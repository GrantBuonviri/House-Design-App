import type { FloorPlan, Opening, Point } from "@/lib/model/schema";
import { pointOnEdge } from "./arcs";
import { dist, sub, unit } from "./geometry";
import type { Guide } from "./labels";
import { clampOffset, hostSegment, sameHost, wallPieces, type HostSegment } from "./walls";

/**
 * How far a door or window sits from the nearest corner of its wall. A corner
 * is anywhere another wall meets this one: the two ends, or partway along
 * where an inside wall runs into it (a T). The distance runs from the face of
 * that wall to the near edge of the opening, the way a framer measures it.
 */

/** A corner along a wall: `t` inches from the wall's start (along the curve, for a curved wall), and half the meeting wall's thickness. */
export type WallCorner = { t: number; half: number };

export type CornerDistance = {
  inches: number;
  /** Which way along the wall the corner is from the opening. */
  side: "start" | "end";
  /** The wall face and the opening's edge, for drawing the guide. */
  from: Point;
  to: Point;
};

/** How close (inches) a meeting wall's end has to be to this wall's line to count as a corner. */
const TOUCH_IN = 3;
/** Walls closer to parallel than this (sine of the angle) are the same wall carrying on, not a corner. */
const PARALLEL = 0.2;

const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;

/** Every corner along a wall, sorted from its start. The two ends always count. */
export function wallCorners(plan: FloorPlan, seg: HostSegment, exteriorIn: number): WallCorner[] {
  const u = unit(sub(seg.b, seg.a));
  const ends: WallCorner[] = [
    { t: 0, half: 0 },
    { t: seg.length, half: 0 },
  ];
  const mid: WallCorner[] = [];
  for (const p of wallPieces(plan, exteriorIn)) {
    if (p.open || p.thicknessIn <= 0 || sameHost(p.host, seg.host)) continue;
    const pu = unit(sub(p.b, p.a));
    if (Math.abs(cross(u, pu)) < PARALLEL) continue;
    const half = p.thicknessIn / 2;
    for (const end of [p.a, p.b]) {
      if (dist(end, seg.a) <= TOUCH_IN) ends[0].half = Math.max(ends[0].half, half);
      else if (dist(end, seg.b) <= TOUCH_IN) ends[1].half = Math.max(ends[1].half, half);
      else if (!seg.bulge) {
        // Partway along a straight wall: a wall running into it.
        const v = sub(end, seg.a);
        const t = v.x * u.x + v.y * u.y;
        if (t > 0 && t < seg.length && Math.abs(cross(u, v)) <= TOUCH_IN) mid.push({ t, half });
      }
    }
  }
  // Walls meeting at one spot (from both sides, or two rooms' corners) are one corner.
  const out: WallCorner[] = [];
  for (const c of [...ends, ...mid].sort((a, b) => a.t - b.t)) {
    const last = out.at(-1);
    if (last && c.t - last.t <= 1) last.half = Math.max(last.half, c.half);
    else out.push({ ...c });
  }
  return out;
}

/** The opening's edges along its wall and the nearest corner face on each side (null when the opening covers it). */
function sides(plan: FloorPlan, o: Opening, exteriorIn: number) {
  const seg = hostSegment(plan, o.host);
  if (!seg || seg.length < 1) return null;
  const lo = o.offsetIn - o.widthIn / 2;
  const hi = o.offsetIn + o.widthIn / 2;
  const corners = wallCorners(plan, seg, exteriorIn);
  const before = corners.filter((c) => c.t <= lo + 0.5).at(-1);
  const after = corners.find((c) => c.t >= hi - 0.5);
  const at = (t: number) => pointOnEdge(seg.a, seg.b, seg.bulge ?? 0, Math.max(0, Math.min(seg.length, t)));
  const start: CornerDistance | null = before ? { side: "start", inches: lo - (before.t + before.half), from: at(before.t + before.half), to: at(lo) } : null;
  const end: CornerDistance | null = after ? { side: "end", inches: after.t - after.half - hi, from: at(hi), to: at(after.t - after.half) } : null;
  return { seg, start, end };
}

/** The distance to the nearest corner on each side of a door or window. */
export function cornerDistances(plan: FloorPlan, o: Opening, exteriorIn: number): CornerDistance[] {
  const s = sides(plan, o, exteriorIn);
  return s ? [s.start, s.end].filter((d): d is CornerDistance => d !== null) : [];
}

/** The distance to the nearest corner, or null when the opening isn't on a wall. */
export function nearestCorner(plan: FloorPlan, o: Opening, exteriorIn: number): CornerDistance | null {
  const all = cornerDistances(plan, o, exteriorIn);
  return all.length ? all.reduce((a, b) => (Math.abs(b.inches) < Math.abs(a.inches) ? b : a)) : null;
}

/**
 * Slide a door or window along its wall so it sits `inches` from the corner
 * on `side` (the nearest one when left out). It stays on the wall: a distance
 * too big for the wall stops at the far end.
 */
export function setCornerDistance(plan: FloorPlan, id: string, inches: number, exteriorIn: number, side?: "start" | "end"): FloorPlan {
  const o = plan.openings.find((x) => x.id === id);
  if (!o) return plan;
  const s = sides(plan, o, exteriorIn);
  const which = side ?? nearestCorner(plan, o, exteriorIn)?.side;
  if (!s || !which) return plan;
  const d = which === "start" ? s.start : s.end;
  if (!d) return plan;
  // Move by the difference, so the corner face stays the one measured from.
  const shift = (inches - d.inches) * (which === "start" ? 1 : -1);
  const offsetIn = Math.round(clampOffset(o.offsetIn + shift, o.widthIn, s.seg.length) * 4) / 4;
  return offsetIn === o.offsetIn ? plan : { ...plan, openings: plan.openings.map((x) => (x.id === id ? { ...x, offsetIn } : x)) };
}

/** The guides drawn while dragging a door or window: the gap to the corner on each side, the nearest one marked. */
export function cornerGuides(plan: FloorPlan, o: Opening, exteriorIn: number): Guide[] {
  const all = cornerDistances(plan, o, exteriorIn);
  const near = nearestCorner(plan, o, exteriorIn);
  return all.filter((d) => d.inches > 0.5).map((d) => ({ from: d.from, to: d.to, inches: d.inches, ...(d.side === near?.side ? { note: "to corner" } : {}) }));
}
