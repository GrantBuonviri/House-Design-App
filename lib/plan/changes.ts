import type { FloorPlan, Level, Opening, PlanRoom, Point } from "@/lib/model/schema";
import { roomType } from "@/lib/brief/rooms";
import { exteriorWallIn, levelAbove } from "./basics";
import { hangingArea } from "./support";
import { OUTSIDE, addDoor, freeSpot, newOpening, openingRooms, reachable, roomLinks, sharedWall } from "./connect";
import { keepOpeningsInPlace, planOf, type Plans } from "./edit";
import { outsideDoor, type PlanContext } from "./fromSketch";
import { add, boundsOf, collinearOverlap, dist, dot, edgesOf, leftNormal, pointInPolygon, polygonArea, polygonsOverlap, round1, roundPoint, scale, signedArea, sub, unit } from "./geometry";
import { areaKind, roomSqft } from "./measure";
import { outsideStretches, roomJustOutside, stairsBoxes, wayInRooms } from "./suggest";
import { openingGeometry } from "./walls";

/**
 * Small changes to a floor plan, as the built-in alternatives describe
 * them: push a wall, swap two rooms, add or take away a door, open
 * up a wall, add a window, flip the house. Code applies each one and checks
 * the result (no rooms on top of each other, every room still reachable,
 * sensible sizes, and no more of an upper floor hanging past the floor below);
 * a change that fails a check is skipped.
 */

export const CHANGE_OPS = ["grow", "shrink", "swap", "door", "no_door", "open_up", "window", "mirror"] as const;
export type ChangeOp = (typeof CHANGE_OPS)[number];
export const CHANGE_SIDES = ["N", "E", "S", "W", "none"] as const;
export type ChangeSide = (typeof CHANGE_SIDES)[number];

/**
 * One change. Every field is always there: `other` is "" and `side` is
 * "none" and `feet` is 0 when unused.
 */
export type PlanChange = {
  op: ChangeOp;
  /** A room id. Room ids are unique across floors, so this also says which floor. */
  room: string;
  /** swap, door, no_door, open_up: the other room's id, or "outside" for a door to the outside. */
  other: string;
  /** grow, shrink, window, and a door to the outside: which side of the room. */
  side: ChangeSide;
  /** grow, shrink: how far the wall moves. window: how wide. */
  feet: number;
};

const DIR: Record<Exclude<ChangeSide, "none">, Point> = { N: { x: 0, y: -1 }, E: { x: 1, y: 0 }, S: { x: 0, y: 1 }, W: { x: -1, y: 0 } };
/** A room this many inches deep (at least) after a wall is pushed into it. */
const MIN_DEPTH_IN = 36;
const MIN_HALL_DEPTH_IN = 40;

export function levelOfRoom(plans: Plans, roomId: string): string | null {
  for (const [id, p] of Object.entries(plans)) if (p.rooms.some((r) => r.id === roomId)) return id;
  return null;
}

/** The room's longest edge that faces a side (its outward direction within about 45°). */
export function edgeFacing(room: PlanRoom, side: Exclude<ChangeSide, "none">): number | null {
  let best: { i: number; length: number } | null = null;
  for (const e of edgesOf(room.polygon)) {
    const n = leftNormal(unit(sub(e.b, e.a)));
    const length = dist(e.a, e.b);
    if (dot(n, DIR[side]) > 0.7 && length >= 12 && (!best || length > best.length)) best = { i: e.i, length };
  }
  return best?.i ?? null;
}

// ---------- Pushing a wall ----------

/**
 * Push one edge of a room by `d` (along its outward normal, or back), taking
 * the room on the other side with it. A neighbor whose wall runs past the
 * stretch that moves gets a notch, so nothing else shifts. Null when a
 * neighbor would be left too shallow.
 */
export function pushWall(plan: FloorPlan, roomId: string, edge: number, d: Point): FloorPlan | null {
  const room = plan.rooms.find((r) => r.id === roomId);
  if (!room) return null;
  const a = room.polygon[edge];
  const b = room.polygon[(edge + 1) % room.polygon.length];
  const u = unit(sub(b, a));
  let next = plan;
  // Split neighbors' walls where the moving stretch starts and ends.
  const L = dist(a, b);
  for (const other of plan.rooms) {
    if (other.id === roomId) continue;
    for (let guard = 0; guard < 4; guard++) {
      const cur = next.rooms.find((r) => r.id === other.id)!;
      const split = edgesOf(cur.polygon)
        .map((e) => {
          if (!collinearOverlap(a, b, e.a, e.b, 1)) return null;
          const te = (p: Point) => dot(sub(p, a), u);
          const lo = Math.min(te(e.a), te(e.b));
          const hi = Math.max(te(e.a), te(e.b));
          const cut = [0, L].find((t) => t > lo + 1 && t < hi - 1);
          return cut === undefined ? null : { edge: e.i, p: add(a, scale(u, cut)) };
        })
        .find(Boolean);
      if (!split) break;
      const res = splitEdge(next, other.id, split.edge, split.p);
      if (!res) return null;
      next = res;
    }
  }
  const pushed = next.rooms.find((r) => r.id === roomId)!;
  const pa = pushed.polygon[edge];
  const pb = pushed.polygon[(edge + 1) % pushed.polygon.length];
  const moved = {
    ...next,
    rooms: next.rooms.map((r) => {
      const idx = new Set<number>();
      for (const e of edgesOf(r.polygon)) {
        const mine = r.id === roomId && e.i === edge;
        if (mine || (r.id !== roomId && collinearOverlap(pa, pb, e.a, e.b, 1))) {
          idx.add(e.i);
          idx.add((e.i + 1) % r.polygon.length);
        }
      }
      return idx.size ? { ...r, polygon: r.polygon.map((p, i) => (idx.has(i) ? roundPoint(add(p, d)) : p)) } : r;
    }),
  };
  // Neighbors that gave up space keep enough depth behind the new wall.
  const n = unit(d);
  const wall = add(pa, d);
  for (const r of moved.rooms) {
    if (r.id === roomId) continue;
    const before = next.rooms.find((x) => x.id === r.id)!;
    if (before.polygon === r.polygon || polygonArea(r.polygon) >= polygonArea(before.polygon) - 1) continue;
    const depth = Math.max(...r.polygon.map((p) => dot(sub(p, wall), n)));
    if (depth < (r.type === "hall" ? MIN_HALL_DEPTH_IN : MIN_DEPTH_IN)) return null;
  }
  return keepOpeningsInPlace(next, moved);
}

/**
 * Two corners at one spot partway along a room's edge, so the stretch on one
 * side can move and leave a step. Doors and windows stay where they are; null
 * when one sits across the spot.
 */
function splitEdge(plan: FloorPlan, roomId: string, edge: number, p: Point): FloorPlan | null {
  const room = plan.rooms.find((r) => r.id === roomId);
  if (!room) return null;
  const at = dist(room.polygon[edge], p);
  let blocked = false;
  const openings = plan.openings.map((o) => {
    if (!("roomId" in o.host) || o.host.roomId !== roomId || o.host.edge < edge) return o;
    if (o.host.edge > edge) return { ...o, host: { roomId, edge: o.host.edge + 2 } };
    if (Math.abs(o.offsetIn - at) < o.widthIn / 2 + 1) blocked = true;
    return o.offsetIn < at ? o : { ...o, host: { roomId, edge: edge + 2 }, offsetIn: round1(o.offsetIn - at) };
  });
  if (blocked) return null;
  const q = roundPoint(p);
  const polygon = [...room.polygon.slice(0, edge + 1), q, { ...q }, ...room.polygon.slice(edge + 1)];
  return { ...plan, rooms: plan.rooms.map((r) => (r.id === roomId ? { ...r, polygon } : r)), openings };
}

// ---------- Mirror ----------

/** Flip every floor east to west (or north to south) about the middle of the house, keeping each door and window on its wall. */
export function mirrorPlans(plans: Plans, axis: "x" | "y"): Plans {
  const bb = boundsOf(Object.values(plans).flatMap((p) => p.rooms.flatMap((r) => r.polygon)));
  if (!bb) return plans;
  const c = axis === "x" ? (bb.x0 + bb.x1) / 2 : (bb.y0 + bb.y1) / 2;
  const flip = (p: Point): Point => roundPoint(axis === "x" ? { x: 2 * c - p.x, y: p.y } : { x: p.x, y: 2 * c - p.y });
  const turn = (deg: number) => {
    const r = axis === "x" ? -deg : 180 - deg;
    return ((r % 360) + 360) % 360;
  };
  const out: Plans = {};
  for (const [id, plan] of Object.entries(plans)) {
    const sizes = new Map(plan.rooms.map((r) => [r.id, r.polygon.length]));
    out[id] = {
      // A mirror image runs the other way round, so corners are reversed to stay clockwise.
      rooms: plan.rooms.map((r) => ({ ...r, polygon: [...r.polygon].reverse().map(flip) })),
      walls: plan.walls.map((w) => ({ ...w, a: flip(w.a), b: flip(w.b) })),
      ...(plan.openWalls ? { openWalls: plan.openWalls.map((w) => ({ a: flip(w.a), b: flip(w.b) })) } : {}),
      openings: plan.openings.map((o): Opening => {
        const host = o.host;
        if (!("roomId" in host)) return { ...o, side: o.side === 1 ? -1 : 1 };
        const n = sizes.get(host.roomId) ?? 0;
        const room = plan.rooms.find((r) => r.id === host.roomId);
        if (!room || !n) return o;
        const i = host.edge;
        const L = dist(room.polygon[i], room.polygon[(i + 1) % n]);
        // Old edge i is new edge n - 2 - i, walked the other way: same side, hinge at the other end.
        return { ...o, host: { roomId: host.roomId, edge: (n - 2 - i + 2 * n) % n }, offsetIn: round1(L - o.offsetIn), hinge: o.hinge === "start" ? "end" : "start" };
      }),
      stairs: plan.stairs.map((s) => ({ ...s, ...flip({ x: s.x, y: s.y }), rotation: turn(s.rotation), flip: !s.flip })),
      fixtures: plan.fixtures.map((f) => ({ ...f, ...flip({ x: f.x, y: f.y }), rotation: turn(f.rotation) })),
      furniture: plan.furniture.map((f) => ({ ...f, ...flip({ x: f.x, y: f.y }), rotation: turn(f.rotation) })),
    };
  }
  return out;
}

/** East to west when the road is north or south (the entry stays on the road and the sunny side stays south). Null when a flip would turn the house away from the road or the sun. */
export function mirrorAxis(ctx: Pick<PlanContext, "plot">): "x" | null {
  return !ctx.plot || ctx.plot.roadSide === "N" || ctx.plot.roadSide === "S" ? "x" : null;
}

// ---------- One change ----------

const linkKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function linkSet(plan: FloorPlan): Set<string> {
  const out = new Set<string>();
  for (const [a, set] of roomLinks(plan)) for (const b of set) out.add(linkKey(a, b));
  return out;
}

function sharedLengths(plan: FloorPlan): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 0; i < plan.rooms.length; i++) {
    for (let j = i + 1; j < plan.rooms.length; j++) {
      const w = sharedWall(plan.rooms[i], plan.rooms[j]);
      if (w && w.t1 - w.t0 >= 24) out.set(linkKey(plan.rooms[i].id, plan.rooms[j].id), w.t1 - w.t0);
    }
  }
  return out;
}

/** Windows that now look into another room, and fixtures and furniture pushed out of their room, are taken away. */
function tidy(plan: FloorPlan): FloorPlan {
  const indoors = new Set(plan.rooms.filter((r) => areaKind(r) !== "outdoor").map((r) => r.id));
  const openings = plan.openings.filter((o) => {
    if (!openingGeometry(plan, o)) return false;
    if (o.kind !== "window") return true;
    const [a, b] = openingRooms(plan, o);
    return !(a && b && indoors.has(a) && indoors.has(b));
  });
  const fixtures = plan.fixtures.filter((f) => {
    if (!f.roomId) return true;
    const r = plan.rooms.find((x) => x.id === f.roomId);
    return !r || pointInPolygon({ x: f.x, y: f.y }, r.polygon);
  });
  const furniture = plan.furniture.filter((f) => {
    if (!f.roomId) return true;
    const r = plan.rooms.find((x) => x.id === f.roomId);
    return !r || pointInPolygon({ x: f.x, y: f.y }, r.polygon);
  });
  return openings.length === plan.openings.length && fixtures.length === plan.fixtures.length && furniture.length === plan.furniture.length
    ? plan
    : { ...plan, openings, fixtures, furniture };
}

/** Rooms keep a sensible size and shape: not folded over, not too narrow, and not far under the smallest size for their type. */
function roomOk(before: PlanRoom | undefined, r: PlanRoom): boolean {
  if (before && before.polygon === r.polygon) return true;
  if (signedArea(r.polygon) <= 0) return false;
  if (edgesOf(r.polygon).some((e) => dist(e.a, e.b) < 1)) return false;
  const bb = boundsOf(r.polygon)!;
  if (Math.min(bb.x1 - bb.x0, bb.y1 - bb.y0) < 30) return false;
  const min = r.type ? roomType(r.type).min : 15;
  return roomSqft(r) >= Math.min(min, before ? roomSqft(before) : min);
}

type Check = { allowDrop?: string[] };

/**
 * Is `after` still a sound plan, compared with `before`? No new overlaps,
 * rooms keep their size and shape, no room loses a door (other than ones
 * named in allowDrop) or the wall it shares with a neighbor, and every room
 * that could be reached still can be.
 */
export function stillSound(before: FloorPlan, after: FloorPlan, seedsBefore: string[], seedsAfter: string[], check: Check = {}): boolean {
  const was = new Map(before.rooms.map((r) => [r.id, r]));
  if (!after.rooms.every((r) => roomOk(was.get(r.id), r))) return false;
  for (let i = 0; i < after.rooms.length; i++) {
    for (let j = i + 1; j < after.rooms.length; j++) {
      const a = after.rooms[i];
      const b = after.rooms[j];
      if (!polygonsOverlap(a.polygon, b.polygon)) continue;
      const a0 = was.get(a.id);
      const b0 = was.get(b.id);
      if (!a0 || !b0 || !polygonsOverlap(a0.polygon, b0.polygon)) return false;
    }
  }
  const linksAfter = linkSet(after);
  const drop = new Set(check.allowDrop ?? []);
  for (const k of linkSet(before)) if (!linksAfter.has(k) && !drop.has(k)) return false;
  const shared = sharedLengths(after);
  for (const [k, length] of sharedLengths(before)) if ((shared.get(k) ?? 0) < Math.min(length, 24) - 0.5) return false;
  const reachBefore = reachable(before, seedsBefore);
  const reachAfter = reachable(after, seedsAfter);
  for (const id of reachBefore) if (!reachAfter.has(id)) return false;
  return true;
}

/** A window on the room's outside wall facing a side. */
function addWindow(plan: FloorPlan, room: PlanRoom, side: Exclude<ChangeSide, "none">, widthIn: number): FloorPlan | null {
  const stretches = outsideStretches(plan, room)
    .filter((w) => dot(leftNormal(unit(sub(w.b, w.a))), DIR[side]) > 0.7 && !roomJustOutside(plan, w))
    .sort((p, q) => q.t1 - q.t0 - (p.t1 - p.t0));
  const big = widthIn >= 72 && ["living", "family", "dining", "sunroom"].includes(room.type ?? "");
  for (const w of stretches) {
    const width = Math.min(widthIn, Math.floor((w.t1 - w.t0 - 36) / 6) * 6);
    if (width < 24) continue;
    const at = freeSpot(plan, w.host, w.t0 + 18, w.t1 - 18, width, 12);
    if (at === null) continue;
    return { ...plan, openings: [...plan.openings, newOpening(big ? "window-picture" : "window", w.host, at, 1, width)] };
  }
  return null;
}

/** Doors and openings between two rooms. */
function openingsBetween(plan: FloorPlan, a: string, b: string): Opening[] {
  return plan.openings.filter((o) => {
    if (o.kind === "window") return false;
    const [x, y] = openingRooms(plan, o);
    return b === OUTSIDE ? (x === a && !y) || (y === a && !x) : (x === a && y === b) || (x === b && y === a);
  });
}

const OPEN_UP_MAX_IN = 144;

/**
 * Apply one change to one floor. Returns the new floor and the rooms it
 * touched, or null when the change doesn't make sense or fails the checks.
 */
export function applyChange(plan: FloorPlan, c: PlanChange, ctx: { exteriorIn: number; seeds: (p: FloorPlan) => string[] }): { plan: FloorPlan; rooms: string[] } | null {
  const room = plan.rooms.find((r) => r.id === c.room);
  if (!room) return null;
  const other = c.other && c.other !== OUTSIDE ? plan.rooms.find((r) => r.id === c.other) : undefined;
  const side = c.side === "none" ? null : c.side;
  let next: FloorPlan | null = null;
  let touched = [room.id];
  const check: Check = {};

  switch (c.op) {
    case "grow":
    case "shrink": {
      const feet = Math.min(6, Math.max(0.5, Math.abs(c.feet) || 2));
      let edge = side ? edgeFacing(room, side) : null;
      // "Grow into the kitchen": the wall they share.
      if (edge === null && other) edge = sharedWall(room, other)?.edge ?? null;
      if (edge === null) return null;
      const e = edgesOf(room.polygon)[edge];
      const n = leftNormal(unit(sub(e.b, e.a)));
      next = pushWall(plan, room.id, edge, scale(n, (c.op === "grow" ? 1 : -1) * feet * 12));
      if (next) touched = next.rooms.filter((r) => plan.rooms.find((x) => x.id === r.id)?.polygon !== r.polygon).map((r) => r.id);
      break;
    }
    case "swap": {
      if (!other || other.id === room.id) return null;
      const ca = boundsOf(room.polygon)!;
      const cb = boundsOf(other.polygon)!;
      const mid = (b: typeof ca) => ({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });
      const da = sub(mid(cb), mid(ca));
      const who = (r: PlanRoom) => ({ name: r.name, type: r.type, briefRoomId: r.briefRoomId });
      const [wa, wb] = [who(room), who(other)];
      next = {
        ...plan,
        rooms: plan.rooms.map((r) => (r.id === room.id ? { ...r, ...wb } : r.id === other.id ? { ...r, ...wa } : r)),
        // Fixtures go with what the room is for; ones that don't fit the new room are left out.
        fixtures: plan.fixtures.map((f) =>
          f.roomId === room.id ? { ...f, x: f.x + da.x, y: f.y + da.y, roomId: other.id } : f.roomId === other.id ? { ...f, x: f.x - da.x, y: f.y - da.y, roomId: room.id } : f,
        ),
        furniture: plan.furniture.map((f) =>
          f.roomId === room.id ? { ...f, x: f.x + da.x, y: f.y + da.y, roomId: other.id } : f.roomId === other.id ? { ...f, x: f.x - da.x, y: f.y - da.y, roomId: room.id } : f,
        ),
      };
      touched = [room.id, other.id];
      break;
    }
    case "door": {
      if (c.other === OUTSIDE) {
        if (openingsBetween(plan, room.id, OUTSIDE).length) return null;
        const facing = side ? DIR[side] : { x: 0, y: 0 };
        const outdoorish = ["living", "family", "dining", "kitchen", "sunroom", "great-room"].includes(room.type ?? "");
        const [style, width] = room.type === "entry" ? ["door-entry", 36] : outdoorish ? ["door-slider", 72] : ["door-hinged", 32];
        const o = outsideDoor(plan, room, facing, style as string, width as number, ctx.exteriorIn, side ? 0.5 : -2);
        next = o ? { ...plan, openings: [...plan.openings, o] } : null;
        break;
      }
      if (!other || openingsBetween(plan, room.id, other.id).length) return null;
      next = addDoor(plan, room, other);
      touched = [room.id, other.id];
      break;
    }
    case "no_door": {
      const target = other?.id ?? (c.other === OUTSIDE ? OUTSIDE : null);
      if (!target) return null;
      const gone = new Set(openingsBetween(plan, room.id, target).map((o) => o.id));
      if (!gone.size) return null;
      next = { ...plan, openings: plan.openings.filter((o) => !gone.has(o.id)) };
      check.allowDrop = [linkKey(room.id, target)];
      touched = other ? [room.id, other.id] : [room.id];
      break;
    }
    case "open_up": {
      if (!other) return null;
      const wall = sharedWall(room, other);
      if (!wall) return null;
      const width = Math.min(OPEN_UP_MAX_IN, Math.floor((wall.t1 - wall.t0 - 12) / 6) * 6);
      if (width < 48) return null;
      const gone = new Set(openingsBetween(plan, room.id, other.id).map((o) => o.id));
      if ([...gone].some((id) => plan.openings.find((o) => o.id === id)?.kind === "opening" && (plan.openings.find((o) => o.id === id)?.widthIn ?? 0) >= width - 6)) return null;
      const without = { ...plan, openings: plan.openings.filter((o) => !gone.has(o.id)) };
      const host = { roomId: room.id, edge: wall.edge };
      const at = freeSpot(without, host, wall.t0, wall.t1, width, 2);
      if (at === null) return null;
      next = { ...without, openings: [...without.openings, newOpening("opening", host, at, 1, width)] };
      touched = [room.id, other.id];
      break;
    }
    case "window": {
      if (!side || areaKind(room) !== "living") return null;
      const widthIn = Math.min(120, Math.max(24, Math.round((c.feet || 3) * 2) * 6));
      next = addWindow(plan, room, side, widthIn);
      break;
    }
    case "mirror":
      // Whole-house; see applyChanges.
      return null;
  }
  if (!next) return null;
  next = tidy(next);
  if (!stillSound(plan, next, ctx.seeds(plan), ctx.seeds(next), check)) return null;
  return { plan: next, rooms: touched };
}

// ---------- A list of changes ----------

/** Whether a change leaves more of this floor, or the floor above, hanging past the floor below it (by over a square foot). */
function hangsMore(before: Plans, after: Plans, levels: Level[], level: Level): boolean {
  const above = levelAbove(levels, level);
  return [level, ...(above ? [above] : [])].some((l) => hangingArea(after, levels, l) > hangingArea(before, levels, l) + 144);
}

export type Applied = { plans: Plans; applied: PlanChange[]; changed: string[]; mirrored: boolean };

/** Apply changes in order, skipping any that don't work. Rooms are found on whichever floor they're on. */
export function applyChanges(plans: Plans, changes: PlanChange[], ctx: PlanContext): Applied {
  const exteriorIn = exteriorWallIn(ctx.basics);
  let out: Plans = { ...plans };
  const applied: PlanChange[] = [];
  const changed = new Set<string>();
  let mirrored = false;
  for (const c of changes) {
    if (c.op === "mirror") {
      const axis = mirrorAxis(ctx);
      if (mirrored || !axis) continue;
      out = mirrorPlans(out, axis);
      mirrored = true;
      applied.push(c);
      continue;
    }
    const levelId = levelOfRoom(out, c.room);
    const level = ctx.levels.find((l) => l.id === levelId);
    if (!levelId || !level) continue;
    const seeds = (p: FloorPlan) => wayInRooms(p, stairsBoxes({ ...out, [levelId]: p }, ctx, level));
    const res = applyChange(planOf(out, levelId), c, { exteriorIn, seeds });
    if (!res) continue;
    const next = { ...out, [levelId]: res.plan };
    if (hangsMore(out, next, ctx.levels, level)) continue;
    out = next;
    applied.push(c);
    for (const id of res.rooms) changed.add(id);
  }
  return { plans: out, applied, changed: [...changed], mirrored };
}
