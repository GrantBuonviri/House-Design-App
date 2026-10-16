import type { FloorPlan, HouseStructure, Level, Point } from "@/lib/model/schema";
import { floorFootprint, roofFootprint, type Region } from "@/lib/house3d/footprint";
import { areaKind } from "@/lib/plan/measure";
import { wallPieces, type WallPiece } from "@/lib/plan/walls";
import { lerp, pointInPolygon, project as projectOnto } from "@/lib/plan/geometry";
import { formatFeetInches } from "@/lib/model/units";
import { outerEdges, overhangsOf, overPorches, type Overhang } from "@/lib/plan/support";
import { codeNum, codeTable } from "@/lib/codes/data";
import { along, intersectRegions, lineIntervals, other, pt, regionBounds, runsAcross, stripPositions, type Axis } from "./geometry";
import { pickCantilever, pickHeader, pickJoist, type CantileverPick, type HeaderPick, type JoistPick } from "./tables";

/**
 * Floor framing, one floor at a time: which way the joists run, what holds
 * them up (the walls below, or girders on piers over a crawlspace or
 * basement), and the smallest joist from the IRC span table that reaches.
 * Whatever the tables can't reach is listed as "Engineer required".
 */

export type Engineer = { levelId: string; text: string; at?: Point };

/** Something the joists rest on partway across: a wall below, or a girder. */
export type Bearing = {
  a: Point;
  b: Point;
  /** Its coordinate along the joists. */
  pos: number;
  /** How far it reaches across the joists. */
  w0: number;
  w1: number;
  kind: "wall" | "girder";
  /** A wall on the floor below. */
  piece?: WallPiece;
};

export type Pier = { at: Point; sizeIn: number; thicknessIn: number; loadLb: number };

export type Girder = {
  a: Point;
  b: Point;
  /** Header table column: it holds one floor, or a floor and a bearing wall from the floor above. */
  condition: "one-floor-only" | "two-floors";
  /** Joist length it carries across, for the table's building width. */
  widthIn: number;
  pick: HeaderPick | null;
  /** Piers between its ends (and at an end that stops at a floor opening). */
  piers: Pier[];
  /** Distance between supports. */
  bayIn: number;
};

/** A room on this floor that sticks out past the wall below on its joists, sized from the IRC cantilever table. */
export type Cantilever = { roomId: string; name: string; depthIn: number; pick: CantileverPick; backspanIn: number; at: Point };

export type FloorFraming = {
  levelId: string;
  /** What's under this floor. */
  over: "crawlspace" | "basement" | "floor";
  regions: Region[];
  /** Floor openings (stairs coming up). */
  openings: Point[][];
  axis: Axis;
  joist: JoistPick | null;
  maxSpanIn: number;
  /** Walls below that hold the joists partway across. */
  bearingWalls: Bearing[];
  girders: Girder[];
  /** Spots where the joists' end has nothing under it. */
  unsupported: Point[];
  /** How many 12" strips of floor have an end with nothing under it. */
  looseStrips: number;
  /** Short cantilevers the table covers. */
  cantilevers: Cantilever[];
  engineer: Engineer[];
};

export type FramingInput = {
  level: Level;
  plan: FloorPlan;
  over: FloorFraming["over"];
  /** The floor's framed area (garage and slab parts left out). */
  regions: Region[];
  openings: Point[][];
  /** The floor below's plan, for floors over a floor. */
  below?: FloorPlan;
  exteriorIn: number;
  structure: HouseStructure;
  /** Walls on this floor that hold up the floor above, so girders must go under them. */
  carry?: Bearing[];
  /** There's a floor on top of this one (a cantilever then holds more than a wall and roof). */
  floorAbove?: boolean;
};

const HALF_SUPPORT_IN = 6;
/** How far a joist end can sit from the wall below and still bear on it. */
const ON_WALL_IN = 8;
/** Girder bay the app aims for between piers: the lightest girder that reaches it. */
const GIRDER_BAY_TARGET_IN = 72;

type Strip = { w: number; spans: [number, number][] };

/** Every strip of floor along `axis`, and the spans between the bearings that cross it. Strips at `skip` don't count toward the longest span. */
function spansOf(regions: Region[], axis: Axis, bearings: Bearing[], skip: Set<number> = new Set()): { max: number; strips: Strip[] } {
  let max = 0;
  const strips: Strip[] = [];
  for (const w of stripPositions(regions, axis)) {
    const counts = !skip.has(w);
    const spans: [number, number][] = [];
    for (const [s, e] of lineIntervals(regions, axis, w)) {
      const cuts = bearings.filter((b) => w >= b.w0 - 1 && w <= b.w1 + 1 && b.pos > s + HALF_SUPPORT_IN && b.pos < e - HALF_SUPPORT_IN).map((b) => b.pos);
      const stops = [s, ...[...new Set(cuts)].sort((p, q) => p - q), e];
      for (let i = 0; i + 1 < stops.length; i++) {
        spans.push([stops[i], stops[i + 1]]);
        if (counts) max = Math.max(max, stops[i + 1] - stops[i]);
      }
    }
    strips.push({ w, spans });
  }
  return { max, strips };
}

/** Walls on a floor plan that run across `axis`, as bearings. */
function wallBearings(plan: FloorPlan, exteriorIn: number, axis: Axis): Bearing[] {
  const cross = other(axis);
  return wallPieces(plan, exteriorIn)
    // Half walls stop short of the ceiling, so nothing above rests on them.
    .filter((p) => !p.open && !p.height && runsAcross(p.a, p.b, axis))
    .map((p) => {
      const w0 = Math.min(along(p.a, cross), along(p.b, cross));
      const w1 = Math.max(along(p.a, cross), along(p.b, cross));
      return { a: p.a, b: p.b, pos: (along(p.a, axis) + along(p.b, axis)) / 2, w0, w1, kind: "wall" as const, piece: p };
    });
}

/** Lay out one floor's framing, trying both directions and keeping the better one. */
export function frameFloor(input: FramingInput): FloorFraming {
  const tries = (["x", "y"] as Axis[]).map((axis) => (input.over === "floor" ? overFloor(input, axis) : overGirders(input, axis)));
  const score = (f: FloorFraming) => f.looseStrips * 1e7 + f.engineer.length * 1e6 + (f.girders.length + f.bearingWalls.length) * 1e3 + (f.joist ? ["2x8", "2x10", "2x12"].indexOf(f.joist.size) * 10 + (f.joist.spacing === 12 ? 5 : 0) : 500) + f.maxSpanIn / 1e3;
  return tries.sort((a, b) => score(a) - score(b))[0];
}

function base(input: FramingInput, axis: Axis): FloorFraming {
  return { levelId: input.level.id, over: input.over, regions: input.regions, openings: input.openings, axis, joist: null, maxSpanIn: 0, bearingWalls: [], girders: [], unsupported: [], looseStrips: 0, cantilevers: [], engineer: [] };
}

/** A floor resting on the walls of the floor below. */
function overFloor(input: FramingInput, axis: Axis): FloorFraming {
  const out = base(input, axis);
  const below = input.below ? wallBearings(input.below, input.exteriorIn, axis) : [];
  const { lumber } = input.structure;

  // Joist ends must land on a wall below, unless they stop at a floor opening (doubled joists and headers there).
  const atOpening = (p: Point) => input.openings.some((h) => pointInPolygon(p, h));
  const onWall = (s: number, w: number) => below.some((b) => Math.abs(b.pos - s) <= ON_WALL_IN && w >= b.w0 - 2 && w <= b.w1 + 2);
  const loose = new Set<number>();
  let run: Point[] = [];
  const flush = () => {
    if (run.length >= 2) out.unsupported.push(run[Math.floor(run.length / 2)]);
    run = [];
  };
  for (const end of [0, 1] as const) {
    for (const w of stripPositions(input.regions, axis)) {
      const ivs = lineIntervals(input.regions, axis, w);
      let hit: Point | null = null;
      for (const iv of ivs) {
        const s = iv[end];
        const beyond = pt(axis, s + (end === 0 ? -3 : 3), w);
        if (!onWall(s, w) && !atOpening(beyond)) hit = pt(axis, s, w);
      }
      if (hit) loose.add(w);
      if (hit) run.push(hit);
      else flush();
    }
    flush();
  }

  // Add walls below as bearing, the most useful first, until a joist reaches.
  const interior = below.filter((b) => !b.piece?.exterior);
  const chosen: Bearing[] = [];
  // Joists are picked for the part that has walls under both ends; the rest needs an engineer anyway.
  let stats = spansOf(input.regions, axis, chosen, loose);
  for (let i = 0; i < 8 && !pickJoist(lumber, stats.max); i++) {
    let best: { b: Bearing; max: number } | null = null;
    for (const b of interior) {
      if (chosen.includes(b)) continue;
      const m = spansOf(input.regions, axis, [...chosen, b], loose).max;
      if (m < stats.max - 1 && (!best || m < best.max)) best = { b, max: m };
    }
    if (!best) break;
    chosen.push(best.b);
    stats = spansOf(input.regions, axis, chosen, loose);
  }
  // Keep walls that are bearing anyway (they cut the span the joists are picked for), merged per line.
  out.bearingWalls = chosen;
  out.maxSpanIn = stats.max;
  out.looseStrips = loose.size;
  const anySupported = stripPositions(input.regions, axis).some((w) => !loose.has(w));
  out.joist = anySupported ? pickJoist(lumber, stats.max) : null;
  if (!out.joist && anySupported) out.engineer.push({ levelId: input.level.id, text: `${input.level.name} floor: the joists would span ${feet(stats.max)}, longer than the IRC span table allows. A beam or engineered floor joists need an engineer or the joist supplier.` });
  const held = input.below ? heldUp(input, input.below) : { cantilevers: [], engineer: [], fine: [], named: [] };
  out.cantilevers = held.cantilevers;
  out.engineer.push(...held.engineer);
  // Joist ends at a short cantilever the table covers are fine; ends a named note covers don't need the general one.
  const near = (p: Point, polys: Point[][]) => polys.some((poly) => pointInPolygon(p, poly) || poly.some((a, i) => projectOnto(p, a, poly[(i + 1) % poly.length]).d <= 3));
  out.unsupported = out.unsupported.filter((p) => !near(p, held.fine));
  const unexplained = out.unsupported.filter((p) => !near(p, held.named));
  if (unexplained.length)
    out.engineer.push({ levelId: input.level.id, text: `${input.level.name}: part of the floor isn't over a wall of the floor below (an overhang or a floor over open space). An engineer must design the beam or cantilever.`, at: unexplained[0] });
  return out;
}

/** How far the floor reaches along a line through `c` in direction `n` (the roof width the cantilever table asks for). */
function widthThrough(regions: Region[], c: Point, n: Point): number {
  const ts: number[] = [];
  for (const r of regions)
    for (const ring of [r.outline, ...r.holes])
      ring.forEach((a, i) => {
        const b = ring[(i + 1) % ring.length];
        const e = { x: b.x - a.x, y: b.y - a.y };
        const den = n.x * e.y - n.y * e.x;
        if (Math.abs(den) < 1e-9) return;
        const t = ((a.x - c.x) * e.y - (a.y - c.y) * e.x) / den;
        const u = ((a.x - c.x) * n.y - (a.y - c.y) * n.x) / den;
        if (u >= 0 && u <= 1) ts.push(t);
      });
  const lo = Math.max(...ts.filter((t) => t <= 0));
  const hi = Math.min(...ts.filter((t) => t >= 0));
  return Number.isFinite(lo) && Number.isFinite(hi) ? hi - lo : Infinity;
}

/** The outward direction of an overhang piece: across its longest outer edge. */
function outward(o: Overhang, support: Region[]): Point | null {
  let best: { e: [Point, Point]; piece: Point[]; len: number } | null = null;
  for (const piece of o.pieces)
    for (const e of outerEdges(piece, support)) {
      const len = Math.hypot(e[1].x - e[0].x, e[1].y - e[0].y);
      if (!best || len > best.len) best = { e, piece, len };
    }
  if (!best) return null;
  const [a, b] = best.e;
  const n = { x: (b.y - a.y) / best.len, y: -(b.x - a.x) / best.len };
  // Point it away from the room.
  const mid = lerp(a, b, 0.5);
  return pointInPolygon({ x: mid.x + n.x * 2, y: mid.y + n.y * 2 }, best.piece) ? { x: -n.x, y: -n.y } : n;
}

/** Rooms on a floor over a floor that are held up on purpose (per their "Hangs over the floor below" setting) or sit over a porch. */
function heldUp(input: FramingInput, below: FloorPlan): { cantilevers: Cantilever[]; engineer: Engineer[]; fine: Point[][]; named: Point[][] } {
  const L = input.level.id;
  const support = roofFootprint(below);
  const byId = new Map(input.plan.rooms.map((r) => [r.id, r]));
  const cantilevers: Cantilever[] = [];
  const engineer: Engineer[] = [];
  const fine: Point[][] = [];
  const named: Point[][] = [];
  const snow = codeNum("design.groundSnowLoad");
  for (const o of overhangsOf(input.plan.rooms, support)) {
    const room = byId.get(o.roomId)!;
    const reach = formatFeetInches(o.depthIn);
    if (o.kind === "none") {
      engineer.push({ levelId: L, text: `${room.name} hangs ${reach} past the wall below with nothing holding it up: an engineer must design a beam or cantilever (or pull the room back over the wall below).`, at: o.at });
      named.push(...o.pieces);
      continue;
    }
    if (o.kind === "posts") {
      engineer.push({ levelId: L, text: `${room.name} hangs ${reach} past the wall below on posts and a beam: an engineer must size the beam, the posts and their footings.`, at: o.at });
      named.push(...o.pieces);
      continue;
    }
    if (o.kind === "engineered") {
      engineer.push({ levelId: L, text: `${room.name} hangs ${reach} past the wall below on an engineered beam or truss: an engineer must design it.`, at: o.at });
      named.push(...o.pieces);
      continue;
    }
    // A short cantilever: the joists run out past the wall below.
    const n = outward(o, support);
    const roofWidthIn = n ? widthThrough(input.regions, o.at, n) : Infinity;
    const backspanIn = roofWidthIn - o.depthIn;
    const pick = !input.floorAbove && o.ok ? pickCantilever(o.depthIn, roofWidthIn, snow) : null;
    if (pick && backspanIn >= 3 * o.depthIn) {
      cantilevers.push({ roomId: room.id, name: room.name, depthIn: o.depthIn, pick, backspanIn, at: o.at });
      fine.push(...o.pieces);
      continue;
    }
    const why = input.floorAbove
      ? "it holds up a floor above, and the IRC cantilever table only covers an outside wall and roof"
      : !o.ok
        ? "that's past a short cantilever's 2'"
        : !pick
          ? "that's past the IRC cantilever table for this roof width"
          : "the joists don't run back far enough inside (the IRC asks for 3 times the cantilever)";
    engineer.push({ levelId: L, text: `${room.name} sticks out ${reach} past the wall below on its joists, but ${why}. An engineer must design the cantilever.`, at: o.at });
    named.push(...o.pieces);
  }
  // Rooms over a covered porch or patio: the porch's beam and posts carry them.
  const seen = new Set<string>();
  for (const { roomId, porch } of overPorches(input.plan.rooms, below)) {
    if (seen.has(`${roomId}:${porch.id}`)) continue;
    seen.add(`${roomId}:${porch.id}`);
    const room = byId.get(roomId)!;
    const p = porch.name.toLowerCase();
    engineer.push({ levelId: L, text: `${room.name} sits over the ${p}: the ${p} beam and posts must be sized by an engineer.`, at: porch.polygon[0] && lerp(porch.polygon[0], porch.polygon[Math.floor(porch.polygon.length / 2)], 0.5) });
    named.push(porch.polygon);
  }
  return { cantilevers, engineer, fine, named };
}

/** A floor over a crawlspace or basement: girders on piers or posts wherever they help, plus girders under walls that hold up the floor above. */
function overGirders(input: FramingInput, axis: Axis): FloorFraming {
  const out = base(input, axis);
  const { lumber } = input.structure;
  const b = regionBounds(input.regions);
  if (!b) return out;
  const cross = other(axis);
  const s0 = axis === "x" ? b.x0 : b.y0;
  const s1 = axis === "x" ? b.x1 : b.y1;

  // Girders under the walls that carry the floor above.
  const forced: Bearing[] = (input.carry ?? []).map((c) => {
    const across = runsAcross(c.a, c.b, axis);
    const pos = across ? (along(c.a, axis) + along(c.b, axis)) / 2 : NaN;
    return { ...c, kind: "girder" as const, pos, w0: Math.min(along(c.a, cross), along(c.b, cross)), w1: Math.max(along(c.a, cross), along(c.b, cross)) };
  });
  const forcedAcross = forced.filter((f) => !Number.isNaN(f.pos));

  const linesAt = (positions: number[]): Bearing[] =>
    positions.flatMap((pos) =>
      lineIntervals(input.regions, cross, pos)
        .filter(([w0, w1]) => w1 - w0 > 24)
        .map(([w0, w1]) => ({ a: pt(axis, pos, w0), b: pt(axis, pos, w1), pos, w0, w1, kind: "girder" as const })),
    );

  let lines: Bearing[] = [];
  let stats = spansOf(input.regions, axis, forcedAcross);
  let joist = pickJoist(lumber, stats.max, true);
  for (let k = 1; k <= 6 && !joist; k++) {
    const positions = Array.from({ length: k }, (_, i) => s0 + ((s1 - s0) * (i + 1)) / (k + 1)).filter((p) => !forcedAcross.some((f) => Math.abs(f.pos - p) < 36));
    lines = linesAt(positions);
    stats = spansOf(input.regions, axis, [...forcedAcross, ...lines]);
    joist = pickJoist(lumber, stats.max, true) ?? (k === 6 ? pickJoist(lumber, stats.max) : null);
  }
  out.maxSpanIn = stats.max;
  out.joist = joist;
  if (!joist) out.engineer.push({ levelId: input.level.id, text: `${input.level.name} floor: even with girders the joists span ${feet(stats.max)}, past the IRC span table. An engineer must lay out this floor.` });

  const all = [...forced, ...lines];
  const live = spansOf(input.regions, axis, all.filter((g) => !Number.isNaN(g.pos)));
  const soil = input.structure.soilPsf;
  const loads = codeTable<number>("struct.liveLoads");
  const psf = (loads.floorLiving ?? 40) + codeNum("struct.floorDeadLoad");
  for (const g of all) {
    const condition: Girder["condition"] = forced.includes(g) ? "two-floors" : "one-floor-only";
    // The joists on both sides of the girder. The tables' building width is taken as twice what the girder carries
    // (the tables assume a girder down the middle of the house), measured where it carries the most.
    const gpos = Number.isNaN(g.pos) ? null : g.pos;
    let width = 0;
    for (const st of live.strips) {
      if (st.w < g.w0 - 1 || st.w > g.w1 + 1) continue;
      const sides = gpos === null ? [] : st.spans.filter(([s, e]) => Math.abs(s - gpos) < 1 || Math.abs(e - gpos) < 1);
      width = Math.max(width, sides.reduce((t, [s, e]) => t + (e - s), 0));
    }
    // A girder under a wall that runs along the joists carries the wall, not joists: use the narrowest column.
    if (width === 0) width = 144;
    const trib = width / 2;
    const len = Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y);
    const rows = [GIRDER_BAY_TARGET_IN, 96, 48].map((target) => pickHeader("interior", condition, width, Math.min(target, len)));
    const pick = rows.find((r) => r) ?? null;
    const bays = pick ? Math.max(1, Math.ceil(len / pick.spanIn - 1e-6)) : 1;
    const bayIn = len / bays;
    const piers: Pier[] = [];
    // An end that stops at a floor opening (not the foundation wall) needs its own pier.
    const beyond = (p: Point, q: Point) => lerp(p, q, -3 / Math.max(len, 1));
    const atOpening = (p: Point) => input.openings.some((h) => pointInPolygon(p, h));
    const stations = Array.from({ length: bays - 1 }, (_, i) => (i + 1) / bays);
    if (atOpening(beyond(g.a, g.b))) stations.unshift(0);
    if (atOpening(beyond(g.b, g.a))) stations.push(1);
    const floors = condition === "two-floors" ? 2 : 1;
    const loadLb = Math.round((bayIn / 12) * (trib / 12) * psf * floors);
    const side = Math.max(16, Math.ceil(Math.sqrt(loadLb / soil) * 12 / 2) * 2);
    const thick = Math.max(8, Math.ceil((side - 8) / 2));
    for (const t of stations) piers.push({ at: lerp(g.a, g.b, t), sizeIn: side, thicknessIn: thick, loadLb });
    out.girders.push({ a: g.a, b: g.b, condition, widthIn: width, pick, piers, bayIn });
    if (!pick) out.engineer.push({ levelId: input.level.id, text: `${input.level.name} floor: a girder carrying ${feet(width)} of joists is past the IRC girder table. An engineer must size it.`, at: lerp(g.a, g.b, 0.5) });
  }
  return out;
}

const feet = (inches: number) => `${Math.round((inches / 12) * 10) / 10} ft`;

/** The parts of a floor that are framed (not the garage, which sits on a slab). */
export function framedRegions(plan: FloorPlan, within?: Region[]): Region[] {
  const indoor = floorFootprint({ ...plan, rooms: plan.rooms.filter((r) => areaKind(r) === "living") });
  return within ? intersectRegions(indoor, within) : indoor;
}
