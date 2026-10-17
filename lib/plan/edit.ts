import { mapRiders } from "@/lib/furnish/ride";
import type { FloorPlan, Opening, PlanRoom, Point } from "@/lib/model/schema";
import { newElementId } from "@/lib/bubbles/edit";
import { add, clockwise, collinearOverlap, dist, dot, edgesOf, polygonCenter, rotate, round1, roundPoint, scale, sub, unit } from "./geometry";
import { clampOffset, hostSegment, nearestHost, sameHost } from "./walls";
import { bulgeOf, leftBulge, pointOnEdge, projectOnEdge, reverseBulges, roomEdgeArc, roomEdgeLength, scaledBulge, wallArc, wallLength, withBulges } from "./arcs";
import { carryOpenWalls, pruneOpenWalls } from "./openWalls";
import { unlocked } from "./locks";

/**
 * Editing helpers for one level's floor plan. Each returns a new plan, so the
 * project store can save it and undo it.
 */

export type Plans = Record<string, FloorPlan>;

export function emptyPlan(): FloorPlan {
  return { rooms: [], walls: [], openings: [], stairs: [], fixtures: [], furniture: [] };
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

/** Delete rooms, walls, doors and windows, stairs, fixtures and furniture. Doors and windows in deleted walls go too. Anchored stairs stay. */
export function removeMany(plan: FloorPlan, ids: string[]): FloorPlan {
  const gone = new Set(unlocked(plan, ids));
  const hostGone = (o: Opening) => ("roomId" in o.host ? gone.has(o.host.roomId) : gone.has(o.host.wallId));
  return pruneOpenWalls({
    ...(plan.openWalls ? { openWalls: plan.openWalls } : {}),
    rooms: plan.rooms.filter((r) => !gone.has(r.id)),
    walls: plan.walls.filter((w) => !gone.has(w.id)),
    openings: plan.openings.filter((o) => !gone.has(o.id) && !hostGone(o)),
    stairs: plan.stairs.filter((s) => !gone.has(s.id)),
    // Fixtures stay when their room goes; they just stop following it.
    fixtures: plan.fixtures.filter((f) => !gone.has(f.id)).map((f) => (f.roomId && gone.has(f.roomId) ? { ...f, roomId: undefined } : f)),
    furniture: plan.furniture.filter((f) => !gone.has(f.id)).map((f) => (f.roomId && gone.has(f.roomId) ? { ...f, roomId: undefined } : f)),
    ...(plan.cabinets ? { cabinets: plan.cabinets } : {}),
    ...(plan.devices ? { devices: plan.devices } : {}),
    ...(plan.addOns ? { addOns: plan.addOns } : {}),
    // Furnish items stay too, and stop following a room that's gone.
    ...mapRiders(
      { ...plan, addOns: plan.addOns?.filter((a) => !gone.has(a.id)) },
      (x) => (x.roomId && gone.has(x.roomId) ? { ...x, roomId: undefined } : x),
    ),
  });
}

/**
 * Move rooms, walls, stairs and fixtures together. Doors and windows ride
 * along with their walls, and fixtures with their room. Anchored stairs stay
 * put.
 */
export function moveMany(plan: FloorPlan, ids: string[], dx: number, dy: number): FloorPlan {
  const ids_ = new Set(unlocked(plan, ids));
  const d = { x: dx, y: dy };
  const mv = (p: Point) => roundPoint(add(p, d));
  return carryOpenWalls(plan, {
    ...plan,
    rooms: plan.rooms.map((r) => (ids_.has(r.id) ? { ...r, polygon: r.polygon.map(mv) } : r)),
    walls: plan.walls.map((w) => (ids_.has(w.id) ? { ...w, a: mv(w.a), b: mv(w.b) } : w)),
    stairs: plan.stairs.map((s) => (ids_.has(s.id) ? { ...s, ...mv(s) } : s)),
    fixtures: plan.fixtures.map((f) => (ids_.has(f.id) || (f.roomId && ids_.has(f.roomId)) ? { ...f, ...mv(f) } : f)),
    furniture: plan.furniture.map((f) => (f.roomId && ids_.has(f.roomId) ? { ...f, ...mv(f) } : f)),
    ...mapRiders(plan, (x) => (x.roomId && ids_.has(x.roomId) ? { ...x, ...mv(x) } : x)),
  });
}

/** Turn rooms (with their fixtures), walls, stairs and fixtures around a point. Anchored stairs stay put. */
export function rotateMany(plan: FloorPlan, ids: string[], deg: number, about: Point): FloorPlan {
  const ids_ = new Set(unlocked(plan, ids));
  const rt = (p: Point) => roundPoint(rotate(p, deg, about));
  const turn = (r: number) => ((Math.round((r + deg) * 10) / 10) % 360 + 360) % 360;
  return carryOpenWalls(plan, {
    ...plan,
    rooms: plan.rooms.map((r) => (ids_.has(r.id) ? { ...r, polygon: r.polygon.map(rt) } : r)),
    walls: plan.walls.map((w) => (ids_.has(w.id) ? { ...w, a: rt(w.a), b: rt(w.b) } : w)),
    stairs: plan.stairs.map((s) => (ids_.has(s.id) ? { ...s, ...rt(s), rotation: turn(s.rotation) } : s)),
    fixtures: plan.fixtures.map((f) => (ids_.has(f.id) || (f.roomId && ids_.has(f.roomId)) ? { ...f, ...rt(f), rotation: turn(f.rotation) } : f)),
    furniture: plan.furniture.map((f) => (f.roomId && ids_.has(f.roomId) ? { ...f, ...rt(f), rotation: turn(f.rotation) } : f)),
    ...mapRiders(plan, (x) => (x.roomId && ids_.has(x.roomId) ? { ...x, ...rt(x), rotation: turn(x.rotation) } : x)),
  });
}

/** Of these ids, the rooms, loose walls and stairs that aren't anchored: what the Turn items in the right-click menu can turn. */
export function turnableIds(plan: FloorPlan, ids: string[]): string[] {
  return unlocked(plan, ids).filter((id) => plan.rooms.some((r) => r.id === id) || plan.walls.some((w) => w.id === id) || plan.stairs.some((st) => st.id === id));
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
 * corner its wall starts from. Removed walls stay with the rooms they sit between.
 */
export function keepOpeningsInPlace(before: FloorPlan, after: FloorPlan): FloorPlan {
  return keepDoorsInPlace(before, carryOpenWalls(before, after));
}

function keepDoorsInPlace(before: FloorPlan, after: FloorPlan): FloorPlan {
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
    const at = pointOnEdge(from.a, from.b, from.bulge ?? 0, o.offsetIn);
    const offsetIn = round1(clampOffset(projectOnEdge(at, to.a, to.b, to.bulge).t, o.widthIn, to.length));
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

/**
 * Move one corner of a room, and (when `glue` is on) every other room corner
 * and loose wall end sitting on the same spot, so shared walls stay shared.
 */
export function setCornerGlued(plan: FloorPlan, roomId: string, i: number, p: Point, glue = true): FloorPlan {
  const room = plan.rooms.find((r) => r.id === roomId);
  if (!room || !room.polygon[i]) return plan;
  if (!glue) return setCorner(plan, roomId, i, p);
  const from = room.polygon[i];
  const to = roundPoint(p);
  const here = (q: Point) => dist(q, from) <= 1;
  return keepOpeningsInPlace(plan, {
    ...plan,
    rooms: plan.rooms.map((r) => {
      const hit = r.polygon.some((q, k) => (r.id === roomId ? k === i : here(q)));
      return hit ? { ...r, polygon: r.polygon.map((q, k) => ((r.id === roomId ? k === i : here(q)) ? to : q)) } : r;
    }),
    walls: plan.walls.map((w) => (here(w.a) || here(w.b) ? { ...w, a: here(w.a) ? to : w.a, b: here(w.b) ? to : w.b } : w)),
  });
}

/**
 * Add a corner on an edge, and on any other room's edge that runs through the
 * same spot, so a shared wall gets its node on both sides. Returns the new
 * plan, with the new corner's index in the first room.
 */
export function insertGluedCorner(plan: FloorPlan, roomId: string, edge: number, p: Point): { plan: FloorPlan; index: number } {
  let next = insertCorner(plan, roomId, edge, p);
  for (const r of plan.rooms) {
    if (r.id === roomId) continue;
    const hit = edgesOf(r.polygon).find((e) => {
      const pr = projectOnEdge(p, e.a, e.b, leftBulge(r, e.i));
      return pr.d <= 1 && pr.t > 1 && pr.t < pr.length - 1;
    });
    if (hit) next = insertCorner(next, r.id, hit.i, p);
  }
  return { plan: next, index: edge + 1 };
}

/**
 * Give a room a new outline, keeping each door and window as close as it can
 * to where it was. `bulges` go with the new corners; left out, a room with
 * the same number of corners keeps its curves, and otherwise goes straight.
 */
export function reshapeRoom(plan: FloorPlan, roomId: string, polygon: Point[], bulges?: number[]): FloorPlan {
  const room = plan.rooms.find((r) => r.id === roomId);
  if (!room || polygon.length < 3) return plan;
  const rounded = polygon.map(roundPoint);
  const cw = clockwise(rounded);
  let curves = bulges ?? (polygon.length === room.polygon.length ? room.bulges : undefined);
  if (curves && cw !== rounded) curves = reverseBulges(curves, polygon.length);
  const next = { ...plan, rooms: plan.rooms.map((r) => (r.id === roomId ? withBulges({ ...r, polygon: cw }, curves) : r)) };
  const moved = next.rooms.find((r) => r.id === roomId)!;
  const openings = plan.openings.map((o) => {
    if (!("roomId" in o.host) || o.host.roomId !== roomId) return o;
    const seg = hostSegment(plan, o.host);
    if (!seg) return o;
    const at = pointOnEdge(seg.a, seg.b, seg.bulge ?? 0, o.offsetIn);
    let best = { edge: 0, t: 0, d: Infinity, length: 0 };
    for (const e of edgesOf(moved.polygon)) {
      const pr = projectOnEdge(at, e.a, e.b, leftBulge(moved, e.i));
      if (pr.d < best.d) best = { edge: e.i, t: pr.t, d: pr.d, length: pr.length };
    }
    return { ...o, host: { roomId, edge: best.edge }, offsetIn: round1(clampOffset(best.t, o.widthIn, best.length)) };
  });
  return { ...next, openings };
}

/**
 * Add a corner in the middle of an edge, so the room can take a new shape.
 * On a curved edge the corner goes on the curve, and both halves keep
 * following the same circle.
 */
export function insertCorner(plan: FloorPlan, roomId: string, edge: number, p: Point): FloorPlan {
  const room = plan.rooms.find((r) => r.id === roomId);
  if (!room) return plan;
  const poly = [...room.polygon];
  const arc = roomEdgeArc(room, edge);
  const at = arc ? projectOnEdge(p, arc.a, arc.b, arc.bulge).point : p;
  poly.splice(edge + 1, 0, roundPoint(at));
  let bulges: number[] | undefined;
  if (room.bulges) {
    bulges = [...room.bulges];
    while (bulges.length < room.polygon.length) bulges.push(0);
    const halves: [number, number] = [0, 0];
    if (arc) {
      const t = projectOnEdge(at, arc.a, arc.b, arc.bulge).t;
      // A piece of the circle turning through angle φ bows R(1 - cos φ/2).
      const bow = (len: number) => Math.sign(bulgeOf(room, edge)) * arc.radius * (1 - Math.cos(len / arc.radius / 2));
      halves[0] = bow(t);
      halves[1] = bow(arc.length - t);
    }
    bulges.splice(edge, 1, ...halves);
  }
  return reshapeRoom(plan, roomId, poly, bulges);
}

/** Take a corner away (rooms keep at least three). The two walls it joined become one straight wall. */
export function removeCorner(plan: FloorPlan, roomId: string, i: number): FloorPlan {
  const room = plan.rooms.find((r) => r.id === roomId);
  if (!room || room.polygon.length <= 3) return plan;
  const n = room.polygon.length;
  let bulges: number[] | undefined;
  if (room.bulges) {
    bulges = Array.from({ length: n }, (_, k) => bulgeOf(room, k)).filter((_, k) => k !== i);
    bulges[(i - 1 + n - 1) % (n - 1)] = 0;
  }
  return reshapeRoom(plan, roomId, room.polygon.filter((_, k) => k !== i), bulges);
}

/**
 * Make one edge of a room a given length. Its end corner slides along the
 * edge, and so does the next corner when the next edge turns a corner, so a
 * rectangle stays a rectangle (its far side moves, with any neighbor's
 * wall that shares it).
 */
export function setEdgeLength(plan: FloorPlan, roomId: string, edge: number, lengthIn: number): FloorPlan {
  const room = plan.rooms.find((r) => r.id === roomId);
  if (!room || lengthIn < 1) return plan;
  const n = room.polygon.length;
  const a = room.polygon[edge];
  const b = room.polygon[(edge + 1) % n];
  const u = unit(sub(b, a));
  // A curved edge keeps its shape: `lengthIn` is along the curve, and the bow grows with it.
  const along = roomEdgeLength(room, edge);
  const chord = roomEdgeArc(room, edge) ? (dist(a, b) * lengthIn) / along : lengthIn;
  const delta = scale(u, chord - dist(a, b));
  const bulges = room.bulges?.map((bg, k) => (k === edge ? scaledBulge(bg, dist(a, b), chord) : bg));
  const withMine = (p: FloorPlan) => (bulges ? { ...p, rooms: p.rooms.map((r) => (r.id === roomId ? withBulges(r, bulges) : r)) } : p);
  const j = (edge + 1) % n;
  const k = (edge + 2) % n;
  // Only when the next edge turns (isn't straight on), or the room would fold.
  if (n >= 4 && k !== edge && Math.abs(dot(unit(sub(room.polygon[k], b)), u)) < 0.98) {
    // The far side moves like a dragged edge, taking a neighbor's shared wall with it (no overlap or gap).
    return withMine(moveEdge(plan, roomId, j, delta, true));
  }
  const poly = [...room.polygon];
  poly[j] = roundPoint(add(b, delta));
  return keepOpeningsInPlace(plan, withMine({ ...plan, rooms: plan.rooms.map((r) => (r.id === roomId ? { ...r, polygon: poly } : r)) }));
}

/**
 * Push one edge of a room by `d` (both its corners move), and the same stretch
 * of wall in any room that shares it, so neighbors stay together.
 */
export function moveEdge(plan: FloorPlan, roomId: string, edge: number, d: Point, glue = true): FloorPlan {
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
        if (mine || (glue && r.id !== roomId && collinearOverlap(a, b, e.a, e.b, 1))) {
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
    walls: plan.walls.map((w) => {
      if (w.id !== wallId || lengthIn < 1) return w;
      // A curved wall keeps its shape: `lengthIn` is along the curve, and the bow grows with it.
      const chord = wallArc(w) ? (dist(w.a, w.b) * lengthIn) / wallLength(w) : lengthIn;
      const next = { ...w, b: roundPoint(add(w.a, scale(unit(sub(w.b, w.a)), chord))) };
      return w.bulge ? { ...next, bulge: scaledBulge(w.bulge, dist(w.a, w.b), chord) } : next;
    }),
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
 * inches), or along its own wall when no other wall is close. `grab` is
 * how far past the opening's center it was picked up, along its wall.
 */
export function moveOpeningTo(plan: FloorPlan, id: string, p: Point, reach: number, grab = 0): FloorPlan {
  const o = plan.openings.find((x) => x.id === id);
  if (!o) return plan;
  const near = nearestHost(plan, p, reach);
  if (near && !sameHost(near.seg.host, o.host)) {
    return updateOpening(plan, id, { host: near.seg.host, offsetIn: near.t });
  }
  const seg = hostSegment(plan, o.host);
  if (!seg) return plan;
  return updateOpening(plan, id, { offsetIn: projectOnEdge(p, seg.a, seg.b, seg.bulge).t - grab });
}
