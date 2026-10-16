import type { Plot, Point } from "@/lib/model/schema";
import { plotRoadEdges } from "./custom";
import { pointInPolygon } from "./geometry";
import { createTerrain, waterLevels, type HeightFn } from "./terrain";
import { landTint, landView, type LandView } from "./view";

/**
 * Pure data for drawing a plot in 3D. Scene units: the whole view is
 * SCENE_SIZE wide, x points east, z points south, y is up. Heights are
 * exaggerated a little so gentle slopes are still visible.
 */
export const SCENE_SIZE = 10;
export const HEIGHT_EXAGGERATION = 2;

export type LandScene = {
  view: LandView;
  height: HeightFn;
  /** Plot inches -> scene units (horizontal). */
  scale: number;
  toScene: (x: number, y: number, liftIn?: number) => [number, number, number];
};

export function landScene(plot: Plot): LandScene {
  const view = landView(plot);
  const height = createTerrain(plot);
  const scale = SCENE_SIZE / view.side;
  const cx = view.x0 + view.side / 2;
  const cy = view.y0 + view.side / 2;
  return {
    view,
    height,
    scale,
    toScene: (x, y, liftIn = 0) => [
      (x - cx) * scale,
      (height(x, y) + liftIn) * scale * HEIGHT_EXAGGERATION,
      (y - cy) * scale,
    ],
  };
}

export type TerrainMesh = {
  positions: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  /** Lowest and highest scene y, for placing the camera and water. */
  minY: number;
  maxY: number;
};

/** An n × n vertex grid over the view, colored by height and faded outside the plot. */
export function buildTerrainMesh(plot: Plot, scene: LandScene, n = 96): TerrainMesh {
  const { view } = scene;
  const positions = new Float32Array(n * n * 3);
  const heights = new Float32Array(n * n);
  const inside = new Uint8Array(n * n);
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = view.x0 + (i / (n - 1)) * view.side;
      const y = view.y0 + (j / (n - 1)) * view.side;
      const [sx, sy, sz] = scene.toScene(x, y);
      const k = j * n + i;
      positions.set([sx, sy, sz], k * 3);
      heights[k] = sy;
      inside[k] = pointInPolygon({ x, y }, plot.outline) ? 1 : 0;
      lo = Math.min(lo, sy);
      hi = Math.max(hi, sy);
    }
  }
  const range = Math.max(hi - lo, 1e-6);
  const colors = new Float32Array(n * n * 3);
  for (let k = 0; k < n * n; k++) {
    let [r, g, b] = landTint(plot.isFlat ? 0.15 : (heights[k] - lo) / range);
    if (!inside[k]) {
      r = r * 0.6 + 235 * 0.4;
      g = g * 0.6 + 232 * 0.4;
      b = b * 0.6 + 220 * 0.4;
    }
    colors.set([r / 255, g / 255, b / 255], k * 3);
  }
  const indices = new Uint32Array((n - 1) * (n - 1) * 6);
  let o = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      indices.set([a, c, b, b, c, d], o);
      o += 6;
    }
  }
  return { positions, colors, indices, minY: lo, maxY: hi };
}

/** Clamp a point to the view box so far-off lake corners don't stretch the scene. */
function clampToView(p: Point, view: LandView): Point {
  return {
    x: Math.max(view.x0, Math.min(view.x0 + view.side, p.x)),
    y: Math.max(view.y0, Math.min(view.y0 + view.side, p.y)),
  };
}

export type WaterSurface = { kind: "pond" | "lake"; outline: [number, number][]; level: number };

/**
 * Flat water for ponds and lakes: the outline in scene x/z and the water
 * level from the terrain, so the ground forms the bank.
 */
export function waterSurfaces(plot: Plot, scene: LandScene): WaterSurface[] {
  const levels = waterLevels(plot);
  const out: WaterSurface[] = [];
  plot.waterFeatures.forEach((w, i) => {
    if (w.kind !== "pond" && w.kind !== "lake") return;
    out.push({
      kind: w.kind,
      outline: w.points.map((p) => {
        const q = clampToView(p, scene.view);
        const [x, , z] = scene.toScene(q.x, q.y);
        return [x, z] as [number, number];
      }),
      level: levels[i] * scene.scale * HEIGHT_EXAGGERATION,
    });
  });
  return out;
}

/**
 * Points along a line laid onto the ground, split into short steps so the
 * line follows the terrain instead of cutting through hills.
 */
export function drapeLine(
  points: Point[],
  scene: LandScene,
  opts: { closed?: boolean; liftIn?: number; stepIn?: number } = {},
): [number, number, number][] {
  const step = opts.stepIn ?? scene.view.side / 80;
  const lift = opts.liftIn ?? 8;
  const pts = opts.closed ? [...points, points[0]] : points;
  const out: [number, number, number][] = [];
  const { view } = scene;
  const inView = (p: Point) =>
    p.x >= view.x0 && p.x <= view.x0 + view.side && p.y >= view.y0 && p.y <= view.y0 + view.side;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let s = 0; s < steps; s++) {
      const p = { x: a.x + ((b.x - a.x) * s) / steps, y: a.y + ((b.y - a.y) * s) / steps };
      if (inView(p)) out.push(scene.toScene(p.x, p.y, lift));
    }
  }
  const last = pts[pts.length - 1];
  if (inView(last)) out.push(scene.toScene(last.x, last.y, lift));
  return out;
}

/** The road as a line just outside the plot edge on its road side. */
export function roadLine(plot: Plot, scene: LandScene): Point[] {
  const { view } = scene;
  const gap = view.side * 0.035;
  const x1 = view.x0;
  const x2 = view.x0 + view.side;
  const y1 = view.y0;
  const y2 = view.y0 + view.side;
  switch (plot.roadSide) {
    case "N":
      return [{ x: x1, y: -gap }, { x: x2, y: -gap }];
    case "S":
      return [{ x: x1, y: plot.depthIn + gap }, { x: x2, y: plot.depthIn + gap }];
    case "W":
      return [{ x: -gap, y: y1 }, { x: -gap, y: y2 }];
    case "E":
      return [{ x: plot.widthIn + gap, y: y1 }, { x: plot.widthIn + gap, y: y2 }];
  }
}

const FT = 12;

export type RibbonMesh = { positions: Float32Array; indices: Uint32Array };

/**
 * A flat strip of `widthIn` inches laid along a path on the ground (rivers,
 * lanes, roads). The path is cut into short steps so the strip follows hills.
 */
export function ribbonMesh(points: Point[], widthIn: number, scene: LandScene, liftIn = 6): RibbonMesh | null {
  const { view } = scene;
  const step = view.side / 80;
  const dense: Point[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let s = 0; s < n; s++) dense.push({ x: a.x + ((b.x - a.x) * s) / n, y: a.y + ((b.y - a.y) * s) / n });
  }
  if (points.length) dense.push(points[points.length - 1]);
  const inView = (p: Point) => p.x >= view.x0 && p.x <= view.x0 + view.side && p.y >= view.y0 && p.y <= view.y0 + view.side;
  const kept = dense.filter(inView);
  if (kept.length < 2) return null;
  const half = widthIn / 2;
  const positions = new Float32Array(kept.length * 2 * 3);
  kept.forEach((p, i) => {
    const prev = kept[Math.max(0, i - 1)];
    const next = kept[Math.min(kept.length - 1, i + 1)];
    const len = Math.hypot(next.x - prev.x, next.y - prev.y) || 1;
    const nx = -(next.y - prev.y) / len;
    const ny = (next.x - prev.x) / len;
    positions.set(scene.toScene(p.x + nx * half, p.y + ny * half, liftIn), i * 6);
    positions.set(scene.toScene(p.x - nx * half, p.y - ny * half, liftIn), i * 6 + 3);
  });
  const indices = new Uint32Array((kept.length - 1) * 6);
  for (let i = 0; i < kept.length - 1; i++) indices.set([i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2], i * 6);
  return { positions, indices };
}

export type RoadStrip = { points: Point[]; widthIn: number; main: boolean };

/** Each road as a centerline just outside its real lot edge (made-up plots get one main road). */
export function roadStrips(plot: Plot): RoadStrip[] {
  return plotRoadEdges(plot).map(({ road, a, b, facingDeg }) => {
    const r = (facingDeg * Math.PI) / 180;
    const off = (road.widthFt / 2 + 4) * FT;
    // Bearing 0 is north, which is up the page (y decreases); bearing 90 is east.
    const dx = Math.sin(r) * off;
    const dy = -Math.cos(r) * off;
    return {
      points: [
        { x: a.x + dx, y: a.y + dy },
        { x: b.x + dx, y: b.y + dy },
      ],
      widthIn: road.widthFt * FT,
      main: road.kind === "main",
    };
  });
}

export type LandSpot = { id: string; kind: "rock" | "tree"; position: [number, number, number]; radius: number };

/** Rocks and trees placed on the ground, in scene units (radius is half their size across). */
export function featureSpots(plot: Plot, scene: LandScene): LandSpot[] {
  const { view } = scene;
  return plot.features
    .filter((f) => f.at.x >= view.x0 && f.at.x <= view.x0 + view.side && f.at.y >= view.y0 && f.at.y <= view.y0 + view.side)
    .map((f) => ({ id: f.id, kind: f.kind, position: scene.toScene(f.at.x, f.at.y), radius: (f.sizeFt * FT * scene.scale) / 2 }));
}
