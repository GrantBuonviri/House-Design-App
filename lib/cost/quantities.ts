import type { Ctx, Quantities } from "./quantityBasics";
import { measurePlan } from "./measurePlan";
import { measureRough } from "./measureRough";
import { flatProject } from "@/lib/plan/flatten";
export type { Quantities, RoomFinish } from "./quantityBasics";
export { foldLength, measureRoof } from "./measureRoof";
export { measurePlan } from "./measurePlan";
export { measureRough } from "./measureRough";

/**
 * Measures the house for the cost estimate: areas, wall lengths, the roof,
 * doors and windows, fixtures and the foundation. Measured from the floor
 * plan when there is one, or roughly from the Rooms page when there isn't.
 * Areas are in square feet and lengths in feet.
 */

// The measuring lives in measurePlan.ts, measureRough.ts and measureRoof.ts, sharing quantityBasics.ts.

const CTX_KEYS = ["levels", "plot", "sketch", "bubbles", "floorPlans", "house3d", "plan", "discovery", "brief", "location", "plans"] as const;
/** Answers kept: the shown estimate survives Suggest scoring a few alternatives (PlanStage's `costOf`). */
const KEEP = 8;
let recent: { p: Ctx; q: Quantities | null }[] = [];

/**
 * The best measure available: the floor plan, or the rough one from the Rooms
 * page. The last few answers are kept, so changes that don't touch the house's
 * shape (like picking a finish) don't measure it all again, and scoring
 * alternatives doesn't throw out the estimate that's showing.
 */
export function measureHouse(p: Ctx): Quantities | null {
  p = flatProject(p);
  const i = recent.findIndex((e) => CTX_KEYS.every((k) => e.p[k] === p[k]));
  if (i >= 0) {
    const hit = recent[i];
    if (i > 0) recent = [hit, ...recent.slice(0, i), ...recent.slice(i + 1)];
    return hit.q;
  }
  const q = measurePlan(p) ?? measureRough(p);
  recent = [{ p: Object.fromEntries(CTX_KEYS.map((k) => [k, p[k]])) as Ctx, q }, ...recent].slice(0, KEEP);
  return q;
}
