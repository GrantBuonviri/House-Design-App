import type { FloorPlan, PlanRoom, PlanWall, Point } from "@/lib/model/schema";
import { type Arc, angleAlong, arcBetween, isCurved, projectOnEdge, roomArea, roomEdgeArc, tidyBulges, wallArc } from "./arcs";
import { FLAT_STEP_DEG, roomOutline } from "./flatten";
import { dist, polygonArea, signedArea, sub, unit } from "./geometry";

/**
 * Keeping curves through edits that cut rooms up. Combining, splitting,
 * Fill room, trimming and the upper-floor tools all cut outlines with
 * straight-line polygon math, so they run on flattened outlines (each curve
 * as short straight pieces). `refitArcs` then finds runs of corners lying on
 * one of the curves that went in and turns each run back into one curved edge.
 */

/** Every curve among these rooms and walls, as arcs. */
export function curvesOf(rooms: Pick<PlanRoom, "polygon" | "bulges">[], walls: Pick<PlanWall, "a" | "b" | "bulge">[] = []): Arc[] {
  const out: Arc[] = [];
  for (const r of rooms) r.polygon.forEach((_, i) => { const a = roomEdgeArc(r, i); if (a) out.push(a); });
  for (const w of walls) { const a = wallArc(w); if (a) out.push(a); }
  return out;
}

/** A room's outline with its curves as short straight pieces, for cutting with polygon math. The corners themselves when nothing is curved. */
export const cutOutline = (room: Pick<PlanRoom, "polygon" | "bulges">): Point[] => roomOutline(room, FLAT_STEP_DEG);

type Circle = { center: Point; radius: number; arcs: Arc[] };

function circlesOf(arcs: Arc[]): Circle[] {
  const out: Circle[] = [];
  for (const a of arcs) {
    const c = out.find((x) => dist(x.center, a.center) < 0.5 && Math.abs(x.radius - a.radius) < 0.5);
    if (c) c.arcs.push(a);
    else out.push({ center: a.center, radius: a.radius, arcs: [a] });
  }
  return out;
}

const tolOf = (c: Circle) => Math.max(0.5, c.radius * 0.002);
const angleAt = (c: Circle, p: Point) => Math.atan2(p.y - c.center.y, p.x - c.center.x);

/** Whether a point at this angle around the circle is on one of its arcs (with a little slack at the ends). */
function inSpan(c: Circle, ang: number): boolean {
  return c.arcs.some((arc) => {
    const slack = 1 / arc.radius;
    const u = angleAlong(arc, ang);
    return u <= Math.abs(arc.sweep) + slack || u >= Math.PI * 2 - slack;
  });
}

/** Signed angle from one point to another around a circle, the short way. */
function turn(c: Circle, p: Point, q: Point): number {
  let d = angleAt(c, q) - angleAt(c, p);
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Which circle (index) the straight edge p-q is a short piece of, or -1. */
function edgeCircle(circles: Circle[], p: Point, q: Point): number {
  for (let k = 0; k < circles.length; k++) {
    const c = circles[k];
    const tol = tolOf(c);
    if (Math.abs(dist(p, c.center) - c.radius) > tol || Math.abs(dist(q, c.center) - c.radius) > tol) continue;
    const phi = Math.abs(turn(c, p, q));
    // A piece no further off the curve than flattening (or tidying the outline) leaves it.
    const sag = c.radius * (1 - Math.cos(phi / 2));
    if (phi < 1e-6 || sag > Math.max(0.75, c.radius * (1 - Math.cos((3.5 * Math.PI) / 180)))) continue;
    if (!inSpan(c, angleAt(c, p) + turn(c, p, q) / 2)) continue;
    return k;
  }
  return -1;
}

/** The bulge (left of p→q) of the arc on circle c from p to q that turns `phi` radians. */
function bulgeFor(c: Circle, p: Point, q: Point, phi: number): number {
  const h = Math.min(c.radius, dist(p, q) / 2);
  const off = Math.sqrt(Math.max(0, c.radius * c.radius - h * h));
  const s = Math.abs(phi) > Math.PI ? c.radius + off : c.radius - off;
  return Math.sign(phi) * s;
}

/**
 * Turn runs of corners that lie on one of these curves back into single
 * curved edges. `poly` is a cut-up outline, running clockwise (as rooms do).
 * Returns the corners left and each edge's bulge (out of the room is positive);
 * when nothing fits, the outline comes back as it is with no bulges.
 */
export function refitArcs(poly: Point[], arcs: Arc[]): { polygon: Point[]; bulges?: number[] } {
  const n = poly.length;
  const circles = circlesOf(arcs);
  if (!circles.length || n < 3) return { polygon: poly };
  const on = poly.map((p, i) => edgeCircle(circles, p, poly[(i + 1) % n]));
  if (on.every((k) => k < 0)) return { polygon: poly };

  // Runs of edges on the same circle, starting where a run begins (so none wraps past the end).
  let start = on.findIndex((k, i) => k !== on[(i - 1 + n) % n]);
  const whole = start < 0;
  if (whole) start = 0;
  type Run = { from: number; edges: number; circle: number };
  const runs: Run[] = [];
  for (let s = 0; s < n; ) {
    const i = (start + s) % n;
    let len = 1;
    while (s + len < n && on[(start + s + len) % n] === on[i]) len++;
    runs.push({ from: i, edges: len, circle: on[i] });
    s += len;
  }

  // Split curved runs that turn past a half circle (a whole round room becomes quarters).
  const pieces: Run[] = [];
  for (const r of runs) {
    if (r.circle < 0) {
      pieces.push(r);
      continue;
    }
    const c = circles[r.circle];
    let total = 0;
    for (let k = 0; k < r.edges; k++) total += Math.abs(turn(c, poly[(r.from + k) % n], poly[(r.from + k + 1) % n]));
    const parts = Math.min(r.edges, whole ? Math.max(4, Math.ceil(total / Math.PI - 0.01)) : Math.ceil(total / (Math.PI + 0.02)));
    pieces.push(...splitRun(r, Math.max(1, parts)));
  }

  for (let tries = 0; tries < 6; tries++) {
    const out = build(poly, circles, pieces);
    if (out) return out;
    // Didn't come out right (too few corners, or the shape turned inside out): split the longest curve and try again.
    const longest = pieces.filter((p) => p.circle >= 0 && p.edges > 1).sort((a, b) => b.edges - a.edges)[0];
    if (!longest) break;
    pieces.splice(pieces.indexOf(longest), 1, ...splitRun(longest, 2));
  }
  return { polygon: poly };
}

function splitRun(r: { from: number; edges: number; circle: number }, parts: number) {
  const out: { from: number; edges: number; circle: number }[] = [];
  let used = 0;
  for (let k = 0; k < parts; k++) {
    const take = Math.round(((k + 1) * r.edges) / parts) - used;
    if (take > 0) out.push({ from: r.from + used, edges: take, circle: r.circle });
    used += take;
  }
  return out;
}

function build(poly: Point[], circles: Circle[], pieces: { from: number; edges: number; circle: number }[]): { polygon: Point[]; bulges?: number[] } | null {
  const n = poly.length;
  const polygon: Point[] = [];
  const bulges: number[] = [];
  for (const r of pieces) {
    if (r.circle < 0) {
      for (let k = 0; k < r.edges; k++) {
        polygon.push(poly[(r.from + k) % n]);
        bulges.push(0);
      }
      continue;
    }
    const c = circles[r.circle];
    const p = poly[r.from % n];
    const q = poly[(r.from + r.edges) % n];
    let phi = 0;
    for (let k = 0; k < r.edges; k++) phi += turn(c, poly[(r.from + k) % n], poly[(r.from + k + 1) % n]);
    polygon.push(p);
    bulges.push(bulgeFor(c, p, q, phi));
  }
  if (polygon.length < 3 || signedArea(polygon) <= 0) return null;
  const tidy = tidyBulges(bulges, polygon.length);
  const room = { polygon, bulges: tidy };
  // The curved outline has to cover the same floor as the cut-up one.
  const want = polygonArea(poly);
  if (Math.abs(roomArea(room) - want) > Math.max(4, want * 0.01)) return null;
  return tidy ? { polygon, bulges: tidy } : { polygon };
}

/** A room made from a cut-up outline, with its curves put back (the outline must run clockwise). */
export function refitRoom<R extends PlanRoom>(room: R, poly: Point[], arcs: Arc[]): R {
  const { polygon, bulges } = refitArcs(poly, arcs);
  const { bulges: _old, ...rest } = room;
  void _old;
  return (bulges ? { ...rest, polygon, bulges } : { ...rest, polygon }) as R;
}

/** Where a point lands on a room's walls: the nearest edge, inches along it (along the curve when curved), how far off, and which way the wall runs there. */
export function nearestEdge(room: Pick<PlanRoom, "polygon" | "bulges">, p: Point): { edge: number; t: number; d: number; length: number; u: Point } | null {
  let best: { edge: number; t: number; d: number; length: number; u: Point } | null = null;
  const n = room.polygon.length;
  const out = signedArea(room.polygon) >= 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const a = room.polygon[i];
    const b = room.polygon[(i + 1) % n];
    const left = (room.bulges?.[i] ?? 0) * out;
    const pr = projectOnEdge(p, a, b, left);
    if (best && pr.d >= best.d) continue;
    best = { edge: i, t: pr.t, d: pr.d, length: pr.length, u: edgeDirection(a, b, left, pr.point) };
  }
  return best;
}

/** Which way an edge from a to b (with this left bulge) runs at a point on it. */
export function edgeDirection(a: Point, b: Point, left: number, at: Point): Point {
  const arc = isCurved(left) ? arcBetween(a, b, left) : null;
  if (!arc) return unit(sub(b, a));
  const r = unit(sub(at, arc.center));
  return arc.sweep >= 0 ? { x: -r.y, y: r.x } : { x: r.y, y: -r.x };
}

/** Whether a plan has any curved room edges or walls among these rooms (or any at all). */
export const anyCurves = (plan: FloorPlan, ids?: string[]): boolean =>
  plan.rooms.some((r) => (!ids || ids.includes(r.id)) && r.bulges?.some((b) => isCurved(b))) || plan.walls.some((w) => isCurved(w.bulge));
