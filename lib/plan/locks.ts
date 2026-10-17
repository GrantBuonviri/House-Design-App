import type { FloorPlan } from "@/lib/model/schema";

/**
 * What anchoring locks on one floor: anchored stairs and the stair halls of
 * anchored stairs (see lib/plan/anchor.ts). Editing helpers leave these out
 * of moves, turns, flips, deletes and automatic fixes.
 */
export function lockedIds(plan: Pick<FloorPlan, "rooms" | "stairs">): Set<string> {
  const out = new Set<string>();
  for (const s of plan.stairs) if (s.anchored) out.add(s.id);
  for (const r of plan.rooms) if (r.anchored && r.stairStack) out.add(r.id);
  return out;
}

export const isLocked = (plan: Pick<FloorPlan, "rooms" | "stairs">, id: string): boolean => lockedIds(plan).has(id);

/** These ids without the locked ones. */
export function unlocked(plan: Pick<FloorPlan, "rooms" | "stairs">, ids: string[]): string[] {
  const locked = lockedIds(plan);
  return locked.size ? ids.filter((id) => !locked.has(id)) : ids;
}

/** A stair hall (anchored or not): its outline is shared by every floor of its stack, so it can't curve. */
export const isStairHall = (plan: Pick<FloorPlan, "rooms">, roomId: string): boolean => !!plan.rooms.find((r) => r.id === roomId)?.stairStack;

export const LOCKED_STAIRS_NOTE = "These stairs are anchored. Click Unanchor in the side panel to move them.";
export const LOCKED_HALL_NOTE = "This stair hall is anchored to the stairs. Its walls can be moved; click Unanchor in the side panel to move it.";
export const HALL_CURVE_NOTE = "Stair hall walls stay straight, so they line up on every floor.";

/** The note for trying to move or delete something locked, or null when none of these ids are locked. */
export function lockedNote(plan: Pick<FloorPlan, "rooms" | "stairs">, ids: string[]): string | null {
  const locked = lockedIds(plan);
  const hit = ids.filter((id) => locked.has(id));
  if (!hit.length) return null;
  return plan.stairs.some((s) => hit.includes(s.id)) ? LOCKED_STAIRS_NOTE : LOCKED_HALL_NOTE;
}
