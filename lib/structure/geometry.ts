import type { Point } from "@/lib/model/schema";
import { subtractRegions, type Region } from "@/lib/house3d/footprint";
import { boundsOf, dist, pointInPolygon, sub, unit, type Bounds } from "@/lib/plan/geometry";

/**
 * Shared geometry for the structure: plan shapes cut into strips along one
 * axis, the way joists and trusses run across a house.
 */

/** The direction joists or trusses run: along x (east-west) or y (north-south). */
export type Axis = "x" | "y";

export const other = (a: Axis): Axis => (a === "x" ? "y" : "x");
/** A point's coordinate along an axis. */
export const along = (p: Point, a: Axis) => (a === "x" ? p.x : p.y);
/** A plan point from a coordinate along an axis and one across it. */
export const pt = (a: Axis, s: number, w: number): Point => (a === "x" ? { x: s, y: w } : { x: w, y: s });

export function regionBounds(regions: Region[]): Bounds | null {
  return boundsOf(regions.flatMap((r) => r.outline));
}

/** Where a line across the regions is inside them: [start, end] pairs along `axis`, at `w` across it. */
export function lineIntervals(regions: Region[], axis: Axis, w: number): [number, number][] {
  const xs: number[] = [];
  const cross = other(axis);
  for (const r of regions) {
    for (const ring of [r.outline, ...r.holes]) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        const wa = along(a, cross);
        const wb = along(b, cross);
        if (wa === wb || w < Math.min(wa, wb) || w >= Math.max(wa, wb)) continue;
        const t = (w - wa) / (wb - wa);
        xs.push(along(a, axis) + t * (along(b, axis) - along(a, axis)));
      }
    }
  }
  xs.sort((p, q) => p - q);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > 1) out.push([xs[i], xs[i + 1]]);
  return out;
}

/** Strip positions across the regions, about every `step` inches, nudged off round numbers so they miss corners. */
export function stripPositions(regions: Region[], axis: Axis, step = 12): number[] {
  const b = regionBounds(regions);
  if (!b) return [];
  const cross = other(axis);
  const w0 = cross === "x" ? b.x0 : b.y0;
  const w1 = cross === "x" ? b.x1 : b.y1;
  const out: number[] = [];
  for (let w = w0 + step / 2 + 0.37; w < w1; w += step) out.push(w);
  return out;
}

export function intersectRegions(a: Region[], b: Region[]): Region[] {
  if (!a.length || !b.length) return [];
  return subtractRegions(a, subtractRegions(a, b));
}

export function insideRegions(regions: Region[], p: Point): boolean {
  return regions.some((r) => pointInPolygon(p, r.outline) && !r.holes.some((h) => pointInPolygon(p, h)));
}

/** A straight plan segment, and whether it runs across an axis (perpendicular to it, within 10°). */
export function runsAcross(a: Point, b: Point, axis: Axis): boolean {
  if (dist(a, b) < 1) return false;
  const u = unit(sub(b, a));
  return Math.abs(axis === "x" ? u.x : u.y) < 0.17;
}
