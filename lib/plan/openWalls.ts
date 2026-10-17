import { mapRiders } from "@/lib/furnish/ride";
import polygonClipping, { type Polygon } from "polygon-clipping";
import type { FloorPlan, OpenWall, Opening, PlanRoom, Point } from "@/lib/model/schema";
import { cleanRing } from "@/lib/house3d/footprint";
import { areaKind } from "./measure";
import { sharedWall } from "./connect";
import { clockwise, collinearOverlap, dist, edgesOf, lerp, pointInPolygon, polygonArea, project, roundPoint, subtractIntervals, add, scale } from "./geometry";
import { hostSegment, openingGeometry, openWallsOf, wallPieces } from "./walls";
import { pointOnEdge } from "./arcs";
import { curvesOf, cutOutline, edgeDirection, nearestEdge, refitArcs } from "./refit";

/**
 * Taking out the wall between two rooms (they stay two rooms, open to each
 * other), putting it back, and combining touching rooms into one.
 * Removed walls are stored as stretches of plan (`plan.openWalls`), not as
 * "edge 3 of room X", so they keep working when rooms are reshaped.
 */

/** The walls along one edge of a room: inside walls that can be taken out, ones already taken out, and whether any of it is an outside wall. */
export function edgeWalls(plan: FloorPlan, roomId: string, edge: number): { inside: OpenWall[]; removed: OpenWall[]; outside: boolean } {
  const out = { inside: [] as OpenWall[], removed: [] as OpenWall[], outside: false };
  const seg = hostSegment(plan, { roomId, edge });
  if (!seg || seg.length < 1) return out;
  for (const p of wallPieces(plan, 0)) {
    if (!("roomId" in p.host)) continue;
    const o = collinearOverlap(seg.a, seg.b, p.a, p.b, 1);
    if (!o) continue;
    const stretch = { a: roundPoint(lerp(seg.a, seg.b, o[0] / seg.length)), b: roundPoint(lerp(seg.a, seg.b, o[1] / seg.length)) };
    if (p.removed) out.removed.push(stretch);
    else if (p.exterior) out.outside = true;
    else if (!p.open) out.inside.push(stretch);
  }
  return out;
}

/** Why a wall can't be taken out, or null when it can. */
export function whyWallStays(plan: FloorPlan, roomId: string, edge: number): string | null {
  const w = edgeWalls(plan, roomId, edge);
  if (w.inside.length) return null;
  if (w.removed.length) return "This wall is already taken out.";
  const room = plan.rooms.find((r) => r.id === roomId);
  if (room && areaKind(room) === "outdoor") return "A porch, deck or patio has no walls to take out.";
  return w.outside ? "This is an outside wall. Taking it out would open the house to the yard." : "There's no wall here to take out.";
}

/** Doors and windows sitting in any of these stretches. */
function openingsIn(plan: FloorPlan, stretches: OpenWall[]): Opening[] {
  return plan.openings.filter((o) => {
    const g = openingGeometry(plan, o);
    return !!g && stretches.some((s) => {
      const pr = project(g.center, s.a, s.b);
      return pr.d < 2 && pr.t > 0.5 && pr.t < pr.length - 0.5;
    });
  });
}

/**
 * Take out the inside wall along one edge of a room (the stretches it shares
 * with other rooms; outside walls stay). Doors and windows in it go too.
 * Null when there's nothing to take out.
 */
export function removeWall(plan: FloorPlan, roomId: string, edge: number): { plan: FloorPlan; removedOpenings: Opening[] } | null {
  const { inside } = edgeWalls(plan, roomId, edge);
  if (!inside.length) return null;
  const gone = openingsIn(plan, inside);
  const ids = new Set(gone.map((o) => o.id));
  return {
    plan: { ...plan, openWalls: [...openWallsOf(plan), ...inside], openings: plan.openings.filter((o) => !ids.has(o.id)) },
    removedOpenings: gone,
  };
}

/** Put back the wall along one edge of a room, wherever it was taken out. */
export function restoreWall(plan: FloorPlan, roomId: string, edge: number): FloorPlan {
  const seg = hostSegment(plan, { roomId, edge });
  if (!seg) return plan;
  const kept: OpenWall[] = [];
  for (const w of openWallsOf(plan)) {
    const L = dist(w.a, w.b);
    const o = collinearOverlap(w.a, w.b, seg.a, seg.b, 1);
    if (!o) {
      kept.push(w);
      continue;
    }
    for (const [t0, t1] of subtractIntervals(L, [o])) if (t1 - t0 > 1) kept.push({ a: roundPoint(lerp(w.a, w.b, t0 / L)), b: roundPoint(lerp(w.a, w.b, t1 / L)) });
  }
  return withOpenWalls(plan, kept);
}

/** Every removed wall on the plan, put back. */
export function restoreAllWalls(plan: FloorPlan): FloorPlan {
  return withOpenWalls(plan, []);
}

function withOpenWalls(plan: FloorPlan, list: OpenWall[]): FloorPlan {
  const rest = { ...plan };
  delete rest.openWalls;
  return list.length ? { ...rest, openWalls: list } : rest;
}

/**
 * Drop removed-wall stretches (or the parts of them) that no longer lie on
 * an inside wall between two rooms, say after a room was moved or deleted,
 * so a wall doesn't vanish later when a room happens to land there.
 */
export function pruneOpenWalls(plan: FloorPlan): FloorPlan {
  const list = openWallsOf(plan);
  if (!list.length) return plan;
  const removed = wallPieces(plan, 0).filter((p) => p.removed);
  const kept: OpenWall[] = [];
  for (const w of list) {
    const L = dist(w.a, w.b);
    const on = removed.map((p) => collinearOverlap(w.a, w.b, p.a, p.b, 1)).filter((o): o is [number, number] => o !== null);
    // What's left after taking away the parts still in use is what to drop.
    const off = subtractIntervals(L, on);
    if (!off.length) kept.push(w);
    else for (const [t0, t1] of subtractIntervals(L, off)) if (t1 - t0 > 1) kept.push({ a: roundPoint(lerp(w.a, w.b, t0 / L)), b: roundPoint(lerp(w.a, w.b, t1 / L)) });
  }
  return kept.length === list.length && kept.every((w, i) => w === list[i]) ? plan : withOpenWalls(plan, kept);
}

/**
 * Keep removed walls with the rooms they sit between when those rooms are
 * moved or reshaped (same corners, moved): each stretch stays at the same
 * place along its room edge.
 */
export function carryOpenWalls(before: FloorPlan, after: FloorPlan): FloorPlan {
  const list = openWallsOf(before);
  if (!list.length || before.rooms === after.rooms) return after;
  const now = new Map(after.rooms.map((r) => [r.id, r]));
  let changed = false;
  const moved = list.map((w) => {
    for (const r of before.rooms) {
      const cur = now.get(r.id);
      if (!cur || cur.polygon === r.polygon || cur.polygon.length !== r.polygon.length) continue;
      for (const e of edgesOf(r.polygon)) {
        const L = dist(e.a, e.b);
        const o = collinearOverlap(e.a, e.b, w.a, w.b, 1);
        if (!o || L < 1) continue;
        const [a, b] = [cur.polygon[e.i], cur.polygon[(e.i + 1) % cur.polygon.length]];
        // Which end of the stretch is nearer the edge's start.
        const flip = dist(w.a, e.a) > dist(w.b, e.a);
        const p0 = roundPoint(lerp(a, b, o[0] / L));
        const p1 = roundPoint(lerp(a, b, o[1] / L));
        changed = true;
        return flip ? { a: p1, b: p0 } : { a: p0, b: p1 };
      }
    }
    return w;
  });
  return changed ? pruneOpenWalls({ ...after, openWalls: moved }) : after;
}

const toRing = (pts: Point[]): [number, number][] => [...pts.map((p) => [p.x, p.y] as [number, number]), [pts[0].x, pts[0].y]];

/** Why these rooms can't be combined into one, or null when they can. */
export function whyNotCombine(plan: FloorPlan, ids: string[]): string | null {
  const rooms = ids.map((id) => plan.rooms.find((r) => r.id === id)).filter((r): r is PlanRoom => !!r);
  if (rooms.length < 2) return "Pick two or more rooms that touch.";
  if (rooms.some((r) => r.stairStack)) return "A stair hall stays its own room, lined up on every floor. Pick other rooms to combine.";
  const outdoor = rooms.filter((r) => areaKind(r) === "outdoor").length;
  if (outdoor && outdoor < rooms.length) return "A porch, deck or patio can't be combined with an inside room.";
  // Every room has to share a real stretch of wall with the others (not just a corner).
  const seen = new Set([rooms[0].id]);
  const queue = [rooms[0]];
  while (queue.length) {
    const r = queue.shift()!;
    for (const o of rooms) {
      if (seen.has(o.id)) continue;
      const w = sharedWall(r, o);
      if (w && w.t1 - w.t0 >= 12) {
        seen.add(o.id);
        queue.push(o);
      }
    }
  }
  if (seen.size < rooms.length) return "These rooms don't share a wall. Rooms that only touch at a corner can't be combined.";
  if (!unionOf(rooms)) return "These rooms don't line up cleanly. Line up the wall between them first.";
  return null;
}

/** The joined outline of touching rooms, with their curves kept as curved edges. */
function unionOf(rooms: PlanRoom[]): { polygon: Point[]; bulges?: number[] } | null {
  const [first, ...rest] = rooms.map((r): Polygon => [toRing(cutOutline(r))]);
  const mp = polygonClipping.union(first, ...rest);
  if (mp.length !== 1 || mp[0].length !== 1) return null;
  const ring = cleanRing(mp[0][0].slice(0, -1).map(([x, y]) => roundPoint({ x, y })));
  return ring.length >= 3 ? refitArcs(clockwise(ring), curvesOf(rooms)) : null;
}

/**
 * Join touching rooms into one. It keeps the biggest room (its id, name,
 * type and finishes). Doors and windows in the walls between them go;
 * the rest move onto the new outline. Fixtures and furniture belong to the
 * joined room. Null when they can't be combined (see `whyNotCombine`).
 */
export function combineRooms(plan: FloorPlan, ids: string[]): { plan: FloorPlan; keptId: string; removedOpenings: Opening[] } | null {
  if (whyNotCombine(plan, ids)) return null;
  const rooms = plan.rooms.filter((r) => ids.includes(r.id));
  const joined = unionOf(rooms)!;
  const flatJoined = cutOutline(joined);
  const keep = rooms.reduce((a, b) => (polygonArea(b.polygon) > polygonArea(a.polygon) ? b : a));
  const members = new Set(rooms.map((r) => r.id));
  const gone: Opening[] = [];
  const openings: Opening[] = [];
  for (const o of plan.openings) {
    if (!("roomId" in o.host) || !members.has(o.host.roomId)) {
      openings.push(o);
      continue;
    }
    const seg = hostSegment(plan, o.host);
    const center = seg && pointOnEdge(seg.a, seg.b, seg.bulge ?? 0, o.offsetIn);
    const n = seg && center && leftNormalOf(edgeDirection(seg.a, seg.b, seg.bulge ?? 0, center));
    // Inside the joined room on both sides: it was in a wall between them.
    const inside = !center || !n || (pointInPolygon(add(center, scale(n, 6)), flatJoined) && pointInPolygon(add(center, scale(n, -6)), flatJoined));
    const at = center && !inside ? nearestEdge(joined, center) : null;
    if (!at || at.d >= 1.5) {
      gone.push(o);
      continue;
    }
    // Outlines all run clockwise, so the new edge points the same way as the old one and the swing side holds.
    openings.push({ ...o, host: { roomId: keep.id, edge: at.edge }, offsetIn: Math.round(at.t * 10) / 10 });
  }
  const re = <T extends { roomId?: string }>(x: T): T => (x.roomId && members.has(x.roomId) ? { ...x, roomId: keep.id } : x);
  const next: FloorPlan = {
    ...plan,
    rooms: plan.rooms.filter((r) => r.id === keep.id || !members.has(r.id)).map((r) => (r.id === keep.id ? withShape(r, joined) : r)),
    openings,
    fixtures: plan.fixtures.map(re),
    furniture: plan.furniture.map(re),
    ...mapRiders(plan, re),
  };
  return { plan: pruneOpenWalls(next), keptId: keep.id, removedOpenings: gone };
}

const leftNormalOf = (u: Point): Point => ({ x: u.y, y: -u.x });

function withShape(r: PlanRoom, shape: { polygon: Point[]; bulges?: number[] }): PlanRoom {
  const { bulges: _b, ...rest } = r;
  void _b;
  return shape.bulges ? { ...rest, polygon: shape.polygon, bulges: shape.bulges } : { ...rest, polygon: shape.polygon };
}

/** Rooms on either side of a shared wall along one edge of a room (the room itself first). */
export function roomsAlong(plan: FloorPlan, roomId: string, edge: number): string[] {
  const seg = hostSegment(plan, { roomId, edge });
  if (!seg) return [roomId];
  const out = [roomId];
  for (const r of plan.rooms) {
    if (r.id === roomId) continue;
    if (edgesOf(r.polygon).some((e) => collinearOverlap(seg.a, seg.b, e.a, e.b, 1))) out.push(r.id);
  }
  return out;
}
