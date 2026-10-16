import type { Point, Project } from "@/lib/model/schema";
import { add, dot, pointInPolygon, scale, unit } from "@/lib/plan/geometry";
import { houseScene } from "@/lib/plans/scene";
import { flatProject } from "@/lib/plan/flatten";

/**
 * Roof framing: trusses at 24" on center, drawn across each roof plane in
 * the direction it slopes, so they bear on the walls under its eaves. The
 * truss supplier's engineer designs the trusses themselves (IRC R802.10);
 * the app gives the layout, the spans and which walls carry them.
 */

export const TRUSS_SPACING_IN = 24;

export type RoofPlane = {
  levelId: string;
  /** The plane in plan. */
  poly: Point[];
  /** Downhill, in plan. Zero for a flat roof. */
  down: Point;
  /** How far the plane runs from its eave up to its ridge (a flat roof: across it), plan inches. */
  runIn: number;
  /** Truss lines across it, in plan. */
  trusses: [Point, Point][];
  flat: boolean;
};

export type RoofFraming = { planes: RoofPlane[]; style: Project["house3d"]["roof"]["style"]; pitch: number; overhangIn: number };

/** Where a line through `p` along `d` crosses a polygon: the inside stretches. */
function clipLine(poly: Point[], p: Point, d: Point): [number, number][] {
  const ts: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const e = { x: b.x - a.x, y: b.y - a.y };
    const den = d.x * e.y - d.y * e.x;
    if (Math.abs(den) < 1e-9) continue;
    const w = { x: a.x - p.x, y: a.y - p.y };
    const t = (w.x * e.y - w.y * e.x) / den;
    const s = (w.x * d.y - w.y * d.x) / den;
    if (s >= 0 && s < 1) ts.push(t);
  }
  ts.sort((x, y) => x - y);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < ts.length; i += 2) if (ts[i + 1] - ts[i] > 2) out.push([ts[i], ts[i + 1]]);
  return out;
}

export function roofFraming(project: Project): RoofFraming {
  project = flatProject(project);
  const sc = houseScene(project);
  const roof = project.house3d.roof;
  const planes: RoofPlane[] = [];
  for (const f of sc.faces) {
    if (f.kind !== "roof" || !f.levelId) continue;
    const all = f.fills.flat().map((q) => ({ x: q.x, y: q.y }));
    if (all.length < 3) continue;
    const flat = f.n.z > 0.995;
    const down = flat ? { x: 0, y: 0 } : unit({ x: f.n.x, y: f.n.y });
    // Flat roofs: trusses run the short way across.
    const xs = all.map((q) => q.x);
    const ys = all.map((q) => q.y);
    const short = Math.max(...xs) - Math.min(...xs) < Math.max(...ys) - Math.min(...ys);
    const dir = flat ? (short ? { x: 1, y: 0 } : { x: 0, y: 1 }) : down;
    const across = { x: -dir.y, y: dir.x };
    const runs = all.map((q) => dot(q, dir));
    const runIn = Math.max(...runs) - Math.min(...runs);
    for (const fill of f.fills) {
      const poly = fill.map((q) => ({ x: q.x, y: q.y }));
      if (poly.length < 3) continue;
      const proj = poly.map((q) => dot(q, across));
      const trusses: [Point, Point][] = [];
      // Lines on a grid shared by every plane, so trusses on the two sides of a ridge line up.
      const k0 = Math.ceil(Math.min(...proj) / TRUSS_SPACING_IN);
      const k1 = Math.floor(Math.max(...proj) / TRUSS_SPACING_IN);
      for (let k = k0; k <= k1; k++) {
        const origin = scale(across, k * TRUSS_SPACING_IN);
        for (const [t0, t1] of clipLine(poly, origin, dir)) trusses.push([add(origin, scale(dir, t0)), add(origin, scale(dir, t1))]);
      }
      planes.push({ levelId: f.levelId, poly, down, runIn, trusses, flat });
    }
  }
  return { planes, style: roof.style, pitch: roof.pitch, overhangIn: roof.overhangIn };
}

/**
 * Whether the roof bears on an outside wall: a roof plane over the room side
 * of the wall slopes down toward it. Returns the truss span (the house's
 * width there), or null for a gable-end or other wall the trusses run along.
 */
export function roofBearing(rf: RoofFraming, levelId: string, mid: Point, outward: Point): number | null {
  const inside = add(mid, scale(outward, -12));
  let span: number | null = null;
  for (const p of rf.planes) {
    if (p.levelId !== levelId || !pointInPolygon(inside, p.poly)) continue;
    // The plane's run includes the overhang past the wall.
    const run = Math.max(0, p.runIn - rf.overhangIn);
    if (p.flat) span = Math.max(span ?? 0, Math.max(0, p.runIn - 2 * Math.min(rf.overhangIn, 6)));
    else if (dot(p.down, outward) > 0.7) span = Math.max(span ?? 0, run * (rf.style === "shed" ? 1 : 2));
  }
  return span;
}
