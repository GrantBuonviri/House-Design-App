import type { Level, PlanBasics } from "@/lib/model/schema";
import { FLOOR_STRUCTURE_IN, ceilingFor } from "@/lib/plan/basics";
import { MAIN_LEVEL_ID } from "@/lib/brief/levels";

/**
 * How high each floor sits in 3D, in inches above the main floor. Regular
 * floors stack: each one starts where the one below ends (its ceiling plus
 * the floor structure), the same rise the stairs are sized for. Lofts and
 * split levels keep their own elevation.
 */

export type LevelHeights = Record<string, { floorIn: number; ceilingIn: number }>;

const REGULAR = /^(floor|basement)-(\d)$/;

export function levelHeights(levels: Level[], basics: PlanBasics | null): LevelHeights {
  const out: LevelHeights = {};
  const sorted = [...levels].sort((a, b) => a.elevationIn - b.elevationIn);
  const regular = sorted.filter((l) => REGULAR.test(l.id));
  const mainAt = regular.findIndex((l) => l.id === MAIN_LEVEL_ID);
  const story = (l: Level) => ceilingFor(basics, l) + FLOOR_STRUCTURE_IN;
  if (mainAt >= 0) {
    out[regular[mainAt].id] = { floorIn: 0, ceilingIn: ceilingFor(basics, regular[mainAt]) };
    for (let i = mainAt + 1; i < regular.length; i++) {
      const below = regular[i - 1];
      out[regular[i].id] = { floorIn: out[below.id].floorIn + story(below), ceilingIn: ceilingFor(basics, regular[i]) };
    }
    for (let i = mainAt - 1; i >= 0; i--) {
      const above = regular[i + 1];
      out[regular[i].id] = { floorIn: out[above.id].floorIn - story(regular[i]), ceilingIn: ceilingFor(basics, regular[i]) };
    }
  }
  for (const l of sorted) if (!out[l.id]) out[l.id] = { floorIn: l.elevationIn, ceilingIn: ceilingFor(basics, l) };
  return out;
}
