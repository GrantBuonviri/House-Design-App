import { WHOLE_HOUSE, type Point, type Product, type Project, type Selection } from "@/lib/model/schema";
import { polygonArea, SQ_IN_PER_SQ_FT } from "@/lib/plan/geometry";
import { roomType } from "@/lib/brief/rooms";
import { INTERIOR_CATEGORIES, type InteriorCategory } from "@/lib/catalog/categories";

/**
 * Interior picks: one per category for the whole house, and any room can
 * have its own instead. A room without its own pick uses the whole house's.
 */

export type InteriorRoom = { id: string; name: string; type: string; levelId: string; levelName: string; sqft: number; polygon?: Point[] };

/** The floor plan's rooms, floor by floor, that can have finishes picked. */
export function interiorRooms(p: Pick<Project, "levels" | "floorPlans">): InteriorRoom[] {
  const out: InteriorRoom[] = [];
  const levels = [...p.levels].sort((a, b) => b.elevationIn - a.elevationIn);
  for (const l of levels) {
    for (const r of p.floorPlans[l.id]?.rooms ?? []) {
      const type = r.type ?? "other";
      const cat = roomType(type).category;
      if (cat === "garage" || cat === "outdoor") continue;
      out.push({ id: r.id, name: r.name, type, levelId: l.id, levelName: l.name, sqft: polygonArea(r.polygon) / SQ_IN_PER_SQ_FT, polygon: r.polygon });
    }
  }
  return out;
}

/** Categories that can be picked for a room (or, with no room, for the whole house). */
export function categoriesFor(room?: { type: string }): InteriorCategory[] {
  if (!room) return INTERIOR_CATEGORIES;
  return INTERIOR_CATEGORIES.filter((c) => c.perRoom && c.fits(room.type));
}

/** The pick for a room (or the whole house) and category. Accent wall paint doesn't count: see `wallPicks`. */
export function pickFor(selections: Selection[], targetId: string, category: string): Selection | undefined {
  return selections.find((s) => s.targetId === targetId && s.category === category && !s.wall);
}

/** What a room uses for a category: its own pick, else the whole house's. */
export function effectivePick(selections: Selection[], roomId: string, category: string): { pick: Selection; own: boolean } | null {
  const own = pickFor(selections, roomId, category);
  if (own) return { pick: own, own: true };
  const house = pickFor(selections, WHOLE_HOUSE, category);
  return house ? { pick: house, own: false } : null;
}

/** A product's brand and name, without saying the brand twice when the name already starts with it. */
export function productTitle(p: { brand: string; name: string }): string {
  return p.name.toLowerCase().startsWith(p.brand.toLowerCase()) ? p.name : `${p.brand} ${p.name}`;
}

/** A catalog product (interior or exterior) as saved in a pick: the product details only. */
export function toProduct(p: Product & { id: string; priceNote?: string }): Product {
  const { id, name, brand, line, sku, url, imageUrl, price, unit, priceSource, lastChecked, color, pattern, kind } = p;
  const out: Product = { id, name, brand, url, unit, priceSource, lastChecked, color, pattern, kind };
  if (line) out.line = line;
  if (sku) out.sku = sku;
  if (imageUrl) out.imageUrl = imageUrl;
  if (price !== undefined) out.price = price;
  return out;
}

/** Set (or with null, clear) the pick for a room or the whole house. */
export function setPick(selections: Selection[], targetId: string, category: string, product: Product | null): Selection[] {
  const rest = selections.filter((s) => !(s.targetId === targetId && s.category === category && !s.wall));
  if (!product) return rest;
  return [...rest, { id: `${targetId}:${category}`, targetId, category, product }];
}

/** The key for one wall of a room: its edge number, as "e3". */
export const wallKey = (edge: number) => `e${edge}`;

/** A room's accent walls: paint picked for one wall, by wall key. */
export function wallPicks(selections: Selection[], roomId: string): Map<string, Selection> {
  const out = new Map<string, Selection>();
  for (const s of selections) if (s.targetId === roomId && s.category === "paint" && s.wall) out.set(s.wall, s);
  return out;
}

/** Set (or with null, clear) the paint for one wall of a room. */
export function setWallPick(selections: Selection[], roomId: string, wall: string, product: Product | null): Selection[] {
  const rest = selections.filter((s) => !(s.targetId === roomId && s.category === "paint" && s.wall === wall));
  if (!product) return rest;
  return [...rest, { id: `${roomId}:paint:${wall}`, targetId: roomId, category: "paint", wall, product }];
}

/** Drop picks for rooms that are no longer in the plan. */
export function livePicks(selections: Selection[], roomIds: Set<string>): Selection[] {
  return selections.filter((s) => s.targetId === WHOLE_HOUSE || roomIds.has(s.targetId));
}

/** The products a room shows, by category (its own picks, then the whole house's). */
export function roomFinishes(selections: Selection[], roomId: string): Map<string, Product> {
  const out = new Map<string, Product>();
  for (const s of selections) if (s.targetId === WHOLE_HOUSE && !s.wall) out.set(s.category, s.product);
  for (const s of selections) if (s.targetId === roomId && !s.wall) out.set(s.category, s.product);
  return out;
}

/** Where the Interior design window's Pick finishes starts: the room you're standing in, if it takes finishes, else the whole house. */
export function startTarget(rooms: { id: string }[], hereRoomId?: string | null): string {
  return hereRoomId && rooms.some((r) => r.id === hereRoomId) ? hereRoomId : WHOLE_HOUSE;
}
