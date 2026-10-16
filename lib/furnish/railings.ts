import type { FloorPlan, Level, PlanBasics } from "@/lib/model/schema";
import { flatPlans } from "@/lib/plan/flatten";
import type { Plans } from "@/lib/plan/edit";
import { autoRailing, bareSlots, changeRailing, removeRailing, type Railing, type RailingKind, type RailingSlot, type RailingStyle } from "@/lib/plan/railings";
import { riseFromHeights } from "@/lib/house3d/railings";
import { levelHeights } from "@/lib/house3d/levels";

/**
 * Editing stair railings in Furnish (the 2D page and the walkthrough's Place
 * tab). Railings are worked out from the stairs, so a change is saved on the
 * stairs, on the floor they start from, which can be a different floor from
 * the one a railing is drawn on (the guards around a stairwell are on the
 * floor above).
 */

export type RailingChange = { kind?: RailingKind; style?: RailingStyle } | "remove" | "auto";

/** What the picked thing is: a railing now standing, or a bare side where one can be added. */
export type RailingTarget = { key: string; stairsId: string; stairsLevelId: string; levelId: string; edge: string; railing?: Railing; slot?: RailingSlot };

/** The railings built on one floor, and the sides there with none. */
export function stageRailings(plans: Plans, levels: Level[], basics: PlanBasics | null, levelId: string): { railings: Railing[]; bare: RailingSlot[] } {
  const flat = flatPlans(plans);
  const rise = riseFromHeights(levelHeights(levels, basics));
  return bareSlots(flat, levelId, rise);
}

/** The picked railing or bare side, by the key the canvas gave it (`<stairsId>:<edge>`, with `:<n>` after it for a second stretch). */
export function railingTarget(found: { railings: Railing[]; bare: RailingSlot[] }, key: string): RailingTarget | null {
  const railing = found.railings.find((r) => r.key === key);
  if (railing) return { key, stairsId: railing.stairsId, stairsLevelId: railing.stairsLevelId, levelId: railing.levelId, edge: railing.edge, railing };
  const slot = found.bare.find((x) => x.key === key);
  return slot ? { key, stairsId: slot.stairsId, stairsLevelId: slot.stairsLevelId, levelId: slot.levelId, edge: slot.edge, slot } : null;
}

/** The floor plan of the stairs' floor with the change made. Null when those stairs are gone. */
export function changeRailingIn(plans: Record<string, FloorPlan>, t: Pick<RailingTarget, "stairsId" | "stairsLevelId" | "edge">, change: RailingChange): FloorPlan | null {
  const plan = plans[t.stairsLevelId];
  if (!plan || !plan.stairs.some((s) => s.id === t.stairsId)) return null;
  const apply = (s: FloorPlan["stairs"][number]) =>
    change === "remove" ? removeRailing(s, t.edge) : change === "auto" ? autoRailing(s, t.edge) : changeRailing(s, t.edge, change);
  return { ...plan, stairs: plan.stairs.map((s) => (s.id === t.stairsId ? apply(s) : s)) };
}

/** Add a railing on a bare side: a guard in the default wood look, or a handrail where the side runs along a wall. */
export function addRailingIn(plans: Record<string, FloorPlan>, t: Pick<RailingTarget, "stairsId" | "stairsLevelId" | "edge">, kind: RailingKind = "guard"): FloorPlan | null {
  return changeRailingIn(plans, t, { kind, style: "wood" });
}
