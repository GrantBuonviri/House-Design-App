import type { CustomLand, GroundShape, Plot, Point } from "@/lib/model/schema";
import { centroid, pointInPolygon } from "./geometry";
import { landFrame } from "./custom";
import { createTerrain, localSlopePercent } from "./terrain";

/**
 * Editing helpers for the designer's ground shapes (hills, dips, steeper and
 * flatter spots). Pure functions on the designer's settings (inches, the frame
 * the lot was drawn in). The terrain math itself lives in terrain.ts.
 */

const FT = 12;
const round = (p: Point): Point => ({ x: Math.round(p.x), y: Math.round(p.y) });

export type GroundKind = GroundShape["kind"];
export const GROUND_KINDS: { id: GroundKind; label: string }[] = [
  { id: "hill", label: "Hill" },
  { id: "dip", label: "Dip" },
  { id: "steeper", label: "Steeper here" },
  { id: "flatter", label: "Flatter here" },
];
export const HEIGHT_MIN_FT = 1;
export const HEIGHT_MAX_FT = 20;
export const GROUND_RADIUS_MIN_FT = 8;
export const GROUND_RADIUS_MAX_FT = 200;
/** Never more than this many shapes, so a long brush stroke can't slow the page. */
export const GROUND_MAX = 300;

export const isBump = (k: GroundKind) => k === "hill" || k === "dip";

export function groundLabel(kind?: GroundKind): string {
  return { hill: "Hill", dip: "Dip", steeper: "Steeper spot", flatter: "Flatter spot" }[kind ?? "hill"];
}

export function addGround(land: CustomLand, kind: GroundKind, at: Point, radiusFt: number, amount: number): CustomLand {
  if (land.ground.length >= GROUND_MAX) return land;
  const shape: GroundShape = { id: crypto.randomUUID(), kind, at: round(at), radiusFt, amount };
  return { ...land, ground: [...land.ground, shape] };
}

/**
 * Stamp a steeper/flatter circle at `to`, or (dragging) along the line from
 * `from` to `to`, one circle every half radius. A stamp that would sit on a
 * matching one already there is skipped.
 */
export function stampGround(land: CustomLand, kind: GroundKind, to: Point, radiusFt: number, strength: number, from: Point | null = null): CustomLand {
  const step = radiusFt * FT * 0.5;
  const dist = from ? Math.hypot(to.x - from.x, to.y - from.y) : 0;
  const n = from ? Math.max(1, Math.floor(dist / step)) : 1;
  let next = land;
  for (let i = 1; i <= n; i++) {
    const t = from ? i / n : 1;
    const at = from ? { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t } : to;
    const dup = next.ground.some((g) => g.kind === kind && g.radiusFt === radiusFt && g.amount === strength && Math.hypot(g.at.x - at.x, g.at.y - at.y) < step * 0.4);
    if (!dup) next = addGround(next, kind, at, radiusFt, strength);
  }
  return next;
}

export function moveGround(land: CustomLand, index: number, to: Point): CustomLand {
  return { ...land, ground: land.ground.map((g, i) => (i === index ? { ...g, at: round(to) } : g)) };
}

export function setGroundRadius(land: CustomLand, index: number, radiusFt: number): CustomLand {
  const r = Math.round(Math.min(GROUND_RADIUS_MAX_FT, Math.max(GROUND_RADIUS_MIN_FT, radiusFt)));
  return { ...land, ground: land.ground.map((g, i) => (i === index ? { ...g, radiusFt: r } : g)) };
}

/** Height or depth in feet for a hill or dip, strength 0 to 1 for steeper and flatter. */
export function setGroundAmount(land: CustomLand, index: number, amount: number): CustomLand {
  return {
    ...land,
    ground: land.ground.map((g, i) => {
      if (i !== index) return g;
      const v = isBump(g.kind) ? Math.min(HEIGHT_MAX_FT, Math.max(HEIGHT_MIN_FT, amount)) : Math.min(1, Math.max(0.05, amount));
      return { ...g, amount: v };
    }),
  };
}

export function clearGround(land: CustomLand): CustomLand {
  return land.ground.length ? { ...land, ground: [] } : land;
}

/** The ground's grade (percent) under the middle of the lot, where a house usually goes. */
export function buildingSpotGrade(plot: Plot): number {
  return localSlopePercent(plot, centroid(plot.outline));
}

/** Line segments [x1, y1, x2, y2] where a grid of heights crosses each level. */
export function contourSegments(
  height: (x: number, y: number) => number,
  box: { x0: number; y0: number; x1: number; y1: number },
  cols: number,
  rows: number,
  levels: number[],
): number[][] {
  const dx = (box.x1 - box.x0) / cols;
  const dy = (box.y1 - box.y0) / rows;
  const v: number[][] = [];
  for (let j = 0; j <= rows; j++) {
    const row: number[] = [];
    for (let i = 0; i <= cols; i++) row.push(height(box.x0 + i * dx, box.y0 + j * dy));
    v.push(row);
  }
  const out: number[][] = [];
  for (const L of levels) {
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const a = v[j][i];
        const b = v[j][i + 1];
        const c = v[j + 1][i + 1];
        const d = v[j + 1][i];
        const x = box.x0 + i * dx;
        const y = box.y0 + j * dy;
        const cross: Point[] = [];
        const edge = (p: number, q: number, p0: Point, p1: Point) => {
          if (p < L === q < L) return;
          const t = (L - p) / (q - p);
          cross.push({ x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t });
        };
        edge(a, b, { x, y }, { x: x + dx, y });
        edge(b, c, { x: x + dx, y }, { x: x + dx, y: y + dy });
        edge(d, c, { x, y: y + dy }, { x: x + dx, y: y + dy });
        edge(a, d, { x, y }, { x, y: y + dy });
        for (let k = 0; k + 1 < cross.length; k += 2) out.push([cross[k].x, cross[k].y, cross[k + 1].x, cross[k + 1].y]);
      }
    }
  }
  return out;
}

/** Spacing in feet for contour lines: the smallest nice step that keeps them to about a dozen. */
export function contourStepFt(rangeFt: number): number {
  return [0.5, 1, 2, 5, 10, 20].find((s) => rangeFt / s <= 12) ?? 50;
}

/**
 * Contour lines for the lot in the designer's drawing frame, so the shape of
 * the ground can be seen while it's edited.
 */
export function landContours(land: CustomLand, plot: Plot): { segments: number[][]; stepFt: number } {
  const height = createTerrain(plot);
  const frame = landFrame(land);
  const xs = land.outline.map((p) => p.x);
  const ys = land.outline.map((p) => p.y);
  const box = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  const f = (x: number, y: number) => {
    const p = frame.toPlot({ x, y });
    return height(p.x, p.y) / FT;
  };
  const cols = 64;
  const rows = 52;
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = 0; j <= rows; j += 2) {
    for (let i = 0; i <= cols; i += 2) {
      const p = { x: box.x0 + ((box.x1 - box.x0) * i) / cols, y: box.y0 + ((box.y1 - box.y0) * j) / rows };
      if (!pointInPolygon(p, land.outline)) continue;
      const z = f(p.x, p.y);
      lo = Math.min(lo, z);
      hi = Math.max(hi, z);
    }
  }
  if (!(hi - lo >= 0.3)) return { segments: [], stepFt: 0 };
  const stepFt = contourStepFt(hi - lo);
  const levels: number[] = [];
  for (let L = Math.ceil(lo / stepFt) * stepFt; L <= hi; L += stepFt) levels.push(L);
  const segments = contourSegments(f, box, cols, rows, levels).filter((s) => pointInPolygon({ x: (s[0] + s[2]) / 2, y: (s[1] + s[3]) / 2 }, land.outline));
  return { segments, stepFt };
}
