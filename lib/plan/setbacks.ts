import type { FloorPlan, Point } from "@/lib/model/schema";
import { areaKind } from "./measure";

/**
 * How far a house reaches past the lot's setbacks. The limits come from the lot (see
 * lib/plans/lot.ts `setbackLimits`); this file only does the geometry, in plan inches,
 * so the floor plan's hallway and "grow" ideas can use it without the whole project.
 */

/** A lot line and how far inside it the house has to stay. */
export type SetbackLimit = { name: string; a: Point; b: Point; bufferIn: number; /** Which way is the lot's inside, as a unit vector. */ inward: Point };

/** One place the house reaches past a limit. `pastLine` is true when it is past the lot line itself. */
export type Overrun = { name: string; byIn: number; point: Point; pastLine: boolean };

/** The outside corners of everything under a roof on a floor (porches count, patios and decks don't). */
export function housePoints(plan: FloorPlan): Point[] {
  return plan.rooms.filter((r) => areaKind(r) !== "outdoor").flatMap((r) => r.polygon);
}

/** The worst overrun of each limit, for the points given. */
export function overruns(points: Point[], limits: SetbackLimit[]): Overrun[] {
  const out: Overrun[] = [];
  for (const l of limits) {
    const dx = l.b.x - l.a.x;
    const dy = l.b.y - l.a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;
    let worst: Overrun | null = null;
    for (const p of points) {
      // Only points alongside this lot line count: a corner of an odd-shaped lot is judged by its own lines.
      const along = ((p.x - l.a.x) * dx + (p.y - l.a.y) * dy) / len;
      if (along < -1 || along > len + 1) continue;
      const inside = (p.x - l.a.x) * l.inward.x + (p.y - l.a.y) * l.inward.y;
      const by = l.bufferIn - inside;
      if (by > 0.5 && (!worst || by > worst.byIn)) worst = { name: l.name, byIn: by, point: p, pastLine: inside < 0 };
    }
    if (worst) out.push(worst);
  }
  return out;
}

/** How far the plan reaches past the most-crossed limit, in inches (0 when it stays inside). */
export function worstOverrun(plan: FloorPlan, limits: SetbackLimit[]): number {
  if (!limits.length) return 0;
  return Math.max(0, ...overruns(housePoints(plan), limits).map((o) => o.byIn));
}
