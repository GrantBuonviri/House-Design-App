import type { FloorPlan, Level, Opening, PlanRoom, Point, WindowOperation } from "@/lib/model/schema";
import { escapeCheck } from "@/lib/codes/openings";
import { codeNum } from "@/lib/codes/data";
import { freeSpot, newOpening, openingRooms } from "./connect";
import { openingType } from "./catalog";
import { hostSegment } from "./walls";
import { add, collinearOverlap, dist, dot, edgesOf, leftNormal, lerp, pointInPolygon, polygonArea, scale, sub, subtractIntervals, unit } from "./geometry";
import { areaKind } from "./measure";
import { BEDROOMS } from "./closets";
import { isCurved, roomEdgeArc, roomEdgeLength } from "./arcs";
import { sharedEdges, widestUnit } from "./bend";

/** Suggest a plan: windows on outside walls, more and bigger on the sunny south side. */

const SOUTH: Point = { x: 0, y: 1 };

/**
 * Afternoon sun comes from the west and heats rooms most, so west glass is kept small:
 * at most 25% of a room's window area, and 4% of the house's floor area in all. Walls facing
 * within 60 degrees of due west count as west.
 */
const WEST_SHARE = 0.25;
const WEST_OF_FLOOR = 0.04;
const isWest = (n: Point) => n.x <= -0.5;
/** A window over the kitchen sink: its sill sits 42" up, just over the counter and backsplash. */
const SINK_SILL_IN = 42;
const SINK_HEIGHT_IN = 36;
/** How close (inches) a sink's centre is to an outside wall for the window to go over it. */
const SINK_REACH_IN = 36;

const sqft = (widthIn: number, heightIn: number) => (widthIn * heightIn) / 144;

// ---------- Windows ----------

const NO_WINDOWS = new Set(["hall", "closet", "pantry", "primary-closet", "mechanical", "storage", "garage", "entry"]);
const BATHS = new Set(["bathroom", "half-bath", "primary-bath"]);
const SUNNY = new Set(["living", "family", "dining", "sunroom", "kitchen"]);
const ONE_SMALL = new Set(["laundry", "mudroom"]);
const END_IN = 18;
/** An escape window may sit closer to a corner than the usual windows: a short outside wall still takes one. */
const ESCAPE_END_IN = 4;

type Placement = { style: string; widthIn: number; operation?: WindowOperation };

/** `t0`, `t1` are inches along the wall (along the curve on a curved one, which also has its `radius`). */
export type Stretch = { a: Point; b: Point; t0: number; t1: number; host: { roomId: string; edge: number }; radius?: number };

/** Stretches of a room's walls with nothing indoors on the other side: open air, or a porch, patio or deck. */
export function outsideStretches(plan: FloorPlan, room: PlanRoom): Stretch[] {
  const indoor = plan.rooms.filter((r) => r.id !== room.id && areaKind(r) !== "outdoor");
  const out: Stretch[] = [];
  for (const e of edgesOf(room.polygon)) {
    const L = dist(e.a, e.b);
    if (L < 1) continue;
    if (isCurved(room.bulges?.[e.i])) {
      // A curved wall: the whole curve, inches along it, unless an indoor room shares it.
      const shared = indoor.some((o) => o.polygon.some((p) => dist(p, e.a) < 1) && o.polygon.some((p) => dist(p, e.b) < 1) && sharedEdges(plan, room.id, e.i).some((x) => x.roomId === o.id));
      if (!shared) out.push({ a: e.a, b: e.b, t0: 0, t1: roomEdgeLength(room, e.i), host: { roomId: room.id, edge: e.i }, radius: roomEdgeArc(room, e.i)!.radius });
      continue;
    }
    const cuts: [number, number][] = [];
    for (const other of indoor) {
      for (const f of edgesOf(other.polygon)) {
        const o = collinearOverlap(e.a, e.b, f.a, f.b, 1);
        if (o) cuts.push(o);
      }
    }
    for (const [t0, t1] of subtractIntervals(L, cuts)) out.push({ a: e.a, b: e.b, t0, t1, host: { roomId: room.id, edge: e.i } });
  }
  return out;
}

/** Is an indoor room just outside this stretch of wall (a few inches away, so a window would look into it)? */
export function roomJustOutside(plan: FloorPlan, s: Stretch): boolean {
  if (s.radius) return false; // A shared curve was already left out; nothing sits a few inches off a curve.
  const n = leftNormal(unit(sub(s.b, s.a)));
  const L = dist(s.a, s.b);
  return [0.25, 0.5, 0.75].some((k) => {
    const p = add(lerp(s.a, s.b, (s.t0 + (s.t1 - s.t0) * k) / L), scale(n, 12));
    return plan.rooms.some((r) => areaKind(r) !== "outdoor" && pointInPolygon(p, r.polygon));
  });
}

/** Windows on each room's outside walls: more and bigger facing south, fewer facing north. */
/** Is the ground just outside this stretch of wall covered by the floor above (a basement wall under the main floor)? */
export function buriedStretch(s: Stretch, covered: Point[][]): boolean {
  if (!covered.length) return false;
  const n = leftNormal(unit(sub(s.b, s.a)));
  const L = dist(s.a, s.b);
  return [0.25, 0.5, 0.75].some((k) => {
    const p = add(lerp(s.a, s.b, (s.t0 + (s.t1 - s.t0) * k) / L), scale(n, 18));
    return covered.some((poly) => pointInPolygon(p, poly));
  });
}

/**
 * Windows on each room's outside walls: more and bigger facing south, fewer facing north.
 * `covered` is where the floor above covers the ground (see wells.ts `coveredAbove`): a
 * basement gets no windows in walls buried under it.
 */
export function addWindows(plan: FloorPlan, level: Pick<Level, "kind">, covered: Point[][] = []): { plan: FloorPlan; added: number } {
  let p = plan;
  let added = 0;
  const westBudget = (plan.rooms.filter((r) => areaKind(r) === "living").reduce((n, r) => n + polygonArea(r.polygon), 0) / 144) * WEST_OF_FLOOR;
  let westUsed = 0;
  for (const room of plan.rooms) {
    const type = room.type ?? "other";
    if (areaKind(room) !== "living" || NO_WINDOWS.has(type)) continue;
    if (p.openings.some((o) => o.kind === "window" && "roomId" in o.host && o.host.roomId === room.id)) continue;
    const mine = outsideStretches(plan, room)
      .map((w) => ({ w, n: leftNormal(unit(sub(w.b, w.a))), usable: w.t1 - w.t0 - 2 * END_IN }))
      // Not where another room is just a few inches away.
      .filter((x) => x.usable >= 24 && !roomJustOutside(plan, x.w) && !buriedStretch(x.w, covered))
      .map((x) => ({ ...x, facing: dot(x.n, SOUTH) }))
      // Sunniest first, then east before west, north last; longer walls first.
      .sort((a, b) => b.facing - a.facing || a.n.x * -1 - b.n.x * -1 || b.usable - a.usable);
    const bedroom = BEDROOMS.has(type);
    if (!mine.length) {
      // Too little outside wall for the usual windows; a bedroom still gets an escape window if one fits.
      if (bedroom) {
        const fixed = makeEscapeWindow(p, room.id, level, covered);
        if (fixed.added) added++;
        p = fixed.plan;
      }
      continue;
    }

    const plans: { piece: (typeof mine)[number]; count: number; place: Placement }[] = [];
    if (level.kind === "basement") {
      // Below ground: an egress window for bedrooms, a high window elsewhere.
      plans.push({ piece: mine[0], count: 1, place: bedroom ? { style: "window", widthIn: 36, operation: "casement" } : { style: "window-high", widthIn: 48 } });
    } else if (BATHS.has(type)) {
      const longest = [...mine].sort((a, b) => b.usable - a.usable)[0];
      plans.push({ piece: longest, count: 1, place: { style: "window-high", widthIn: type === "half-bath" ? 24 : 36 } });
    } else if (ONE_SMALL.has(type)) {
      plans.push({ piece: mine[0], count: 1, place: { style: "window", widthIn: 30 } });
    } else if (bedroom) {
      const most = type === "primary-bedroom" ? 3 : 2;
      // The sunniest one is a casement, which opens all the way: the room's escape window.
      mine.slice(0, most).forEach((piece, i) => plans.push({ piece, count: 1, place: { style: "window", widthIn: type === "primary-bedroom" ? 48 : 36, ...(i === 0 ? { operation: "casement" as const } : {}) } }));
    } else {
      let total = 0;
      let picture = SUNNY.has(type) && type !== "kitchen";
      for (const piece of mine) {
        const south = piece.facing > 0.6;
        const north = piece.facing < -0.6;
        let count = south ? Math.max(1, Math.floor(piece.usable / 108)) : north ? (piece.usable >= 192 ? 2 : piece.usable >= 48 ? 1 : 0) : Math.min(2, Math.max(piece.usable >= 48 ? 1 : 0, Math.floor(piece.usable / 120)));
        if (type === "kitchen") count = Math.min(count, 2 - total);
        count = Math.min(count, 5 - total);
        if (count <= 0) continue;
        if (south && picture && piece.usable >= 96) {
          plans.push({ piece, count: 1, place: { style: "window-picture", widthIn: Math.min(96, Math.floor((piece.usable - 12) / 12) * 12) } });
          picture = false;
          total += 1;
          continue;
        }
        const room_ = piece.usable / count - 24;
        const widthIn = south ? Math.min(72, Math.max(36, Math.floor(room_ / 12) * 12)) : north ? 36 : room_ >= 48 ? 48 : 36;
        plans.push({ piece, count, place: { style: "window", widthIn } });
        total += count;
      }
    }

    // A kitchen gets a window over the sink, or on its best wall where a sink can go later.
    let sinkArea = 0;
    let sinkWest = false;
    if (type === "kitchen" && level.kind !== "basement") {
      const sink = sinkWindow(p, room, mine);
      if (sink) {
        p = { ...p, openings: [...p.openings, sink.opening] };
        added++;
        sinkArea = sqft(sink.opening.widthIn, sink.opening.heightIn);
        sinkWest = sink.west;
        // The sink window is one of the kitchen's two.
        const first = plans.findIndex((x) => x.count > 0);
        if (first >= 0 && plans.reduce((n, x) => n + x.count, 0) >= 2) plans[first] = { ...plans[first], count: plans[first].count - 1 };
      }
    }
    if (level.kind !== "basement") {
      const need = (polygonArea(room.polygon) / 144) * ((codeNum("light.glazingPctOfFloor") * 1.15) / 100);
      const cut = capWest(plans, mine, sinkArea, sinkWest, Math.max(0, westBudget - westUsed), need);
      westUsed += cut.westArea + (sinkWest ? sinkArea : 0);
    }

    for (const { piece, count, place } of plans) {
      if (count <= 0) continue;
      const { w } = piece;
      const slot = (w.t1 - w.t0) / count;
      for (let k = 0; k < count; k++) {
        const t0 = w.t0 + k * slot + (k === 0 ? END_IN : 6);
        const t1 = w.t0 + (k + 1) * slot - (k === count - 1 ? END_IN : 6);
        // On a curve, windows are spaced along it and kept narrow enough to sit in it flat.
        const fitsCurve = w.radius ? Math.floor(widestUnit(w.radius) / 6) * 6 : Infinity;
        const widthIn = Math.min(place.widthIn, fitsCurve, Math.floor((t1 - t0 - 4) / 6) * 6);
        if (widthIn < 24) continue;
        const at = freeSpot(p, w.host, t0, t1, widthIn, 12);
        if (at === null) continue;
        const o = newOpening(place.style, w.host, at, 1, widthIn);
        p = { ...p, openings: [...p.openings, place.operation ? { ...o, operation: place.operation } : o] };
        added++;
      }
    }
    // Every bedroom ends up with a window you could climb out of.
    if (bedroom && !hasEscape(p, room.id, level.kind === "basement")) {
      const fixed = makeEscapeWindow(p, room.id, level, covered);
      if (fixed.added) added++;
      p = fixed.plan;
    }
  }
  // A basement with rooms to live in and no door outside needs an escape window too (with a well, see wells.ts).
  if (level.kind === "basement" && !p.openings.some((o) => o.kind === "door" && openingRooms(p, o).includes(null))) {
    const living = p.rooms.filter((r) => areaKind(r) === "living" && !NO_WINDOWS.has(r.type ?? "other"));
    const anyEscape = p.openings.some((o) => o.kind === "window" && escapeCheck(o, true).ok);
    const biggest = [...living].sort((a, b) => polygonArea(b.polygon) - polygonArea(a.polygon)).find((r) => outsideStretches(p, r).some((w) => w.t1 - w.t0 >= 2 * ESCAPE_END_IN + 30 && !buriedStretch(w, covered)));
    if (living.length && !anyEscape && biggest) {
      const fixed = makeEscapeWindow(p, biggest.id, level, covered);
      if (fixed.added) added++;
      p = fixed.plan;
    }
  }
  return { plan: p, added };
}

type Planned = { piece: { w: Stretch; n: Point; usable: number; facing: number }; count: number; place: Placement };
type Piece = Planned["piece"];

const areaOf = (e: Planned) => e.count * sqft(e.place.widthIn, openingType(e.place.style).heightIn);

/**
 * Trims the planned windows on west walls down to the west glass limit, then moves some of what
 * was cut to a south or east wall that has no window yet. Returns the west glass left, in sq ft.
 * A room with no other wall keeps one small west window rather than none.
 */
function capWest(plans: Planned[], mine: Piece[], sinkArea: number, sinkWest: boolean, houseLeft: number, needSqft: number): { westArea: number } {
  const west = (e: Planned) => isWest(e.piece.n);
  const other = plans.filter((e) => !west(e)).reduce((n, e) => n + areaOf(e), 0) + (sinkWest ? 0 : sinkArea);
  // w <= 25% of (w + other)  means  w <= other / 3.
  const room = other > 0 ? other * (WEST_SHARE / (1 - WEST_SHARE)) : 0;
  let westArea = plans.filter(west).reduce((n, e) => n + areaOf(e), 0) + (sinkWest ? sinkArea : 0);
  // Light comes first: where the other walls can't give the room the 8% glass the code wants, west windows make up the rest.
  const limit = Math.max(Math.min(room, houseLeft), Math.min(westArea, needSqft - other));
  const before = westArea;
  const sizeable = () => plans.filter((e) => west(e) && e.count > 0);
  while (westArea > limit) {
    const big = [...sizeable()].sort((a, b) => areaOf(b) - areaOf(a))[0];
    if (!big) break;
    const only = plans.every((e) => e === big || e.count <= 0) && sinkArea === 0;
    if (big.count > 1) big.count--;
    else if (big.place.style === "window-picture") big.place = { style: "window", widthIn: 48 };
    else if (big.place.widthIn > 24) big.place = { ...big.place, widthIn: Math.max(24, big.place.widthIn - 12) };
    else if (only) break;
    else big.count = 0;
    westArea = plans.filter(west).reduce((n, e) => n + areaOf(e), 0) + (sinkWest ? sinkArea : 0);
  }
  // Give some of it back on a south or east wall that has no window yet.
  const removed = before - westArea;
  if (removed > 0.5) {
    const used = new Set(plans.filter((e) => e.count > 0).map((e) => e.piece.w.host.edge + ":" + e.piece.w.t0));
    const spare = mine.find((m) => !isWest(m.n) && m.facing > -0.6 && !used.has(m.w.host.edge + ":" + m.w.t0));
    if (spare) {
      const widthIn = Math.min(48, Math.floor((spare.usable - 12) / 12) * 12);
      if (widthIn >= 36) plans.push({ piece: spare, count: 1, place: { style: "window", widthIn } });
    }
  }
  return { westArea };
}

/**
 * The kitchen window: over the sink when one is on an outside wall, else in the middle of the
 * best outside wall (south, then east) so a sink can go under it later. Sill 42".
 */
function sinkWindow(plan: FloorPlan, room: PlanRoom, mine: Piece[]): { opening: Opening; west: boolean } | null {
  const sinks = plan.fixtures.filter((f) => f.kind === "sink" && (f.roomId === room.id || pointInPolygon({ x: f.x, y: f.y }, room.polygon)));
  const tryPiece = (piece: Piece, want: number | null) => {
    const { w } = piece;
    const L = w.t1 - w.t0;
    const widthIn = Math.min(L - 2 * END_IN >= 48 ? 48 : 36, Math.floor((L - 2 * END_IN) / 6) * 6);
    if (widthIn < 24) return null;
    const lo = w.t0 + END_IN;
    const hi = w.t1 - END_IN;
    const centre = Math.min(hi - widthIn / 2, Math.max(lo + widthIn / 2, want ?? (w.t0 + w.t1) / 2));
    const at = freeSpot(plan, w.host, centre - widthIn / 2 - 1, centre + widthIn / 2 + 1, widthIn, 6);
    if (at === null) return null;
    const o = { ...newOpening("window", w.host, at, 1, widthIn), heightIn: SINK_HEIGHT_IN, sillIn: SINK_SILL_IN };
    return { opening: o, west: isWest(piece.n) };
  };
  for (const sink of sinks) {
    const c = { x: sink.x, y: sink.y };
    const near = mine
      .map((piece) => {
        const along = dot(sub(c, piece.w.a), unit(sub(piece.w.b, piece.w.a)));
        const foot = add(piece.w.a, scale(unit(sub(piece.w.b, piece.w.a)), along));
        return { piece, along, gap: dist(c, foot) };
      })
      .filter((x) => x.gap <= SINK_REACH_IN && x.along >= x.piece.w.t0 && x.along <= x.piece.w.t1)
      .sort((a, b) => a.gap - b.gap)[0];
    if (near) {
      const got = tryPiece(near.piece, near.along);
      if (got) return got;
    }
  }
  // No sink on an outside wall: the best wall that isn't facing north or west if there is one.
  const order = [...mine].sort((a, b) => Number(isWest(a.n)) - Number(isWest(b.n)));
  for (const piece of order) {
    const got = tryPiece(piece, null);
    if (got) return got;
  }
  return null;
}

/** Outside windows of a room. */
function outsideWindows(plan: FloorPlan, roomId: string): Opening[] {
  return plan.openings.filter((o) => o.kind === "window" && openingRooms(plan, o).includes(roomId) && openingRooms(plan, o).includes(null));
}

/** Does the room have a window that meets the escape sizes? Basements (`gradeFloor`) allow the smaller opening. */
export function hasEscape(plan: FloorPlan, roomId: string, gradeFloor: boolean): boolean {
  return plan.openings.some((o) => o.kind === "window" && openingRooms(plan, o).includes(roomId) && escapeCheck(o, gradeFloor).ok);
}

/** The narrowest catalog window that passes as an escape window when it's a casement (30" with the usual 60" height). */
export function escapeWidth(gradeFloor: boolean): number {
  const t = openingType("window");
  const pass = (w: number) => escapeCheck({ ...newOpening("window", { roomId: "", edge: 0 }, 0, 1, w), operation: "casement" }, gradeFloor).ok;
  return [...t.widths].sort((a, b) => a - b).find(pass) ?? 36;
}

/**
 * "Make this an escape window": the room's biggest outside window becomes a
 * casement big enough to climb out of (and low enough, sill 30"). With no
 * outside window yet, one goes on the sunniest outside wall. `added` says a
 * new window was put in rather than one changed.
 */
export function makeEscapeWindow(plan: FloorPlan, roomId: string, level: Pick<Level, "kind">, covered: Point[][] = []): { plan: FloorPlan; ok: boolean; added: boolean } {
  const room = plan.rooms.find((r) => r.id === roomId);
  if (!room) return { plan, ok: false, added: false };
  const gradeFloor = level.kind === "basement";
  const base = openingType("window");
  const minW = escapeWidth(gradeFloor);
  const buried = (o: Opening) => {
    const seg = hostSegment(plan, o.host);
    return !!seg && buriedStretch({ a: seg.a, b: seg.b, t0: o.offsetIn - 1, t1: o.offsetIn + 1, host: { roomId, edge: 0 } }, covered);
  };
  const westWindow = (o: Opening) => {
    const seg = hostSegment(plan, o.host);
    return seg ? isWest(leftNormal(unit(sub(seg.b, seg.a)))) : false;
  };
  // Not a west window if another will do: afternoon sun comes in there.
  const own = outsideWindows(plan, roomId)
    .filter((o) => !buried(o))
    .sort((a, b) => Number(westWindow(a)) - Number(westWindow(b)) || b.widthIn * b.heightIn - a.widthIn * a.heightIn);
  for (const o of own) {
    const without = { ...plan, openings: plan.openings.filter((x) => x.id !== o.id) };
    const seg = hostSegment(plan, o.host);
    if (!seg) continue;
    const widthIn = Math.max(minW, Math.min(o.widthIn, 72));
    const swapped: Opening = { ...o, style: "window", operation: "casement", widthIn, heightIn: Math.max(o.heightIn, base.heightIn), sillIn: Math.min(o.sillIn ?? 30, base.sillIn ?? 30) };
    if (!escapeCheck(swapped, gradeFloor).ok) continue;
    // Where it was, if it still fits there; else the nearest free spot on the same wall.
    const fitsHere = freeSpot(without, o.host, o.offsetIn - widthIn / 2 - 2, o.offsetIn + widthIn / 2 + 2, widthIn, 0) !== null;
    const at = fitsHere ? o.offsetIn : freeSpot(without, o.host, ESCAPE_END_IN, seg.length - ESCAPE_END_IN, widthIn, 6);
    if (at === null) continue;
    return { plan: { ...without, openings: [...without.openings, { ...swapped, offsetIn: Math.round(at * 10) / 10 }] }, ok: true, added: false };
  }
  // No window that could be made into one: a new casement on the sunniest outside wall that takes it.
  const pieces = outsideStretches(plan, room)
    .filter((w) => !roomJustOutside(plan, w) && !buriedStretch(w, covered))
    .map((w) => ({ w, facing: dot(leftNormal(unit(sub(w.b, w.a))), SOUTH) }))
    .sort((a, b) => b.facing - a.facing || Number(isWest(leftNormal(unit(sub(a.w.b, a.w.a))))) - Number(isWest(leftNormal(unit(sub(b.w.b, b.w.a))))) || b.w.t1 - b.w.t0 - (a.w.t1 - a.w.t0));
  for (const { w } of pieces) {
    const fitsCurve = w.radius ? Math.floor(widestUnit(w.radius) / 6) * 6 : Infinity;
    const widthIn = Math.min(Math.max(minW, 36), fitsCurve, Math.floor((w.t1 - w.t0 - 2 * ESCAPE_END_IN) / 6) * 6);
    if (widthIn < minW) continue;
    const at = freeSpot(plan, w.host, w.t0 + ESCAPE_END_IN, w.t1 - ESCAPE_END_IN, widthIn, 6);
    if (at === null) continue;
    const o = { ...newOpening("window", w.host, at, 1, widthIn), operation: "casement" as const };
    return { plan: { ...plan, openings: [...plan.openings, o] }, ok: true, added: true };
  }
  return { plan, ok: false, added: false };
}
