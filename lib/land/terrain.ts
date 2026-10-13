import type { Plot } from "@/lib/model/schema";
import { bearingVector } from "./generate";
import { distanceToPolygonEdge, distanceToPolyline, pointInPolygon } from "./geometry";
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
  const base = baseTerrain(plot);
  const levels = waterLevels(plot);

  const features = plot.waterFeatures.map((f, i) => ({ ...f, level: levels[i] }));

  return (x, y) => {
    let h = base(x, y);
    const p = { x, y };
    for (const f of features) {
      if (f.kind === "creek" || f.kind === "wash") {
        const depth = f.kind === "creek" ? 4 * FT : 2.5 * FT;
        const halfWidth = f.kind === "creek" ? 14 * FT : 10 * FT;
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

/** The slope plus gentle rolls, before any water is carved in. */
function baseTerrain(plot: Plot): HeightFn {
  const cx = plot.widthIn / 2;
  const cy = plot.depthIn / 2;
  const down = bearingVector(plot.slope.downhillDeg);
  const grade = plot.slope.percent / 100;
  const noise = createNoise2D(plot.seed ^ 0x5bd1e995);
  // Gentle rolls: a few feet of relief, a little more on steeper ground.
  const amp = Math.min(2 + plot.slope.percent * 0.25, 7) * FT;
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
 * plot.waterFeatures by index (NaN for creeks and washes). Water sits a foot
 * below the lowest point of its shoreline, so it never spills over the bank.
 */
export function waterLevels(plot: Plot): number[] {
  if (plot.isFlat) return plot.waterFeatures.map(() => NaN);
  const base = baseTerrain(plot);
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
