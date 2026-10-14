import type { FloorPlan, Opening, PlanRoom, Point } from "@/lib/model/schema";
import { newElementId } from "@/lib/bubbles/edit";
import { add, clockwise, collinearOverlap, dist, dot, edgesOf, polygonCenter, project, rotate, round1, roundPoint, scale, sub, unit } from "./geometry";
import { clampOffset, hostSegment, nearestHost, sameHost } from "./walls";

/**
 * Editing helpers for one level's floor plan. Each returns a new plan, so the
 * project store can save it and undo it.
 */

export type Plans = Record<string, FloorPlan>;

export function emptyPlan(): FloorPlan {
  return { rooms: [], walls: [], openings: [], stairs: [], fixtures: [] };
}

export function planOf(plans: Plans, levelId: string): FloorPlan {
  return plans[levelId] ?? emptyPlan();
}

export function planHasContent(plans: Plans): boolean {
  return Object.values(plans).some((p) => p.rooms.length + p.walls.length + p.openings.length + p.stairs.length + p.fixtures.length > 0);
}

export function blankPlans(levels: { id: string }[]): Plans {
  return Object.fromEntries(levels.map((l) => [l.id, emptyPlan()]));
}

export const newPlanId = newElementId;

/** A new room from corners in any order of turning; corners are stored clockwise. */
export function makeRoom(polygon: Point[], name = "New room", extra: Partial<PlanRoom> = {}): PlanRoom {
  return { id: newPlanId("r"), name, polygon: clockwise(polygon.map(roundPoint)), ...extra };
}

export function addRoom(plan: FloorPlan, room: PlanRoom): FloorPlan {
  return { ...plan, rooms: [...plan.rooms, { ...room, polygon: clockwise(room.polygon) }] };
}

export function updateRoom(plan: FloorPlan, id: string, patch: Partial<PlanRoom>): FloorPlan {
  return { ...plan, rooms: plan.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)) };
}

/** Delete rooms, walls, doors and windows, stairs and fixtures. Doors and windows in deleted walls go too. */
export function removeMany(plan: FloorPlan, ids: string[]): FloorPlan {
  const gone = new Set(ids);
  const hostGone = (o: Opening) => ("roomId" in o.host ? gone.has(o.host.roomId) : gone.has(o.host.wallId));
  return {
    rooms: plan.rooms.filter((r) => !gone.has(r.id)),
    walls: plan.walls.filter((w) => !gone.has(w.id)),
    openings: plan.openings.filter((o) => !gone.has(o.id) && !hostGone(o)),
    stairs: plan.stairs.filter((s) => !gone.has(s.id)),
    // Fixtures stay when their room goes; they just stop following it.
    fixtures: plan.fixtures.filter((f) => !gone.has(f.id)).map((f) => (f.roomId && gone.has(f.roomId) ? { ...f, roomId: undefined } : f)),
  };
}

/**
 * Move rooms, walls, stairs and fixtures together. Doors and windows ride
 * along with their walls, and fixtures with their room.
 */
export function moveMany(plan: FloorPlan, ids: string[], dx: number, dy: number): FloorPlan {
  const ids_ = new Set(ids);
  const d = { x: dx, y: dy };
  const mv = (p: Point) => roundPoint(add(p, d));
  return {
    ...plan,
    rooms: plan.rooms.map((r) => (ids_.has(r.id) ? { ...r, polygon: r.polygon.map(mv) } : r)),
    walls: plan.walls.map((w) => (ids_.has(w.id) ? { ...w, a: mv(w.a), b: mv(w.b) } : w)),
    stairs: plan.stairs.map((s) => (ids_.has(s.id) ? { ...s, ...mv(s) } : s)),
    fixtures: plan.fixtures.map((f) => (ids_.has(f.id) || (f.roomId && ids_.has(f.roomId)) ? { ...f, ...mv(f) } : f)),
  };
}

/** Turn rooms (with their fixtures), walls, stairs and fixtures around a point. */
export function rotateMany(plan: FloorPlan, ids: string[], deg: number, about: Point): FloorPlan {
  const ids_ = new Set(ids);
  const rt = (p: Point) => roundPoint(rotate(p, deg, about));
  const turn = (r: number) => ((Math.round((r + deg) * 10) / 10) % 360 + 360) % 360;
  return {
    ...plan,
    rooms: plan.rooms.map((r) => (ids_.has(r.id) ? { ...r, polygon: r.polygon.map(rt) } : r)),
    walls: plan.walls.map((w) => (ids_.has(w.id) ? { ...w, a: rt(w.a), b: rt(w.b) } : w)),
    stairs: plan.stairs.map((s) => (ids_.has(s.id) ? { ...s, ...rt(s), rotation: turn(s.rotation) } : s)),
    fixtures: plan.fixtures.map((f) => (ids_.has(f.id) || (f.roomId && ids_.has(f.roomId)) ? { ...f, ...rt(f), rotation: turn(f.rotation) } : f)),
  };
}

/** The middle of everything with these ids, for turning them together. */
export function centerOfMany(plan: FloorPlan, ids: string[]): Point {
  const pts: Point[] = [];
  for (const r of plan.rooms) if (ids.includes(r.id)) pts.push(polygonCenter(r.polygon));
  for (const w of plan.walls) if (ids.includes(w.id)) pts.push(scale(add(w.a, w.b), 0.5));
  for (const s of plan.stairs) if (ids.includes(s.id)) pts.push({ x: s.x, y: s.y });
  for (const f of plan.fixtures) if (ids.includes(f.id)) pts.push({ x: f.x, y: f.y });
  if (!pts.length) return { x: 0, y: 0 };
  return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
}

/**
 * After rooms change shape (same corners, moved), keep each door and window
 * where it was on its wall, instead of letting it slide along with the
 * corner its wall starts from.
 */
export function keepOpeningsInPlace(before: FloorPlan, after: FloorPlan): FloorPlan {
  const was = new Map(before.rooms.map((r) => [r.id, r]));
  const now = new Map(after.rooms.map((r) => [r.id, r]));
  let changed = false;
  const openings = after.openings.map((o) => {
    if (!("roomId" in o.host)) return o;
    const old = was.get(o.host.roomId);
    const cur = now.get(o.host.roomId);
    if (!old || !cur || old.polygon === cur.polygon || old.polygon.length !== cur.polygon.length) return o;
    const from = hostSegment(before, o.host);
    const to = hostSegment(after, o.host);
    if (!from || !to) return o;
    const at = add(from.a, scale(unit(sub(from.b, from.a)), o.offsetIn));
    const offsetIn = round1(clampOffset(project(at, to.a, to.b).t, o.widthIn, to.length));
    if (offsetIn === o.offsetIn) return o;
    changed = true;
    return { ...o, offsetIn };
  });
  return changed ? { ...after, openings } : after;
}

/** Move one corner of a room. */
export function setCorner(plan: FloorPlan, roomId: string, i: number, p: Point): FloorPlan {
  return keepOpeningsInPlace(plan, {
    ...plan,
    rooms: plan.rooms.map((r) => (r.id === roomId ? { ...r, polygon: r.polygon.map((q, k) => (k === i ? roundPoint(p) : q)) } : r)),
  });
}

/** Give a room a new outline, keeping each door and window as close as it can to where it was. */
export function reshapeRoom(plan: FloorPlan, roomId: string, polygon: Point[]): FloorPlan {
  const room = plan.rooms.find((r) => r.id === roomId);
  if (!room || polygon.length < 3) return plan;
  const next = { ...plan, rooms: plan.rooms.map((r) => (r.id === roomId ? { ...r, polygon: clockwise(polygon.map(roundPoint)) } : r)) };
  const moved = next.rooms.find((r) => r.id === roomId)!;
  const openings = plan.openings.map((o) => {
    if (!("roomId" in o.host) || o.host.roomId !== roomId) return o;
    const seg = hostSegment(plan, o.host);
    if (!seg) return o;
    const at = add(seg.a, scale(unit(sub(seg.b, seg.a)), o.offsetIn));
    let best = { edge: 0, t: 0, d: Infinity, length: 0 };
    for (const e of edgesOf(moved.polygon)) {
      const pr = project(at, e.a, e.b);
      if (pr.d < best.d) best = { edge: e.i, t: pr.t, d: pr.d, length: pr.length };
    }
    return { ...o, host: { roomId, edge: best.edge }, offsetIn: round1(clampOffset(best.t, o.widthIn, best.length)) };
  });
  return { ...next, openings };
}

/** Add a corner in the middle of an edge, so the room can take a new shape. */
export function insertCorner(plan: FloorPlan, roomId: string, edge: number, p: Point): FloorPlan {
  const room = plan.rooms.find((r) => r.id === roomId);
  if (!room) return plan;
  const poly = [...room.polygon];
  poly.splice(edge + 1, 0, roundPoint(p));
  return reshapeRoom(plan, roomId, poly);
}

/** Take a corner away (rooms keep at least three). */
export function removeCorner(plan: FloorPlan, roomId: string, i: number): FloorPlan {
  const room = plan.rooms.find((r) => r.id === roomId);
  if (!room || room.polygon.length <= 3) return plan;
  return reshapeRoom(plan, roomId, room.polygon.filter((_, k) => k !== i));
}

/**
 * Make one edge of a room a given length. Its end corner slides along the
 * edge, and so does the next corner when the next edge turns a corner, so a
 * rectangle stays a rectangle (its far side moves).
 */
export function setEdgeLength(plan: FloorPlan, roomId: string, edge: number, lengthIn: number): FloorPlan {
  const room = plan.rooms.find((r) => r.id === roomId);
  if (!room || lengthIn < 1) return plan;
  const n = room.polygon.length;
  const a = room.polygon[edge];
  const b = room.polygon[(edge + 1) % n];
  const u = unit(sub(b, a));
  const delta = scale(u, lengthIn - dist(a, b));
  const poly = [...room.polygon];
  const j = (edge + 1) % n;
  poly[j] = roundPoint(add(b, delta));
  const k = (edge + 2) % n;
  if (n >= 4 && k !== edge) {
    const next = unit(sub(room.polygon[k], b));
    // Only when the next edge turns (isn't straight on), or the room would fold.
    if (Math.abs(dot(next, u)) < 0.98) poly[k] = roundPoint(add(room.polygon[k], delta));
  }
  return keepOpeningsInPlace(plan, { ...plan, rooms: plan.rooms.map((r) => (r.id === roomId ? { ...r, polygon: poly } : r)) });
}

/**
 * Push one edge of a room by `d` (both its corners move), and the same stretch
 * of wall in any room that shares it, so neighbors stay together.
 */
export function moveEdge(plan: FloorPlan, roomId: string, edge: number, d: Point): FloorPlan {
  const room = plan.rooms.find((r) => r.id === roomId);
  if (!room) return plan;
  const a = room.polygon[edge];
  const b = room.polygon[(edge + 1) % room.polygon.length];
  return keepOpeningsInPlace(plan, {
    ...plan,
    rooms: plan.rooms.map((r) => {
      const moveIdx = new Set<number>();
      for (const e of edgesOf(r.polygon)) {
        const mine = r.id === roomId && e.i === edge;
        if (mine || (r.id !== roomId && collinearOverlap(a, b, e.a, e.b, 1))) {
          moveIdx.add(e.i);
          moveIdx.add((e.i + 1) % r.polygon.length);
        }
      }
      return moveIdx.size ? { ...r, polygon: r.polygon.map((p, i) => (moveIdx.has(i) ? roundPoint(add(p, d)) : p)) } : r;
    }),
  });
}

/** Change a wall drawn on its own to a given length, keeping its start. */
export function setWallLength(plan: FloorPlan, wallId: string, lengthIn: number): FloorPlan {
  return {
    ...plan,
    walls: plan.walls.map((w) => (w.id === wallId && lengthIn >= 1 ? { ...w, b: roundPoint(add(w.a, scale(unit(sub(w.b, w.a)), lengthIn))) } : w)),
  };
}

export function updateOpening(plan: FloorPlan, id: string, patch: Partial<Opening>): FloorPlan {
  return {
    ...plan,
    openings: plan.openings.map((o) => {
      if (o.id !== id) return o;
      const next = { ...o, ...patch };
      const seg = hostSegment(plan, next.host);
      return seg ? { ...next, offsetIn: round1(clampOffset(next.offsetIn, next.widthIn, seg.length)) } : next;
    }),
  };
}

/**
 * Slide a door or window to the wall nearest a point (within `reach`
 * inches), or along its own wall when no other wall is close.
 */
export function moveOpeningTo(plan: FloorPlan, id: string, p: Point, reach: number): FloorPlan {
  const o = plan.openings.find((x) => x.id === id);
  if (!o) return plan;
  const near = nearestHost(plan, p, reach);
  if (near && !sameHost(near.seg.host, o.host)) {
    return updateOpening(plan, id, { host: near.seg.host, offsetIn: near.t });
  }
  const seg = hostSegment(plan, o.host);
  if (!seg) return plan;
  return updateOpening(plan, id, { offsetIn: project(p, seg.a, seg.b).t });
}
