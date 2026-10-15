import { WHOLE_HOUSE, type Selection } from "@/lib/model/schema";
import { interiorCategory, type InteriorCategoryId } from "@/lib/catalog/categories";
import { pickFor, setPick, setWallPick, wallPicks } from "./picks";
import type { Aim } from "./surfaces";

/**
 * Where a pick made in the walkthrough goes: one wall (accent paint), the
 * room, or the whole house (every room without its own pick).
 */

export type FinishAim = Extract<Aim, { kind: "finish" }>;

/** Where a pick goes: one wall, the room, or every room without its own. */
export type Scope = "wall" | "room" | "house";

/** The scopes a category offers here, and which one to start on (where today's look comes from). */
export function scopesFor(aim: FinishAim, category: InteriorCategoryId, selections: Selection[]): { scopes: Scope[]; start: Scope } {
  const cat = interiorCategory(category);
  const scopes: Scope[] = [];
  if (category === "paint" && aim.wall && aim.room) scopes.push("wall");
  if (cat?.perRoom && aim.room) scopes.push("room");
  scopes.push("house");
  let start: Scope = scopes.includes("room") ? "room" : "house";
  if (scopes.includes("wall") && aim.room && wallPicks(selections, aim.room.id).has(aim.wall!.key)) start = "wall";
  return { scopes, start };
}

/** The pick that shows here today for a category, and where it comes from. */
export function currentPick(aim: FinishAim, category: InteriorCategoryId, selections: Selection[]): { pick: Selection; from: Scope } | null {
  if (category === "paint" && aim.wall && aim.room) {
    const w = wallPicks(selections, aim.room.id).get(aim.wall.key);
    if (w) return { pick: w, from: "wall" };
  }
  const own = aim.room && interiorCategory(category)?.perRoom ? pickFor(selections, aim.room.id, category) : undefined;
  if (own) return { pick: own, from: "room" };
  const house = pickFor(selections, WHOLE_HOUSE, category);
  return house ? { pick: house, from: "house" } : null;
}

/** Put a product (or with null, clear the pick) at a scope. */
export function applyPick(aim: FinishAim, category: InteriorCategoryId, scope: Scope, selections: Selection[], product: Parameters<typeof setPick>[3]): Selection[] {
  if (scope === "wall" && aim.room && aim.wall) return setWallPick(selections, aim.room.id, aim.wall.key, product);
  if (scope === "room" && aim.room) return setPick(selections, aim.room.id, category, product);
  return setPick(selections, WHOLE_HOUSE, category, product);
}

