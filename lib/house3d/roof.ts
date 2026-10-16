import { ShapeUtils, Vector2 } from "three";
import polygonClipping, { type MultiPolygon, type Polygon } from "polygon-clipping";
import { SkeletonBuilder } from "straight-skeleton";
import type { Point, Roof } from "@/lib/model/schema";
import { add, dist, dot, leftNormal, pointInPolygon, polygonArea, project, scale, sub, unit } from "@/lib/plan/geometry";
import { cleanRing, offsetRing, type Region } from "./footprint";
import { COLORS } from "./colors";
import { MeshBuilder, toScene, type Frame, type Vec3 } from "./mesh";
import type { ExteriorLook } from "./exterior";

/**
 * Roofs, made from the house outline. A hip roof is the "straight skeleton"
 * of the outline: every eave rises at the same pitch until the slopes meet,
 * which gives the hips, valleys and ridges of a real roof on any shape. A
 * gable roof is the same with the sloped ends at the narrow ends turned into
 * upright gable walls. A shed roof is one tilted plane, and a flat roof a
 * slab.
 */

/** A roof triangle: plan corners and their heights (inches). */
export type RoofTri = { p: [Point, Point, Point]; h: [number, number, number] };

export type RoofShape = {
  tris: RoofTri[];
  /** Upright siding under the roof: gable ends, and the high side of a shed roof. */
  walls: { p: Point[]; h: number[]; out: Point }[];
  /** Whether the hip or gable roof had to fall back to flat (an outline the roof maker couldn't handle). */
  fellBack: boolean;
  /** Where the roof meets a wall of the floor above: the edge, its heights, and which way is away from the wall. */
  flashing?: { a: Point; b: Point; ha: number; hb: number; out: Point }[];
  /** The roof's own shape would have run into the floor above, so it's a shed leaning on that floor's wall instead. */
  leansOnWall?: boolean;
};

/** Roof thickness (rafters and sheathing), shown at the eaves. */
export const ROOF_THICK_IN = 7;
/** A flat roof's slab. */
export const FLAT_ROOF_IN = 10;

const SHED_DIR: Record<Roof["shedDown"], Point> = { N: { x: 0, y: -1 }, S: { x: 0, y: 1 }, E: { x: 1, y: 0 }, W: { x: -1, y: 0 } };

/**
 * The floor above, where it stands on the floor being roofed: its outline (to
 * the middle of its walls) and the top of its walls. A roof that meets it
 * stops at its outside wall face, like the wall of the house next door.
 */
export type UpperFloor = { regions: Region[]; topIn: number };

/**
 * The roof over one region of the house. `topIn` is the height of the top of
 * the walls it sits on, `wallIn` the outside wall thickness. With `upper`,
 * the roof leans on that floor's walls where it meets them (see `againstUpper`).
 */
export function roofShape(
  region: Region,
  topIn: number,
  wallIn: number,
  roof: Pick<Roof, "style" | "pitch" | "overhangIn" | "shedDown">,
  forceFlat = false,
  upper?: UpperFloor,
): RoofShape {
  if (upper?.regions.length) {
    const s = againstUpper(region, topIn, wallIn, roof, forceFlat, upper);
    if (s) return s;
  }
  const style = forceFlat ? "flat" : roof.style;
  const slope = roof.pitch / 12;
  const over = style === "flat" ? Math.min(roof.overhangIn, 6) : roof.overhangIn;
  const wallOuter = grow(region, wallIn / 2);
  const eave = grow(wallOuter, over);

  if (style === "flat") return { tris: triangulate(eave, () => topIn + FLAT_ROOF_IN), walls: [], fellBack: false };

  if (style === "shed") {
    const { h, walls } = shedPlane(wallOuter, topIn, slope, SHED_DIR[roof.shedDown]);
    return { tris: triangulate(eave, h), walls, fellBack: false };
  }

  const sloped = slopedFaces(wallOuter, eave, topIn, over, slope, style);
  if (!sloped) return { ...roofShape(region, topIn, wallIn, roof, true), fellBack: true };
  return { tris: sloped.faces.flatMap((f) => fanFace(f.pts, f.h)), walls: sloped.walls, fellBack: false };
}

const grow = (r: Region, d: number): Region => ({ outline: offsetRing(r.outline, d), holes: r.holes.map((h) => offsetRing(h, d)) });

/** A shed roof's plane, sloping down toward `d`, and the siding under its high sides. */
function shedPlane(wallOuter: Region, topIn: number, slope: number, d: Point) {
  const m = Math.max(...[wallOuter.outline, ...wallOuter.holes].flat().map((q) => dot(q, d)));
  const h = (p: Point) => topIn + slope * (m - dot(p, d));
  const walls: RoofShape["walls"] = [];
  for (const ring of [wallOuter.outline, ...wallOuter.holes]) {
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length];
      if (h(a) - topIn < 0.5 && h(b) - topIn < 0.5) return;
      walls.push({ p: [a, b, b, a], h: [topIn, topIn, h(b), h(a)], out: leftNormal(unit(sub(b, a))) });
    });
  }
  return { h, walls };
}

/** A flat roof face: corners and their heights. */
type Poly = { pts: Point[]; h: number[] };

/** Hip and gable faces from the straight skeleton of the eave outline, or null when it can't be made. */
function slopedFaces(wallOuter: Region, eave: Region, topIn: number, over: number, slope: number, style: "hip" | "gable"): { faces: Poly[]; walls: RoofShape["walls"] } | null {
  const eaveIn = topIn - over * slope;
  const sk = skeletonFaces(eave);
  if (!sk) return null;
  const faces = sk.faces;
  const walls: RoofShape["walls"] = [];

  if (style === "gable") {
    const rings = [sk.region.outline, ...sk.region.holes];
    const wallRings = [wallOuter.outline, ...wallOuter.holes];
    // Skeleton corners shared by several faces can differ by a hair, so match them to the half inch.
    const key = (p: Point) => `${Math.round(p.x * 2)},${Math.round(p.y * 2)}`;
    const uses = new Map<string, number>();
    for (const f of faces) for (const p of f.pts) uses.set(key(p), (uses.get(key(p)) ?? 0) + 1);
    const moved = new Map<string, Point>();
    const gableFaces = new Set<number>();
    faces.forEach((f, fi) => {
      if (f.pts.length !== 3) return;
      const edge = findEdge(rings, f.edge[0], f.edge[1]);
      if (!edge) return;
      const apexAt = f.dist.findIndex((d) => d > 1);
      if (apexAt < 0 || f.dist.filter((d) => d > 1).length !== 1) return;
      const apex = f.pts[apexAt];
      const k = key(apex);
      if (uses.get(k) !== 3 || moved.has(k)) return;
      const [a, b] = [f.edge[0], f.edge[1]];
      const L = dist(a, b);
      if (L < 6 * 12) return;
      const pr = project(apex, a, b);
      if (pr.t < 0.2 * L || pr.t > 0.8 * L) return;
      moved.set(k, pr.point);
      gableFaces.add(fi);
      // The gable wall, in line with the outside face of the wall below.
      const wr = wallRings[edge.ring];
      const wa = wr[edge.i];
      const wb = wr[(edge.i + 1) % wr.length];
      const top = project(apex, wa, wb).point;
      const apexH = eaveIn + f.dist[apexAt] * slope;
      walls.push({ p: [wa, wb, top], h: [topIn, topIn, apexH], out: leftNormal(unit(sub(wb, wa))) });
    });
    const out: Poly[] = [];
    faces.forEach((f, fi) => {
      if (gableFaces.has(fi)) return;
      out.push({ pts: f.pts.map((p) => moved.get(key(p)) ?? p), h: f.dist.map((d) => eaveIn + d * slope) });
    });
    return { faces: out, walls };
  }

  return { faces: faces.map((f) => ({ pts: f.pts, h: f.dist.map((d) => eaveIn + d * slope) })), walls };
}

// ---- Roofs against the floor above ----

const ring = (pts: Point[]): [number, number][] => [...pts.map((p) => [p.x, p.y] as [number, number]), [pts[0].x, pts[0].y]];
const asPolygon = (r: Region): Polygon => [ring(r.outline), ...r.holes.map(ring)];
const unring = (r: [number, number][]): Point[] => r.slice(0, -1).map(([x, y]) => ({ x, y }));
const mpArea = (mp: MultiPolygon) => mp.reduce((s, poly) => s + polygonArea(unring(poly[0])) - poly.slice(1).reduce((t, h) => t + polygonArea(unring(h)), 0), 0);

/** How far a point is from the nearest of some rings' edges. */
function distToRings(p: Point, rings: Point[][]): number {
  let best = Infinity;
  for (const r of rings) for (let i = 0; i < r.length; i++) best = Math.min(best, project(p, r[i], r[(i + 1) % r.length]).d);
  return best;
}

/** Heights across a flat face, from three of its corners. */
function planeOf(pts: Point[], h: number[]): (p: Point) => number {
  let best = { i: 0, j: 1, k: 2, a: 0 };
  const n = pts.length;
  for (let j = 1; j < n - 1; j++)
    for (let k = j + 1; k < n; k++) {
      const a = Math.abs((pts[j].x - pts[0].x) * (pts[k].y - pts[0].y) - (pts[k].x - pts[0].x) * (pts[j].y - pts[0].y));
      if (a > best.a) best = { i: 0, j, k, a };
    }
  const [A, B, C] = [pts[best.i], pts[best.j], pts[best.k]];
  const [ha, hb, hc] = [h[best.i], h[best.j], h[best.k]];
  const det = (B.x - A.x) * (C.y - A.y) - (C.x - A.x) * (B.y - A.y);
  if (Math.abs(det) < 1e-9) return () => ha;
  return (p) => {
    const u = ((p.x - A.x) * (C.y - A.y) - (C.x - A.x) * (p.y - A.y)) / det;
    const v = ((B.x - A.x) * (p.y - A.y) - (p.x - A.x) * (B.y - A.y)) / det;
    return ha + u * (hb - ha) + v * (hc - ha);
  };
}

/** Triangles for the parts of `mp` (a clipped piece of roof), with heights from `h`. */
function trianglesOf(mp: MultiPolygon, h: (p: Point) => number): RoofTri[] {
  return mp.flatMap((poly) => triangulate({ outline: unring(poly[0]), holes: poly.slice(1).map(unring) }, h));
}

/** The parts of an upright roof wall whose foot is out of every `away` ring (inside none of them). */
function clipWall(w: RoofShape["walls"][number], away: Region[]): RoofShape["walls"] {
  const a = w.p[0];
  const L = dist(a, w.p[1]);
  if (L < 0.5) return [];
  const u = unit(sub(w.p[1], a));
  const ts = [0, L];
  for (const r of away)
    for (const rg of [r.outline, ...r.holes])
      for (let i = 0; i < rg.length; i++) {
        const t = crossAt(a, u, L, rg[i], rg[(i + 1) % rg.length]);
        if (t !== null) ts.push(t);
      }
  ts.sort((x, y) => x - y);
  const out: RoofShape["walls"] = [];
  const sz = w.p.map((p, i) => ({ s: dot(sub(p, a), u), z: w.h[i] }));
  for (let i = 0; i < ts.length - 1; i++) {
    const [s0, s1] = [ts[i], ts[i + 1]];
    if (s1 - s0 < 0.5) continue;
    const mid = add(a, scale(u, (s0 + s1) / 2));
    if (away.some((r) => inRegion(mid, r))) continue;
    const kept = clipS(clipS(sz, s0, 1), s1, -1);
    if (kept.length < 3) continue;
    out.push({ p: kept.map((q) => add(a, scale(u, q.s))), h: kept.map((q) => q.z), out: w.out });
  }
  return out;
}

/** Where a segment (from `a` along `u`, `L` long) crosses the segment p-q, as a distance along it. */
function crossAt(a: Point, u: Point, L: number, p: Point, q: Point): number | null {
  const e = sub(q, p);
  const den = u.x * e.y - u.y * e.x;
  if (Math.abs(den) < 1e-9) return null;
  const w = sub(p, a);
  const t = (w.x * e.y - w.y * e.x) / den;
  const s = (w.x * u.y - w.y * u.x) / den;
  return t > 0 && t < L && s >= 0 && s <= 1 ? t : null;
}

/** Keep the side of an (s, z) polygon where s is past `at` (sign 1) or before it (sign -1). */
function clipS(poly: { s: number; z: number }[], at: number, sign: 1 | -1) {
  const out: { s: number; z: number }[] = [];
  const inside = (q: { s: number }) => (q.s - at) * sign >= -1e-9;
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length];
    if (inside(p)) out.push(p);
    if (inside(p) !== inside(q)) {
      const t = (at - p.s) / (q.s - p.s);
      out.push({ s: at, z: p.z + t * (q.z - p.z) });
    }
  });
  return out;
}

function inRegion(p: Point, r: Region): boolean {
  return pointInPolygon(p, r.outline) && !r.holes.some((h) => pointInPolygon(p, h));
}

/**
 * A lower floor's roof where it meets the floor above. Edges along the upper
 * floor's walls don't slope up: the roof is worked out as if the house went
 * on under the upper floor, then cut off at the upper floor's outside wall
 * face, so the slopes and ridge die into the wall and nothing goes inside
 * it. If that roof would still rise past the top of the upper floor's walls
 * (or can't be made), it falls back to a shed leaning on the wall, sloping
 * away from it. A flashing strip goes where roof meets wall. Null when the
 * region doesn't meet the floor above.
 */
function againstUpper(
  region: Region,
  topIn: number,
  wallIn: number,
  roof: Pick<Roof, "style" | "pitch" | "overhangIn" | "shedDown">,
  forceFlat: boolean,
  upper: UpperFloor,
): RoofShape | null {
  const style = forceFlat ? "flat" : roof.style;
  const slope = roof.pitch / 12;
  const over = style === "flat" ? Math.min(roof.overhangIn, 6) : roof.overhangIn;
  const wallOuter = grow(region, wallIn / 2);
  const eave = grow(wallOuter, over);
  // The upper floor out to its outside wall faces.
  let walls: Region[] = upper.regions.map((r) => grow(r, wallIn / 2));
  let kept: MultiPolygon;
  try {
    const e = asPolygon(eave);
    walls = walls.filter((w) => mpArea(polygonClipping.intersection(e, asPolygon(w))) > 144);
    if (!walls.length) return null;
    kept = polygonClipping.difference(e, ...walls.map(asPolygon));
  } catch {
    return null;
  }
  if (!kept.length) return { tris: [], walls: [], fellBack: false, flashing: [] };
  const wallRings = walls.flatMap((w) => [w.outline, ...w.holes]);
  const clipFaces = (faces: Poly[]) =>
    faces.flatMap((f) => {
      try {
        return trianglesOf(polygonClipping.intersection([ring(f.pts)], kept), planeOf(f.pts, f.h));
      } catch {
        return [];
      }
    });
  const finish = (tris: RoofTri[], ws: RoofShape["walls"], extra: Partial<RoofShape> = {}): RoofShape => ({
    tris,
    walls: ws.flatMap((w) => clipWall(w, walls)),
    fellBack: false,
    flashing: flashingOf(tris, wallRings),
    ...extra,
  });
  const fits = (tris: RoofTri[]) => tris.every((t) => t.h.every((h) => h <= upper.topIn + 0.5));

  if (style === "flat") return finish(trianglesOf(kept, () => topIn + FLAT_ROOF_IN), []);

  if (style === "shed") {
    const { h, walls: ws } = shedPlane(wallOuter, topIn, slope, SHED_DIR[roof.shedDown]);
    const tris = trianglesOf(kept, h);
    if (fits(tris)) return finish(tris, ws);
  } else {
    // The roof as if this floor went on under the floor above.
    let whole: Region | null = null;
    try {
      const u = polygonClipping.union(asPolygon(wallOuter), ...walls.map(asPolygon));
      const biggest = u.reduce((a, b) => (mpArea([b]) > mpArea([a]) ? b : a));
      whole = { outline: cleanRing(unring(biggest[0])), holes: biggest.slice(1).map((h) => cleanRing(unring(h))).filter((h) => h.length >= 3 && polygonArea(h) > 150 * 144) };
    } catch {
      whole = null;
    }
    const sloped = whole && whole.outline.length >= 3 ? slopedFaces(whole, grow(whole, over), topIn, over, slope, style) : null;
    if (sloped) {
      const tris = clipFaces(sloped.faces);
      if (tris.length && fits(tris)) return finish(tris, sloped.walls);
    }
  }

  // Fall back to a shed leaning on the wall, sloping away from it, never above the upper floor's walls.
  const flash = flashingOf(trianglesOf(kept, () => topIn), wallRings);
  let d = { x: 0, y: 0 };
  for (const f of flash) d = add(d, scale(f.out, dist(f.a, f.b)));
  if (Math.hypot(d.x, d.y) < 1) return finish(trianglesOf(kept, () => topIn + FLAT_ROOF_IN), [], { fellBack: true });
  d = unit(d);
  const m = Math.max(...[wallOuter.outline, ...wallOuter.holes].flat().map((q) => dot(q, d)));
  const low = Math.min(...kept.flat(2).map(([x, y]) => dot({ x, y }, d)));
  const s = Math.max(0, Math.min(slope, (upper.topIn - 6 - topIn) / Math.max(12, m - low)));
  const { h, walls: ws } = shedPlane(wallOuter, topIn, s, d);
  return finish(trianglesOf(kept, h), ws, { leansOnWall: true });
}

/** The edges of a roof that run along a wall above it, for the flashing strip, each facing away from the wall. */
function flashingOf(tris: RoofTri[], wallRings: Point[][]): NonNullable<RoofShape["flashing"]> {
  const out: NonNullable<RoofShape["flashing"]> = [];
  const on = (p: Point) => distToRings(p, wallRings) < 0.1;
  for (const t of tris)
    for (let i = 0; i < 3; i++) {
      const [a, b, c] = [t.p[i], t.p[(i + 1) % 3], t.p[(i + 2) % 3]];
      if (dist(a, b) < 0.5 || !on(a) || !on(b) || !on(lerp2(a, b))) continue;
      let n = leftNormal(unit(sub(b, a)));
      if (dot(sub(c, a), n) < 0) n = scale(n, -1);
      out.push({ a, b, ha: t.h[i], hb: t.h[(i + 1) % 3], out: n });
    }
  return out;
}

const lerp2 = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

type Face = { pts: Point[]; dist: number[]; edge: [Point, Point] };

/**
 * The roof faces from the straight skeleton, one per eave edge, or null when
 * it can't be made. Outlines with many corners lined up exactly (common in
 * square-cornered houses) can trip up the skeleton maker, so it tries again
 * with the corners nudged by a hair, which doesn't show.
 */
function skeletonFaces(r: Region): { faces: Face[]; region: Region } | null {
  for (const amp of [0, 0.05, 0.3]) {
    let seed = 7919;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2 * amp;
    const nudge = (pts: Point[]) => (amp ? pts.map((p) => ({ x: p.x + rnd(), y: p.y + rnd() })) : pts);
    const tried = { outline: nudge(r.outline), holes: r.holes.map(nudge) };
    const faces = skeletonOnce(tried);
    if (faces) return { faces, region: tried };
  }
  return null;
}

function skeletonOnce(r: Region): Face[] | null {
  const ring = (pts: Point[]) => pts.map((p) => [p.x, p.y] as [number, number]);
  try {
    const sk = SkeletonBuilder.BuildFromGeoJSON([[ring(r.outline), ...r.holes.map(ring)]]);
    const edges = r.outline.length + r.holes.reduce((s, h) => s + h.length, 0);
    if (sk.Edges.length !== edges) return null;
    // Every corner of the roof has to sit inside the outline's box: the
    // skeleton maker sometimes sends one off toward infinity instead of failing.
    const xs = r.outline.map((p) => p.x);
    const ys = r.outline.map((p) => p.y);
    const [x0, x1, y0, y1] = [Math.min(...xs) - 1, Math.max(...xs) + 1, Math.min(...ys) - 1, Math.max(...ys) + 1];
    const maxDist = Math.min(x1 - x0, y1 - y0) / 2 + 1;
    const faces: Face[] = [];
    for (const e of sk.Edges) {
      const pts = e.Polygon.map((v) => ({ x: v.X, y: v.Y }));
      const dist = e.Polygon.map((v) => sk.Distances.get(v) ?? 0);
      if (pts.length < 3 || dist.some((d) => !Number.isFinite(d) || d < -1e-6 || d > maxDist)) return null;
      if (pts.some((p) => p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1)) return null;
      faces.push({ pts, dist, edge: [{ x: e.Edge.Begin.X, y: e.Edge.Begin.Y }, { x: e.Edge.End.X, y: e.Edge.End.Y }] });
    }
    return faces;
  } catch {
    return null;
  }
}

function findEdge(rings: Point[][], a: Point, b: Point): { ring: number; i: number } | null {
  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r];
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      const q = ring[(i + 1) % ring.length];
      if ((dist(p, a) < 0.01 && dist(q, b) < 0.01) || (dist(p, b) < 0.01 && dist(q, a) < 0.01)) return { ring: r, i };
    }
  }
  return null;
}

/** Triangles for one flat roof face, given its corners in order. */
function fanFace(pts: Point[], h: number[]): RoofTri[] {
  let idx: number[][];
  try {
    idx = ShapeUtils.triangulateShape(pts.map((p) => new Vector2(p.x, p.y)), []);
  } catch {
    return [];
  }
  return idx.map(([i, j, k]) => ({ p: [pts[i], pts[j], pts[k]], h: [h[i], h[j], h[k]] }));
}

function triangulate(r: Region, h: (p: Point) => number): RoofTri[] {
  const all = [...r.outline, ...r.holes.flat()];
  let idx: number[][];
  try {
    idx = ShapeUtils.triangulateShape(
      r.outline.map((p) => new Vector2(p.x, p.y)),
      r.holes.map((ring) => ring.map((p) => new Vector2(p.x, p.y))),
    );
  } catch {
    return [];
  }
  return idx.map(([i, j, k]) => ({ p: [all[i], all[j], all[k]], h: [h(all[i]), h(all[j]), h(all[k])] }));
}

/**
 * Draw a roof: the top in roofing, the underside (soffit) a roof's thickness
 * lower, a fascia board around the open edges, and siding for gable ends.
 */
export function drawRoof(mb: { roof: MeshBuilder; trim: MeshBuilder; siding: MeshBuilder }, f: Frame, shape: RoofShape, thick: number, look?: ExteriorLook) {
  const roof = look?.roof ?? { color: COLORS.roof, pattern: 0 };
  const fascia = look?.trim ?? COLORS.fascia;
  // Gable ends: the siding, or the accent when it goes on the gables.
  const gable = look ? (look.accent?.place === "gables" ? look.accent : look.siding) : { color: COLORS.siding, pattern: 0 };
  const edges = new Map<string, { a: Point; b: Point; ha: number; hb: number; other: Point; n: number }>();
  const k = (p: Point) => `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`;
  for (const t of shape.tris) {
    const [A, B, C] = t.p.map((p, i) => toScene(f, p, t.h[i])) as [Vec3, Vec3, Vec3];
    mb.roof.pattern = roof.pattern;
    mb.roof.tri(A, B, C, roof.color, [0, 1, 0]);
    mb.roof.pattern = 0;
    const lower = (v: Vec3): Vec3 => [v[0], v[1] - thick / 12, v[2]];
    mb.trim.tri(lower(A), lower(B), lower(C), fascia, [0, -1, 0]);
    for (let i = 0; i < 3; i++) {
      const a = t.p[i];
      const b = t.p[(i + 1) % 3];
      const id = [k(a), k(b)].sort().join("|");
      const e = edges.get(id);
      if (e) e.n++;
      else edges.set(id, { a, b, ha: t.h[i], hb: t.h[(i + 1) % 3], other: t.p[(i + 2) % 3], n: 1 });
    }
  }
  for (const e of edges.values()) {
    if (e.n !== 1) continue;
    const u = unit(sub(e.b, e.a));
    let out = leftNormal(u);
    if (dot(sub(e.other, e.a), out) > 0) out = scale(out, -1);
    mb.trim.upright(f, e.a, e.b, e.ha - thick, e.ha, e.hb - thick, e.hb, out, fascia);
  }
  for (const w of shape.walls) {
    // A flat upright piece (a triangle, or four or more corners in order around it).
    const P = w.p.map((p, i) => toScene(f, p, w.h[i]));
    for (let i = 1; i < P.length - 1; i++) {
      mb.siding.pattern = gable.pattern;
      mb.siding.tri(P[0], P[i], P[i + 1], gable.color, [w.out.x, 0, w.out.y]);
      mb.siding.pattern = 0;
      // The attic side, so the gable isn't see-through from inside.
      mb.siding.tri(P[0], P[i], P[i + 1], COLORS.drywall, [-w.out.x, 0, -w.out.y]);
    }
  }
  // Flashing where the roof meets a wall above: a strip of trim up the wall face, just off it.
  for (const e of shape.flashing ?? []) {
    const back = scale(e.out, FLASHING_OFF_IN);
    const a = add(e.a, back);
    const b = add(e.b, back);
    mb.trim.upright(f, a, b, e.ha - 1, e.ha + FLASHING_IN, e.hb - 1, e.hb + FLASHING_IN, e.out, fascia);
  }
}

/** How tall the flashing strip shows above the roof, and how far off the wall face it sits. */
export const FLASHING_IN = 4;
const FLASHING_OFF_IN = 0.4;

/** The highest point of a roof, for framing the camera. */
export function roofTop(shape: RoofShape): number {
  return shape.tris.reduce((m, t) => Math.max(m, ...t.h), -Infinity);
}

