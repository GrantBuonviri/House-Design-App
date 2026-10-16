import type { FloorPlan, Point } from "@/lib/model/schema";
import { add, dot, edgesOf, leftNormal, project, scale, sub, unit } from "./geometry";

/**
 * Snapping while drawing and moving: to corners, to lining up with corners,
 * to walls, and to a 6" grid. Tolerances are in inches (the editor turns a
 * few screen pixels into inches at the current zoom).
 */

export const GRID_IN = 6;

export type Guides = { x?: number; y?: number };
export type Snapped = { p: Point; guides: Guides; on?: "corner" | "wall" | "grid" };

export type SnapTargets = { points: Point[]; segments: [Point, Point][] };

const roundTo = (n: number, step: number) => Math.round(n / step) * step;

/** Corners and walls to snap to, leaving out the given rooms and walls (the ones being changed). */
export function snapTargets(plan: FloorPlan, skip: string[] = []): SnapTargets {
  const points: Point[] = [];
  const segments: [Point, Point][] = [];
  for (const r of plan.rooms) {
    if (skip.includes(r.id)) continue;
    points.push(...r.polygon);
    for (const e of edgesOf(r.polygon)) segments.push([e.a, e.b]);
  }
  for (const w of plan.walls) {
    if (skip.includes(w.id)) continue;
    points.push(w.a, w.b);
    segments.push([w.a, w.b]);
  }
  return { points, segments };
}

/**
 * Snap a point: onto a corner, else line it up across and down with nearby
 * corners, else onto a wall, else to the grid (when it's on).
 */
export function snapPoint(p: Point, targets: SnapTargets, tolerance: number, grid: boolean): Snapped {
  let bestCorner: Point | null = null;
  let bestD = tolerance;
  for (const q of targets.points) {
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d <= bestD) {
      bestD = d;
      bestCorner = q;
    }
  }
  if (bestCorner) return { p: { ...bestCorner }, guides: {}, on: "corner" };

  let x: number | undefined;
  let y: number | undefined;
  let dx = tolerance;
  let dy = tolerance;
  for (const q of targets.points) {
    if (Math.abs(q.x - p.x) < dx) {
      dx = Math.abs(q.x - p.x);
      x = q.x;
    }
    if (Math.abs(q.y - p.y) < dy) {
      dy = Math.abs(q.y - p.y);
      y = q.y;
    }
  }
  if (x === undefined && y === undefined) {
    for (const [a, b] of targets.segments) {
      const pr = project(p, a, b);
      if (pr.d <= tolerance) return { p: pr.point, guides: {}, on: "wall" };
    }
  }
  const out = {
    x: x ?? (grid ? roundTo(p.x, GRID_IN) : p.x),
    y: y ?? (grid ? roundTo(p.y, GRID_IN) : p.y),
  };
  return { p: out, guides: { x, y }, on: x !== undefined || y !== undefined ? "corner" : grid ? "grid" : undefined };
}

/**
 * Pull a point onto the 90° and 45° lines running out of the given anchors
 * (a corner's neighbors). Near one line it slides onto it; near lines from
 * two anchors it lands where they cross. Returns null when nothing is close.
 */
export function snapAngles(p: Point, anchors: Point[], tolerance: number, stepDeg = 45): Point | null {
  const lines: { a: Point; d: Point; dist: number; q: Point }[] = [];
  for (const a of anchors) {
    let best: { a: Point; d: Point; dist: number; q: Point } | null = null;
    for (let deg = 0; deg < 180; deg += stepDeg) {
      const r = (deg * Math.PI) / 180;
      const d = { x: Math.cos(r), y: Math.sin(r) };
      const t = dot(sub(p, a), d);
      const q = add(a, scale(d, t));
      const dd = Math.hypot(q.x - p.x, q.y - p.y);
      if (dd <= tolerance && (!best || dd < best.dist)) best = { a, d, dist: dd, q };
    }
    if (best) lines.push(best);
  }
  if (!lines.length) return null;
  if (lines.length >= 2) {
    const [l1, l2] = lines.sort((x, y) => x.dist - y.dist);
    const cross = l1.d.x * l2.d.y - l1.d.y * l2.d.x;
    if (Math.abs(cross) > 1e-6) {
      const w = sub(l2.a, l1.a);
      const t = (w.x * l2.d.y - w.y * l2.d.x) / cross;
      const hit = add(l1.a, scale(l1.d, t));
      if (Math.hypot(hit.x - p.x, hit.y - p.y) <= tolerance * 2) return hit;
    }
  }
  return lines.sort((x, y) => x.dist - y.dist)[0].q;
}

/**
 * Snap a corner being placed or dragged: onto another corner, else onto a 90°
 * or 45° line from its neighbors (`anchors`), else the usual lining up, walls
 * and grid. `free` (Shift held) turns all snapping off.
 */
export function snapNode(p: Point, anchors: Point[], targets: SnapTargets, tolerance: number, grid: boolean, free: boolean): Snapped {
  if (free) return { p, guides: {} };
  const base = snapPoint(p, targets, tolerance, grid);
  if (base.on === "corner" && base.guides.x === undefined && base.guides.y === undefined) return base;
  const hit = snapAngles(p, anchors, tolerance);
  if (hit) {
    // Lining up with a still corner wins when the angle line already passes through it.
    const x = targets.points.find((q) => Math.abs(q.x - hit.x) < 0.5)?.x;
    const y = targets.points.find((q) => Math.abs(q.y - hit.y) < 0.5)?.y;
    return { p: hit, guides: { x, y }, on: "corner" };
  }
  return base;
}

/** Snap a point drawn from `from`; holding Shift turns snapping off, for any angle. */
export function snapFrom(from: Point | null, p: Point, targets: SnapTargets, tolerance: number, grid: boolean, shift: boolean, more: Point[] = []): Snapped {
  return snapNode(p, from ? [from, ...more] : more, targets, tolerance, grid, shift);
}

/**
 * Snap a move of several corners: the move is nudged so a moving corner
 * lines up with a still one (across, down, or both), or else is rounded to
 * the grid.
 */
export function snapMove(moving: Point[], still: Point[], dx: number, dy: number, tolerance: number, grid: boolean): { dx: number; dy: number; guides: Guides } {
  let bx: { d: number; adj: number; at: number } | null = null;
  let by: { d: number; adj: number; at: number } | null = null;
  for (const m of moving) {
    const mx = m.x + dx;
    const my = m.y + dy;
    for (const s of still) {
      const ex = s.x - mx;
      const ey = s.y - my;
      if (Math.abs(ex) <= tolerance && (!bx || Math.abs(ex) < bx.d)) bx = { d: Math.abs(ex), adj: ex, at: s.x };
      if (Math.abs(ey) <= tolerance && (!by || Math.abs(ey) < by.d)) by = { d: Math.abs(ey), adj: ey, at: s.y };
    }
  }
  return {
    dx: bx ? dx + bx.adj : grid ? roundTo(dx, GRID_IN) : dx,
    dy: by ? dy + by.adj : grid ? roundTo(dy, GRID_IN) : dy,
    guides: { x: bx?.at, y: by?.at },
  };
}

/**
 * How far to push a wall straight out (along its normal) for a drag that
 * moved `drag` inches: snapped so the wall lines up with a still corner, or
 * else to the grid.
 */
export function snapPush(a: Point, b: Point, drag: Point, still: Point[], tolerance: number, grid: boolean): { d: number; n: Point } {
  const n = leftNormal(unit(sub(b, a)));
  let d = dot(drag, n);
  let best: number | null = null;
  for (const s of still) {
    const along = dot(sub(s, a), n);
    if (Math.abs(along - d) <= tolerance && (best === null || Math.abs(along - d) < Math.abs(best - d))) best = along;
  }
  if (best !== null) d = best;
  else if (grid) d = roundTo(d, GRID_IN);
  return { d, n };
}

export const pushBy = (p: Point, n: Point, d: number) => add(p, scale(n, d));
