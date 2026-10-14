import type { Plot, Point } from "@/lib/model/schema";
import { pointInPolygon } from "@/lib/land/geometry";
import { landTint, landView } from "@/lib/land/view";
import { waterLevels } from "@/lib/land/terrain";
import { toScene, type Frame, type Vec3 } from "./mesh";
import type { Site } from "./site";

/**
 * The ground around the 3D house, at true height (the land page exaggerates
 * hills; here a foot is a foot). A coarse grid covers the lot and around it,
 * and a fine grid covers the house, with a hole cut where a basement is dug
 * in. Along the edge where the two grids meet, the fine grid follows the
 * coarse one exactly so there are no cracks.
 */

export type GroundMesh = { positions: Float32Array; colors: Float32Array; indices: Uint32Array };

export type GroundOptions = {
  /** The house's box in plan inches, so the fine grid covers it. */
  house: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Outlines (plan inches) where the ground is dug out: basements. */
  holes: Point[][];
  coarse?: number;
  fineIn?: number;
};

const MARGIN_IN = 8 * 12;

export function groundMesh(site: Site, f: Frame, opts: GroundOptions): GroundMesh {
  const { plot, offset } = site;
  // The whole area in plot coordinates: the lot and plenty around it, so the ground reaches the haze.
  const lot = plot ? landView(plot) : flatView(opts.house, offset);
  const view = { x0: lot.x0 - lot.side * 1.5, y0: lot.y0 - lot.side * 1.5, side: lot.side * 4 };
  const N = opts.coarse ?? 241;
  const cell = view.side / (N - 1);
  const h = (x: number, y: number) => site.terrain(x, y) - site.base;
  const tint = groundTint(plot, view);

  // The fine patch, on whole coarse cells.
  let patch: { i0: number; j0: number; i1: number; j1: number } | null = null;
  if (opts.house) {
    const hx0 = opts.house.x0 + offset.x - MARGIN_IN;
    const hy0 = opts.house.y0 + offset.y - MARGIN_IN;
    const hx1 = opts.house.x1 + offset.x + MARGIN_IN;
    const hy1 = opts.house.y1 + offset.y + MARGIN_IN;
    const clampI = (v: number) => Math.max(0, Math.min(N - 1, v));
    patch = {
      i0: clampI(Math.floor((hx0 - view.x0) / cell)),
      j0: clampI(Math.floor((hy0 - view.y0) / cell)),
      i1: clampI(Math.ceil((hx1 - view.x0) / cell)),
      j1: clampI(Math.ceil((hy1 - view.y0) / cell)),
    };
    if (patch.i1 <= patch.i0 || patch.j1 <= patch.j0) patch = null;
  }

  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const put = (x: number, y: number, z: number) => {
    const s: Vec3 = toScene(f, { x: x - offset.x, y: y - offset.y }, z);
    pos.push(...s);
    const c = tint(x, y, z);
    col.push(c[0], c[1], c[2]);
    return pos.length / 3 - 1;
  };

  // Coarse grid.
  const coarseZ = new Float64Array(N * N);
  const coarseId = new Int32Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = view.x0 + i * cell;
      const y = view.y0 + j * cell;
      const z = h(x, y);
      coarseZ[j * N + i] = z;
      coarseId[j * N + i] = put(x, y, z);
    }
  }
  const inPatch = (i: number, j: number) => patch && i >= patch.i0 && i < patch.i1 && j >= patch.j0 && j < patch.j1;
  for (let j = 0; j < N - 1; j++) {
    for (let i = 0; i < N - 1; i++) {
      if (inPatch(i, j)) continue;
      const a = coarseId[j * N + i];
      const b = coarseId[j * N + i + 1];
      const c = coarseId[(j + 1) * N + i];
      const d = coarseId[(j + 1) * N + i + 1];
      idx.push(a, c, b, b, c, d);
    }
  }

  if (patch) {
    const k = Math.max(1, Math.min(16, Math.round(cell / (opts.fineIn ?? 6))));
    const cols = (patch.i1 - patch.i0) * k + 1;
    const rows = (patch.j1 - patch.j0) * k + 1;
    const fine = cell / k;
    const x0 = view.x0 + patch.i0 * cell;
    const y0 = view.y0 + patch.j0 * cell;
    const ids = new Int32Array(cols * rows);
    const cz = (i: number, j: number) => coarseZ[j * N + i];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = x0 + c * fine;
        const y = y0 + r * fine;
        let z: number;
        const onLeft = c === 0;
        const onRight = c === cols - 1;
        const onTop = r === 0;
        const onBottom = r === rows - 1;
        if (onLeft || onRight) {
          // Follow the coarse edge between its two corners.
          const i = patch.i0 + (onLeft ? 0 : patch.i1 - patch.i0);
          const jj = patch.j0 + Math.floor(r / k);
          const t = (r % k) / k;
          z = t === 0 ? cz(i, jj) : cz(i, jj) * (1 - t) + cz(i, jj + 1) * t;
        } else if (onTop || onBottom) {
          const j = patch.j0 + (onTop ? 0 : patch.j1 - patch.j0);
          const ii = patch.i0 + Math.floor(c / k);
          const t = (c % k) / k;
          z = t === 0 ? cz(ii, j) : cz(ii, j) * (1 - t) + cz(ii + 1, j) * t;
        } else z = h(x, y);
        ids[r * cols + c] = put(x, y, z);
      }
    }
    const holes = opts.holes;
    const dug = (x: number, y: number) => {
      const p = { x: x - offset.x, y: y - offset.y };
      return holes.some((poly) => pointInPolygon(p, poly));
    };
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const xa = x0 + c * fine;
        const ya = y0 + r * fine;
        const a = ids[r * cols + c];
        const b = ids[r * cols + c + 1];
        const cc = ids[(r + 1) * cols + c];
        const d = ids[(r + 1) * cols + c + 1];
        // Each triangle is left out when its middle is over a basement.
        if (!holes.length || !dug(xa + fine / 3, ya + fine / 3)) idx.push(a, cc, b);
        if (!holes.length || !dug(xa + (2 * fine) / 3, ya + (2 * fine) / 3)) idx.push(b, cc, d);
      }
    }
  }

  return { positions: new Float32Array(pos), colors: new Float32Array(col), indices: new Uint32Array(idx) };
}

/** A flat square of ground around the house when no land has been picked. */
function flatView(house: GroundOptions["house"], offset: Point) {
  const cx = house ? (house.x0 + house.x1) / 2 + offset.x : 0;
  const cy = house ? (house.y0 + house.y1) / 2 + offset.y : 0;
  const side = Math.max(200 * 12, house ? 3 * Math.max(house.x1 - house.x0, house.y1 - house.y0) : 0);
  return { x0: cx - side / 2, y0: cy - side / 2, side };
}

/** Grass, a little lighter higher up, and faded outside the lot. */
function groundTint(plot: Plot | null, view: { side: number }) {
  return (x: number, y: number, z: number): [number, number, number] => {
    const t = plot && !plot.isFlat ? Math.max(0, Math.min(1, 0.35 + z / (view.side * 0.08))) : 0.2;
    let [r, g, b] = landTint(t);
    if (plot && !pointInPolygon({ x, y }, plot.outline)) {
      r = r * 0.7 + 225 * 0.3;
      g = g * 0.7 + 222 * 0.3;
      b = b * 0.7 + 205 * 0.3;
    }
    return [Math.pow(r / 255, 2.2), Math.pow(g / 255, 2.2), Math.pow(b / 255, 2.2)];
  };
}

export type Water = { kind: "pond" | "lake"; outline: Point[]; level: number };

/** Ponds and lakes as flat water: outlines in plan inches, levels in inches above the main floor. */
export function waterIn3D(site: Site): Water[] {
  const plot = site.plot;
  if (!plot) return [];
  const levels = waterLevels(plot);
  const view = landView(plot);
  const clamp = (p: Point) => ({ x: Math.max(view.x0, Math.min(view.x0 + view.side, p.x)), y: Math.max(view.y0, Math.min(view.y0 + view.side, p.y)) });
  const out: Water[] = [];
  plot.waterFeatures.forEach((w, i) => {
    if (w.kind !== "pond" && w.kind !== "lake") return;
    out.push({ kind: w.kind, outline: w.points.map((p) => clamp(p)).map((p) => ({ x: p.x - site.offset.x, y: p.y - site.offset.y })), level: levels[i] - site.base });
  });
  return out;
}

/** A line on the ground (plot points), split into short steps so it follows the land. Scene points. */
export function lineOnGround(site: Site, f: Frame, points: Point[], opts: { closed?: boolean; lift?: number; step?: number } = {}): Vec3[] {
  const pts = opts.closed ? [...points, points[0]] : points;
  const step = opts.step ?? 24;
  const out: Vec3[] = [];
  const at = (p: Point) => toScene(f, { x: p.x - site.offset.x, y: p.y - site.offset.y }, site.terrain(p.x, p.y) - site.base + (opts.lift ?? 4));
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let s = 0; s < n; s++) out.push(at({ x: a.x + ((b.x - a.x) * s) / n, y: a.y + ((b.y - a.y) * s) / n }));
  }
  if (pts.length) out.push(at(pts[pts.length - 1]));
  return out;
}
