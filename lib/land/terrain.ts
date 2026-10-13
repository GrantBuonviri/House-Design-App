import type { Plot } from "@/lib/model/schema";
import { bearingVector } from "./generate";
import { centroid, distanceToPolygonEdge, distanceToPolyline, pointInPolygon } from "./geometry";
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

  const cx = plot.widthIn / 2;
  const cy = plot.depthIn / 2;
  const down = bearingVector(plot.slope.downhillDeg);
  const grade = plot.slope.percent / 100;
  const noise = createNoise2D(plot.seed ^ 0x5bd1e995);
  // Gentle rolls: a few feet of relief, a little more on steeper ground.
  const amp = Math.min(2 + plot.slope.percent * 0.25, 7) * FT;
  const wavelength = 140 * FT;

  const features = plot.waterFeatures.map((f) => {
    if (f.kind === "pond") {
      const c = centroid(f.points);
      const radius = Math.max(...f.points.map((p) => Math.hypot(p.x - c.x, p.y - c.y)));
      return { kind: f.kind, points: f.points, c, radius };
    }
    return { kind: f.kind, points: f.points, c: { x: 0, y: 0 }, radius: 0 };
  });

  return (x, y) => {
    const along = (x - cx) * down.x + (y - cy) * down.y;
    let h = -grade * along;
    const nx = x / wavelength;
    const ny = y / wavelength;
    h += amp * (0.65 * noise(nx, ny) + 0.35 * noise(nx * 2.3 + 17, ny * 2.3 + 5));

    for (const f of features) {
      const p = { x, y };
      if (f.kind === "creek" || f.kind === "wash") {
        const depth = f.kind === "creek" ? 4 * FT : 2.5 * FT;
        const halfWidth = f.kind === "creek" ? 14 * FT : 10 * FT;
        const d = distanceToPolyline(p, f.points);
        h -= depth * Math.exp(-((d / halfWidth) ** 2));
      } else if (f.kind === "pond") {
        const d = Math.hypot(x - f.c.x, y - f.c.y) / (f.radius * 1.4);
        if (d < 1) h -= 5 * FT * (1 - d * d);
      } else if (f.kind === "lake") {
        const inside = pointInPolygon(p, f.points);
        const d = distanceToPolygonEdge(p, f.points);
        // Shore drops off into the lake.
        h -= inside ? 4 * FT + Math.min(d / (30 * FT), 1) * 6 * FT : 2 * FT * Math.exp(-((d / (20 * FT)) ** 2));
      }
    }
    return h;
  };
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
