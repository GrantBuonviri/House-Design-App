import type { Point } from "@/lib/model/schema";
import { dist } from "@/lib/plan/geometry";
import type { Plans } from "@/lib/plan/edit";
import { openingGeometries } from "@/lib/plan/walls";
import type { LevelHeights } from "./levels";

/**
 * The walkthrough's tape measure: a point in the house is a spot on the plan
 * (x east, y south, inches) and a height z in inches above the main floor.
 * Pure math for snapping and reading a measurement; drawn by components/walk/TapeMeasure.tsx.
 */

export type TapePoint = { x: number; y: number; z: number };
export type Tape = { a: TapePoint; b: TapePoint };

/** How close a click has to be to a corner or door/window edge to snap to it. */
export const SNAP_IN = 3;
/** The tape keeps this many finished measurements. */
export const TAPE_KEEP = 5;

export type Reading = { length: number; level: number; height: number };

/** Straight-line length, plus the level (along the floor) and height (up and down) parts. */
export function reading(t: Tape): Reading {
  const level = dist({ x: t.a.x, y: t.a.y }, { x: t.b.x, y: t.b.y });
  const height = Math.abs(t.b.z - t.a.z);
  return { length: Math.hypot(level, height), level, height };
}

/** Which parts of a reading get their own small label: both parts, when each is more than an inch. */
export function showParts(r: Reading): boolean {
  return r.level > 1 && r.height > 1;
}

/** Shift: make the second point level with the first, or straight above or below it, whichever is closer to where you aimed. */
export function lockAxis(a: TapePoint, b: TapePoint): TapePoint {
  const level = dist(a, b);
  const height = Math.abs(b.z - a.z);
  return height > level ? { x: a.x, y: a.y, z: b.z } : { x: b.x, y: b.y, z: a.z };
}

/** Corners and door/window edges you can snap to. */
export function tapeCandidates(plans: Plans, heights: LevelHeights, levelIds: string[]): TapePoint[] {
  const out: TapePoint[] = [];
  for (const id of levelIds) {
    const plan = plans[id];
    const h = heights[id];
    if (!plan || !h) continue;
    const bottom = h.floorIn;
    const top = h.floorIn + h.ceilingIn;
    for (const r of plan.rooms) {
      for (const p of r.polygon) {
        out.push({ x: p.x, y: p.y, z: bottom }, { x: p.x, y: p.y, z: top });
      }
    }
    for (const g of openingGeometries(plan)) {
      const o = g.opening;
      const sill = bottom + (o.kind === "window" ? (o.sillIn ?? 36) : 0);
      const head = sill + o.heightIn;
      for (const p of [g.a, g.b] as Point[]) out.push({ x: p.x, y: p.y, z: sill }, { x: p.x, y: p.y, z: head });
    }
  }
  return out;
}

/** The nearest corner or opening edge within `SNAP_IN` of a point, else the point itself. */
export function snap(p: TapePoint, candidates: TapePoint[]): TapePoint {
  let best: TapePoint | null = null;
  let bestD = SNAP_IN;
  for (const c of candidates) {
    const d = Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z);
    if (d <= bestD) {
      best = c;
      bestD = d;
    }
  }
  return best ?? p;
}

export type TapePin = { id: string; a: TapePoint; b: TapePoint };

/** How close (screen pixels) the aim dot has to be to a pin to point at it. */
export const PIN_AIM_PX = 12;

type View = { eye: TapePoint; dir: TapePoint; fovDeg: number; width: number; height: number };

/** A spot in the house on screen (pixels from the center, y up) and how far in front of the eye it is; null if it is behind. */
export function toScreen(p: TapePoint, v: View): { x: number; y: number; depth: number } | null {
  const c = Math.hypot(v.dir.x, v.dir.y);
  const right = c < 1e-6 ? { x: 1, y: 0, z: 0 } : { x: -v.dir.y / c, y: v.dir.x / c, z: 0 };
  const up = c < 1e-6 ? { x: 0, y: -1, z: 0 } : { x: (-v.dir.z * v.dir.x) / c, y: (-v.dir.z * v.dir.y) / c, z: c };
  const d = { x: p.x - v.eye.x, y: p.y - v.eye.y, z: p.z - v.eye.z };
  const depth = d.x * v.dir.x + d.y * v.dir.y + d.z * v.dir.z;
  if (depth < 1) return null;
  const f = v.height / 2 / Math.tan((v.fovDeg * Math.PI) / 360);
  return { x: (f * (d.x * right.x + d.y * right.y)) / depth, y: (f * (d.x * up.x + d.y * up.y + d.z * up.z)) / depth, depth };
}

/** Screen distance from the aim dot (the center) to a pin's line or its label (at the middle); Infinity when it is all behind you. */
export function pinScreenDistance(pin: { a: TapePoint; b: TapePoint }, v: View): number {
  const lerp = (t: number): TapePoint => ({ x: pin.a.x + (pin.b.x - pin.a.x) * t, y: pin.a.y + (pin.b.y - pin.a.y) * t, z: pin.a.z + (pin.b.z - pin.a.z) * t });
  // Cut the line at the near plane so a pin partly behind you still counts.
  const depthAt = (t: number) => {
    const q = lerp(t);
    return (q.x - v.eye.x) * v.dir.x + (q.y - v.eye.y) * v.dir.y + (q.z - v.eye.z) * v.dir.z;
  };
  const da = depthAt(0);
  const db = depthAt(1);
  if (da < 1 && db < 1) return Infinity;
  let t0 = 0;
  let t1 = 1;
  if (da < 1) t0 = (1 - da) / (db - da);
  if (db < 1) t1 = (da - 1) / (da - db);
  const s0 = toScreen(lerp(t0), v);
  const s1 = toScreen(lerp(t1), v);
  if (!s0 || !s1) return Infinity;
  const dx = s1.x - s0.x;
  const dy = s1.y - s0.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 < 1e-9 ? 0 : Math.max(0, Math.min(1, -(s0.x * dx + s0.y * dy) / len2));
  const line = Math.hypot(s0.x + dx * t, s0.y + dy * t);
  const mid = toScreen(lerp(0.5), v);
  return Math.min(line, mid ? Math.hypot(mid.x, mid.y) : Infinity);
}

/** The pin the aim dot is on, if any: the nearest within `PIN_AIM_PX`, skipping any that `hidden` says are behind a wall. */
export function pinUnderDot(pins: TapePin[], v: View, hidden: (pin: TapePin) => boolean = () => false, maxPx = PIN_AIM_PX): TapePin | null {
  let best: TapePin | null = null;
  let bestD = maxPx;
  for (const p of pins) {
    const d = pinScreenDistance(p, v);
    if (d <= bestD && !hidden(p)) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

/** Pin the finished measurement at `index` (the newest by default): it leaves `done` and joins the saved pins. */
export function pinMeasurement(done: Tape[], pins: TapePin[], id: string, index = done.length - 1): { done: Tape[]; pins: TapePin[] } {
  const t = done[index];
  if (!t) return { done, pins };
  return { done: done.filter((_, i) => i !== index), pins: [...pins, { id, a: t.a, b: t.b }] };
}
