import type { FloorPlan, PlanRoom, Point } from "@/lib/model/schema";
import { dist, dot, edgesOf, sub, unit } from "./geometry";
import { bulgeOf, isCurved, projectOnEdge } from "./arcs";
import { sharedEdges } from "./bend";
import { makeRoom, reshapeRoom } from "./edit";
import { HALL_CURVE_NOTE } from "./locks";

/** Shortcut shapes: Round corner, the Round room preset and Half-round bay. */

export const DEFAULT_CORNER_RADIUS_IN = 24;
export const DEFAULT_BAY_WIDTH_IN = 96;
export const DEFAULT_BAY_DEPTH_IN = 48;
export const DEFAULT_ROUND_ROOM_IN = 144;

/** How far a quarter-turn arc of radius r bows out from its chord. */
const sagitta = (r: number, turn: number) => r * (1 - Math.cos(turn / 2));

/** The radius a corner can be rounded to: the asked-for one, or the biggest that fits. Null when the corner can't be rounded. */
export function roundableRadius(room: Pick<PlanRoom, "polygon" | "bulges">, i: number, radius: number, share = 1): number | null {
  const n = room.polygon.length;
  if (n < 3 || i < 0 || i >= n) return null;
  if (isCurved(bulgeOf(room, i)) || isCurved(bulgeOf(room, (i - 1 + n) % n))) return null;
  const p = room.polygon[i];
  const a = room.polygon[(i - 1 + n) % n];
  const b = room.polygon[(i + 1) % n];
  const ua = unit(sub(a, p));
  const ub = unit(sub(b, p));
  const theta = Math.acos(Math.max(-1, Math.min(1, dot(ua, ub))));
  if (theta < 0.05 || theta > Math.PI - 0.05) return null;
  // `share` is how much of each wall the corner may use: half when every corner is being rounded.
  const reach = Math.min(dist(p, a), dist(p, b)) * share - 1;
  if (reach <= 0) return null;
  return Math.max(1, Math.min(radius, reach * Math.tan(theta / 2)));
}

/** Replace one corner with two corners joined by a curved edge that meets both walls smoothly. */
export function roundCorner(plan: FloorPlan, roomId: string, i: number, radius = DEFAULT_CORNER_RADIUS_IN, share = 1): FloorPlan | null {
  const room = plan.rooms.find((r) => r.id === roomId);
  if (!room || room.stairStack) return null;
  const r = roundableRadius(room, i, radius, share);
  if (r === null) return null;
  const n = room.polygon.length;
  const p = room.polygon[i];
  const a = room.polygon[(i - 1 + n) % n];
  const b = room.polygon[(i + 1) % n];
  const ua = unit(sub(a, p));
  const ub = unit(sub(b, p));
  const theta = Math.acos(Math.max(-1, Math.min(1, dot(ua, ub))));
  const t = r / Math.tan(theta / 2);
  const t1 = { x: p.x + ua.x * t, y: p.y + ua.y * t };
  const t2 = { x: p.x + ub.x * t, y: p.y + ub.y * t };
  // Corners go clockwise on screen: a convex corner turns right, and its rounding bows out of the room.
  const convex = (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x) > 0;
  const bow = sagitta(r, Math.PI - theta) * (convex ? 1 : -1);
  const poly = [...room.polygon];
  poly.splice(i, 1, t1, t2);
  const bulges = Array.from({ length: n }, (_, k) => bulgeOf(room, k));
  bulges.splice(i, 0, bow);
  return reshapeRoom(plan, roomId, poly, bulges);
}

/** Round every straight corner of a room. Null when none can be rounded. */
export function roundAllCorners(plan: FloorPlan, roomId: string, radius = DEFAULT_CORNER_RADIUS_IN): FloorPlan | null {
  const n = plan.rooms.find((r) => r.id === roomId)?.polygon.length ?? 0;
  let next = plan;
  let any = false;
  // Last corner first, so the corners still to do keep their numbers.
  for (let i = n - 1; i >= 0; i--) {
    const out = roundCorner(next, roomId, i, radius, 0.5);
    if (!out) continue;
    next = out;
    any = true;
  }
  return any ? next : null;
}

/** The corners and curved edges of a round room: four quarter circles. */
export function roundRoomShape(center: Point, diameter: number): { polygon: Point[]; bulges: number[] } {
  const r = diameter / 2;
  const polygon = [
    { x: center.x, y: center.y - r },
    { x: center.x + r, y: center.y },
    { x: center.x, y: center.y + r },
    { x: center.x - r, y: center.y },
  ];
  return { polygon, bulges: polygon.map(() => sagitta(r, Math.PI / 2)) };
}

export function makeRoundRoom(center: Point, diameter: number): PlanRoom {
  const { polygon, bulges } = roundRoomShape(center, diameter);
  return makeRoom(polygon, "New room", { bulges });
}

/** Why a half-round bay can't go on this wall, or null when it can. */
export function whyNoBay(plan: FloorPlan, roomId: string, edge: number): string | null {
  const room = plan.rooms.find((r) => r.id === roomId);
  if (!room) return "Pick a wall of a room.";
  if (room.stairStack) return HALL_CURVE_NOTE;
  if (isCurved(bulgeOf(room, edge))) return "This wall is already curved. Make it straight first.";
  if (sharedEdges(plan, roomId, edge).length > 0) return "Bays go on outside walls, not on a wall two rooms share.";
  const e = edgesOf(room.polygon)[edge];
  if (dist(e.a, e.b) < 36) return "This wall is too short for a bay.";
  return null;
}

/**
 * Add a half-round bay: a curved bump on an outside wall, with the room growing
 * into it. `at` is where along the wall it is centered (the middle by default).
 */
export function addBay(plan: FloorPlan, roomId: string, edge: number, width = DEFAULT_BAY_WIDTH_IN, depth = DEFAULT_BAY_DEPTH_IN, at?: Point): FloorPlan | null {
  if (whyNoBay(plan, roomId, edge)) return null;
  const room = plan.rooms.find((r) => r.id === roomId)!;
  const e = edgesOf(room.polygon)[edge];
  const chord = dist(e.a, e.b);
  const w = Math.max(24, Math.min(width, chord - 12));
  const d = Math.max(6, Math.min(depth, w / 2));
  const u = unit(sub(e.b, e.a));
  const t = Math.max(w / 2 + 6, Math.min(chord - w / 2 - 6, at ? projectOnEdge(at, e.a, e.b).t : chord / 2));
  const at1 = { x: e.a.x + u.x * (t - w / 2), y: e.a.y + u.y * (t - w / 2) };
  const at2 = { x: e.a.x + u.x * (t + w / 2), y: e.a.y + u.y * (t + w / 2) };
  const poly = [...room.polygon];
  poly.splice(edge + 1, 0, at1, at2);
  const bulges = Array.from({ length: room.polygon.length }, (_, k) => bulgeOf(room, k));
  bulges.splice(edge, 1, 0, d, 0);
  return reshapeRoom(plan, roomId, poly, bulges);
}
