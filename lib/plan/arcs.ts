import type { PlanRoom, PlanWall, Point } from "@/lib/model/schema";
import { add, dist, leftNormal, polygonArea, project, scale, signedArea, sub, unit } from "./geometry";

/**
 * Curved walls. A curved room edge or loose wall is stored as its two ends
 * plus a "bulge": how far the middle of the curve sits from the straight
 * line between the ends, in inches. On a room edge, positive bows out of the
 * room; on a loose wall, positive bows to the left walking from `a` to `b`.
 * Every curve is part of a circle.
 *
 * Everything outside the 2D editor works on a flattened copy (see
 * flatten.ts); this file has the math both sides share.
 */

/** Below this (inches) a bulge counts as straight. */
export const STRAIGHT_IN = 0.05;

export type Arc = {
  a: Point;
  b: Point;
  center: Point;
  radius: number;
  /** Angle of `a` around the center, radians (screen angles: clockwise from east). */
  start: number;
  /** Signed angle from `a` to `b` along the curve, radians. Positive turns clockwise on screen. */
  sweep: number;
  /** Length along the curve, inches. */
  length: number;
  /** Signed bulge to the left of a→b. */
  bulge: number;
};

export const isCurved = (bulge: number | undefined): bulge is number => !!bulge && Math.abs(bulge) >= STRAIGHT_IN;

/**
 * The arc from a to b bowing `bulge` inches to the left (negative: right),
 * or null when it's straight. Worked out from the lower end first, so the
 * same curve read from either end gives exactly the same circle.
 */
export function arcBetween(a: Point, b: Point, bulge: number): Arc | null {
  const chord = dist(a, b);
  if (!isCurved(bulge) || chord < 0.5) return null;
  const swap = a.x > b.x || (a.x === b.x && a.y > b.y);
  const [p, q, h] = swap ? [b, a, -bulge] : [a, b, bulge];
  const half = chord / 2;
  const s = Math.abs(h);
  const radius = (half * half + s * s) / (2 * s);
  const n = leftNormal(unit(sub(q, p)));
  const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  const center = add(mid, scale(n, h - Math.sign(h) * radius));
  const theta = 4 * Math.atan(s / half);
  // Bowing left runs clockwise on screen (y south): the angle grows.
  const sweepPQ = Math.sign(h) * theta;
  const angleOf = (pt: Point) => Math.atan2(pt.y - center.y, pt.x - center.x);
  const start = swap ? angleOf(q) : angleOf(p);
  return { a, b, center, radius, start, sweep: swap ? -sweepPQ : sweepPQ, length: radius * theta, bulge };
}

/** The point `s` inches along an arc from its start. */
export function pointOnArc(arc: Arc, s: number): Point {
  const t = arc.start + (Math.sign(arc.sweep) * s) / arc.radius;
  return { x: arc.center.x + arc.radius * Math.cos(t), y: arc.center.y + arc.radius * Math.sin(t) };
}

/** The point at angle `ang` (radians) on the arc's circle. */
export const pointAtAngle = (arc: Pick<Arc, "center" | "radius">, ang: number): Point => ({
  x: arc.center.x + arc.radius * Math.cos(ang),
  y: arc.center.y + arc.radius * Math.sin(ang),
});

/** How far around the arc (radians, 0 at the start, growing toward the end) the angle `ang` is, in [0, 2π). */
export function angleAlong(arc: Arc, ang: number): number {
  const d = (ang - arc.start) * Math.sign(arc.sweep);
  const TAU = Math.PI * 2;
  return ((d % TAU) + TAU) % TAU;
}

/** Nearest point on an arc: inches along it from the start, distance away, and the point. */
export function projectOnArc(p: Point, arc: Arc): { t: number; d: number; length: number; point: Point } {
  const ang = Math.atan2(p.y - arc.center.y, p.x - arc.center.x);
  const along = angleAlong(arc, ang);
  const total = Math.abs(arc.sweep);
  let t: number;
  if (along <= total) t = along * arc.radius;
  else t = dist(p, arc.a) <= dist(p, arc.b) ? 0 : arc.length; // Past an end: the nearer end.
  const point = pointOnArc(arc, t);
  return { t, d: dist(p, point), length: arc.length, point };
}

/** Exact area between the straight line a-b and the curve. */
export function segmentArea(arc: Arc): number {
  const th = Math.abs(arc.sweep);
  return (arc.radius * arc.radius * (th - Math.sin(th))) / 2;
}

// ---------- Rooms ----------

/** A room's bulge on edge i (0 when straight). */
export const bulgeOf = (room: Pick<PlanRoom, "bulges">, i: number): number => room.bulges?.[i] ?? 0;

export const roomHasCurves = (room: Pick<PlanRoom, "bulges">): boolean => !!room.bulges?.some((b) => isCurved(b));

/** The arc of a room's edge i, or null when it's straight. Bulges bow out of the room whichever way the corners run. */
export function roomEdgeArc(room: Pick<PlanRoom, "polygon" | "bulges">, i: number): Arc | null {
  const b = bulgeOf(room, i);
  if (!isCurved(b)) return null;
  const n = room.polygon.length;
  // Corners running clockwise on screen (positive signed area) have the outside on the left.
  const out = signedArea(room.polygon) >= 0 ? 1 : -1;
  return arcBetween(room.polygon[i], room.polygon[(i + 1) % n], b * out);
}

/** Length of a room's edge i along the wall (the arc length when it's curved). */
export function roomEdgeLength(room: Pick<PlanRoom, "polygon" | "bulges">, i: number): number {
  const arc = roomEdgeArc(room, i);
  return arc ? arc.length : dist(room.polygon[i], room.polygon[(i + 1) % room.polygon.length]);
}

/** A room's true floor area in square inches, curves included. */
export function roomArea(room: Pick<PlanRoom, "polygon" | "bulges">): number {
  let area = polygonArea(room.polygon);
  if (!roomHasCurves(room)) return area;
  for (let i = 0; i < room.polygon.length; i++) {
    const arc = roomEdgeArc(room, i);
    if (arc) area += Math.sign(bulgeOf(room, i)) * segmentArea(arc);
  }
  return area;
}

/** The arc of a loose wall, or null when it's straight. */
export const wallArc = (w: Pick<PlanWall, "a" | "b" | "bulge">): Arc | null => arcBetween(w.a, w.b, w.bulge ?? 0);

export const wallLength = (w: Pick<PlanWall, "a" | "b" | "bulge">): number => wallArc(w)?.length ?? dist(w.a, w.b);

// ---------- Edges, straight or curved ----------

/** Nearest point on an edge from a to b with this left bulge: inches along it, distance away, the edge length and the point. */
export function projectOnEdge(p: Point, a: Point, b: Point, bulge = 0): { t: number; d: number; length: number; point: Point } {
  const arc = arcBetween(a, b, bulge);
  return arc ? projectOnArc(p, arc) : project(p, a, b);
}

/** The point `s` inches along an edge from a to b with this left bulge. */
export function pointOnEdge(a: Point, b: Point, bulge: number, s: number): Point {
  const arc = arcBetween(a, b, bulge);
  if (arc) return pointOnArc(arc, s);
  return add(a, scale(unit(sub(b, a)), s));
}

/** A room edge's bulge to the left of its direction (what the edge helpers above take). */
export function leftBulge(room: Pick<PlanRoom, "polygon" | "bulges">, i: number): number {
  return bulgeOf(room, i) * (signedArea(room.polygon) >= 0 ? 1 : -1);
}

/** The bulge of the part of an arc between two points on it (same circle, same side). */
export function subBulge(arc: Arc, p: Point, q: Point): number {
  const tp = projectOnArc(p, arc).t;
  const tq = projectOnArc(q, arc).t;
  const phi = Math.abs(tq - tp) / arc.radius;
  return Math.sign(arc.bulge) * arc.radius * (1 - Math.cos(phi / 2)) * (tq >= tp ? 1 : -1);
}

// ---------- Keeping bulges in step with corners ----------

/** Bulges with trailing straight edges dropped; undefined when nothing is curved. */
export function tidyBulges(bulges: number[] | undefined, corners: number): number[] | undefined {
  if (!bulges) return undefined;
  const out = Array.from({ length: corners }, (_, i) => (isCurved(bulges[i]) ? Math.round(bulges[i] * 10) / 10 : 0));
  return out.some((b) => b !== 0) ? out : undefined;
}

/**
 * Bulges for an outline whose corners were put in reverse order: edge j of
 * the reversed outline is edge n - 2 - j of the old one, run backwards.
 * "Out of the room" doesn't depend on direction, so the numbers stay the same.
 */
export function reverseBulges(bulges: number[] | undefined, n: number): number[] | undefined {
  if (!bulges) return undefined;
  return Array.from({ length: n }, (_, j) => bulges[(2 * n - 2 - j) % n] ?? 0);
}

/** Give a room bulges, leaving the field off when every edge is straight. */
export function withBulges<R extends PlanRoom>(room: R, bulges: number[] | undefined): R {
  const tidy = tidyBulges(bulges, room.polygon.length);
  const { bulges: _old, ...rest } = room;
  void _old;
  return (tidy ? { ...rest, bulges: tidy } : rest) as R;
}

/** Scale how far a curve bows to keep its shape when its length changes. */
export const scaledBulge = (bulge: number, fromLength: number, toLength: number): number =>
  fromLength > 0 ? Math.round(((bulge * toLength) / fromLength) * 10) / 10 : bulge;
