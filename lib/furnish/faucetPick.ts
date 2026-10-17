import { WHOLE_HOUSE, type FloorPlan, type Fixture, type Product, type Selection } from "@/lib/model/schema";
import { INTERIOR_CATEGORIES } from "@/lib/catalog/categories";
import { productsIn } from "@/lib/catalog/catalog";
import { roomFinishes, setPick } from "@/lib/interior/picks";
import { add, rotate } from "@/lib/plan/geometry";
import { potFillerRoomId } from "@/lib/cost/furnishQuantities";
import { placeItem, roomAt, snapToWall, type LayerItem } from "./layer";
import { FAUCET_CATEGORY, changeFaucet, faucetOf, removeFaucet, restoreFaucet, type Faucet, type FaucetKind, type FaucetShape } from "./faucets";

/**
 * The Furnish side of faucet products: the same list and the same picks as
 * Interior design. A pick belongs to the room (or the whole house when the
 * fixture isn't in a room), so it covers every faucet of that kind there.
 */

const WORD: Record<FaucetKind, string> = { kitchen: "kitchen faucet", prep: "bar faucet", laundry: "kitchen faucet", bath: "bath faucet", tub: "tub and shower trim", shower: "tub and shower trim" };

/** The room whose pick a fixture's faucet uses (null: the whole house). */
export function faucetRoom(plan: FloorPlan, fx: Fixture): { id: string; name: string } | null {
  const room = (fx.roomId && plan.rooms.find((r) => r.id === fx.roomId)) || roomAt(plan, { x: fx.x, y: fx.y });
  return room ? { id: room.id, name: room.name } : null;
}

/** "Used for every bath faucet in Bath 1. Interior design shows the same pick." */
export function usedFor(plan: FloorPlan, fx: Fixture, kind: FaucetKind): string {
  const room = faucetRoom(plan, fx);
  return `Used for every ${WORD[kind]} ${room ? `in ${room.name}` : "in the house"}. Interior design shows the same pick.`;
}

/** The products to choose from for a faucet (the Interior design list for its category). */
export function faucetProducts(kind: FaucetKind) {
  return productsIn(FAUCET_CATEGORY[kind] as Parameters<typeof productsIn>[0]);
}

export const faucetCategoryLabel = (kind: FaucetKind) => INTERIOR_CATEGORIES.find((c) => c.id === FAUCET_CATEGORY[kind])?.label ?? "Faucet";

/** The selections with the room's faucet pick set (or cleared with null). */
export function pickFaucetProduct(plan: FloorPlan, fx: Fixture, kind: FaucetKind, selections: Selection[], product: Product | null): Selection[] {
  const room = faucetRoom(plan, fx);
  return setPick(selections, room?.id ?? WHOLE_HOUSE, FAUCET_CATEGORY[kind], product);
}

/** The faucet of the fixture with this id (removed ones too). */
export function faucetById(plan: FloorPlan, levelId: string, fixtureId: string, selections: Selection[], exteriorIn?: number): Faucet | null {
  const fx = plan.fixtures.find((f) => f.id === fixtureId);
  return fx ? faucetOf(plan, levelId, fx, selections, exteriorIn) : null;
}

/** A panel change applied to a fixture's faucet. */
export function applyFaucetChange(plan: FloorPlan, fixtureId: string, c: { shape?: FaucetShape | null; alongIn?: number } | "remove" | "restore"): FloorPlan {
  if (c === "remove") return removeFaucet(plan, fixtureId);
  if (c === "restore") return restoreFaucet(plan, fixtureId);
  return changeFaucet(plan, fixtureId, c);
}

/** Whether a catalog id is a range, which gets the "Add a pot filler above" button. */
export const isRange = (entryId: string) => entryId === "fixture:range";

/** A pot filler on the wall behind a range, centered on it; null when no wall is there. `already` when one is within a range-width of its middle. */
export function potFillerAbove(plan: FloorPlan, range: Pick<LayerItem, "x" | "y" | "rotation" | "depthIn" | "widthIn">): { plan: FloorPlan; id: string } | { already: true } | null {
  if ((plan.addOns ?? []).some((a) => a.kind === "pot-filler" && Math.hypot(a.x - range.x, a.y - range.y) < range.widthIn)) return { already: true };
  const back = add({ x: range.x, y: range.y }, rotate({ x: 0, y: -range.depthIn / 2 }, range.rotation));
  const spot = snapToWall(plan, back, { widthIn: 4, depthIn: 4, mount: "wall" }, 12);
  if (!spot) return null;
  const out = placeItem(plan, "addon:pot-filler", spot, { rotation: spot.rotation });
  return out.id ? { plan: out.plan, id: out.id } : null;
}

/** The pot filler's product: the room's Interior design pick for `pot-fillers`. */
export function potFillerPick(plan: FloorPlan, addOn: { x: number; y: number }, selections: Selection[]) {
  const roomId = potFillerRoomId(plan, addOn);
  const room = plan.rooms.find((r) => r.id === roomId);
  const picked = room ? roomFinishes(selections, room.id).get("pot-fillers") ?? null : null;
  return {
    roomId,
    picked,
    products: productsIn("pot-fillers"),
    label: INTERIOR_CATEGORIES.find((c) => c.id === "pot-fillers")?.label ?? "Pot filler",
    usedFor: `Used for every pot filler ${room ? `in ${room.name}` : "in the house"}. Interior design shows the same pick.`,
  };
}

export function pickPotFiller(plan: FloorPlan, addOn: { x: number; y: number }, selections: Selection[], product: Product | null): Selection[] {
  return setPick(selections, potFillerRoomId(plan, addOn) ?? WHOLE_HOUSE, "pot-fillers", product);
}
