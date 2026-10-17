import type { FloorPlan, Point } from "@/lib/model/schema";
import { add, pointInPolygon, rectangle, rotate, scale } from "@/lib/plan/geometry";
import { furnitureType, overlaps } from "@/lib/plan/furniture";
import { roomAt, type LayerItem } from "./layer";

/**
 * The soft "room to move" shading around an item while it's placed, dragged
 * or picked on the Furnish page: a walkway in front of furniture, room
 * around an island or a table, and space in front of a toilet. These are
 * comfort sizes (the usual design guides), not code rules, so a zone that
 * runs into a wall or another item only turns red; it never stops a drop.
 */

export type ClearanceRule = { front?: number; sides?: number; back?: number; label: string };

const RULES: Record<string, ClearanceRule> = {
  "fixture:toilet": { front: 30, label: `30" in front of a toilet` },
  "fixture:island": { front: 42, sides: 42, back: 42, label: `42" around an island` },
  "fixture:counter": { front: 42, label: `42" in front of a counter` },
  "fixture:sink": { front: 42, label: `42" in front of a sink` },
  "fixture:range": { front: 42, label: `42" in front of a range` },
  "fixture:fridge": { front: 42, label: `42" in front of a refrigerator` },
  "fixture:dishwasher": { front: 42, label: `42" in front of a dishwasher` },
  "fixture:vanity": { front: 30, label: `30" in front of a vanity` },
  "fixture:tub": { front: 30, label: `30" beside a tub` },
  "fixture:shower": { front: 30, label: `30" in front of a shower` },
  "fixture:washer": { front: 36, label: `36" in front of a washer` },
  "fixture:dryer": { front: 36, label: `36" in front of a dryer` },
  "fixture:laundry-sink": { front: 30, label: `30" in front of a laundry sink` },
  "furniture:dining-table": { front: 36, sides: 36, back: 36, label: `36" around a table to pull out chairs` },
  "furniture:bed-twin": { front: 36, sides: 24, label: `24" beside a bed, 36" at its foot` },
  "furniture:bed-full": { front: 36, sides: 24, label: `24" beside a bed, 36" at its foot` },
  "furniture:bed-queen": { front: 36, sides: 24, label: `24" beside a bed, 36" at its foot` },
  "furniture:bed-king": { front: 36, sides: 24, label: `24" beside a bed, 36" at its foot` },
  "furniture:desk": { front: 36, label: `36" to pull out a chair` },
  "furniture:dresser": { front: 36, label: `36" to open drawers` },
};

/** A 36" walkway in front of furniture that isn't listed above; nothing for small things, rugs and side tables. */
const WALKWAY: ClearanceRule = { front: 36, label: `36" walkway` };
const NO_WALKWAY = new Set(["side-table", "nightstand", "plant", "coffee-table", "desk-chair", "bar-stools"]);

export function clearanceRule(entryId: string): ClearanceRule | null {
  if (RULES[entryId]) return RULES[entryId];
  if (!entryId.startsWith("furniture:")) return null;
  const type = entryId.slice(10);
  const t = furnitureType(type);
  if (!t || t.flat || NO_WALKWAY.has(type)) return null;
  return WALKWAY;
}

export type ClearanceZone = { polygon: Point[]; label: string; blocked: boolean; why?: string };

type Placed = Pick<LayerItem, "entryId" | "x" | "y" | "rotation" | "widthIn" | "depthIn" | "mount"> & { id?: string };

/** Counters and islands hold sinks, ranges and cabinets: those don't block each other's room. */
const HOLDERS = new Set(["fixture:counter", "fixture:island", "fixture:vanity"]);
const KITCHEN = (id: string) => /^fixture:(sink|prep-sink|range|dishwasher|fridge|counter|island)$/.test(id) || id.startsWith("cabinet:");

/**
 * The zones around an item (in front, at the sides, behind, as its rule
 * says), each marked blocked when it runs through a wall of the item's room
 * or into another floor item. Furniture chosen to sit in the zone (a
 * nightstand by the bed, a chair at a desk, stools at an island) doesn't
 * count, and neither do flat things like rugs.
 */
export function clearanceZones(plan: FloorPlan, item: Placed, others: LayerItem[]): ClearanceZone[] {
  if (item.mount !== "floor") return [];
  const rule = clearanceRule(item.entryId);
  if (!rule) return [];
  const c = { x: item.x, y: item.y };
  const u = rotate({ x: 1, y: 0 }, item.rotation);
  const v = rotate({ x: 0, y: 1 }, item.rotation);
  const zones: { mid: Point; w: number; d: number; turn: number }[] = [];
  const hw = item.widthIn / 2;
  const hd = item.depthIn / 2;
  // Side and back zones run the full length; the front one also covers the corners when sides are wanted.
  if (rule.front) zones.push({ mid: add(c, scale(v, hd + rule.front / 2)), w: item.widthIn + 2 * (rule.sides ?? 0), d: rule.front, turn: item.rotation });
  if (rule.back) zones.push({ mid: add(c, scale(v, -(hd + rule.back / 2))), w: item.widthIn + 2 * (rule.sides ?? 0), d: rule.back, turn: item.rotation });
  if (rule.sides) for (const s of [-1, 1]) zones.push({ mid: add(c, scale(u, s * (hw + rule.sides / 2))), w: rule.sides, d: item.depthIn, turn: item.rotation });
  const room = roomAt(plan, c);
  const kitchen = KITCHEN(item.entryId);
  const blockers = others.filter(
    (o) =>
      o.id !== item.id &&
      o.mount === "floor" &&
      o.kind !== "device" &&
      !(o.entryId.startsWith("furniture:") && (furnitureType(o.entryId.slice(10))?.flat || NO_WALKWAY.has(o.entryId.slice(10)))) &&
      !(kitchen && KITCHEN(o.entryId) && (HOLDERS.has(o.entryId) || HOLDERS.has(item.entryId) || o.entryId.startsWith("cabinet:"))),
  );
  return zones.map((z) => {
    const polygon = rectangle(z.mid.x, z.mid.y, z.w, z.d, z.turn);
    // A zone sticking out of the room (through a wall) is blocked; check the corners and edge middles.
    const probe = polygon.flatMap((p, i) => [p, scale(add(p, polygon[(i + 1) % 4]), 0.5)]);
    const shrunk = probe.map((p) => add(p, scale(add(z.mid, scale(p, -1)), 0.04)));
    if (room && shrunk.some((p) => !pointInPolygon(p, room.polygon))) return { polygon, label: rule.label, blocked: true, why: "a wall" };
    const hit = blockers.find((o) => overlaps(polygon, rectangle(o.x, o.y, o.widthIn, o.depthIn, o.rotation)));
    return hit ? { polygon, label: rule.label, blocked: true, why: `the ${hit.label.toLowerCase()}` } : { polygon, label: rule.label, blocked: false };
  });
}

/** One line for the drawing: the zone's size, and what's in the way when it's short. */
export function clearanceNote(zones: ClearanceZone[]): string | null {
  if (!zones.length) return null;
  const bad = zones.find((z) => z.blocked);
  return bad ? `Less than ${bad.label} (${bad.why} is in the way)` : zones[0].label;
}
