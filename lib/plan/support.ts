import polygonClipping, { type Polygon } from "polygon-clipping";
import type { FloorPlan, Level, PlanRoom, Point } from "@/lib/model/schema";
import { cleanRing, roofFootprint, subtractRegions, type Region } from "@/lib/house3d/footprint";
import { levelBelow } from "./basics";
import { planOf, makeRoom, reshapeRoom, type Plans } from "./edit";
import { clockwise, dist, edgesOf, polygonArea, polygonCenter } from "./geometry";
import { areaKind } from "./measure";
import type { SnapTargets } from "./snap";

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
export function supportOf(plans: Plans, levels: Level[], level: Level): { below: Level; regions: Region[] } | null {
  if (level.kind === "main" || level.kind === "basement") return null;
  const below = levelBelow(levels, level);
  if (!below) return null;
  const regions = roofFootprint(planOf(plans, below.id));
  return regions.length ? { below, regions } : null;
}

export type Overhang = {
  roomId: string;
  /** The parts of the room past the support area. */
  pieces: Point[][];
  /** How far the farthest corner reaches past the wall below, inches. */
  depthIn: number;
  /** The middle of the biggest piece, to look at. */
  at: Point;
};

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
    out.push({ roomId: room.id, pieces, depthIn: Math.round(depthIn), at: polygonCenter(biggest) });
  }
  return out;
}

/** The room trimmed to the support area, as one clean outline. Null when that can't be done cleanly. */
export function pulledBack(room: PlanRoom, regions: Region[]): Point[] | null {
  let out: ReturnType<typeof polygonClipping.intersection>;
  try {
    out = polygonClipping.intersection([ring(room.polygon)], ...asPolygons(regions));
  } catch {
    return null;
  }
  if (out.length !== 1 || out[0].length !== 1) return null;
  const pts = clockwise(cleanRing(fromRing(out[0][0]), 0.25));
  if (pts.length < 3 || polygonArea(pts) < MIN_ROOM_SQIN) return null;
  return pts;
}

/** Trim a room to the support area. The plan comes back unchanged when that can't be done cleanly. */
export function pullBack(plan: FloorPlan, roomId: string, regions: Region[]): FloorPlan {
  const room = plan.rooms.find((r) => r.id === roomId);
  const pts = room && pulledBack(room, regions);
  return pts ? reshapeRoom(plan, roomId, pts) : plan;
}

/** The part of the support area with no room on it yet, as outlines to fill. */
export function fillShapes(plan: FloorPlan, regions: Region[]): Point[][] {
  const used: Region[] = plan.rooms.filter((r) => r.polygon.length >= 3).map((r) => ({ outline: clockwise(r.polygon), holes: [] }));
  const left = used.length ? subtractRegions(regions, used) : regions;
  return left.map((r) => clockwise(r.outline)).filter((p) => polygonArea(p) >= MIN_ROOM_SQIN);
}

/** "Fill the floor below": one room on each part of the support area that's still empty. */
export function fillBelow(plan: FloorPlan, regions: Region[]): FloorPlan {
  const shapes = fillShapes(plan, regions);
  return { ...plan, rooms: [...plan.rooms, ...shapes.map((poly, i) => makeRoom(poly, shapes.length > 1 ? `Room ${i + 1}` : "Room"))] };
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

export const mergeTargets = (a: SnapTargets, b: SnapTargets | null): SnapTargets => (b ? { points: [...a.points, ...b.points], segments: [...a.segments, ...b.segments] } : a);
