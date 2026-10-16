import type { Level, PlanBasics, Roof } from "@/lib/model/schema";
import { exteriorWallIn } from "@/lib/plan/basics";
import { planOf, type Plans } from "@/lib/plan/edit";
import { polygonArea } from "@/lib/plan/geometry";
import { floorFootprint, offsetRing, regionArea, roofFootprint, subtractRegions, type Region } from "@/lib/house3d/footprint";
import { levelHeights } from "@/lib/house3d/levels";
import { roofShape, type RoofShape } from "@/lib/house3d/roof";
import { sqft, ft, ringLength } from "./quantityBasics";

/** Measures the roof: its areas, gable ends, hips and valleys, gutters and eaves, and the attic. */

const triArea3D = (t: RoofShape["tris"][number]) => {
  const [a, b, c] = t.p.map((p, i) => [p.x, p.y, t.h[i]]);
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
};

const wallArea = (w: RoofShape["walls"][number]) => {
  // Upright pieces: a triangle (gable) or a four-sided piece (shed side). Area of the shape in its own plane.
  let s = 0;
  for (let i = 1; i < w.p.length - 1; i++) {
    const pts = [0, i, i + 1].map((k) => [w.p[k].x, w.p[k].y, w.h[k]]);
    const u = pts[1].map((x, j) => x - pts[0][j]);
    const v = pts[2].map((x, j) => x - pts[0][j]);
    s += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
  }
  return s;
};

/**
 * Hips and valleys: the sloped creases where two roof planes meet. Found as
 * triangle edges shared by two triangles that face different ways (edges
 * inside one flat plane, and level ridges, don't count).
 */
export function foldLength(tris: RoofShape["tris"]): number {
  const normal = (t: RoofShape["tris"][number]) => {
    const [a, b, c] = t.p.map((p, i) => [p.x, p.y, t.h[i]]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    const k = n[2] < 0 ? -l : l;
    return n.map((x) => x / k);
  };
  const key = (p: { x: number; y: number }, h: number) => `${Math.round(p.x)},${Math.round(p.y)},${Math.round(h)}`;
  const edges = new Map<string, { n: number[]; len: number; rise: number }[]>();
  for (const t of tris) {
    const n = normal(t);
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      const ka = key(t.p[i], t.h[i]);
      const kb = key(t.p[j], t.h[j]);
      if (ka === kb) continue;
      const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const len = Math.hypot(t.p[i].x - t.p[j].x, t.p[i].y - t.p[j].y, t.h[i] - t.h[j]);
      const list = edges.get(k) ?? [];
      list.push({ n, len, rise: Math.abs(t.h[i] - t.h[j]) });
      edges.set(k, list);
    }
  }
  let total = 0;
  for (const list of edges.values()) {
    if (list.length !== 2 || list[0].rise < 6) continue;
    const [a, b] = list;
    const cos = a.n[0] * b.n[0] + a.n[1] * b.n[1] + a.n[2] * b.n[2];
    if (cos < 0.995) total += a.len;
  }
  return total;
}

/** Roof surfaces, gable walls, hips and valleys, gutters and attic ceilings over the whole house. */
export function measureRoof(plans: Plans, levels: Level[], basics: PlanBasics | null, roof: Roof) {
  const heights = levelHeights(levels, basics);
  const ordered = [...levels].sort((a, b) => heights[a.id].floorIn - heights[b.id].floorIn);
  const exteriorIn = exteriorWallIn(basics);
  const out = { roofSqft: 0, flatSqft: 0, gableSqft: 0, hipValleyLf: 0, gutterLf: 0, eaveLf: 0, atticSqft: 0 };
  ordered.forEach((level, i) => {
    const plan = planOf(plans, level.id);
    const regions = roofFootprint(plan);
    if (!regions.length) return;
    const next = ordered.slice(i + 1).find((l) => (plans[l.id]?.rooms.length ?? 0) > 0);
    const above = next ? floorFootprint(planOf(plans, next.id)) : [];
    const exposed = subtractRegions(regions, above);
    out.atticSqft += sqft(subtractRegions(floorFootprint(plan), above).reduce((s, r) => s + regionArea(r), 0));
    const { floorIn, ceilingIn } = heights[level.id];
    const flat = level.kind === "basement" || floorIn < 0;
    for (const found of exposed) {
      const r: Region = { ...found, holes: found.holes.filter((h) => polygonArea(h) > 150 * 144) };
      const shape = roofShape(r, floorIn + ceilingIn, exteriorIn, roof, flat);
      const area = sqft(shape.tris.reduce((s, t) => s + triArea3D(t), 0));
      const isFlat = flat || shape.fellBack || roof.style === "flat";
      if (isFlat) out.flatSqft += area;
      else out.roofSqft += area;
      out.gableSqft += sqft(shape.walls.reduce((s, w) => s + wallArea(w), 0));
      const eave = ft(ringLength(offsetRing(r.outline, exteriorIn / 2 + roof.overhangIn)));
      out.eaveLf += eave;
      if (isFlat) {
        out.gutterLf += eave * 0.25;
        continue;
      }
      out.hipValleyLf += ft(foldLength(shape.tris));
      out.gutterLf += eave * (roof.style === "hip" ? 1 : roof.style === "gable" ? 0.6 : 0.3);
    }
  });
  return out;
}
