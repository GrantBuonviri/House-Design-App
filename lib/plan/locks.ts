import type { FloorPlan } from "@/lib/model/schema";

/**
 * What anchoring locks on one floor: anchored stairs (see lib/plan/anchor.ts).
 * Editing helpers leave these out of moves, turns, flips, deletes and
 * automatic fixes.
 */
export function lockedIds(plan: Pick<FloorPlan, "rooms" | "stairs">): Set<string> {
  const out = new Set<string>();
  for (const s of plan.stairs) if (s.anchored) out.add(s.id);
  return out;
}

export const isLocked = (plan: Pick<FloorPlan, "rooms" | "stairs">, id: string): boolean => lockedIds(plan).has(id);

/** These ids without the locked ones. */
export function unlocked(plan: Pick<FloorPlan, "rooms" | "stairs">, ids: string[]): string[] {
  const locked = lockedIds(plan);
  return locked.size ? ids.filter((id) => !locked.has(id)) : ids;
}

export const LOCKED_STAIRS_NOTE = "These stairs are anchored. Click Unanchor in the side panel to move them.";

/** The note for trying to move or delete something locked, or null when none of these ids are locked. */
export function lockedNote(plan: Pick<FloorPlan, "rooms" | "stairs">, ids: string[]): string | null {
  const locked = lockedIds(plan);
  return ids.some((id) => locked.has(id)) ? LOCKED_STAIRS_NOTE : null;
}
