import type { Plot } from "@/lib/model/schema";
import { bearingVector } from "./generate";
import { closestPointOnPolyline, distanceToPolygonEdge, distanceToPolyline, pointInPolygon } from "./geometry";
import { createNoise2D } from "./random";

/** Ground height in inches at a plot-local point, relative to the plot's center. */
export type HeightFn = (x: number, y: number) => number;

const FT = 12;

/**
 * Build the terrain for a plot. It's rebuilt from the seed every time, so
 * nothing about the ground needs saving. Works outside the plot outline too,
 * so neighbors' land can be drawn around it.
 */
export function createTerrain(plot: Plot): HeightFn {
  if (plot.isFlat) return () => 0;
  const base = shapedTerrain(plot);
  const levels = waterLevels(plot);

  const features = plot.waterFeatures.map((f, i) => ({ ...f, level: levels[i] }));

  return (x, y) => {
    let h = base(x, y);
    const p = { x, y };
    for (const f of features) {
      if (f.kind === "creek" || f.kind === "wash" || f.kind === "river") {
        const { depth, halfWidth } = CHANNEL[f.kind];
        const d = distanceToPolyline(p, f.points);
        h -= depth * Math.exp(-((d / halfWidth) ** 2));
      } else {
        // Ponds and lakes: a gentle bank outside, and inside a bed that
        // deepens away from the shore, always below the water level.
        const d = distanceToPolygonEdge(p, f.points);
        const deepAt = f.kind === "pond" ? 15 * FT : 30 * FT;
        const depth = f.kind === "pond" ? 3 * FT : 6 * FT;
        if (pointInPolygon(p, f.points)) {
          h = Math.min(h, f.level - WATER_DEPTH_AT_SHORE - Math.min(d / deepAt, 1) * depth);
        } else {
          h -= 0.75 * FT * Math.exp(-((d / (15 * FT)) ** 2));
        }
      }
    }
    return h;
  };
}

/** How far the bed sits below the water right at the shoreline. */
const WATER_DEPTH_AT_SHORE = 0.5 * FT;

/** How deep and wide running water cuts its channel. */
const CHANNEL = {
  creek: { depth: 4 * FT, halfWidth: 14 * FT },
  river: { depth: 8 * FT, halfWidth: 32 * FT },
  wash: { depth: 2.5 * FT, halfWidth: 10 * FT },
} as const;

/** How much of the usual rolls each ground setting keeps. */
const ROLLS = { smooth: 0, gentle: 1, bumpy: 2.2 } as const;

/** Most a "steeper here" shape multiplies the slope by, at full strength. */
export const STEEPER_MAX = 3;

/** A smooth bump: 1 at the middle, easing to 0 at `radius`. */
function bump(d: number, radius: number): number {
  return d >= radius ? 0 : 0.5 * (1 + Math.cos((Math.PI * d) / radius));
}

/** Full strength in the inner half of a circle, easing to 0 at its edge. */
function brushWeight(d: number, radius: number): number {
  if (d <= radius * 0.5) return 1;
  if (d >= radius) return 0;
  const t = (radius - d) / (radius * 0.5);
  return t * t * (3 - 2 * t);
}

/** Lanes are graded level across their width, easing back to the ground over this shoulder. */
const LANE_SHOULDER = 10 * FT;

/**
 * The ground before water: slope and rolls, then hills and dips and rocks,
 * then the steeper/flatter shapes, then lanes graded flat across. Made-up
 * plots have none of the extras, so this is just their slope and rolls.
 */
function shapedTerrain(plot: Plot): HeightFn {
  let h = baseTerrain(plot);
  const bumps = [
    ...plot.ground
      .filter((g) => g.kind === "hill" || g.kind === "dip")
      .map((g) => ({ at: g.at, r: g.radiusFt * FT, dz: (g.kind === "hill" ? 1 : -1) * g.amount * FT })),
    ...plot.features
      .filter((f) => f.kind === "rock")
      .map((f) => ({ at: f.at, r: f.sizeFt * 0.9 * FT, dz: Math.min(f.sizeFt * 0.3, 4) * FT })),
  ];
  if (bumps.length) {
    const prev = h;
    h = (x, y) => bumps.reduce((z, b) => z + b.dz * bump(Math.hypot(x - b.at.x, y - b.at.y), b.r), prev(x, y));
  }
  for (const g of plot.ground) {
    if (g.kind !== "steeper" && g.kind !== "flatter") continue;
    const prev = h;
    const r = g.radiusFt * FT;
    const strength = Math.min(g.amount, 1);
    const k = g.kind === "steeper" ? 1 + strength * (STEEPER_MAX - 1) : 1 - strength;
    const center = prev(g.at.x, g.at.y);
    h = (x, y) => {
      const z = prev(x, y);
      const w = brushWeight(Math.hypot(x - g.at.x, y - g.at.y), r);
      return w === 0 ? z : z + w * (k - 1) * (z - center);
    };
  }
  for (const lane of plot.lanes) {
    if (lane.points.length < 2) continue;
    const prev = h;
    const half = (lane.widthFt * FT) / 2;
    h = (x, y) => {
      const z = prev(x, y);
      const q = closestPointOnPolyline({ x, y }, lane.points);
      const d = Math.hypot(x - q.x, y - q.y);
      const w = d <= half ? 1 : d >= half + LANE_SHOULDER ? 0 : brushWeight(d - half, LANE_SHOULDER * 2);
      return w === 0 ? z : z + w * (prev(q.x, q.y) - z);
    };
  }
  return h;
}

/** The slope plus gentle rolls, before any shapes or water. */
function baseTerrain(plot: Plot): HeightFn {
  const cx = plot.widthIn / 2;
  const cy = plot.depthIn / 2;
  const down = bearingVector(plot.slope.downhillDeg);
  const grade = plot.slope.percent / 100;
  const noise = createNoise2D(plot.seed ^ 0x5bd1e995);
  // Gentle rolls: a few feet of relief, a little more on steeper ground.
  const amp = Math.min(2 + plot.slope.percent * 0.25, 7) * FT * ROLLS[plot.rolls ?? "gentle"];
  const wavelength = 140 * FT;
  return (x, y) => {
    const along = (x - cx) * down.x + (y - cy) * down.y;
    const nx = x / wavelength;
    const ny = y / wavelength;
    return -grade * along + amp * (0.65 * noise(nx, ny) + 0.35 * noise(nx * 2.3 + 17, ny * 2.3 + 5));
  };
}

/**
 * The flat water surface height (inches) for each pond or lake, matching
 * plot.waterFeatures by index (NaN for creeks, rivers and washes). Water sits a foot
 * below the lowest point of its shoreline, so it never spills over the bank.
 */
export function waterLevels(plot: Plot): number[] {
  if (plot.isFlat) return plot.waterFeatures.map(() => NaN);
  const base = shapedTerrain(plot);
  return plot.waterFeatures.map((f) => {
    if (f.kind !== "pond" && f.kind !== "lake") return NaN;
    // A lake's last two points are its far side, well off the plot.
    const shore = f.kind === "lake" ? f.points.slice(0, -2) : f.points;
    return Math.min(...shore.map((p) => base(p.x, p.y))) - FT;
  });
}

/** Sample a grid of heights covering a box (inches), row by row. */
export function sampleHeights(
  height: HeightFn,
  box: { x: number; y: number; w: number; h: number },
  cols: number,
  rows: number,
): Float32Array {
  const out = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      out[j * cols + i] = height(box.x + ((i + 0.5) / cols) * box.w, box.y + ((j + 0.5) / rows) * box.h);
    }
  }
  return out;
}

/** Highest minus lowest point inside the plot outline, in inches. */
export function elevationChange(plot: Plot, samples = 40): number {
  const height = createTerrain(plot);
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = 0; j < samples; j++) {
    for (let i = 0; i < samples; i++) {
      const p = { x: ((i + 0.5) / samples) * plot.widthIn, y: ((j + 0.5) / samples) * plot.depthIn };
      if (!pointInPolygon(p, plot.outline)) continue;
      const z = height(p.x, p.y);
      lo = Math.min(lo, z);
      hi = Math.max(hi, z);
    }
  }
  return hi > lo ? hi - lo : 0;
}

/**
 * The ground's grade (percent) around a spot, measured across `radiusIn`
 * the way it falls, before water and leaving out the random rolls, so it
 * shows the slope and shapes as designed. Used for the slope under the house.
 */
export function localSlopePercent(plot: Plot, at: { x: number; y: number }, radiusIn = 30 * FT): number {
  if (plot.isFlat) return 0;
  const h = shapedTerrain({ ...plot, rolls: "smooth" });
  const gx = (h(at.x + radiusIn, at.y) - h(at.x - radiusIn, at.y)) / (2 * radiusIn);
  const gy = (h(at.x, at.y + radiusIn) - h(at.x, at.y - radiusIn)) / (2 * radiusIn);
  return Math.round(Math.hypot(gx, gy) * 1000) / 10;
}
