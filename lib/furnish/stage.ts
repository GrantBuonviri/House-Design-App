import type { FloorPlan, Level, Point, Project } from "@/lib/model/schema";
import { add, boundsOf, polygonCenter, rectangle, rotate, round1, scale, sub } from "@/lib/plan/geometry";
import { flatPlan } from "@/lib/plan/flatten";
import { distanceGuides, wallSegments, type Guide } from "@/lib/plan/labels";
import { levelDevices } from "@/lib/plans/systems";
import { levelCabinets } from "@/lib/plans/sheets/cabinets";
import type { PlacedCabinet } from "@/lib/plan/cabinets";
import type { PlacedDevice } from "@/lib/plan/devices";
import { catalogEntry, type CatalogEntry } from "./catalog";
import { layerItems, placeCheck, placeItem, removeItem, snapToWall, swapItem, updateItem, type FurnishCheck, type ItemPatch, type LayerItem } from "./layer";

/**
 * What the 2D Furnish page needs on top of the layer's own edits: the items
 * on a floor including the app's own cabinets and devices, the ghost that
 * follows the mouse while placing, dragging an item along walls, and the
 * distances to the walls around one.
 */

/** The app's own cabinets and devices on a floor, as the layout works them out. */
export type Layouts = { cabinets: PlacedCabinet[]; devices: PlacedDevice[] };

export function furnishLayouts(project: Project, level: Pick<Level, "id" | "kind" | "elevationIn">): Layouts {
  return { cabinets: levelCabinets(project, level).cabinets, devices: levelDevices(project, level) };
}

/**
 * Everything on the floor as one list. The layouts come from the saved
 * project, so while an item is dragged the plan being shown decides which of
 * the app's own cabinets and devices are hidden and which hand-placed copies
 * are there.
 */
export function stageItems(plan: FloorPlan, layouts?: Layouts): LayerItem[] {
  if (!layouts) return layerItems(plan);
  const hiddenC = new Set(plan.cabinets?.hidden ?? []);
  const hiddenD = new Set(plan.devices?.hidden ?? []);
  const cabinets = [...layouts.cabinets.filter((c) => c.auto && !hiddenC.has(c.id)), ...(plan.cabinets?.added ?? []).map((c) => ({ ...c, auto: false }) as PlacedCabinet)];
  const devices = [...layouts.devices.filter((d) => d.auto && !hiddenD.has(d.id)), ...(plan.devices?.added ?? []).map((d) => ({ ...d, auto: false }) as PlacedDevice)];
  return layerItems(plan, { cabinets, devices });
}

/** A hand-placed copy gets a new id when an app-placed cabinet or device is touched: find it. */
function addedId(before: FloorPlan, after: FloorPlan, item: LayerItem): string {
  if (!item.auto) return item.id;
  const was = new Set([...(before.cabinets?.added ?? []), ...(before.devices?.added ?? [])].map((x) => x.id));
  const now = [...(after.cabinets?.added ?? []), ...(after.devices?.added ?? [])].find((x) => !was.has(x.id));
  return now?.id ?? item.id;
}

/** Change an item, and say which id it has afterwards. */
export function patchItem(plan: FloorPlan, item: LayerItem, patch: ItemPatch): { plan: FloorPlan; id: string } {
  const next = updateItem(plan, item, patch);
  return { plan: next, id: addedId(plan, next, item) };
}

/** Swap an item for another kind, and say which id the new one has. */
export function swapTo(plan: FloorPlan, item: LayerItem, entryId: string, ceilingIn?: number): { plan: FloorPlan; id: string | null } {
  return swapItem(plan, item, entryId, ceilingIn);
}

export function deleteItem(plan: FloorPlan, item: LayerItem): FloorPlan {
  return removeItem(plan, item);
}

// ---------- Placing ----------

export type Ghost = {
  entryId: string;
  x: number;
  y: number;
  rotation: number;
  widthIn: number;
  depthIn: number;
  heightIn: number;
  bottomIn: number;
  check: FurnishCheck;
};

/** The size a catalog entry is placed at on this floor (ceiling items hang from the real ceiling). */
function placedSize(e: CatalogEntry, ceilingIn: number) {
  const bottomIn = e.mount === "ceiling" ? Math.max(0, ceilingIn - e.heightIn) : e.bottomIn;
  return { widthIn: e.widthIn, depthIn: e.depthIn, heightIn: e.heightIn, bottomIn };
}

/**
 * Where an item would land with the mouse at `cursor`: backed onto the
 * nearest wall (or flat on it, for wall-hung things), turned a further
 * `turn` degrees, and whether it can go there.
 */
export function ghostAt(plan: FloorPlan, entryId: string, cursor: Point, turn: number, items: LayerItem[], ceilingIn = 96): Ghost | null {
  const e = catalogEntry(entryId);
  if (!e || e.kind === "opening" || e.kind === "wall" || e.kind === "closet") return null;
  const size = placedSize(e, ceilingIn);
  const snap = snapToWall(plan, cursor, { widthIn: size.widthIn, depthIn: size.depthIn, mount: e.mount });
  const at = snap ?? { x: round1(cursor.x), y: round1(cursor.y), rotation: 0 };
  const rotation = (((at.rotation + turn) % 360) + 360) % 360;
  const check = placeCheck(plan, { entryId, x: at.x, y: at.y, rotation, ...size }, items);
  return { entryId, x: at.x, y: at.y, rotation, ...size, check };
}

/** Drop the ghost: the new plan and the id of what was placed (nothing when it doesn't fit). */
export function placeGhost(plan: FloorPlan, g: Ghost, ceilingIn = 96): { plan: FloorPlan; id: string | null } {
  if (!g.check.ok) return { plan, id: null };
  return placeItem(plan, g.entryId, { x: g.x, y: g.y }, { rotation: g.rotation, widthIn: g.widthIn, depthIn: g.depthIn, heightIn: g.heightIn, bottomIn: g.bottomIn, ceilingIn });
}

// ---------- Dragging ----------

/**
 * The item dragged so its middle is at `to`: it backs onto a wall that is
 * close (so it can be pulled off one), and says whether it fits there.
 */
export function dragItem(plan: FloorPlan, item: LayerItem, to: Point, items: LayerItem[]): { plan: FloorPlan; id: string; check: FurnishCheck; item: LayerItem } {
  const snap = item.mount === "ceiling" ? null : snapToWall(plan, to, { widthIn: item.widthIn, depthIn: item.depthIn, mount: item.mount }, 12);
  const at = snap ?? { x: round1(to.x), y: round1(to.y), rotation: item.rotation };
  const moved = { ...item, x: at.x, y: at.y, rotation: at.rotation };
  const check = placeCheck(plan, moved, items);
  const out = patchItem(plan, item, { x: at.x, y: at.y, rotation: at.rotation });
  return { ...out, check, item: moved };
}

// ---------- Distances to the walls ----------

export type WallGap = { side: "up" | "down" | "left" | "right"; inches: number; guide: Guide };

const SIDES: WallGap["side"][] = ["up", "down", "left", "right"];

/** How far each side of an item is from the nearest wall, looking up, down, left and right on the plan. */
export function wallGaps(plan: FloorPlan, item: Pick<LayerItem, "x" | "y" | "rotation" | "widthIn" | "depthIn">): WallGap[] {
  const b = boundsOf(rectangle(item.x, item.y, item.widthIn, item.depthIn, item.rotation));
  if (!b) return [];
  const guides = distanceGuides(b, wallSegments(flatPlan(plan)));
  // distanceGuides lists up, down, left, right, leaving out sides with no wall.
  const dirs: Point[] = [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }];
  return guides.map((guide) => {
    const d = sub(guide.to, guide.from);
    const i = dirs.findIndex((v) => v.x * d.x + v.y * d.y > 0 && Math.abs(v.x * d.y - v.y * d.x) < 1e-6);
    return { side: SIDES[i < 0 ? 0 : i], inches: guide.inches, guide };
  });
}

/** Move an item along one direction so its side is `inches` from the wall it faces. */
export function setWallGap(plan: FloorPlan, item: LayerItem, gap: WallGap, inches: number): { plan: FloorPlan; id: string } {
  const dir = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } }[gap.side];
  const to = add({ x: item.x, y: item.y }, scale(dir, gap.inches - Math.max(0, inches)));
  return patchItem(plan, item, { x: to.x, y: to.y });
}

// ---------- Duplicate and copy ----------

const optsOf = (item: LayerItem) => ({ rotation: item.rotation, widthIn: item.widthIn, depthIn: item.depthIn, heightIn: item.heightIn, bottomIn: item.bottomIn, ...(item.color ? { color: item.color } : {}) });

/** A copy next to the item: along its width, then the other way, then in front or behind, wherever it fits. */
export function duplicateItem(plan: FloorPlan, item: LayerItem, items: LayerItem[] = layerItems(plan), ceilingIn = 96): { plan: FloorPlan; id: string } | null {
  const u = rotate({ x: 1, y: 0 }, item.rotation);
  const v = rotate({ x: 0, y: 1 }, item.rotation);
  const small = item.mount !== "floor" && item.widthIn < 12;
  const gap = small ? 12 : 2;
  const offsets = [scale(u, item.widthIn + gap), scale(u, -(item.widthIn + gap)), ...(small ? [scale(v, 12), scale(v, -12)] : [scale(v, item.depthIn + gap), scale(v, -(item.depthIn + gap))])];
  for (const o of offsets) {
    const at = add({ x: item.x, y: item.y }, o);
    const check = placeCheck(plan, { ...item, x: at.x, y: at.y, id: undefined }, items);
    if (!check.ok) continue;
    const out = placeItem(plan, item.entryId, at, { ...optsOf(item), ceilingIn });
    if (out.id) return { plan: out.plan, id: out.id };
  }
  return null;
}

/** Rooms on the floor of the same kind as the item's room (Bath 2 for something in Bath 1). */
export function sameTypeRooms(plan: FloorPlan, item: Pick<LayerItem, "roomId">) {
  const room = plan.rooms.find((r) => r.id === item.roomId);
  if (!room?.type) return [];
  return plan.rooms.filter((r) => r.id !== room.id && r.type === room.type);
}

/**
 * Copy an item to the same spot in each other room of its kind (moved by the
 * distance between the rooms' middles, then backed onto a wall if it was on
 * one). Rooms where the copy doesn't fit are skipped.
 */
export function copyToRooms(plan: FloorPlan, item: LayerItem, ceilingIn = 96): { plan: FloorPlan; placed: number; skipped: string[] } {
  const from = plan.rooms.find((r) => r.id === item.roomId);
  if (!from) return { plan, placed: 0, skipped: [] };
  let next = plan;
  let placed = 0;
  const skipped: string[] = [];
  for (const room of sameTypeRooms(plan, item)) {
    const d = sub(polygonCenter(room.polygon), polygonCenter(from.polygon));
    const target = add({ x: item.x, y: item.y }, d);
    const snap = item.mount === "ceiling" ? null : snapToWall(next, target, { widthIn: item.widthIn, depthIn: item.depthIn, mount: item.mount });
    const at = snap ?? { x: round1(target.x), y: round1(target.y), rotation: item.rotation };
    const check = placeCheck(next, { ...item, id: undefined, x: at.x, y: at.y, rotation: at.rotation }, layerItems(next));
    if (!check.ok) {
      skipped.push(room.name);
      continue;
    }
    const out = placeItem(next, item.entryId, at, { ...optsOf(item), rotation: at.rotation, ceilingIn });
    if (out.id) {
      next = out.plan;
      placed++;
    }
  }
  return { plan: next, placed, skipped };
}
