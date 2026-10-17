import type { FloorPlan, PlanRoom, Point } from "@/lib/model/schema";
import { worstOverrun, type SetbackLimit } from "./setbacks";
import { isCirculation, neighbors, openingRooms, roleOf, sharedWall } from "./connect";
import { keepOpeningsInPlace, makeRoom, moveMany } from "./edit";
import { roomHasCurves } from "./arcs";
import { overhangsOf } from "./support";
import type { Region } from "@/lib/house3d/footprint";
import { closeHallGaps, setHall } from "./anchor";
import { add, boundsOf, collinearOverlap, edgesOf, isRectangle, polygonsOverlap, round1, roundPoint, type Bounds } from "./geometry";

/** Suggest a plan: hallways where private rooms would only open off other rooms, and stair halls. */

/** A hallway is 3' 6" from wall middle to wall middle, about 3' 2" clear. */
export const HALL_IN = 42;
export const DOOR_ROOM_IN = 36;
const BRIDGE_MAX_IN = 72;

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

/** A stack's stair hall outline (its `hallLimit`) for one set of stairs, when the stairs belong to a stack. */
export type StairFit = { outline: Point[]; stackId: string; floor: Point[] | null };

/**
 * Stairs standing outside every room get a stair hall exactly as big as the
 * stairs allow: the stairs plus 3' of standing room past each end (the
 * stack's `hallLimit` when `fits` gives one). It never reaches toward
 * neighbors: rooms a few inches off close the gap, and where none touches it
 * the hallways step finds a way in. Skipped when it would run into a room.
 */
export function addStairHalls(plan: FloorPlan, boxes: Bounds[], fits: (StairFit | null | undefined)[] = []): { plan: FloorPlan; added: number } {
  let p = plan;
  let added = 0;
  boxes.forEach((b, i) => {
    const fit = fits[i];
    if (fit && p.rooms.some((r) => r.stairStack === fit.stackId)) return;
    if (p.rooms.some((r) => polygonsOverlap(boxCorners(b), r.polygon))) return;
    let outline = fit?.outline;
    if (!outline) {
      const long = b.x1 - b.x0 >= b.y1 - b.y0 ? "x" : "y";
      outline = boxCorners(long === "x" ? { ...b, x0: round1(b.x0 - LANDING_IN), x1: round1(b.x1 + LANDING_IN) } : { ...b, y0: round1(b.y0 - LANDING_IN), y1: round1(b.y1 + LANDING_IN) });
    }
    // Rooms in the way of a stack's hall are trimmed back around it (the same as Anchor does).
    if (fit && p.rooms.some((r) => polygonsOverlap(outline!, r.polygon))) {
      const set = setHall(p, fit.stackId, outline, true, fit.floor ?? outline);
      const next = closeHallGaps(set.plan, set.plan.rooms.find((r) => r.stairStack === fit.stackId)!.id);
      const made = next.rooms.find((r) => r.stairStack === fit.stackId)!;
      if (!neighbors(next, made, DOOR_ROOM_IN).length) return;
      p = next;
      added++;
      return;
    }
    if (p.rooms.some((r) => polygonsOverlap(outline!, r.polygon))) return;
    const base = makeRoom(outline, "Stair hall", { type: "hall" });
    // The hall stays put while neighbors close up to it (an anchored room is never the one that moves).
    const hall = { ...base, anchored: true, stairStack: fit?.stackId ?? "loose" };
    let next = closeHallGaps({ ...p, rooms: [...p.rooms, hall] }, hall.id);
    if (!fit) next = { ...next, rooms: next.rooms.map((r) => (r.id === hall.id ? { ...r, anchored: undefined, stairStack: undefined } : r)) };
    if (!neighbors(next, hall, DOOR_ROOM_IN).length) return;
    p = next;
    added++;
  });
  return { plan: p, added };
}

/**
 * A stair hall is only as big as its stairs, so a room a few feet away has no
 * wall on it. Where a room that still needs a way in faces an anchored stair
 * hall across a gap of up to 6', a short ordinary hallway joins them (kept
 * over the floor below when there is one).
 */
export function bridgeStairHalls(plan: FloorPlan, regions: Region[] = []): { plan: FloorPlan; added: number } {
  let p = plan;
  let added = 0;
  for (const need of roomsNeedingHall(plan)) {
    const nb = boundsOf(need.polygon)!;
    for (const hall of p.rooms.filter((r) => r.stairStack)) {
      const hb = boundsOf(hall.polygon)!;
      const tries: Bounds[] = [];
      for (const axis of ["x", "y"] as const) {
        const [lo, hi] = axis === "x" ? (["x0", "x1"] as const) : (["y0", "y1"] as const);
        const [plo, phi] = axis === "x" ? (["y0", "y1"] as const) : (["x0", "x1"] as const);
        const a0 = Math.max(hb[plo], nb[plo]);
        const a1 = Math.min(hb[phi], nb[phi]);
        for (const [from, to] of [[hb[hi], nb[lo]], [nb[hi], hb[lo]]]) {
          if (to - from < 1 || to - from > BRIDGE_MAX_IN || a1 - a0 < HALL_IN) continue;
          for (let at = a0; at + HALL_IN <= a1 + 0.5; at += 6) {
            const rect = axis === "x" ? { x0: from, x1: to, y0: at, y1: at + HALL_IN } : { x0: at, x1: at + HALL_IN, y0: from, y1: to };
            tries.push(rect);
          }
        }
      }
      for (const rect of tries) {
        const room = makeRoom(boxCorners(rect), "Hall", { type: "hall" });
        if (p.rooms.some((r) => polygonsOverlap(room.polygon, r.polygon))) continue;
        if (regions.length && overhangsOf([room], regions).length) continue;
        p = { ...p, rooms: [...p.rooms, { ...room, name: p.rooms.some((r) => r.type === "hall" && r.name === "Hall") ? `Hall ${p.rooms.filter((r) => r.type === "hall").length + 1}` : "Hall" }] };
        added++;
        break;
      }
      if (!roomsNeedingHall(p).some((r) => r.id === need.id)) break;
    }
  }
  return { plan: p, added };
}

/** Add hallways, one at a time, until every bedroom and bathroom opens onto one (or no cut helps). */
export function addHallways(plan: FloorPlan, stairObstacles: Bounds[] = [], max = 3, limits: SetbackLimit[] = []): { plan: FloorPlan; added: number } {
  let added = 0;
  for (let k = 0; k < max; k++) {
    // An anchored stair hall never slides or stretches, so a hallway cut can't pass through or push it: it stays with the stairs.
    const obstacles = [...stairObstacles, ...plan.rooms.filter((r) => r.stairStack && r.anchored).map((r) => boundsOf(r.polygon)!)];
    const needy = new Set(roomsNeedingHall(plan).map((r) => r.id));
    if (!needy.size) break;
    const name = plan.rooms.some((r) => r.type === "hall") ? `Hall ${plan.rooms.filter((r) => r.type === "hall").length + 1}` : "Hall";
    const found: CutResult[] = [];
    for (const axis of ["x", "y"] as const) {
      const lines = [...new Set(plan.rooms.flatMap((r) => r.polygon.map((p) => round1(axis === "x" ? p.x : p.y))))];
      for (const c of lines) {
        for (const dir of [1, -1] as const) {
          const res = tryCut(plan, { axis, c, dir }, needy, obstacles, name);
          if (res) found.push(res);
        }
      }
    }
    found.sort((a, b) => b.score - a.score);
    // A cut that pushes rooms past a setback is skipped. If every cut does, the best one stays and Things to check says so.
    const already = worstOverrun(plan, limits);
    const best = found.find((res) => worstOverrun(res.plan, limits) <= already + 0.5) ?? found[0] ?? null;
    if (!best) break;
    plan = best.plan;
    added++;
  }
  return { plan, added };
}
