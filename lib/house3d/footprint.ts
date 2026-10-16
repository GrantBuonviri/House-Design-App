import polygonClipping, { type MultiPolygon, type Polygon } from "polygon-clipping";
import type { FloorPlan, Point } from "@/lib/model/schema";
import { areaKind } from "@/lib/plan/measure";
import { add, clockwise, dist, dot, leftNormal, polygonArea, scale, signedArea, sub, unit } from "@/lib/plan/geometry";
import { flatPlan } from "@/lib/plan/flatten";

/**
 * The outline of the house on each floor: all its rooms joined into one
 * shape (or a few, for a detached garage), measured to the middle of the
 * outside walls. Rooms that nearly touch (within an inch) count as touching.
 */

/** A shape with holes: its outline goes clockwise on screen, holes the other way. */
export type Region = { outline: Point[]; holes: Point[][] };

/** How far each room is grown before joining, so rooms an inch apart still join. */
const JOIN_IN = 1;

const toRing = (pts: Point[]): [number, number][] => {
  const r = pts.map((p) => [p.x, p.y] as [number, number]);
  return [...r, r[0]];
};
const fromRing = (r: [number, number][]): Point[] => r.slice(0, -1).map(([x, y]) => ({ x, y }));

function regionsOf(mp: MultiPolygon): Region[] {
  return mp
    .map((poly) => ({ outline: cleanRing(fromRing(poly[0])), holes: poly.slice(1).map((h) => cleanRing(fromRing(h))).filter((h) => h.length >= 3 && polygonArea(h) > 144 * 2) }))
    .filter((r) => r.outline.length >= 3 && polygonArea(r.outline) > 144);
}

const asPolygon = (r: Region): Polygon => [toRing(r.outline), ...r.holes.map(toRing)];

/** Drop corners that are doubled up or sit on a straight line between their neighbors. */
export function cleanRing(pts: Point[], tolerance = 0.25): Point[] {
  let ring = pts.filter((p, i) => dist(p, pts[(i + 1) % pts.length]) > tolerance);
  let changed = true;
  while (changed && ring.length > 3) {
    changed = false;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[(i - 1 + ring.length) % ring.length];
      const b = ring[i];
      const c = ring[(i + 1) % ring.length];
      const ab = dist(a, b);
      const bc = dist(b, c);
      // How far b sits off the line from a to c.
      const off = Math.abs((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / Math.max(dist(a, c), 1e-9);
      if (ab < tolerance || bc < tolerance || off < tolerance) {
        ring = ring.filter((_, k) => k !== i);
        changed = true;
        break;
      }
    }
  }
  return ring;
}

/**
 * Grow (or shrink, with a negative distance) a ring by `d` inches, keeping
 * one corner for each corner. Works on outlines (clockwise on screen) and on
 * holes (the other way): the region always grows. Very sharp corners are
 * clipped so they don't shoot off.
 */
export function offsetRing(ring: Point[], d: number): Point[] {
  const n = ring.length;
  const normals = ring.map((p, i) => leftNormal(unit(sub(ring[(i + 1) % n], p))));
  return ring.map((p, i) => {
    const n0 = normals[(i - 1 + n) % n];
    const n1 = normals[i];
    const bis = add(n0, n1);
    const c = dot(unit(bis), n1);
    if (Math.hypot(bis.x, bis.y) < 1e-9 || c < 0.25) return add(p, scale(n1, d));
    return add(p, scale(unit(bis), d / c));
  });
}

/** Join rooms (indoor ones, or all) into regions. */
export function joinRooms(polys: Point[][]): Region[] {
  const grown: Polygon[] = polys.filter((p) => p.length >= 3 && polygonArea(p) > 1).map((p) => [toRing(offsetRing(clockwise(p), JOIN_IN))]);
  if (!grown.length) return [];
  let mp: MultiPolygon;
  try {
    mp = polygonClipping.union(grown[0], ...grown.slice(1));
  } catch {
    return [];
  }
  // Shrink back by the same amount, so outlines sit on the walls again.
  return regionsOf(mp).map((r) => ({ outline: offsetRing(r.outline, -JOIN_IN), holes: r.holes.map((h) => offsetRing(h, -JOIN_IN)) }));
}

/** The house's outline on one floor: rooms with walls (porches, decks and patios left out). */
export function floorFootprint(plan: FloorPlan): Region[] {
  plan = flatPlan(plan);
  return joinRooms(plan.rooms.filter((r) => areaKind(r) !== "outdoor").map((r) => r.polygon));
}

/** Outdoor rooms that get a roof (on posts): porches and covered patios. Decks stay open. */
export const COVERED = new Set(["porch", "patio"]);

/** What the roof covers on one floor: the rooms with walls plus porches and covered patios. */
export function roofFootprint(plan: FloorPlan): Region[] {
  plan = flatPlan(plan);
  return joinRooms(plan.rooms.filter((r) => areaKind(r) !== "outdoor" || COVERED.has(r.type ?? "")).map((r) => r.polygon));
}

/** What's left of `a` after taking away `b`. */
export function subtractRegions(a: Region[], b: Region[]): Region[] {
  if (!a.length) return [];
  if (!b.length) return a;
  try {
    const out = polygonClipping.difference(a.map(asPolygon) as MultiPolygon, b.map(asPolygon) as MultiPolygon);
    return regionsOf(out);
  } catch {
    return a;
  }
}

/** A plain polygon minus some holes (for a floor with a stairwell cut out). */
export function cutHoles(poly: Point[], holes: Point[][]): Region[] {
  const base: Region = { outline: clockwise(poly), holes: [] };
  if (!holes.length) return [base];
  return subtractRegions([base], holes.map((h) => ({ outline: clockwise(h), holes: [] })));
}

export function regionArea(r: Region): number {
  return Math.abs(signedArea(r.outline)) - r.holes.reduce((s, h) => s + polygonArea(h), 0);
}
