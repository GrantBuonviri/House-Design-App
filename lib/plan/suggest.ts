import type { BubbleDiagram, DesignBrief, Fixture, FloorPlan, Level, PlanRoom, Point } from "@/lib/model/schema";
import { exteriorWallIn, levelBelow, riseBetween } from "./basics";
import { OUTSIDE, addDoor, freeSpot, isCirculation, neighbors, newOpening, openingRooms, reachable, roleOf, roomLinks, sharedWall, type DoorOptions } from "./connect";
import { emptyPlan, keepOpeningsInPlace, makeRoom, moveMany, newPlanId, reshapeRoom, type Plans } from "./edit";
import { plansFromSketch, type PlanContext } from "./fromSketch";
import {
  add,
  angleOf,
  boundsOf,
  collinearOverlap,
  dist,
  dot,
  edgesOf,
  isRectangle,
  leftNormal,
  lerp,
  pointInPolygon,
  polygonArea,
  polygonsOverlap,
  round1,
  roundPoint,
  scale,
  sub,
  subtractIntervals,
  unit,
  type Bounds,
} from "./geometry";
import { areaKind } from "./measure";
import { stairsDrawing } from "./stairs";
import { openingGeometry, wallPieces } from "./walls";

/**
 * "Suggest a plan": the flow sketch turned into a plan, plus what a real plan
 * needs that the sketch doesn't show. A hallway where bedrooms and bathrooms
 * would otherwise only open off other bedrooms, doors so every room can be
 * reached, a closet in each bedroom, and windows on outside walls (more and
 * bigger on the sunny south side). All built-in rules; no AI.
 */

/** A hallway is 3' 6" from wall middle to wall middle, about 3' 2" clear. */
export const HALL_IN = 42;
const DOOR_ROOM_IN = 36;
const SOUTH: Point = { x: 0, y: 1 };

// ---------- Hallways ----------

/** Laundry, storage and workshops can open off the garage too. */
const UTILITY = new Set(["laundry", "storage", "mechanical", "workshop"]);

/** A room a private room can sensibly open onto. */
export function isWayIn(room: PlanRoom, from: PlanRoom): boolean {
  return isCirculation(room) || (UTILITY.has(from.type ?? "") && roleOf(room) === "garage");
}

/** Bedrooms, bathrooms and other private rooms with no wall onto a living space or hallway. */
export function roomsNeedingHall(plan: FloorPlan): PlanRoom[] {
  return plan.rooms.filter((r) => roleOf(r) === "private" && !neighbors(plan, r, DOOR_ROOM_IN).some((n) => isWayIn(n.room, r)));
}

const isAxisRect = (poly: Point[]) =>
  poly.length === 4 && isRectangle(poly) && edgesOf(poly).every((e) => Math.abs(e.a.x - e.b.x) < 0.5 || Math.abs(e.a.y - e.b.y) < 0.5);

const boxCorners = (b: Bounds): Point[] => [
  { x: b.x0, y: b.y0 },
  { x: b.x1, y: b.y0 },
  { x: b.x1, y: b.y1 },
  { x: b.x0, y: b.y1 },
];

/** A cut through the floor along x = c or y = c. Everything on the `dir` side slides away to make room for a hallway. */
type Cut = { axis: "x" | "y"; c: number; dir: 1 | -1 };
type CutResult = { plan: FloorPlan; served: number; score: number };

function tryCut(plan: FloorPlan, cut: Cut, needy: Set<string>, obstacles: Bounds[], name: string): CutResult | null {
  const E = 0.75;
  const { c, dir } = cut;
  const U = (p: Point) => (cut.axis === "y" ? p.y : p.x);
  const V = (p: Point) => (cut.axis === "y" ? p.x : p.y);
  const sideOf = (pts: Point[]): "P" | "Q" | "S" => {
    const us = pts.map(U);
    const lo = Math.min(...us);
    const hi = Math.max(...us);
    if (dir > 0 ? lo >= c - E : hi <= c + E) return "Q";
    if (dir > 0 ? hi <= c + E : lo >= c - E) return "P";
    return "S";
  };

  // P stays, Q slides away, S straddles the cut and stretches.
  const side = new Map(plan.rooms.map((r) => [r.id, sideOf(r.polygon)]));
  if (obstacles.some((b) => sideOf(boxCorners(b)) !== "P")) return null;
  if (plan.walls.some((w) => sideOf([w.a, w.b]) === "S")) return null;
  const straddle = plan.rooms.filter((r) => side.get(r.id) === "S");
  if (straddle.some((r) => !isAxisRect(r.polygon))) return null;

  // Where rooms (and the stairs, which never move) meet the cut line from each side.
  const touch: { id: string; side: "P" | "Q"; v0: number; v1: number; open: boolean }[] = [];
  for (const r of plan.rooms) {
    const s = side.get(r.id)!;
    if (s === "S") continue;
    for (const e of edgesOf(r.polygon)) {
      if (Math.abs(U(e.a) - c) < E && Math.abs(U(e.b) - c) < E) touch.push({ id: r.id, side: s, v0: Math.min(V(e.a), V(e.b)), v1: Math.max(V(e.a), V(e.b)), open: isCirculation(r) });
    }
  }
  obstacles.forEach((b, i) => {
    const pts = boxCorners(b);
    if (pts.some((p) => Math.abs(U(p) - c) < E)) touch.push({ id: `stairs-${i}`, side: "P", v0: Math.min(...pts.map(V)), v1: Math.max(...pts.map(V)), open: true });
  });
  // Where both sides meet, the cut would open a gap, so the hallway has to cover it.
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of touch.filter((t) => t.side === "P")) {
    for (const q of touch.filter((t) => t.side === "Q")) {
      const a = Math.max(p.v0, q.v0);
      const b = Math.min(p.v1, q.v1);
      if (b - a > 1) {
        lo = Math.min(lo, a);
        hi = Math.max(hi, b);
      }
    }
  }
  if (!Number.isFinite(lo)) return null;
  const blocked = straddle.map((r) => [Math.min(...r.polygon.map(V)), Math.max(...r.polygon.map(V))]);
  const crosses = (a: number, b: number) => blocked.some(([s0, s1]) => Math.min(b, s1) - Math.max(a, s0) > 0.5);
  if (crosses(lo, hi)) return null;

  // The hallway has to open onto a living space or the stairs: one that runs along it, or a stretched room it ends at.
  const reach = (a: number, b: number) =>
    touch.some((t) => t.open && Math.min(t.v1, b) - Math.max(t.v0, a) >= Math.min(DOOR_ROOM_IN + 4, t.v1 - t.v0 - 1)) ||
    straddle.some((r) => isCirculation(r) && (Math.abs(Math.max(...r.polygon.map(V)) - a) < E || Math.abs(Math.min(...r.polygon.map(V)) - b) < E));
  if (!reach(lo, hi)) {
    let best: { a: number; b: number; extra: number } | null = null;
    for (const t of touch.filter((x) => x.open)) {
      const need = Math.min(DOOR_ROOM_IN + 4, t.v1 - t.v0);
      const a = t.v1 <= hi ? Math.min(lo, t.v1 - need) : lo;
      const b = t.v0 >= lo ? Math.max(hi, t.v0 + need) : hi;
      if (crosses(a, b) || !reach(a, b)) continue;
      const extra = lo - a + (b - hi);
      if (!best || extra < best.extra) best = { a, b, extra };
    }
    if (!best) return null;
    lo = best.a;
    hi = best.b;
  }

  // Slide the far side away, stretch the rooms across the cut, and put the hallway in the gap.
  const W = HALL_IN * dir;
  const shift = cut.axis === "y" ? { x: 0, y: W } : { x: W, y: 0 };
  const moving = [
    ...plan.rooms.filter((r) => side.get(r.id) === "Q").map((r) => r.id),
    ...plan.walls.filter((w) => sideOf([w.a, w.b]) === "Q").map((w) => w.id),
    ...plan.fixtures.filter((f) => !f.roomId && sideOf([f]) === "Q").map((f) => f.id),
  ];
  const moved = moveMany(plan, moving, shift.x, shift.y);
  const beyond = (p: Point) => (dir > 0 ? U(p) > c : U(p) < c);
  let next = keepOpeningsInPlace(moved, {
    ...moved,
    rooms: moved.rooms.map((r) => (side.get(r.id) === "S" ? { ...r, polygon: r.polygon.map((p) => (beyond(p) ? roundPoint(add(p, shift)) : p)) } : r)),
  });
  const u0 = Math.min(c, c + W);
  const corners = cut.axis === "y" ? boxCorners({ x0: lo, y0: u0, x1: hi, y1: u0 + HALL_IN }) : boxCorners({ x0: u0, y0: lo, x1: u0 + HALL_IN, y1: hi });
  const hall = makeRoom(corners, name, { type: "hall" });
  if (next.rooms.some((r) => polygonsOverlap(r.polygon, hall.polygon))) return null;
  if (obstacles.some((b) => polygonsOverlap(boxCorners(b), hall.polygon))) return null;
  next = { ...next, rooms: [...next.rooms, hall] };
  const atStairs = obstacles.some((b) => edgesOf(boxCorners(b)).some((e) => edgesOf(hall.polygon).some((f) => (collinearOverlap(e.a, e.b, f.a, f.b, 1)?.[1] ?? 0) - (collinearOverlap(e.a, e.b, f.a, f.b, 1)?.[0] ?? 0) >= DOOR_ROOM_IN)));
  if (!atStairs && !neighbors(next, hall, DOOR_ROOM_IN).some((n) => isCirculation(n.room))) return null;

  const served = next.rooms.filter((r) => needy.has(r.id) && (sharedWall(r, hall)?.t1 ?? 0) - (sharedWall(r, hall)?.t0 ?? 0) >= DOOR_ROOM_IN).length;
  if (!served) return null;
  // Splitting a bedroom from its own bath or closet is worse than a longer hallway.
  const split = plan.openings.filter((o) => {
    if (o.kind === "window") return false;
    const [a, b] = openingRooms(plan, o);
    if (!a || !b || side.get(a) === "S" || side.get(b) === "S" || side.get(a) === side.get(b)) return false;
    return [a, b].some((id) => ["suite", "closet"].includes(roleOf(plan.rooms.find((r) => r.id === id)!)));
  }).length;
  const score = served * 1000 - split * 400 - ((hi - lo) / 12) * 3 - straddle.length * 25 - moving.length * 0.5;
  return { plan: dropDoorsToNowhere(plan, next), served, score };
}

/** Doors that joined two rooms before, and now open onto nothing, are taken out. */
function dropDoorsToNowhere(before: FloorPlan, after: FloorPlan): FloorPlan {
  const was = new Map(before.openings.map((o) => [o.id, openingRooms(before, o)]));
  const openings = after.openings.filter((o) => {
    const w = was.get(o.id);
    if (o.kind === "window" || !w || !w[0] || !w[1]) return true;
    const [a, b] = openingRooms(after, o);
    return Boolean(a && b);
  });
  return openings.length === after.openings.length ? after : { ...after, openings };
}

// ---------- Stair halls ----------

/** Room to step off the stairs at each end. */
const LANDING_IN = 36;
/** Rooms this close to the stairs get the stair hall reaching over to them. */
const REACH_IN = 60;

/**
 * Stairs standing outside every room get a stair hall around them: space to
 * step off at each end, reaching across to rooms close by so it can have
 * doors. Skipped when it would run into a room or touch none.
 */
export function addStairHalls(plan: FloorPlan, boxes: Bounds[]): { plan: FloorPlan; added: number } {
  let p = plan;
  let added = 0;
  for (const b of boxes) {
    if (p.rooms.some((r) => polygonsOverlap(boxCorners(b), r.polygon))) continue;
    const long = b.x1 - b.x0 >= b.y1 - b.y0 ? "x" : "y";
    const rect = { ...b };
    const sides = (long === "x" ? ["x0", "x1", "y0", "y1"] : ["y0", "y1", "x0", "x1"]) as (keyof Bounds)[];
    for (const side of sides) {
      const axis = side[0] as "x" | "y";
      const low = side.endsWith("0");
      const across = (r: Bounds) => (axis === "x" ? r.y0 < rect.y1 - 1 && r.y1 > rect.y0 + 1 : r.x0 < rect.x1 - 1 && r.x1 > rect.x0 + 1);
      const gaps = p.rooms
        .map((r) => boundsOf(r.polygon)!)
        .filter(across)
        .map((r) => (low ? rect[side] - (axis === "x" ? r.x1 : r.y1) : (axis === "x" ? r.x0 : r.y0) - rect[side]))
        .filter((d) => d >= -0.5);
      const nearest = Math.max(0, Math.min(Infinity, ...gaps));
      const grow = nearest <= REACH_IN ? nearest : axis === long ? LANDING_IN : 0;
      rect[side] = round1(low ? rect[side] - grow : rect[side] + grow);
    }
    const poly = boxCorners(rect);
    if (p.rooms.some((r) => polygonsOverlap(poly, r.polygon))) continue;
    const hall = makeRoom(poly, "Stair hall", { type: "hall" });
    if (!neighbors(p, hall, DOOR_ROOM_IN).length) continue;
    p = { ...p, rooms: [...p.rooms, hall] };
    added++;
  }
  return { plan: p, added };
}

/** Add hallways, one at a time, until every bedroom and bathroom opens onto one (or no cut helps). */
export function addHallways(plan: FloorPlan, obstacles: Bounds[] = [], max = 3): { plan: FloorPlan; added: number } {
  let added = 0;
  for (let k = 0; k < max; k++) {
    const needy = new Set(roomsNeedingHall(plan).map((r) => r.id));
    if (!needy.size) break;
    const name = plan.rooms.some((r) => r.type === "hall") ? `Hall ${plan.rooms.filter((r) => r.type === "hall").length + 1}` : "Hall";
    let best: CutResult | null = null;
    for (const axis of ["x", "y"] as const) {
      const lines = [...new Set(plan.rooms.flatMap((r) => r.polygon.map((p) => round1(axis === "x" ? p.x : p.y))))];
      for (const c of lines) {
        for (const dir of [1, -1] as const) {
          const res = tryCut(plan, { axis, c, dir }, needy, obstacles, name);
          if (res && (!best || res.score > best.score)) best = res;
        }
      }
    }
    if (!best) break;
    plan = best.plan;
    added++;
  }
  return { plan, added };
}

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

// ---------- Closets ----------

const BEDROOMS = new Set(["bedroom", "guest-suite", "primary-bedroom"]);
const REACH_IN_IN = 26;
const WALK_IN_IN = 66;

/** A closet in the corner of a bedroom, against an inside wall and clear of doors. */
export function addClosets(plan: FloorPlan, exteriorIn: number, brief: DesignBrief | null = null): { plan: FloorPlan; added: number } {
  let p = plan;
  let added = 0;
  const briefHasCloset = Boolean(brief?.rooms.some((r) => r.type === "primary-closet"));
  for (const bed of plan.rooms.filter((r) => BEDROOMS.has(r.type ?? ""))) {
    const now = p.rooms.find((r) => r.id === bed.id);
    if (!now || !isRectangle(now.polygon)) continue;
    // Already has a closet of its own.
    if ([...(roomLinks(p).get(now.id) ?? [])].some((id) => p.rooms.find((r) => r.id === id)?.type === "closet")) continue;
    if (now.type === "primary-bedroom" && briefHasCloset) continue;
    const sqft = polygonArea(now.polygon) / 144;
    if (sqft < 90) continue;
    const sides = edgesOf(now.polygon).map((e) => dist(e.a, e.b));
    const walkIn = now.type === "primary-bedroom" && sqft >= 200 && Math.min(...sides) >= 144;
    const depth = walkIn ? WALK_IN_IN : REACH_IN_IN;
    const pieces = wallPieces(p, exteriorIn).filter((w) => "roomId" in w.host && w.host.roomId === now.id);
    const geos = p.openings.map((o) => ({ o, ...openingEnds(p, o) })).filter((g) => g.a);

    let best: { score: number; poly: Point[]; closet: Point[]; back: [Point, Point]; n: Point; L: number } | null = null;
    for (const e of edgesOf(now.polygon)) {
      const len = dist(e.a, e.b);
      const L = walkIn ? Math.min(len - 36, 84) : Math.min(len - 30, 96);
      const perp = sides[(e.i + 1) % 4];
      if (L < (walkIn ? 60 : 48) || perp < depth + 60) continue;
      const u = unit(sub(e.b, e.a));
      const n = scale(leftNormal(u), -1);
      const outside = pieces.filter((w) => "edge" in w.host && w.host.edge === e.i && w.exterior).reduce((s, w) => s + (w.t1 - w.t0), 0);
      const next = neighbors(p, now, 24).filter((x) => sharedOnEdge(now, e.i, x.room));
      const quiet = next.some((x) => BEDROOMS.has(x.room.type ?? "") || roleOf(x.room) === "suite" || x.room.type === "bathroom" || x.room.type === "closet");
      for (const atStart of [true, false]) {
        const C = atStart ? e.a : e.b;
        const w = atStart ? u : scale(u, -1);
        const grown = [add(C, add(scale(w, -4), scale(n, -4))), add(C, add(scale(w, L + 4), scale(n, -4))), add(C, add(scale(w, L + 4), scale(n, depth + 4))), add(C, add(scale(w, -4), scale(n, depth + 4)))];
        if (geos.some((g) => [g.a!, g.center!, g.b!].some((q) => pointInPolygon(q, grown)))) continue;
        const inner = [add(C, scale(n, depth)), add(C, add(scale(w, L), scale(n, depth))), add(C, scale(w, L))];
        const poly = [...now.polygon];
        const i = atStart ? e.i : (e.i + 1) % 4;
        // Going clockwise, the corner is reached along the wall the closet's depth runs on.
        poly.splice(i, 1, ...(atStart ? inner : [...inner].reverse()));
        const score = 10 - (outside / len) * 8 + (quiet ? 3 : 0) + (atStart ? 0.1 : 0);
        if (!best || score > best.score) best = { score, poly, closet: [C, add(C, scale(w, L)), add(C, add(scale(w, L), scale(n, depth))), add(C, scale(n, depth))], back: [C, add(C, scale(w, L))], n, L };
      }
    }
    if (!best) continue;
    p = reshapeRoom(p, now.id, best.poly);
    const closet = makeRoom(best.closet, walkIn ? "Walk-in closet" : "Closet", { type: "closet" });
    p = { ...p, rooms: [...p.rooms, closet] };
    const bedNow = p.rooms.find((r) => r.id === now.id)!;
    p = addDoor(p, closet, bedNow, walkIn ? { widthIn: 28, swingInto: bedNow.id } : best.L >= 60 ? { style: "door-double", widthIn: 48, swingInto: bedNow.id } : { widthIn: 24, swingInto: bedNow.id }) ?? p;
    const mid = scale(add(best.back[0], best.back[1]), 0.5);
    const shelf = walkIn ? 24 : 20;
    const at = add(mid, scale(best.n, 3 + shelf / 2));
    const rod: Fixture = { id: newPlanId("f"), kind: "closet", x: round1(at.x), y: round1(at.y), rotation: Math.round(angleOf(best.n) - 90), widthIn: Math.round(best.L - 10), depthIn: shelf, roomId: closet.id };
    p = { ...p, fixtures: [...p.fixtures, rod] };
    added++;
  }
  return { plan: p, added };
}

function openingEnds(plan: FloorPlan, o: FloorPlan["openings"][number]) {
  const g = openingGeometry(plan, o);
  return g ? { a: g.a, b: g.b, center: g.center } : { a: undefined, b: undefined, center: undefined };
}

/** Does `other` share some of edge `i` of `room`? */
function sharedOnEdge(room: PlanRoom, i: number, other: PlanRoom): boolean {
  const w = sharedWall(room, other);
  return Boolean(w && w.edge === i);
}

// ---------- Windows ----------

const NO_WINDOWS = new Set(["hall", "closet", "pantry", "primary-closet", "mechanical", "storage", "garage", "entry"]);
const BATHS = new Set(["bathroom", "half-bath", "primary-bath"]);
const SUNNY = new Set(["living", "family", "dining", "sunroom", "kitchen"]);
const ONE_SMALL = new Set(["laundry", "mudroom"]);
const END_IN = 18;

type Placement = { style: string; widthIn: number };

export type Stretch = { a: Point; b: Point; t0: number; t1: number; host: { roomId: string; edge: number } };

/** Stretches of a room's walls with nothing indoors on the other side: open air, or a porch, patio or deck. */
export function outsideStretches(plan: FloorPlan, room: PlanRoom): Stretch[] {
  const indoor = plan.rooms.filter((r) => r.id !== room.id && areaKind(r) !== "outdoor");
  const out: Stretch[] = [];
  for (const e of edgesOf(room.polygon)) {
    const L = dist(e.a, e.b);
    if (L < 1) continue;
    const cuts: [number, number][] = [];
    for (const other of indoor) {
      for (const f of edgesOf(other.polygon)) {
        const o = collinearOverlap(e.a, e.b, f.a, f.b, 1);
        if (o) cuts.push(o);
      }
    }
    for (const [t0, t1] of subtractIntervals(L, cuts)) out.push({ a: e.a, b: e.b, t0, t1, host: { roomId: room.id, edge: e.i } });
  }
  return out;
}

/** Is an indoor room just outside this stretch of wall (a few inches away, so a window would look into it)? */
export function roomJustOutside(plan: FloorPlan, s: Stretch): boolean {
  const n = leftNormal(unit(sub(s.b, s.a)));
  const L = dist(s.a, s.b);
  return [0.25, 0.5, 0.75].some((k) => {
    const p = add(lerp(s.a, s.b, (s.t0 + (s.t1 - s.t0) * k) / L), scale(n, 12));
    return plan.rooms.some((r) => areaKind(r) !== "outdoor" && pointInPolygon(p, r.polygon));
  });
}

/** Windows on each room's outside walls: more and bigger facing south, fewer facing north. */
export function addWindows(plan: FloorPlan, level: Pick<Level, "kind">): { plan: FloorPlan; added: number } {
  let p = plan;
  let added = 0;
  for (const room of plan.rooms) {
    const type = room.type ?? "other";
    if (areaKind(room) !== "living" || NO_WINDOWS.has(type)) continue;
    if (p.openings.some((o) => o.kind === "window" && "roomId" in o.host && o.host.roomId === room.id)) continue;
    const mine = outsideStretches(plan, room)
      .map((w) => ({ w, n: leftNormal(unit(sub(w.b, w.a))), usable: w.t1 - w.t0 - 2 * END_IN }))
      // Not where another room is just a few inches away.
      .filter((x) => x.usable >= 24 && !roomJustOutside(plan, x.w))
      .map((x) => ({ ...x, facing: dot(x.n, SOUTH) }))
      // Sunniest first, then east and west, north last; longer walls first.
      .sort((a, b) => b.facing - a.facing || b.usable - a.usable);
    if (!mine.length) continue;

    const plans: { piece: (typeof mine)[number]; count: number; place: Placement }[] = [];
    const bedroom = BEDROOMS.has(type);
    if (level.kind === "basement") {
      // Below ground: an egress window for bedrooms, a high window elsewhere.
      plans.push({ piece: mine[0], count: 1, place: bedroom ? { style: "window", widthIn: 36 } : { style: "window-high", widthIn: 48 } });
    } else if (BATHS.has(type)) {
      const longest = [...mine].sort((a, b) => b.usable - a.usable)[0];
      plans.push({ piece: longest, count: 1, place: { style: "window-high", widthIn: type === "half-bath" ? 24 : 36 } });
    } else if (ONE_SMALL.has(type)) {
      plans.push({ piece: mine[0], count: 1, place: { style: "window", widthIn: 30 } });
    } else if (bedroom) {
      const most = type === "primary-bedroom" ? 3 : 2;
      for (const piece of mine.slice(0, most)) plans.push({ piece, count: 1, place: { style: "window", widthIn: type === "primary-bedroom" ? 48 : 36 } });
    } else {
      let total = 0;
      let picture = SUNNY.has(type) && type !== "kitchen";
      for (const piece of mine) {
        const south = piece.facing > 0.6;
        const north = piece.facing < -0.6;
        let count = south ? Math.max(1, Math.floor(piece.usable / 108)) : north ? (piece.usable >= 192 ? 2 : piece.usable >= 48 ? 1 : 0) : Math.min(2, Math.max(piece.usable >= 48 ? 1 : 0, Math.floor(piece.usable / 120)));
        if (type === "kitchen") count = Math.min(count, 2 - total);
        count = Math.min(count, 5 - total);
        if (count <= 0) continue;
        if (south && picture && piece.usable >= 96) {
          plans.push({ piece, count: 1, place: { style: "window-picture", widthIn: Math.min(96, Math.floor((piece.usable - 12) / 12) * 12) } });
          picture = false;
          total += 1;
          continue;
        }
        const room_ = piece.usable / count - 24;
        const widthIn = south ? Math.min(72, Math.max(36, Math.floor(room_ / 12) * 12)) : north ? 36 : room_ >= 48 ? 48 : 36;
        plans.push({ piece, count, place: { style: "window", widthIn } });
        total += count;
      }
    }

    for (const { piece, count, place } of plans) {
      const { w } = piece;
      const slot = (w.t1 - w.t0) / count;
      for (let k = 0; k < count; k++) {
        const t0 = w.t0 + k * slot + (k === 0 ? END_IN : 6);
        const t1 = w.t0 + (k + 1) * slot - (k === count - 1 ? END_IN : 6);
        const widthIn = Math.min(place.widthIn, Math.floor((t1 - t0 - 4) / 6) * 6);
        if (widthIn < 24) continue;
        const at = freeSpot(p, w.host, t0, t1, widthIn, 12);
        if (at === null) continue;
        p = { ...p, openings: [...p.openings, newOpening(place.style, w.host, at, 1, widthIn)] };
        added++;
      }
    }
  }
  return { plan: p, added };
}

// ---------- All together ----------

/** The outlines of the stairs on a level: going up from it, and coming up from below. */
export function stairsFootprints(plans: Plans, ctx: Pick<PlanContext, "levels" | "basics">, level: Level): Point[][] {
  const below = levelBelow(ctx.levels, level);
  const list = [
    ...(plans[level.id]?.stairs ?? []).map((s) => ({ s, from: level })),
    ...(below ? (plans[below.id]?.stairs ?? []).filter((s) => s.toLevelId === level.id).map((s) => ({ s, from: below })) : []),
  ];
  return list.map(({ s, from }) => {
    const to = ctx.levels.find((l) => l.id === s.toLevelId);
    return stairsDrawing(s, to ? riseBetween(ctx.basics, from, to) : 121).footprint;
  });
}

/** The stairs' footprints on a level, as boxes. */
export function stairsBoxes(plans: Plans, ctx: Pick<PlanContext, "levels" | "basics">, level: Level): Bounds[] {
  return stairsFootprints(plans, ctx, level).map((f) => boundsOf(f)!);
}

export type SuggestResult = { plans: Plans; notes: string[] };

export function suggestPlans(diagrams: Record<string, BubbleDiagram>, ctx: PlanContext): SuggestResult {
  const base = plansFromSketch(diagrams, ctx);
  const exteriorIn = exteriorWallIn(ctx.basics);
  const plans: Plans = {};
  let halls = 0;
  let stairHalls = 0;
  let closets = 0;
  let windows = 0;
  const stuck: string[] = [];
  for (const level of ctx.levels) {
    let plan = base.plans[level.id] ?? emptyPlan();
    if (plan.rooms.length) {
      const obstacles = stairsBoxes(base.plans, ctx, level);
      const sh = addStairHalls(plan, obstacles);
      stairHalls += sh.added;
      const h = addHallways(sh.plan, obstacles);
      halls += h.added;
      plan = connectAll(h.plan, obstacles, ctx.brief?.openKitchen ?? false);
      const c = addClosets(plan, exteriorIn, ctx.brief);
      closets += c.added;
      const w = addWindows(c.plan, level);
      windows += w.added;
      plan = w.plan;
      const links = roomLinks(plan);
      for (const r of roomsNeedingHall(plan)) {
        const through = [...(links.get(r.id) ?? [])]
          .map((id) => plan.rooms.find((x) => x.id === id))
          .filter((x) => x && x.type !== "closet")
          .map((x) => x!.name);
        stuck.push(through.length ? `${r.name} opens only through ${through.join(" or ")}` : `${r.name} has no door yet`);
      }
    }
    plans[level.id] = plan;
  }
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const notes = [
    `Added ${count(halls + stairHalls, "hallway", "hallways")}${stairHalls ? ` (${stairHalls === 1 ? "one" : stairHalls} around the stairs)` : ""}, ${count(closets, "closet", "closets")} and ${count(windows, "window", "windows")}, with doors so every room can be reached.`,
  ];
  if (stuck.length) notes.push(`${stuck.join("; ")}. Push rooms around, or draw a hallway with the Room tool, if you'd rather they had their own way in.`);
  return { plans, notes };
}

