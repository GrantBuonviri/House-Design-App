import type { Point } from "@/lib/model/schema";
import { dist } from "@/lib/plan/geometry";
import type { Plans } from "@/lib/plan/edit";
import { openingGeometries } from "@/lib/plan/walls";
import type { LevelHeights } from "./levels";

/**
 * The walkthrough's tape measure: a point in the house is a spot on the plan
 * (x east, y south, inches) and a height z in inches above the main floor.
 * Pure math for snapping and reading a measurement; drawn by components/walk/TapeMeasure.tsx.
 */

export type TapePoint = { x: number; y: number; z: number };
export type Tape = { a: TapePoint; b: TapePoint };

/** How close a click has to be to a corner or door/window edge to snap to it. */
export const SNAP_IN = 3;
/** The tape keeps this many finished measurements. */
export const TAPE_KEEP = 5;

export type Reading = { length: number; level: number; height: number };

/** Straight-line length, plus the level (along the floor) and height (up and down) parts. */
export function reading(t: Tape): Reading {
  const level = dist({ x: t.a.x, y: t.a.y }, { x: t.b.x, y: t.b.y });
  const height = Math.abs(t.b.z - t.a.z);
  return { length: Math.hypot(level, height), level, height };
}

/** Which parts of a reading get their own small label: both parts, when each is more than an inch. */
export function showParts(r: Reading): boolean {
  return r.level > 1 && r.height > 1;
}

/** Shift: make the second point level with the first, or straight above or below it, whichever is closer to where you aimed. */
export function lockAxis(a: TapePoint, b: TapePoint): TapePoint {
  const level = dist(a, b);
  const height = Math.abs(b.z - a.z);
  return height > level ? { x: a.x, y: a.y, z: b.z } : { x: b.x, y: b.y, z: a.z };
}

/** Corners and door/window edges you can snap to. */
export function tapeCandidates(plans: Plans, heights: LevelHeights, levelIds: string[]): TapePoint[] {
  const out: TapePoint[] = [];
  for (const id of levelIds) {
    const plan = plans[id];
    const h = heights[id];
    if (!plan || !h) continue;
    const bottom = h.floorIn;
    const top = h.floorIn + h.ceilingIn;
    for (const r of plan.rooms) {
      for (const p of r.polygon) {
        out.push({ x: p.x, y: p.y, z: bottom }, { x: p.x, y: p.y, z: top });
      }
    }
    for (const g of openingGeometries(plan)) {
      const o = g.opening;
      const sill = bottom + (o.kind === "window" ? (o.sillIn ?? 36) : 0);
      const head = sill + o.heightIn;
      for (const p of [g.a, g.b] as Point[]) out.push({ x: p.x, y: p.y, z: sill }, { x: p.x, y: p.y, z: head });
    }
  }
  return out;
}

/** The nearest corner or opening edge within `SNAP_IN` of a point, else the point itself. */
export function snap(p: TapePoint, candidates: TapePoint[]): TapePoint {
  let best: TapePoint | null = null;
  let bestD = SNAP_IN;
  for (const c of candidates) {
    const d = Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z);
    if (d <= bestD) {
      best = c;
      bestD = d;
    }
  }
  return best ?? p;
}
