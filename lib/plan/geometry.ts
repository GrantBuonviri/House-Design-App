import type { Point } from "@/lib/model/schema";

/**
 * Small geometry helpers for the floor plan. Everything is in inches, x east
 * and y south, the same as the flow sketch.
 */

export const FT = 12;
export const SQ_IN_PER_SQ_FT = 144;

export const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
export const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
export const len = (a: Point) => Math.hypot(a.x, a.y);
export const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export function unit(a: Point): Point {
  const l = len(a);
  return l ? { x: a.x / l, y: a.y / l } : { x: 1, y: 0 };
}

/** The left-hand normal of a direction, walking along it (with y pointing south, "left" is counter-clockwise on screen). */
export const leftNormal = (d: Point): Point => ({ x: d.y, y: -d.x });

/** Round to the nearest tenth of an inch, so saved numbers stay short. */
export const round1 = (n: number) => Math.round(n * 10) / 10;
export const roundPoint = (p: Point): Point => ({ x: round1(p.x), y: round1(p.y) });

export function rotate(p: Point, deg: number, about: Point = { x: 0, y: 0 }): Point {
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const x = p.x - about.x;
  const y = p.y - about.y;
  return { x: about.x + x * c - y * s, y: about.y + x * s + y * c };
}

/** Signed area: positive when the corners go clockwise on screen (y south). */
export function signedArea(poly: Point[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export function polygonArea(poly: Point[]): number {
  return Math.abs(signedArea(poly));
}

/** The area-weighted middle of a polygon (falls back to the corner average for slivers). */
export function polygonCenter(poly: Point[]): Point {
  const a = signedArea(poly);
  if (Math.abs(a) < 1e-6) return { x: poly.reduce((s, p) => s + p.x, 0) / poly.length, y: poly.reduce((s, p) => s + p.y, 0) / poly.length };
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export type Bounds = { x0: number; y0: number; x1: number; y1: number };

export function boundsOf(points: Point[]): Bounds | null {
  if (!points.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x0, y0, x1, y1 };
}

export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Where p lands on the line through a and b: t is inches from a, d is the distance off the segment. */
export function project(p: Point, a: Point, b: Point): { t: number; d: number; length: number; point: Point } {
  const length = dist(a, b);
  const u = unit(sub(b, a));
  const t = Math.max(0, Math.min(length, dot(sub(p, a), u)));
  const point = add(a, scale(u, t));
  return { t, d: dist(p, point), length, point };
}

export function edgesOf(poly: Point[]): { a: Point; b: Point; i: number }[] {
  return poly.map((a, i) => ({ a, b: poly[(i + 1) % poly.length], i }));
}

/**
 * Where segment (c, d) lies along segment (a, b), when the two are on the
 * same line (within `tolerance` inches): the interval in inches from a, or
 * null when they aren't on one line or don't overlap.
 */
export function collinearOverlap(a: Point, b: Point, c: Point, d: Point, tolerance = 1): [number, number] | null {
  const L = dist(a, b);
  if (L < 1e-6) return null;
  const u = unit(sub(b, a));
  const n = leftNormal(u);
  const off = (p: Point) => dot(sub(p, a), n);
  if (Math.abs(off(c)) > tolerance || Math.abs(off(d)) > tolerance) return null;
  const tc = dot(sub(c, a), u);
  const td = dot(sub(d, a), u);
  const t0 = Math.max(0, Math.min(tc, td));
  const t1 = Math.min(L, Math.max(tc, td));
  return t1 - t0 > tolerance ? [t0, t1] : null;
}

/** Take intervals away from [0, length]; what's left, in order. */
export function subtractIntervals(length: number, cuts: [number, number][]): [number, number][] {
  const sorted = cuts.map(([a, b]) => [Math.max(0, Math.min(a, b)), Math.min(length, Math.max(a, b))] as [number, number]).sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  let at = 0;
  for (const [a, b] of sorted) {
    if (a > at) out.push([at, a]);
    at = Math.max(at, b);
  }
  if (at < length) out.push([at, length]);
  return out.filter(([a, b]) => b - a > 0.01);
}

/** A rectangle's corners, clockwise on screen from the top-left, around a middle point. */
export function rectangle(cx: number, cy: number, w: number, h: number, rotation = 0): Point[] {
  const c = { x: cx, y: cy };
  return [
    { x: cx - w / 2, y: cy - h / 2 },
    { x: cx + w / 2, y: cy - h / 2 },
    { x: cx + w / 2, y: cy + h / 2 },
    { x: cx - w / 2, y: cy + h / 2 },
  ].map((p) => (rotation ? rotate(p, rotation, c) : p));
}

/** Four corners at right angles (any direction). */
export function isRectangle(poly: Point[], tolerance = 0.5): boolean {
  if (poly.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % 4];
    const c = poly[(i + 2) % 4];
    const u = unit(sub(b, a));
    const v = unit(sub(c, b));
    if (Math.abs(dot(u, v)) > Math.sin((tolerance * Math.PI) / 180) + 1e-9) return false;
  }
  return true;
}

/** Make the corners go clockwise on screen, so "left of an edge" is always outside. */
export function clockwise(poly: Point[]): Point[] {
  return signedArea(poly) < 0 ? [...poly].reverse() : poly;
}

/** Angle of a direction in degrees, clockwise from east (screen convention). */
export function angleOf(d: Point): number {
  return (Math.atan2(d.y, d.x) * 180) / Math.PI;
}

/** Snap a point's direction from `from` to the nearest 45°, keeping its distance. */
export function snapAngle(from: Point, p: Point, stepDeg = 45): Point {
  const d = sub(p, from);
  const l = len(d);
  if (!l) return p;
  const a = Math.round(angleOf(d) / stepDeg) * stepDeg * (Math.PI / 180);
  return { x: from.x + Math.cos(a) * l, y: from.y + Math.sin(a) * l };
}

/** Do two polygons overlap by more than a sliver? Checks corners inside and crossing edges. */
export function polygonsOverlap(p: Point[], q: Point[], inset = 1): boolean {
  const shrink = (poly: Point[]) => {
    const c = polygonCenter(poly);
    return poly.map((v) => {
      const d = sub(v, c);
      const l = len(d);
      return l > inset ? add(c, scale(d, (l - inset) / l)) : c;
    });
  };
  const a = shrink(p);
  const b = shrink(q);
  if (a.some((v) => pointInPolygon(v, b)) || b.some((v) => pointInPolygon(v, a))) return true;
  for (const e of edgesOf(a)) for (const f of edgesOf(b)) if (segmentsCross(e.a, e.b, f.a, f.b)) return true;
  return false;
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = cross(sub(b, a), sub(c, a));
  const d2 = cross(sub(b, a), sub(d, a));
  const d3 = cross(sub(d, c), sub(a, c));
  const d4 = cross(sub(d, c), sub(b, c));
  return d1 * d2 < 0 && d3 * d4 < 0;
}
