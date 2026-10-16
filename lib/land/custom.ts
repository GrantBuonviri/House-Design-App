import type { CustomLand, GroundShape, LandFeature, Lane, Plot, Point, Road, WaterFeature } from "@/lib/model/schema";
import { ACRE_SQ_IN, FLAT_PLOT_SEED, SOIL_TYPES, nearestSide, polygonArea, rateDrainage } from "./generate";
import { centroid } from "./geometry";

/**
 * Custom land: the designer saves its settings as drawn (x right, y down on
 * the screen, plus a north arrow), and buildCustomPlot turns them into a
 * normal plot in compass directions (x east, y south), so every later stage
 * reads it like a made-up plot.
 */

const FT = 12;

/** A rectangle outline, in inches, corners clockwise from the top left. */
export function rectOutline(widthFt: number, depthFt: number): Point[] {
  const w = widthFt * FT;
  const d = depthFt * FT;
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: d },
    { x: 0, y: d },
  ];
}

/** A random seed for a new custom plot, kept clear of the flat plot's seed. */
export function newCustomSeed(): number {
  const s = Math.floor(Math.random() * 0x7fffffff);
  return s === FLAT_PLOT_SEED ? s + 2 : s;
}

/** Settings for a new piece of land: 150 by 200 ft, north up, the street along the bottom. */
export function newCustomLand(name = "My land"): CustomLand {
  return {
    id: crypto.randomUUID(),
    name,
    seed: newCustomSeed(),
    outline: rectOutline(150, 200),
    northDeg: 0,
    slope: { percent: 3, downhillDeg: 180 },
    rolls: "gentle",
    soil: "Silty loam",
    water: [],
    features: [],
    // Edge 2 runs from the bottom right corner to the bottom left: the street.
    roads: [{ id: crypto.randomUUID(), edge: 2, kind: "main", widthFt: 26 }],
    lanes: [],
    ground: [],
  };
}

/** Scale an outline about its first corner so it covers `acres`, keeping its proportions. */
export function scaleOutlineToAcres(outline: Point[], acres: number): Point[] {
  const area = polygonArea(outline);
  if (area <= 0 || acres <= 0) return outline;
  const k = Math.sqrt((acres * ACRE_SQ_IN) / area);
  const o = outline[0];
  return outline.map((p) => ({ x: o.x + (p.x - o.x) * k, y: o.y + (p.y - o.y) * k }));
}

const norm = (deg: number) => ((deg % 360) + 360) % 360;

/**
 * Turning from the drawing to compass directions. A direction drawn at
 * screen angle `a` (clockwise from up) is compass bearing `a - northDeg`.
 */
export function drawingToCompass(northDeg: number) {
  const r = (-northDeg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return {
    bearing: (deg: number) => norm(deg - northDeg),
    /** Turn a point about the drawing's origin (no shift yet). */
    turn: (p: Point): Point => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }),
  };
}

/**
 * Converts between the designer's drawing frame and the plot's compass frame,
 * without rounding, so drawings built on the plot's terrain (contour lines)
 * can be placed back on the designer canvas.
 */
export function landFrame(settings: CustomLand) {
  const t = drawingToCompass(settings.northDeg);
  const back = drawingToCompass(-settings.northDeg);
  const turned = settings.outline.map(t.turn);
  const minX = Math.min(...turned.map((p) => p.x));
  const minY = Math.min(...turned.map((p) => p.y));
  return {
    toPlot: (p: Point): Point => {
      const q = t.turn(p);
      return { x: q.x - minX, y: q.y - minY };
    },
    toDesigner: (p: Point): Point => back.turn({ x: p.x + minX, y: p.y + minY }),
  };
}

/** Turn designer settings into a full plot (compass frame, origin at the north-west of the lot's box). */
export function buildCustomPlot(settings: CustomLand): Plot {
  const t = drawingToCompass(settings.northDeg);
  const turned = settings.outline.map(t.turn);
  const minX = Math.min(...turned.map((p) => p.x));
  const minY = Math.min(...turned.map((p) => p.y));
  const maxX = Math.max(...turned.map((p) => p.x));
  const maxY = Math.max(...turned.map((p) => p.y));
  const place = (p: Point): Point => {
    const q = t.turn(p);
    return { x: Math.round(q.x - minX), y: Math.round(q.y - minY) };
  };

  const outline = settings.outline.map(place);
  const water: WaterFeature[] = settings.water.map((w) => ({ kind: w.kind, points: w.points.map(place) }));
  const features: LandFeature[] = settings.features.map((f) => ({ ...f, at: place(f.at) }));
  const lanes: Lane[] = settings.lanes.map((l) => ({ ...l, points: l.points.map(place) }));
  const ground: GroundShape[] = settings.ground.map((g) => ({ ...g, at: place(g.at) }));
  const roads: Road[] = settings.roads.filter((r) => r.edge < outline.length).map((r) => ({ ...r }));

  const downhillDeg = Math.round(t.bearing(settings.slope.downhillDeg));
  const soil = SOIL_TYPES.find((s) => s.name === settings.soil) ?? SOIL_TYPES[2];
  const main = roads.find((r) => r.kind === "main") ?? roads[0];

  return {
    seed: settings.seed,
    isFlat: false,
    source: "custom",
    custom: structuredClone(settings),
    name: settings.name.trim() || "My land",
    shape: "custom",
    widthIn: Math.max(1, Math.round(maxX - minX)),
    depthIn: Math.max(1, Math.round(maxY - minY)),
    outline,
    slope: { percent: settings.slope.percent, downhillDeg },
    facingDeg: downhillDeg,
    drainage: rateDrainage(settings.slope.percent, soil, water.map((w) => w.kind)),
    soilNote: soil.note,
    waterFeatures: water,
    roadSide: main ? edgeSide(outline, main.edge) : "S",
    features,
    roads,
    lanes,
    ground,
    rolls: settings.rolls,
  };
}

/** The ends of edge `i` of an outline (from corner i to the next). */
export function edgeEnds(outline: Point[], i: number): [Point, Point] {
  return [outline[i], outline[(i + 1) % outline.length]];
}

/** Compass bearing an outline edge faces, pointing away from the lot. */
export function edgeFacingDeg(outline: Point[], i: number): number {
  const [a, b] = edgeEnds(outline, i);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const c = centroid(outline);
  let n = { x: b.y - a.y, y: -(b.x - a.x) };
  if (n.x * (mid.x - c.x) + n.y * (mid.y - c.y) < 0) n = { x: -n.x, y: -n.y };
  // Plot frame: x east, y south, so bearing = atan2(east, north).
  return norm((Math.atan2(n.x, -n.y) * 180) / Math.PI);
}

/** The compass side (N, E, S or W) an outline edge faces. */
export function edgeSide(outline: Point[], i: number): Plot["roadSide"] {
  return nearestSide(edgeFacingDeg(outline, i));
}

export type RoadEdge = { road: Road; a: Point; b: Point; side: Plot["roadSide"]; facingDeg: number };

/**
 * Every road along the lot, with its edge's ends. Made-up plots list no roads,
 * so they get one main road on the edge that best faces their road side.
 */
export function plotRoadEdges(plot: Plot): RoadEdge[] {
  const o = plot.outline;
  const roads: Road[] = plot.roads.length
    ? plot.roads.filter((r) => r.edge < o.length)
    : [{ id: "main", edge: bestEdgeFor(plot), kind: "main", widthFt: 26 }];
  return roads.map((road) => {
    const [a, b] = edgeEnds(o, road.edge);
    const facingDeg = edgeFacingDeg(o, road.edge);
    return { road, a, b, side: nearestSide(facingDeg), facingDeg };
  });
}

const SIDE_DEG = { N: 0, E: 90, S: 180, W: 270 } as const;

function bestEdgeFor(plot: Plot): number {
  const want = SIDE_DEG[plot.roadSide];
  let best = 0;
  let score = -Infinity;
  plot.outline.forEach((_, i) => {
    const [a, b] = edgeEnds(plot.outline, i);
    const s = Math.cos(((edgeFacingDeg(plot.outline, i) - want) * Math.PI) / 180) * Math.hypot(b.x - a.x, b.y - a.y);
    if (s > score) {
      score = s;
      best = i;
    }
  });
  return best;
}
