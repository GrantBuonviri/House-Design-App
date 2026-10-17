import polygonClipping, { type Polygon } from "polygon-clipping";
import type { FloorPlan, PlanRoom, Point } from "@/lib/model/schema";
import { cleanRing } from "@/lib/house3d/footprint";
import { reshapeRoom, moveMany } from "./edit";
import { add, clockwise, dist, dot, edgesOf, leftNormal, len, polygonArea, polygonsOverlap, scale, sub, unit } from "./geometry";
import { curvesOf, cutOutline, refitArcs } from "./refit";
import { lockedIds } from "./locks";

/**
 * Fixing rooms that were dropped on top of each other (`trimOverlap`) or left
 * a few inches apart (`findGaps`, `closeGap`).
 */

/** Rooms closer than this (inches) with a gap between them get a "Close gap" fix. */
export const MAX_GAP_IN = 6;
/** Below this the gap is just rounding, not worth a warning. */
const MIN_GAP_IN = 0.5;
/** Two walls have to face each other along at least this much (inches) to count as a gap. */
const MIN_FACING_IN = 12;
/** A trimmed room smaller than this (sq in) isn't a room any more: leave the overlap alone. */
const MIN_LEFT_SQIN = 24 * 24;

const ring = (poly: Point[]): Polygon => [[...poly.map((p): [number, number] => [p.x, p.y]), [poly[0].x, poly[0].y]]];

/** The room with another room's footprint cut away, as one clean outline. Null when that can't be done cleanly. */
function cutAway(room: Point[], by: Point[]): Point[] | null {
  const out = polygonClipping.difference(ring(room), ring(by));
  if (out.length !== 1 || out[0].length !== 1) return null;
  const pts = out[0][0].slice(0, -1).map(([x, y]) => ({ x, y }));
  const clean = cleanRing(pts, 0.25);
  if (clean.length < 3 || polygonArea(clean) < MIN_LEFT_SQIN) return null;
  return clean;
}

export type Trim = { roomId: string; byId: string };

/**
 * After rooms were moved, trim every room that wasn't moved back to the edge
 * of the ones that were, so they share one wall. Overlaps that can't be fixed
 * cleanly (a room left in two pieces, or nothing of it left) stay as they are.
 * An anchored stair hall isn't trimmed: a room moved onto it is cut back to
 * the hall's wall instead.
 */
export function trimOverlap(plan: FloorPlan, movedIds: string[]): { plan: FloorPlan; trims: Trim[] } {
  const locked = lockedIds(plan);
  const moved = plan.rooms.filter((r) => movedIds.includes(r.id));
  const movedOutlines = moved.map(cutOutline);
  let next = plan;
  const trims: Trim[] = [];
  for (const room of plan.rooms) {
    if (movedIds.includes(room.id)) continue;
    if (locked.has(room.id)) {
      // The rooms that moved onto it stop at its wall.
      const hall = cutOutline(room);
      for (const m of moved) {
        if (locked.has(m.id)) continue;
        const now = next.rooms.find((r) => r.id === m.id)!;
        const outline = cutOutline(now);
        if (!polygonsOverlap(outline, hall)) continue;
        const cut = cutAway(outline, hall);
        if (!cut) continue;
        const fit = refitArcs(clockwise(cut), curvesOf([now]));
        next = reshapeRoom(next, m.id, fit.polygon, fit.bulges ?? []);
        trims.push({ roomId: m.id, byId: room.id });
      }
      continue;
    }
    const whole = cutOutline(room);
    let poly: Point[] | null = whole;
    let by: PlanRoom | null = null;
    for (let k = 0; k < moved.length && poly; k++) {
      if (!polygonsOverlap(poly, movedOutlines[k])) continue;
      const cut: Point[] | null = cutAway(poly, movedOutlines[k]);
      if (!cut) by = null;
      else by = by ?? moved[k];
      poly = cut;
    }
    if (by && poly && poly !== whole) {
      // Curves on either room stay curved edges on what's left.
      const fit = refitArcs(clockwise(poly), curvesOf([room, ...moved]));
      next = reshapeRoom(next, room.id, fit.polygon, fit.bulges ?? []);
      trims.push({ roomId: room.id, byId: by.id });
    }
  }
  return { plan: next, trims };
}

export type Gap = {
  aId: string;
  bId: string;
  /** How far apart the facing walls are, inches. */
  gapIn: number;
  /** What it takes to push room b against room a. */
  dx: number;
  dy: number;
  /** The middle of the gap, to look at. */
  at: Point;
};

/** Pairs of rooms whose walls face each other a few inches apart, with nothing between them. */
export function findGaps(plan: FloorPlan): Gap[] {
  const out: Gap[] = [];
  for (let i = 0; i < plan.rooms.length; i++) {
    for (let j = i + 1; j < plan.rooms.length; j++) {
      const a = plan.rooms[i];
      const b = plan.rooms[j];
      let best: Gap | null = null;
      for (const e of edgesOf(a.polygon)) {
        const L = dist(e.a, e.b);
        if (L < MIN_FACING_IN) continue;
        const u = unit(sub(e.b, e.a));
        // Outlines run clockwise, so the left normal points out of the room.
        const n = leftNormal(u);
        for (const f of edgesOf(b.polygon)) {
          const v = unit(sub(f.b, f.a));
          // Walls facing each other run in opposite directions.
          if (Math.abs(dot(u, v) + 1) > 0.01) continue;
          const offA = dot(sub(f.a, e.a), n);
          const offB = dot(sub(f.b, e.a), n);
          if (Math.abs(offA - offB) > 0.5) continue;
          const d = (offA + offB) / 2;
          // b's wall has to be outside a's wall, a few inches off.
          if (d < MIN_GAP_IN || d > MAX_GAP_IN) continue;
          const ta = dot(sub(f.a, e.a), u);
          const tb = dot(sub(f.b, e.a), u);
          const lo = Math.max(0, Math.min(ta, tb));
          const hi = Math.min(L, Math.max(ta, tb));
          if (hi - lo < MIN_FACING_IN) continue;
          const mid = add(add(e.a, scale(u, (lo + hi) / 2)), scale(n, d / 2));
          // Another room right in the gap means it isn't one.
          const probe = [{ x: mid.x - 0.5, y: mid.y - 0.5 }, { x: mid.x + 0.5, y: mid.y - 0.5 }, { x: mid.x + 0.5, y: mid.y + 0.5 }, { x: mid.x - 0.5, y: mid.y + 0.5 }];
          if (plan.rooms.some((r) => r.id !== a.id && r.id !== b.id && polygonsOverlap(r.polygon, probe, 0))) continue;
          if (!best || d < best.gapIn) best = { aId: a.id, bId: b.id, gapIn: Math.round(d * 10) / 10, dx: -n.x * d, dy: -n.y * d, at: mid };
        }
      }
      if (best) out.push(best);
    }
  }
  return out;
}

/** Push the smaller room of a gap against the other. */
export function closeGap(plan: FloorPlan, gap: Gap): FloorPlan {
  const a = plan.rooms.find((r) => r.id === gap.aId);
  const b = plan.rooms.find((r) => r.id === gap.bId);
  if (!a || !b || len({ x: gap.dx, y: gap.dy }) < 0.01) return plan;
  const locked = lockedIds(plan);
  if (locked.has(a.id) && locked.has(b.id)) return plan;
  // dx, dy move b toward a. When a is the smaller room, move a the other way instead (an anchored stair hall never moves).
  if (locked.has(b.id) || (!locked.has(a.id) && polygonArea(a.polygon) < polygonArea(b.polygon))) return moveMany(plan, [a.id], -gap.dx, -gap.dy);
  return moveMany(plan, [b.id], gap.dx, gap.dy);
}
