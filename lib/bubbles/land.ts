import type { Plot, Point } from "@/lib/model/schema";
import { bearingVector } from "@/lib/land/generate";
import { pointInPolygon } from "@/lib/land/geometry";
import { createTerrain } from "@/lib/land/terrain";
import { dayArc, SUMMER_SOLSTICE, WINTER_SOLSTICE } from "@/lib/land/sun";
import { centerOf } from "./arrange";
import type { Bubble } from "./shapes";

/**
 * The land drawn under the flow sketch: the lot line, water, contours, a
 * downhill arrow and Boise's sun paths. Plot and sketch coordinates are both
 * inches with x east and y south, so placing the house on the lot is just an
 * offset: a plot point is the sketch point plus the offset.
 */

export type WaterLine = { kind: Plot["waterFeatures"][number]["kind"]; points: Point[]; closed: boolean };

export type LandDrawing = {
  /** The lot line, in plot coordinates. */
  outline: Point[];
  /** The lot edge along the road, and where its label goes. */
  road: { a: Point; b: Point; label: Point } | null;
  water: WaterLine[];
  /** Contour segments as x1, y1, x2, y2, … in plot coordinates. Empty on flat land. */
  contours: number[];
  /** Feet between contour lines. */
  contourFt: number;
  /** An arrow pointing downhill, on the downhill side of the lot. */
  downhill: { from: Point; to: Point; percent: number } | null;
};

const FT = 12;
const ROAD_DIR: Record<Plot["roadSide"], Point> = { N: { x: 0, y: -1 }, S: { x: 0, y: 1 }, E: { x: 1, y: 0 }, W: { x: -1, y: 0 } };

/** The middle of the lot. */
export function lotCenter(plot: Plot): Point {
  return { x: plot.widthIn / 2, y: plot.depthIn / 2 };
}

/** The middle of the house: the main floor's rooms, or the drawing's origin when there are none. */
export function houseCenter(mainFloor: Bubble[]): Point {
  return mainFloor.length ? centerOf(mainFloor) : { x: 0, y: 0 };
}

/** Where the house sits until the user moves it: the middle of the lot under the middle of the house. */
export function defaultLotOffset(plot: Plot, mainFloor: Bubble[]): Point {
  const lot = lotCenter(plot);
  const house = houseCenter(mainFloor);
  return { x: Math.round(lot.x - house.x), y: Math.round(lot.y - house.y) };
}

export function landDrawing(plot: Plot): LandDrawing {
  const { segments, intervalFt } = contours(plot);
  return {
    outline: plot.outline,
    road: roadEdge(plot),
    water: plot.waterFeatures.map((w) => ({ kind: w.kind, points: w.points, closed: w.kind === "pond" || w.kind === "lake" })),
    contours: segments,
    contourFt: intervalFt,
    downhill: downhillArrow(plot),
  };
}

/** The longest edge of the lot line that faces the road. */
function roadEdge(plot: Plot): LandDrawing["road"] {
  const pts = plot.outline;
  if (pts.length < 3) return null;
  const dir = ROAD_DIR[plot.roadSide];
  let best: { a: Point; b: Point; score: number; n: Point } | null = null;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1) continue;
    let n = { x: (b.y - a.y) / len, y: -(b.x - a.x) / len };
    // Point the normal out of the lot.
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (pointInPolygon({ x: mid.x + n.x * 6, y: mid.y + n.y * 6 }, pts)) n = { x: -n.x, y: -n.y };
    const facing = n.x * dir.x + n.y * dir.y;
    if (facing < 0.6) continue;
    const score = len * facing;
    if (!best || score > best.score) best = { a, b, score, n };
  }
  if (!best) return null;
  const mid = { x: (best.a.x + best.b.x) / 2, y: (best.a.y + best.b.y) / 2 };
  return { a: best.a, b: best.b, label: { x: mid.x + dir.x * 8 * FT, y: mid.y + dir.y * 8 * FT } };
}

/** On the downhill side of the lot, pointing downhill. None on flat land. */
function downhillArrow(plot: Plot): LandDrawing["downhill"] {
  if (plot.isFlat || plot.slope.percent < 0.5) return null;
  const c = lotCenter(plot);
  const d = bearingVector(plot.slope.downhillDeg);
  const reach = Math.max(...plot.outline.map((p) => (p.x - c.x) * d.x + (p.y - c.y) * d.y), 20 * FT);
  return {
    from: { x: c.x + d.x * reach * 0.55, y: c.y + d.y * reach * 0.55 },
    to: { x: c.x + d.x * reach * 0.9, y: c.y + d.y * reach * 0.9 },
    percent: Math.round(plot.slope.percent * 10) / 10,
  };
}

/**
 * Contour lines over the lot and a little beyond, by marching squares on a
 * grid of terrain heights. Every 2 ft on gentle land, 5 or 10 ft where there's
 * more relief, as on the land page's map.
 */
export function contours(plot: Plot, cells = 90): { segments: number[]; intervalFt: number } {
  if (plot.isFlat) return { segments: [], intervalFt: 2 };
  const height = createTerrain(plot);
  const margin = 0.08 * Math.max(plot.widthIn, plot.depthIn);
  const x0 = -margin;
  const y0 = -margin;
  const w = plot.widthIn + 2 * margin;
  const h = plot.depthIn + 2 * margin;
  const step = Math.max(w, h) / cells;
  const cols = Math.ceil(w / step) + 1;
  const rows = Math.ceil(h / step) + 1;
  const z = new Float64Array(cols * rows);
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const v = height(x0 + i * step, y0 + j * step);
      z[j * cols + i] = v;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  const range = hi - lo;
  const interval = range > 50 * FT ? 10 * FT : range > 20 * FT ? 5 * FT : 2 * FT;
  const segments: number[] = [];
  for (let level = Math.ceil(lo / interval) * interval; level <= hi; level += interval) {
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        // Corners: top-left, top-right, bottom-right, bottom-left.
        const a = z[j * cols + i];
        const b = z[j * cols + i + 1];
        const c = z[(j + 1) * cols + i + 1];
        const d = z[(j + 1) * cols + i];
        const code = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
        if (code === 0 || code === 15) continue;
        const px = x0 + i * step;
        const py = y0 + j * step;
        const t = (p: number, q: number) => (level - p) / (q - p || 1e-9);
        const top = [px + t(a, b) * step, py];
        const right = [px + step, py + t(b, c) * step];
        const bottom = [px + t(d, c) * step, py + step];
        const left = [px, py + t(a, d) * step];
        const edges = CASES[code];
        for (const [e1, e2] of edges) {
          const p1 = [top, right, bottom, left][e1];
          const p2 = [top, right, bottom, left][e2];
          segments.push(round(p1[0]), round(p1[1]), round(p2[0]), round(p2[1]));
        }
      }
    }
  }
  return { segments, intervalFt: interval / FT };
}

const round = (n: number) => Math.round(n * 10) / 10;

/** Marching squares: which cell edges (0 top, 1 right, 2 bottom, 3 left) each corner pattern joins. */
const CASES: Record<number, [number, number][]> = {
  1: [[3, 2]],
  2: [[2, 1]],
  3: [[3, 1]],
  4: [[0, 1]],
  5: [
    [3, 0],
    [2, 1],
  ],
  6: [[0, 2]],
  7: [[3, 0]],
  8: [[3, 0]],
  9: [[0, 2]],
  10: [
    [3, 2],
    [0, 1],
  ],
  11: [[0, 1]],
  12: [[3, 1]],
  13: [[2, 1]],
  14: [[3, 2]],
};

/** The winter path's size, as a share of the summer path's. */
export const WINTER_RING = 0.78;

export type SunPath = {
  season: "summer" | "winter";
  /** From sunrise to sunset, around the house. */
  points: Point[];
  sunrise: Point;
  sunset: Point;
};

/**
 * Boise's summer and winter sun paths as a dial around the house, like the
 * one on the land page: each arc runs from the sunrise direction through
 * south to the sunset direction, winter inside, summer outside.
 */
export function sunPaths(center: Point, radius: number): { paths: SunPath[]; noon: Point } {
  const at = (azimuthDeg: number, r: number): Point => {
    const v = bearingVector(azimuthDeg);
    return { x: center.x + v.x * r, y: center.y + v.y * r };
  };
  const paths = ([
    ["summer", SUMMER_SOLSTICE, radius],
    ["winter", WINTER_SOLSTICE, radius * WINTER_RING],
  ] as const).map(([season, day, r]) => {
    const arc = dayArc(day);
    const steps = 48;
    const from = arc.sunrise.azimuthDeg;
    const to = arc.sunset.azimuthDeg;
    const points = Array.from({ length: steps + 1 }, (_, i) => at(from + ((to - from) * i) / steps, r));
    return { season, points, sunrise: points[0], sunset: points[steps] };
  });
  return { paths, noon: at(180, radius) };
}

/** How far the house reaches from its middle, for sizing the sun dial. */
export function houseReach(bubbles: Bubble[], center: Point): number {
  let r = 0;
  for (const b of bubbles) r = Math.max(r, Math.hypot(b.x - center.x, b.y - center.y) + Math.max(b.rx, b.ry));
  return r;
}
