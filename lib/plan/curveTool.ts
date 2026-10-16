import type { FloorPlan, Point } from "@/lib/model/schema";
import { isCurved } from "./arcs";
import { bowForRadius, bowFromPoint, maxBow, planRadii, snapBow, type BendSnap } from "./bend";
import { newPlanId } from "./edit";
import { dist, roundPoint } from "./geometry";
import { splitRoom } from "./partitions";

/**
 * The Curve tool: click the start, click the end, then move the mouse to set
 * how far it bows (or type a radius) and click again. From one side of a room
 * to another it splits the room along the curve; otherwise it's a curved wall
 * drawn on its own. Pure functions; the canvas holds the clicks.
 */

/** How far the curve from a to b bows (left of a→b) with the pointer at p, pulled toward straight, a half circle or a radius already on the plan. */
export function curveBow(plan: FloorPlan, a: Point, b: Point, p: Point, s: number, free = false): { left: number; snap: BendSnap } {
  return snapBow(dist(a, b), bowFromPoint(a, b, p), planRadii(plan), s, free);
}

/** The bow for a typed radius, on the side the pointer is. Null when the radius can't reach from a to b (less than half the distance). */
export function bowForTyped(a: Point, b: Point, radius: number, side: number): number | null {
  const chord = dist(a, b);
  if (radius < chord / 2 - 0.05) return null;
  return (side < 0 ? -1 : 1) * Math.min(maxBow(chord), bowForRadius(chord, radius));
}

export type CurveResult = { plan: FloorPlan; split: { roomId: string; newRoomId: string } | null; wallId: string | null };

/**
 * Put a curve from a to b bowing `left` inches into the plan: a split when it
 * runs across a room from wall to wall (unless `divider`, Option held), else a
 * curved wall of its own. Null when it's too short to be a wall.
 */
export function drawCurve(plan: FloorPlan, a: Point, b: Point, left: number, divider = false): CurveResult | null {
  const [p, q] = [roundPoint(a), roundPoint(b)];
  if (dist(p, q) < 6) return null;
  const bulge = isCurved(left) ? Math.round(left * 10) / 10 : 0;
  const split = divider ? null : splitRoom(plan, bulge ? { a: p, b: q, bulge } : [p, q]);
  if (split) return { plan: split.plan, split: { roomId: split.roomId, newRoomId: split.newRoomId }, wallId: null };
  const wall = { id: newPlanId("w"), a: p, b: q, thicknessIn: 4.5, ...(bulge ? { bulge } : {}) };
  return { plan: { ...plan, walls: [...plan.walls, wall] }, split: null, wallId: wall.id };
}
