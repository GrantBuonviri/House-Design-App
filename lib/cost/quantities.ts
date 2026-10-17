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

const CTX_KEYS = ["levels", "plot", "sketch", "bubbles", "floorPlans", "house3d", "plan", "discovery", "brief", "location"] as const;
let last: { p: Ctx; q: Quantities | null } | null = null;

/**
 * The best measure available: the floor plan, or the rough one from the Rooms
 * page. The last answer is kept, so changes that don't touch the house's
 * shape (like picking a finish) don't measure it all again.
 */
export function measureHouse(p: Ctx): Quantities | null {
  p = flatProject(p);
  if (last && CTX_KEYS.every((k) => last!.p[k] === p[k])) return last.q;
  const q = measurePlan(p) ?? measureRough(p);
  last = { p: Object.fromEntries(CTX_KEYS.map((k) => [k, p[k]])) as Ctx, q };
  return q;
}
