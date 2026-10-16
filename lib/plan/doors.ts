import type { FloorPlan, PlanRoom } from "@/lib/model/schema";
import { OUTSIDE, addDoor, isCirculation, neighbors, reachable, roleOf, roomLinks, sharedWall, type DoorOptions } from "./connect";
import { polygonArea, polygonsOverlap, type Bounds } from "./geometry";
import { areaKind } from "./measure";
import { DOOR_ROOM_IN, boxCorners, isWayIn } from "./hallways";

/** Suggest a plan: doors so every room can be reached. */

// ---------- Doors ----------

const pick = (types: string[]) => (r: PlanRoom) => {
  const i = types.indexOf(r.type ?? "");
  return i === -1 ? null : i;
};

/**
 * Doors so every room can be reached: private rooms off a hallway or living
 * space, suite rooms off the primary bedroom, the pantry off the kitchen,
 * the garage into the house, porches and decks off living spaces. Then any
 * room still cut off gets a door to a neighbor that can be reached.
 */
export function connectAll(plan: FloorPlan, obstacles: Bounds[] = [], openKitchen = false): FloorPlan {
  let p = plan;
  const links = () => roomLinks(p);
  const room = (id: string) => p.rooms.find((r) => r.id === id)!;

  /** A door to the best-ranked neighbor (lowest rank first, then the longest wall). */
  const doorTo = (r: PlanRoom, rank: (n: PlanRoom) => number | null, opts: (n: PlanRoom) => DoorOptions = () => ({})) => {
    const ranked = neighbors(p, r, DOOR_ROOM_IN)
      .map((n) => ({ ...n, rank: rank(n.room) }))
      .filter((n): n is typeof n & { rank: number } => n.rank !== null)
      .sort((a, b) => a.rank - b.rank || b.length - a.length);
    for (const n of ranked) {
      const next = addDoor(p, r, n.room, opts(n.room));
      if (next) {
        p = next;
        return true;
      }
    }
    return false;
  };
  const linkedTo = (r: PlanRoom, ok: (n: PlanRoom) => boolean) => [...(links().get(r.id) ?? [])].some((id) => id !== OUTSIDE && ok(room(id)));
  const circulationRank = (n: PlanRoom) => (roleOf(n) === "hall" ? 0 : roleOf(n) === "public" ? 1 : null);

  // Hallways open onto a living space, or else onto another hallway.
  for (const r of p.rooms.filter((x) => roleOf(x) === "hall")) {
    if (linkedTo(r, (n) => roleOf(n) === "public")) continue;
    if (!doorTo(r, (n) => (roleOf(n) === "public" ? 0 : null), () => ({ style: "opening", widthIn: 36 })) && !linkedTo(r, isCirculation)) {
      doorTo(r, (n) => (roleOf(n) === "hall" ? 0 : null), () => ({ style: "opening", widthIn: 36 }));
    }
  }
  // Bedrooms, bathrooms and the like off a hallway or living space.
  for (const r of p.rooms.filter((x) => roleOf(x) === "private")) {
    const rank = (n: PlanRoom) => circulationRank(n) ?? (isWayIn(n, r) ? 2 : null);
    if (!linkedTo(r, (n) => isWayIn(n, r))) doorTo(r, rank, () => ({ widthIn: r.type === "bathroom" || r.type === "half-bath" ? 30 : 32, swingInto: r.id }));
  }
  // The primary bath and closet off the primary bedroom.
  for (const r of p.rooms.filter((x) => roleOf(x) === "suite")) {
    const parents = r.type === "primary-closet" ? ["primary-bedroom", "primary-bath"] : ["primary-bedroom"];
    if (!linkedTo(r, (n) => parents.includes(n.type ?? ""))) {
      if (!doorTo(r, pick(parents), () => ({ widthIn: 30, swingInto: r.id })) && !linkedTo(r, isCirculation)) doorTo(r, circulationRank, () => ({ widthIn: 30, swingInto: r.id }));
    }
  }
  // The pantry off the kitchen.
  for (const r of p.rooms.filter((x) => roleOf(x) === "pantry")) {
    if (!linkedTo(r, () => true)) doorTo(r, pick(["kitchen", "dining", "mudroom", "hall", "family", "living"]), () => ({ widthIn: 28, swingInto: r.id }));
  }
  // The garage into the house.
  for (const r of p.rooms.filter((x) => roleOf(x) === "garage")) {
    if (!linkedTo(r, () => true)) doorTo(r, pick(["mudroom", "laundry", "entry", "kitchen", "hall", "family", "dining", "living"]), () => ({ widthIn: 32, swingInto: r.id }));
  }
  // Porches, patios and decks off living spaces.
  for (const r of p.rooms.filter((x) => roleOf(x) === "outdoor")) {
    if (linkedTo(r, () => true)) continue;
    const order = r.type === "porch" ? ["entry", "living", "family", "dining", "kitchen"] : ["living", "family", "dining", "kitchen", "sunroom", "entry"];
    doorTo(r, pick(order), (n) => ((sharedWall(r, n)?.t1 ?? 0) - (sharedWall(r, n)?.t0 ?? 0) >= 84 ? { style: "door-slider", widthIn: 72 } : { widthIn: 36, swingInto: n.id }));
  }
  // Living spaces with no way in at all.
  const OPEN_PLAN = ["kitchen", "dining", "living", "family"];
  for (const r of p.rooms.filter((x) => roleOf(x) === "public")) {
    if (linkedTo(r, () => true)) continue;
    doorTo(r, circulationRank, (n) => (openKitchen && OPEN_PLAN.includes(r.type ?? "") && OPEN_PLAN.includes(n.type ?? "") ? { style: "opening", widthIn: 72 } : {}));
  }

  // Anything still cut off from the way in gets a door to a room that can be reached.
  for (let k = 0; k < p.rooms.length; k++) {
    const seeds = wayInRooms(p, obstacles);
    if (!seeds.length) {
      const first = [...p.rooms].filter(isCirculation).sort((a, b) => polygonArea(b.polygon) - polygonArea(a.polygon))[0];
      if (!first) break;
      seeds.push(first.id);
    }
    const seen = reachable(p, seeds);
    const cutOff = p.rooms.filter((r) => !seen.has(r.id) && areaKind(r) !== "outdoor");
    if (!cutOff.length) break;
    let fixed = false;
    for (const r of cutOff) {
      const rank = (n: PlanRoom) => (!seen.has(n.id) ? null : roleOf(n) === "hall" ? 0 : roleOf(n) === "public" ? 1 : roleOf(n) === "garage" ? 3 : 2);
      const open = (n: PlanRoom) => (roleOf(r) === "hall" && isCirculation(n)) || (roleOf(n) === "hall" && isCirculation(r));
      if (doorTo(r, rank, (n) => (open(n) ? { style: "opening", widthIn: 36 } : { swingInto: r.id }))) {
        fixed = true;
        break;
      }
    }
    if (!fixed) break;
  }
  return p;
}

/**
 * Where you come into a floor: rooms with a door to the outside (or onto a
 * porch or deck) or, on a floor with none, rooms beside the stairs.
 */
export function wayInRooms(plan: FloorPlan, stairs: Bounds[]): string[] {
  const links = roomLinks(plan);
  const outdoor = new Set(plan.rooms.filter((r) => areaKind(r) === "outdoor").map((r) => r.id));
  const outside = plan.rooms.filter((r) => !outdoor.has(r.id) && [...(links.get(r.id) ?? [])].some((id) => id === OUTSIDE || outdoor.has(id)));
  if (outside.length) return outside.map((r) => r.id);
  return plan.rooms.filter((r) => stairs.some((b) => polygonsOverlap(boxCorners({ x0: b.x0 - 6, y0: b.y0 - 6, x1: b.x1 + 6, y1: b.y1 + 6 }), r.polygon, 0))).map((r) => r.id);
}
