import { ShapeUtils, Vector2 } from "three";
import { SkeletonBuilder } from "straight-skeleton";
import type { Point, Roof } from "@/lib/model/schema";
import { dist, dot, leftNormal, project, scale, sub, unit } from "@/lib/plan/geometry";
import { offsetRing, type Region } from "./footprint";
import { COLORS } from "./colors";
import { MeshBuilder, toScene, type Frame, type Vec3 } from "./mesh";

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
};

/** Roof thickness (rafters and sheathing), shown at the eaves. */
export const ROOF_THICK_IN = 7;
/** A flat roof's slab. */
export const FLAT_ROOF_IN = 10;

const SHED_DIR: Record<Roof["shedDown"], Point> = { N: { x: 0, y: -1 }, S: { x: 0, y: 1 }, E: { x: 1, y: 0 }, W: { x: -1, y: 0 } };

/**
 * The roof over one region of the house. `topIn` is the height of the top of
 * the walls it sits on, `wallIn` the outside wall thickness.
 */
export function roofShape(region: Region, topIn: number, wallIn: number, roof: Pick<Roof, "style" | "pitch" | "overhangIn" | "shedDown">, forceFlat = false): RoofShape {
  const style = forceFlat ? "flat" : roof.style;
  const slope = roof.pitch / 12;
  const over = style === "flat" ? Math.min(roof.overhangIn, 6) : roof.overhangIn;
  const wallOuter = { outline: offsetRing(region.outline, wallIn / 2), holes: region.holes.map((h) => offsetRing(h, wallIn / 2)) };
  const eave = { outline: offsetRing(wallOuter.outline, over), holes: wallOuter.holes.map((h) => offsetRing(h, over)) };

  if (style === "flat") return { tris: triangulate(eave, () => topIn + FLAT_ROOF_IN), walls: [], fellBack: false };

  if (style === "shed") {
    const d = SHED_DIR[roof.shedDown];
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
    return { tris: triangulate(eave, h), walls, fellBack: false };
  }

  // Hip and gable: the straight skeleton of the eave outline.
  const eaveIn = topIn - over * slope;
  const sk = skeletonFaces(eave);
  if (!sk) return { ...roofShape(region, topIn, wallIn, roof, true), fellBack: true };
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
    const tris: RoofTri[] = [];
    faces.forEach((f, fi) => {
      if (gableFaces.has(fi)) return;
      const pts = f.pts.map((p) => moved.get(key(p)) ?? p);
      tris.push(...fanFace(pts, f.dist.map((d) => eaveIn + d * slope)));
    });
    return { tris, walls, fellBack: false };
  }

  const tris = faces.flatMap((f) => fanFace(f.pts, f.dist.map((d) => eaveIn + d * slope)));
  return { tris, walls, fellBack: false };
}

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
    const faces: Face[] = [];
    for (const e of sk.Edges) {
      const pts = e.Polygon.map((v) => ({ x: v.X, y: v.Y }));
      const dist = e.Polygon.map((v) => sk.Distances.get(v) ?? 0);
      if (pts.length < 3 || dist.some((d) => !Number.isFinite(d) || d < -1e-6)) return null;
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
export function drawRoof(mb: { roof: MeshBuilder; trim: MeshBuilder; siding: MeshBuilder }, f: Frame, shape: RoofShape, thick: number) {
  const edges = new Map<string, { a: Point; b: Point; ha: number; hb: number; other: Point; n: number }>();
  const k = (p: Point) => `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`;
  for (const t of shape.tris) {
    const [A, B, C] = t.p.map((p, i) => toScene(f, p, t.h[i])) as [Vec3, Vec3, Vec3];
    mb.roof.tri(A, B, C, COLORS.roof, [0, 1, 0]);
    const lower = (v: Vec3): Vec3 => [v[0], v[1] - thick / 12, v[2]];
    mb.trim.tri(lower(A), lower(B), lower(C), COLORS.fascia, [0, -1, 0]);
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
    mb.trim.upright(f, e.a, e.b, e.ha - thick, e.ha, e.hb - thick, e.hb, out, COLORS.fascia);
  }
  for (const w of shape.walls) {
    if (w.p.length === 3) {
      const [A, B, C] = w.p.map((p, i) => toScene(f, p, w.h[i])) as [Vec3, Vec3, Vec3];
      mb.siding.tri(A, B, C, COLORS.siding, [w.out.x, 0, w.out.y]);
      // The attic side, so the gable isn't see-through from inside.
      mb.siding.tri(A, B, C, COLORS.drywall, [-w.out.x, 0, -w.out.y]);
    } else {
      mb.siding.upright(f, w.p[0], w.p[1], w.h[0], w.h[3], w.h[1], w.h[2], w.out, COLORS.siding);
      mb.siding.upright(f, w.p[0], w.p[1], w.h[0], w.h[3], w.h[1], w.h[2], scale(w.out, -1), COLORS.drywall);
    }
  }
}

/** The highest point of a roof, for framing the camera. */
export function roofTop(shape: RoofShape): number {
  return shape.tris.reduce((m, t) => Math.max(m, ...t.h), -Infinity);
}

