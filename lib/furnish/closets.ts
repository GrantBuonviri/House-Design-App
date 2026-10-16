import type { Fixture, FloorPlan, Opening, PlanRoom, PlanWall, Point } from "@/lib/model/schema";
import { add, angleOf, dist, dot, edgesOf, leftNormal, pointInPolygon, polygonArea, project, rectangle, round1, roundPoint, scale, sub, unit } from "@/lib/plan/geometry";
import { openingGeometries, roomEdgeAt } from "@/lib/plan/walls";
import { newOpening, openingRooms, roomLinks } from "@/lib/plan/connect";
import { newPlanId } from "@/lib/plan/edit";
import { INTERIOR_WALL_IN } from "@/lib/plan/basics";
import { splitRoom } from "@/lib/plan/partitions";
import { combineRooms } from "@/lib/plan/openWalls";
import { BEDROOMS } from "@/lib/plan/closets";
import { overlaps } from "@/lib/plan/furniture";
import { isCurved } from "@/lib/plan/arcs";
import { layerItems, roomAt, type LayerItem } from "./layer";

/**
 * Closet pieces: a whole closet in one step. Against a wall of a room it
 * adds partition walls on the open sides (ordinary floor plan walls), a
 * door, and the rod and shelf. A walk-in becomes its own closet room
 * (through `splitRoom`, like the closets Suggest a plan makes); a reach-in
 * stays part of the room. The walls, door and rod share an id stem
 * ("cl-xxxx"), so when the rod is deleted in Furnish, Things to check can
 * point at the walls left behind.
 */

export type ClosetType = "reach-in" | "walk-in";

/** Rooms that get a closet from Furnish for me (the same ones Suggest a plan gives one). */
export const BEDROOMS_FOR_CLOSETS = [...BEDROOMS];

export type ClosetSize = { widthIn: number; depthIn: number };

/** Default sizes, and what each kind can be typed to. */
export const CLOSET_SIZES: Record<ClosetType, ClosetSize & { min: ClosetSize; max: ClosetSize }> = {
  "reach-in": { widthIn: 72, depthIn: 26, min: { widthIn: 36, depthIn: 22 }, max: { widthIn: 144, depthIn: 36 } },
  "walk-in": { widthIn: 72, depthIn: 72, min: { widthIn: 48, depthIn: 48 }, max: { widthIn: 192, depthIn: 144 } },
};

export function clampClosetSize(type: ClosetType, size: Partial<ClosetSize>): ClosetSize {
  const s = CLOSET_SIZES[type];
  const c = (v: number | undefined, lo: number, hi: number, d: number) => Math.min(hi, Math.max(lo, Math.round(v ?? d)));
  return { widthIn: c(size.widthIn, s.min.widthIn, s.max.widthIn, s.widthIn), depthIn: c(size.depthIn, s.min.depthIn, s.max.depthIn, s.depthIn) };
}

/** Where a closet would go: its back along one straight wall of a room, reaching `depthIn` into it. */
export type ClosetSpot = {
  type: ClosetType;
  roomId: string;
  /** The back corners on the room's wall, and the front corners. */
  back: [Point, Point];
  front: [Point, Point];
  /** Into the room, square to the back wall. */
  n: Point;
  widthIn: number;
  depthIn: number;
  /** Side walls needed at each end (none where the closet is in a corner). */
  sides: [boolean, boolean];
  /** Middle and turn, for drawing it like any item (its front faces the room). */
  x: number;
  y: number;
  rotation: number;
  ok: boolean;
  problem?: string;
};

/** How close to a corner (inches) the closet's end snaps into it. */
const CORNER_SNAP_IN = 18;
/** Space left in front of a closet to walk and open its door. */
const FRONT_CLEAR_IN = 30;

/** The way into the room from a straight edge. */
function inward(room: PlanRoom, a: Point, b: Point): Point {
  const u = unit(sub(b, a));
  const n = leftNormal(u);
  const mid = scale(add(a, b), 0.5);
  return pointInPolygon(add(mid, scale(n, 2)), room.polygon) ? n : scale(n, -1);
}

/**
 * A closet against edge `edge` of a room, with its middle `t` inches along
 * the edge. Its ends snap into the corners when close, and it says whether
 * it fits: inside the room, clear of doors, windows and what's placed, and
 * with room to walk in front.
 */
export function closetOnEdge(plan: FloorPlan, room: PlanRoom, edge: number, t: number, type: ClosetType, size: ClosetSize, items: LayerItem[] = layerItems(plan)): ClosetSpot {
  const poly = room.polygon;
  const k = poly.length;
  const a = poly[edge];
  const b = poly[(edge + 1) % k];
  const L = dist(a, b);
  const u = unit(sub(b, a));
  const n = inward(room, a, b);
  const W = Math.min(size.widthIn, L);
  const D = size.depthIn;
  let mid = Math.min(L - W / 2, Math.max(W / 2, t));
  if (mid - W / 2 < CORNER_SNAP_IN) mid = W / 2;
  else if (L - mid - W / 2 < CORNER_SNAP_IN) mid = L - W / 2;
  const s0 = mid - W / 2;
  const s1 = mid + W / 2;
  const back: [Point, Point] = [roundPoint(add(a, scale(u, s0))), roundPoint(add(a, scale(u, s1)))];
  const front: [Point, Point] = [roundPoint(add(back[0], scale(n, D))), roundPoint(add(back[1], scale(n, D)))];
  // In a corner, the wall meeting this one runs along the closet's side: no side wall needed there.
  const along = (from: Point, to: Point) => dot(unit(sub(to, from)), n) > 0.98;
  const sides: [boolean, boolean] = [!(s0 < 0.5 && along(a, poly[(edge + k - 1) % k])), !(s1 > L - 0.5 && along(b, poly[(edge + 2) % k]))];
  const center = add(scale(add(back[0], back[1]), 0.5), scale(n, D / 2));
  const spot: ClosetSpot = { type, roomId: room.id, back, front, n, widthIn: round1(W), depthIn: D, sides, x: round1(center.x), y: round1(center.y), rotation: Math.round(angleOf(n) - 90), ok: true };
  const fail = (problem: string): ClosetSpot => ({ ...spot, ok: false, problem });

  if (isCurved(room.bulges?.[edge])) return fail("A closet goes against a straight wall.");
  if (L < CLOSET_SIZES[type].min.widthIn) return fail("That wall is too short for a closet.");
  const outline = [back[0], back[1], front[1], front[0]];
  const inset = rectangle(center.x, center.y, W - 2, D - 2, spot.rotation);
  if (!inset.every((p) => pointInPolygon(p, poly))) return fail(`It doesn't fit inside the ${room.name.toLowerCase()}.`);
  const ahead = add(scale(add(front[0], front[1]), 0.5), scale(n, FRONT_CLEAR_IN));
  if (!pointInPolygon(ahead, poly)) return fail(`It leaves no room to walk in front of it in the ${room.name.toLowerCase()}.`);
  if (type === "walk-in" && polygonArea(outline) > polygonArea(poly) * 0.6) return fail(`It would take up most of the ${room.name.toLowerCase()}.`);
  for (const og of openingGeometries(plan)) {
    const box = rectangle(og.center.x, og.center.y, og.opening.widthIn, 16, angleOf(og.u));
    if (overlaps(outline, box)) return fail(og.opening.kind === "window" ? "It's across a window." : "It's across a doorway.");
  }
  for (const o of items) {
    if (o.mount !== "floor" || o.kind === "device" || (o.roomId && o.roomId !== room.id)) continue;
    if (overlaps(inset, rectangle(o.x, o.y, o.widthIn, o.depthIn, o.rotation))) return fail(`It's on top of the ${o.label.toLowerCase()}.`);
  }
  return spot;
}

/** The closet with the mouse at `cursor`: backed onto the nearest straight wall of the room it's in. */
export function closetSpotAt(plan: FloorPlan, type: ClosetType, cursor: Point, size: ClosetSize, items?: LayerItem[]): ClosetSpot | null {
  const room = roomAt(plan, cursor);
  if (!room) return null;
  let best: { i: number; t: number; d: number } | null = null;
  for (const e of edgesOf(room.polygon)) {
    const pr = project(cursor, e.a, e.b);
    if (!best || pr.d < best.d) best = { i: e.i, t: pr.t, d: pr.d };
  }
  if (!best || best.d > size.depthIn + 48) return null;
  return closetOnEdge(plan, room, best.i, best.t, type, size, items);
}

/** Ids of the walls and door a closet piece adds, from its stem. */
const stemOf = (id: string) => /^(cl-[a-z0-9]+)-(rod|door|w\d)$/.exec(id)?.[1] ?? null;

/** The rod and shelf of a closet piece (deleting it leaves the walls). */
export const isClosetRod = (id: string) => stemOf(id) !== null && id.endsWith("-rod");

/**
 * Put a closet in: walls on the open sides, a door, and the rod and shelf,
 * as one change. A walk-in is split off into a closet room when the walls
 * close it in. Returns the rod's id (what's selected afterwards).
 */
export function placeCloset(plan: FloorPlan, spot: ClosetSpot): { plan: FloorPlan; id: string | null; roomId?: string } {
  if (!spot.ok) return { plan, id: null };
  const stem = newPlanId("cl");
  const { back, front, n, sides } = spot;
  const walkIn = spot.type === "walk-in";
  let p = plan;
  let rodRoom = spot.roomId;
  let closetRoom: string | undefined;

  // The line of new walls, from the back wall round the front to the back wall again.
  const path = [...(sides[0] ? [back[0]] : []), front[0], front[1], ...(sides[1] ? [back[1]] : [])];
  const split = walkIn ? splitRoom(p, path) : null;
  const madeIsCloset = split && pointInPolygon(add(scale(add(back[0], back[1]), 0.5), scale(n, 2)), split.plan.rooms.find((r) => r.id === split.newRoomId)!.polygon);
  if (split && madeIsCloset) {
    p = { ...split.plan, rooms: split.plan.rooms.map((r) => (r.id === split.newRoomId ? { ...r, name: closetName(split.plan), type: "closet" } : r)) };
    closetRoom = split.newRoomId;
    rodRoom = split.newRoomId;
    const room = p.rooms.find((r) => r.id === split.newRoomId)!;
    const fm = scale(add(front[0], front[1]), 0.5);
    const edge = roomEdgeAt(room.polygon, fm, 2);
    if (edge !== null) {
      const width = Math.min(30, Math.floor(spot.widthIn - 12));
      // The left of a room's edge is outside it: the door swings out into the bedroom.
      const door: Opening = { ...newOpening("door-hinged", { roomId: room.id, edge }, dist(room.polygon[edge], fm), 1, width), id: `${stem}-door` };
      p = { ...p, openings: [...p.openings, door] };
    }
  } else {
    const segs: [Point, Point][] = [...(sides[0] ? [[back[0], front[0]] as [Point, Point]] : []), [front[0], front[1]], ...(sides[1] ? [[back[1], front[1]] as [Point, Point]] : [])];
    const walls: PlanWall[] = segs.map(([a, b], i) => ({ id: `${stem}-w${i}`, a, b, thicknessIn: INTERIOR_WALL_IN }));
    const frontWall = walls[sides[0] ? 1 : 0];
    const u = unit(sub(front[1], front[0]));
    // Doors swing (or fold) toward the room, away from the closet.
    const side: 1 | -1 = dot(leftNormal(u), n) > 0 ? 1 : -1;
    const style = walkIn ? "door-hinged" : "door-bifold";
    const width = walkIn ? Math.min(30, Math.floor(spot.widthIn - 12)) : bifoldWidth(spot.widthIn);
    const door: Opening = { ...newOpening(style, { wallId: frontWall.id }, spot.widthIn / 2, side, width), id: `${stem}-door` };
    p = { ...p, walls: [...p.walls, ...walls], openings: [...p.openings, door] };
  }

  const shelf = walkIn ? 24 : 20;
  const at = add(scale(add(back[0], back[1]), 0.5), scale(n, 3 + shelf / 2));
  const rod: Fixture = { id: `${stem}-rod`, kind: "closet", x: round1(at.x), y: round1(at.y), rotation: spot.rotation, widthIn: Math.max(24, Math.round(spot.widthIn - 10)), depthIn: shelf, roomId: rodRoom };
  p = { ...p, fixtures: [...p.fixtures, rod] };
  return { plan: p, id: rod.id, ...(closetRoom ? { roomId: closetRoom } : {}) };
}

/** The widest bifold door that leaves a few inches of wall at each end. */
function bifoldWidth(front: number): number {
  return [72, 60, 48, 36, 30, 24].find((w) => w <= front - 8) ?? 24;
}

function closetName(plan: FloorPlan): string {
  const used = new Set(plan.rooms.map((r) => r.name));
  if (!used.has("Walk-in closet")) return "Walk-in closet";
  let k = 2;
  while (used.has(`Walk-in closet ${k}`)) k++;
  return `Walk-in closet ${k}`;
}

/** Does a room have a closet: a rod and shelf in it, or a closet room next to it with a door? */
export function hasCloset(plan: FloorPlan, roomId: string): boolean {
  if (plan.fixtures.some((f) => f.kind === "closet" && f.roomId === roomId)) return true;
  return [...(roomLinks(plan).get(roomId) ?? [])].some((id) => plan.rooms.find((r) => r.id === id)?.type === "closet");
}

export type LeftoverCloset = {
  stem: string;
  wallIds: string[];
  doorIds: string[];
  /** The closet room a walk-in made, if any, and the room its door opens into. */
  roomId?: string;
  besideId?: string;
  at: Point;
};

/** Closet pieces whose rod and shelf were deleted: the walls and door they left behind. */
export function leftoverClosets(plan: FloorPlan): LeftoverCloset[] {
  const rods = new Set(plan.fixtures.map((f) => stemOf(f.id)).filter(Boolean));
  const out = new Map<string, LeftoverCloset>();
  const entry = (stem: string, at: Point) => {
    if (!out.has(stem)) out.set(stem, { stem, wallIds: [], doorIds: [], at });
    return out.get(stem)!;
  };
  for (const w of plan.walls) {
    const s = stemOf(w.id);
    if (s && !rods.has(s)) entry(s, scale(add(w.a, w.b), 0.5)).wallIds.push(w.id);
  }
  for (const o of plan.openings) {
    const s = stemOf(o.id);
    if (!s || rods.has(s)) continue;
    const e = entry(s, { x: 0, y: 0 });
    e.doorIds.push(o.id);
    if ("roomId" in o.host) {
      const room = plan.rooms.find((r) => r.id === (o.host as { roomId: string }).roomId);
      if (room?.type === "closet") {
        e.roomId = room.id;
        e.besideId = openingRooms(plan, o).find((id) => id && id !== room.id) ?? undefined;
        if (!e.wallIds.length) e.at = room.polygon.reduce((s2, q) => add(s2, scale(q, 1 / room.polygon.length)), { x: 0, y: 0 });
      }
    }
  }
  return [...out.values()];
}

/**
 * "Remove the closet walls" (on the floor plan, where walls can be removed):
 * the walls and door a deleted closet piece left, and a walk-in's closet
 * room joined back into the room beside it.
 */
export function removeLeftoverCloset(plan: FloorPlan, lc: LeftoverCloset): FloorPlan {
  const walls = new Set(lc.wallIds);
  const doors = new Set(lc.doorIds);
  let p: FloorPlan = {
    ...plan,
    walls: plan.walls.filter((w) => !walls.has(w.id)),
    openings: plan.openings.filter((o) => !doors.has(o.id) && !("wallId" in o.host && walls.has(o.host.wallId))),
  };
  if (lc.roomId && lc.besideId) p = combineRooms(p, [lc.besideId, lc.roomId])?.plan ?? p;
  return p;
}
