import polygonClipping, { type Polygon } from "polygon-clipping";
import type { FloorPlan, Level, OverhangKind, PlanRoom, Point } from "@/lib/model/schema";
import { cleanRing, COVERED, roofFootprint, subtractRegions, type Region } from "@/lib/house3d/footprint";
import { levelBelow } from "./basics";
import { planOf, makeRoom, reshapeRoom, type Plans } from "./edit";
import { clockwise, dist, edgesOf, lerp, polygonArea, polygonCenter, roundPoint } from "./geometry";
import { areaKind } from "./measure";
import type { SnapTargets } from "./snap";
import { flatPlans } from "./flatten";
import { isLocked } from "./locks";
import type { Arc } from "./arcs";
import { curvesOf, cutOutline, refitArcs, refitRoom } from "./refit";

/**
 * What holds up a floor: the outline of the floor directly below it (rooms
 * with walls, the garage, and covered porches and patios). A room on an upper
 * floor that reaches past that outline hangs in the air.
 */

/** Overhangs reaching less than this (inches) are walls that nearly line up, not real overhangs. */
export const MIN_OVERHANG_IN = 1;
/** A room trimmed or filled down to less than this (sq in) isn't a room any more. */
const MIN_ROOM_SQIN = 24 * 24;

const ring = (poly: Point[]): [number, number][] => [...poly.map((p): [number, number] => [p.x, p.y]), [poly[0].x, poly[0].y]];
const asPolygons = (regions: Region[]): Polygon[] => regions.map((r) => [ring(r.outline), ...r.holes.map(ring)]);
const fromRing = (r: [number, number][]): Point[] => r.slice(0, -1).map(([x, y]) => ({ x, y }));

/** The floor below a floor that sits on it, and what holds this floor up. Null when there's nothing to check (the main floor and basement sit on the ground, or the floor below is empty). */
/** `arcs` are the curved walls of the floor below, so rooms cut to fit on it can follow its curves. */
export function supportOf(plans: Plans, levels: Level[], level: Level): { below: Level; regions: Region[]; arcs: Arc[] } | null {
  if (level.kind === "main" || level.kind === "basement") return null;
  const below = levelBelow(levels, level);
  if (!below) return null;
  const regions = roofFootprint(planOf(flatPlans(plans), below.id));
  return regions.length ? { below, regions, arcs: curvesOf(planOf(plans, below.id).rooms) } : null;
}

export type Overhang = {
  roomId: string;
  /** The parts of the room past the support area. */
  pieces: Point[][];
  /** How far the farthest corner reaches past the wall below, inches. */
  depthIn: number;
  /** The middle of the biggest piece, to look at. */
  at: Point;
  /** How the room says it's held up. */
  kind: OverhangKind;
  /** Held up on purpose (a short cantilever within 2', posts, or engineered), so no warning. */
  ok: boolean;
};

/** A short cantilever can reach this far past the wall below (inches) before it needs posts or an engineer. */
export const CANTILEVER_MAX_IN = 24;

export const OVERHANG_LABEL: Record<OverhangKind, string> = {
  none: "No",
  cantilever: "Short cantilever (up to 2')",
  posts: "On posts",
  engineered: "Engineered (beam or truss)",
};

export const overhangOf = (room: Pick<PlanRoom, "overhang">): OverhangKind => room.overhang ?? "none";

/** Whether a room held up this way, reaching this far, is fine as drawn. */
export function overhangOk(kind: OverhangKind, depthIn: number): boolean {
  if (kind === "posts" || kind === "engineered") return true;
  return kind === "cantilever" && depthIn <= CANTILEVER_MAX_IN;
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function distToOutline(p: Point, regions: Region[]): number {
  let best = Infinity;
  for (const r of regions) for (const poly of [r.outline, ...r.holes]) for (const e of edgesOf(poly)) best = Math.min(best, distToSegment(p, e.a, e.b));
  return best;
}

/** Which rooms hang past the support area, and by how much. Outdoor rooms (decks, patios) aren't checked. */
export function overhangsOf(rooms: PlanRoom[], regions: Region[]): Overhang[] {
  if (!regions.length) return [];
  const support = asPolygons(regions);
  const out: Overhang[] = [];
  for (const room of rooms) {
    if (areaKind(room) === "outdoor" || room.polygon.length < 3) continue;
    let diff: ReturnType<typeof polygonClipping.difference>;
    try {
      diff = polygonClipping.difference([ring(room.polygon)], ...support);
    } catch {
      continue;
    }
    const pieces: Point[][] = [];
    let depthIn = 0;
    for (const poly of diff) {
      const pts = cleanRing(fromRing(poly[0]), 0.25);
      if (pts.length < 3) continue;
      const depth = Math.max(...pts.map((p) => distToOutline(p, regions)));
      if (depth < MIN_OVERHANG_IN) continue;
      pieces.push(pts);
      depthIn = Math.max(depthIn, depth);
    }
    if (!pieces.length) continue;
    const biggest = pieces.reduce((a, b) => (polygonArea(b) > polygonArea(a) ? b : a));
    const kind = overhangOf(room);
    const depth = Math.round(depthIn);
    out.push({ roomId: room.id, pieces, depthIn: depth, at: polygonCenter(biggest), kind, ok: overhangOk(kind, depth) });
  }
  return out;
}

/** The room trimmed to the support area, as one clean outline. Null when that can't be done cleanly. */
export function pulledBack(room: PlanRoom, regions: Region[]): Point[] | null {
  let out: ReturnType<typeof polygonClipping.intersection>;
  try {
    out = polygonClipping.intersection([ring(cutOutline(room))], ...asPolygons(regions));
  } catch {
    return null;
  }
  if (out.length !== 1 || out[0].length !== 1) return null;
  const pts = clockwise(cleanRing(fromRing(out[0][0]), 0.25));
  if (pts.length < 3 || polygonArea(pts) < MIN_ROOM_SQIN) return null;
  return pts;
}

/** Trim a room to the support area, keeping its curves and following curves of the floor below (`arcs`). The plan comes back unchanged when that can't be done cleanly. */
export function pullBack(plan: FloorPlan, roomId: string, regions: Region[], arcs: Arc[] = []): FloorPlan {
  const room = plan.rooms.find((r) => r.id === roomId);
  const pts = room && !isLocked(plan, roomId) && pulledBack(room, regions);
  if (!room || !pts) return plan;
  const fit = refitArcs(pts, [...curvesOf([room]), ...arcs]);
  return reshapeRoom(plan, roomId, fit.polygon, fit.bulges ?? []);
}

/** The part of the support area with no room on it yet, as outlines to fill. */
export function fillShapes(plan: FloorPlan, regions: Region[]): Point[][] {
  const used: Region[] = plan.rooms.filter((r) => r.polygon.length >= 3).map((r) => ({ outline: clockwise(cutOutline(r)), holes: [] }));
  const left = used.length ? subtractRegions(regions, used) : regions;
  return left.map((r) => clockwise(r.outline)).filter((p) => polygonArea(p) >= MIN_ROOM_SQIN);
}

/** The biggest part of an outline that sits on the support area. Null when none of it does. */
export function largestInside(poly: Point[], regions: Region[]): Point[] | null {
  let out: ReturnType<typeof polygonClipping.intersection>;
  try {
    out = polygonClipping.intersection([ring(poly)], ...asPolygons(regions));
  } catch {
    return null;
  }
  const pieces = out.map((piece) => clockwise(cleanRing(fromRing(piece[0]), 0.25))).filter((pts) => pts.length >= 3 && polygonArea(pts) >= MIN_ROOM_SQIN);
  return pieces.length ? pieces.reduce((a, b) => (polygonArea(b) > polygonArea(a) ? b : a)) : null;
}

/** Every room that hangs past the support area without being held up on purpose, cut back to its biggest part inside it. For the automatic plans. */
export function keepInside(plan: FloorPlan, regions: Region[], arcs: Arc[] = []): { plan: FloorPlan; trimmed: number } {
  let out = plan;
  let trimmed = 0;
  for (const o of overhangsOf(plan.rooms, regions)) {
    if (o.ok || isLocked(plan, o.roomId)) continue;
    const room = out.rooms.find((r) => r.id === o.roomId)!;
    const pts = largestInside(cutOutline(room), regions);
    if (!pts) continue;
    const fit = refitArcs(pts, [...curvesOf([room]), ...arcs]);
    out = reshapeRoom(out, room.id, fit.polygon, fit.bulges ?? []);
    trimmed++;
  }
  return { plan: out, trimmed };
}

/** How much of a floor hangs past the floor below without being held up on purpose (sq in). */
export function hangingArea(plans: Plans, levels: Level[], level: Level): number {
  plans = flatPlans(plans);
  const s = supportOf(plans, levels, level);
  if (!s) return 0;
  return overhangsOf(planOf(plans, level.id).rooms, s.regions)
    .filter((o) => !o.ok)
    .reduce((t, o) => t + o.pieces.reduce((a, p) => a + polygonArea(p), 0), 0);
}

/** The note for a floor whose rooms need more room than the floor below holds. */
export function tooBigNote(level: Pick<Level, "name">, below: Pick<Level, "name">, needSqFt: number, haveSqFt: number): string {
  const sqft = (n: number) => `${Math.round(n).toLocaleString("en-US")} sq ft`;
  return `The ${level.name.toLowerCase()} needs ${sqft(needSqFt)} but the ${below.name.toLowerCase()} is ${sqft(haveSqFt)}, so its rooms were made smaller to fit on top of it. Make the ${below.name.toLowerCase()} bigger, or mark rooms that should stick out with "Hangs over the floor below".`;
}

/** "Fill the floor below": one room on each part of the support area that's still empty. */
export function fillBelow(plan: FloorPlan, regions: Region[], arcs: Arc[] = []): FloorPlan {
  const shapes = fillShapes(plan, regions);
  const curves = [...curvesOf(plan.rooms), ...arcs];
  return { ...plan, rooms: [...plan.rooms, ...shapes.map((poly, i) => refitRoom(makeRoom(poly, shapes.length > 1 ? `Room ${i + 1}` : "Room"), clockwise(poly.map(roundPoint)), curves))] };
}

/** The support outline's corners and walls, to snap to while drawing. */
export function supportTargets(regions: Region[]): SnapTargets {
  const points: Point[] = [];
  const segments: [Point, Point][] = [];
  for (const r of regions) {
    for (const poly of [r.outline, ...r.holes]) {
      points.push(...poly);
      for (const e of edgesOf(poly)) if (dist(e.a, e.b) > 1) segments.push([e.a, e.b]);
    }
  }
  return { points, segments };
}

export const mergeTargets = (a: SnapTargets, b: SnapTargets | null): SnapTargets =>
  b ? { points: [...a.points, ...b.points], segments: [...a.segments, ...b.segments], arcs: [...(a.arcs ?? []), ...(b.arcs ?? [])] } : a;

/** Posts this far apart at most (inches) under the beam of a room "On posts". */
export const POST_SPACING_IN = 96;

/** The edges of an overhang piece that are its outer edges (not along the wall below). */
export function outerEdges(piece: Point[], regions: Region[]): [Point, Point][] {
  return edgesOf(piece)
    .filter((e) => dist(e.a, e.b) > 6 && distToOutline(lerp(e.a, e.b, 0.5), regions) > MIN_OVERHANG_IN)
    .map((e): [Point, Point] => [e.a, e.b]);
}

/** Posts and beams under a room held up "On posts": a beam along each outer edge, posts at its ends and every 8' between. */
export function postsUnder(o: Pick<Overhang, "pieces">, regions: Region[]): { posts: Point[]; beams: [Point, Point][] } {
  const posts: Point[] = [];
  const beams: [Point, Point][] = [];
  const addPost = (p: Point) => {
    if (!posts.some((q) => dist(p, q) < 6)) posts.push(p);
  };
  for (const piece of o.pieces) {
    for (const [a, b] of outerEdges(piece, regions)) {
      beams.push([a, b]);
      const n = Math.max(1, Math.ceil(dist(a, b) / POST_SPACING_IN - 1e-6));
      // An end on the wall below already has the wall under it.
      for (let i = 0; i <= n; i++) {
        const p = lerp(a, b, i / n);
        if (distToOutline(p, regions) > MIN_OVERHANG_IN) addPost(p);
      }
    }
  }
  return { posts, beams };
}

/** Rooms on this floor that sit over a covered porch or patio on the floor below, with that porch's name. */
export function overPorches(rooms: PlanRoom[], below: FloorPlan): { roomId: string; porch: PlanRoom }[] {
  const porches = below.rooms.filter((r) => areaKind(r) === "outdoor" && COVERED.has(r.type ?? "") && r.polygon.length >= 3);
  const out: { roomId: string; porch: PlanRoom }[] = [];
  for (const room of rooms) {
    if (areaKind(room) === "outdoor" || room.polygon.length < 3) continue;
    for (const porch of porches) {
      let area = 0;
      try {
        area = polygonClipping.intersection([ring(room.polygon)], [ring(porch.polygon)]).reduce((t, poly) => t + polygonArea(fromRing(poly[0])), 0);
      } catch {
        continue;
      }
      if (area >= 144) out.push({ roomId: room.id, porch });
    }
  }
  return out;
}
