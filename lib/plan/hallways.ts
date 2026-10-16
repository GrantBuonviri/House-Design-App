import type { FloorPlan, PlanRoom, Point } from "@/lib/model/schema";
import { isCirculation, neighbors, openingRooms, roleOf, sharedWall } from "./connect";
import { keepOpeningsInPlace, makeRoom, moveMany } from "./edit";
import { roomHasCurves } from "./arcs";
import { add, boundsOf, collinearOverlap, edgesOf, isRectangle, polygonsOverlap, round1, roundPoint, type Bounds } from "./geometry";

/** Suggest a plan: hallways where private rooms would only open off other rooms, and stair halls. */

/** A hallway is 3' 6" from wall middle to wall middle, about 3' 2" clear. */
export const HALL_IN = 42;
export const DOOR_ROOM_IN = 36;

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

export const boxCorners = (b: Bounds): Point[] => [
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
  // Hallway cuts stay off curved walls.
  if (straddle.some((r) => !isAxisRect(r.polygon) || roomHasCurves(r))) return null;

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
