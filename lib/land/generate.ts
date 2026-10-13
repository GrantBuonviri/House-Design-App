import type { Plot, Point } from "@/lib/model/schema";
import { compassName } from "./sun";
import { createRng, hashSeeds, type Rng } from "./random";

/** Square inches in one acre. */
export const ACRE_SQ_IN = 43560 * 144;

/** The seed used for the always-available perfectly flat plot. */
export const FLAT_PLOT_SEED = 1;

const NAME_FIRST = [
  "Sagebrush", "Cottonwood", "Quail", "Juniper", "Bitterbrush", "Aspen", "Ponderosa", "Willow",
  "Elk", "Basalt", "Owyhee", "Red Tail", "Bluebird", "Larkspur", "Syringa", "Chokecherry",
  "Cedar", "Meadowlark", "Sawtooth", "Hidden", "Lone Pine", "Granite", "Badger", "Deer Flat",
] as const;
const NAME_SECOND = [
  "Bench", "Draw", "Ridge", "Hollow", "Flats", "Meadow", "Knoll", "Terrace", "Gulch",
  "Rise", "Point", "Hill", "Canyon", "Springs", "Crossing", "Overlook",
] as const;

type Soil = { name: string; note: string; drainage: number };
const SOILS: readonly (readonly [Soil, number])[] = [
  [{ name: "Sandy loam", note: "Sandy loam: drains well and is easy to dig.", drainage: 1 }, 4],
  [{ name: "Decomposed granite", note: "Decomposed granite, typical of the Boise foothills: drains fast but erodes on steep cuts.", drainage: 1 }, 3],
  [{ name: "Silty loam", note: "Silty loam, common in the Treasure Valley: good for building, holds some water.", drainage: 0 }, 4],
  [{ name: "Clay loam", note: "Clay loam: drains slowly and swells when wet, so the foundation needs good drainage.", drainage: -1 }, 2],
  [{ name: "Caliche", note: "Gravelly loam over a caliche hardpan: water can't soak in deep, and digging is harder.", drainage: -1 }, 2],
  [{ name: "Heavy clay", note: "Heavy clay: drains poorly and may need engineered fill under the house.", drainage: -2 }, 1],
];

export type GenerateOptions = { flat?: boolean };

/** Rebuild a plot exactly from its seed and flat flag. */
export function regeneratePlot(plot: Pick<Plot, "seed" | "isFlat">): Plot {
  return generatePlot(plot.seed, { flat: plot.isFlat });
}

/** The seed for the nth card of an infinite feed. */
export function feedPlotSeed(feedSeed: number, index: number): number {
  const s = hashSeeds(feedSeed, index);
  // Keep clear of the flat plot's seed so the two never collide.
  return s === FLAT_PLOT_SEED ? s + 1 : s;
}

/**
 * Make a believable, made-up plot of land in the Boise area. Pure and
 * deterministic: the same seed always returns the same plot.
 */
export function generatePlot(seed: number, opts: GenerateOptions = {}): Plot {
  if (opts.flat) return flatPlot(seed);
  const rng = createRng(seed);

  // Size and shape
  const acres = rng.weighted<[number, number]>([
    [[0.25, 0.5], 3],
    [[0.5, 1.5], 4],
    [[1.5, 3], 2],
    [[3, 6], 1],
  ]);
  const targetAcres = rng.range(acres[0], acres[1]);
  const shape = rng.weighted<NonNullable<Plot["shape"]>>([
    ["rectangle", 4],
    ["wide", 2],
    ["deep", 2],
    ["corner", 1],
    ["irregular", 2],
  ]);
  const aspect =
    shape === "wide" ? rng.range(1.6, 2.4) : shape === "deep" ? 1 / rng.range(1.6, 2.4) : rng.range(0.8, 1.35);
  const area = targetAcres * ACRE_SQ_IN;
  const widthIn = round(Math.sqrt(area * aspect));
  const depthIn = round(area / widthIn);
  const outline = makeOutline(shape, widthIn, depthIn, rng);

  // Slope
  const slopeBand = rng.weighted<[number, number]>([
    [[0.5, 3], 3],
    [[3, 8], 4],
    [[8, 15], 2.5],
    [[15, 25], 1],
  ]);
  const slopePercent = round1(rng.range(slopeBand[0], slopeBand[1]));
  const downhillDeg = rng.int(0, 359);

  // Soil and water
  const soil = rng.weighted(SOILS);
  const roadSide = rng.pick(["N", "E", "S", "W"] as const);
  const waterKind = rng.chance(0.42)
    ? rng.weighted<"creek" | "pond" | "lake" | "wash">([
        ["creek", 3],
        ["wash", 3],
        ["pond", 2],
        ["lake", 1],
      ])
    : null;
  const waterFeatures = waterKind ? [makeWater(waterKind, widthIn, depthIn, downhillDeg, rng)] : [];

  const drainage = rateDrainage(slopePercent, soil, waterKind);

  return {
    seed,
    isFlat: false,
    name: `${rng.pick(NAME_FIRST)} ${rng.pick(NAME_SECOND)}`,
    shape,
    widthIn,
    depthIn,
    outline,
    slope: { percent: slopePercent, downhillDeg },
    facingDeg: downhillDeg,
    drainage,
    soilNote: soil.note,
    waterFeatures,
    roadSide,
  };
}

function flatPlot(seed: number): Plot {
  const side = round(Math.sqrt(ACRE_SQ_IN)); // one acre, square
  return {
    seed,
    isFlat: true,
    name: "Perfectly flat plot",
    shape: "rectangle",
    widthIn: side,
    depthIn: side,
    outline: [
      { x: 0, y: 0 },
      { x: side, y: 0 },
      { x: side, y: side },
      { x: 0, y: side },
    ],
    slope: { percent: 0, downhillDeg: 180 },
    facingDeg: 180,
    drainage: { rating: "good", reason: "A level, graded pad that sheds water away from the house." },
    soilNote: "Compacted engineered fill over sandy loam: an easy, predictable base to build on.",
    waterFeatures: [],
    roadSide: "S",
  };
}

function makeOutline(shape: NonNullable<Plot["shape"]>, w: number, d: number, rng: Rng): Point[] {
  const rect = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: d },
    { x: 0, y: d },
  ];
  if (shape === "corner") {
    // One corner clipped off, like a lot on a curve in the road.
    const cut = rng.int(0, 3);
    const cx = w * rng.range(0.2, 0.4);
    const cy = d * rng.range(0.2, 0.4);
    const toward = (from: Point, to: Point): Point => {
      const horizontal = from.y === to.y;
      const len = horizontal ? cx : cy;
      const dist = horizontal ? Math.abs(to.x - from.x) : Math.abs(to.y - from.y);
      return {
        x: from.x + ((to.x - from.x) / dist) * len,
        y: from.y + ((to.y - from.y) / dist) * len,
      };
    };
    const pts: Point[] = [];
    rect.forEach((p, i) => {
      if (i !== cut) {
        pts.push(p);
        return;
      }
      pts.push(toward(p, rect[(i + 3) % 4]), toward(p, rect[(i + 1) % 4]));
    });
    return pts.map(roundPoint);
  }
  if (shape === "irregular") {
    // Pull each corner inward a little so no two sides are parallel.
    return rect.map((p) => ({
      x: p.x === 0 ? w * rng.range(0, 0.18) : w * (1 - rng.range(0, 0.18)),
      y: p.y === 0 ? d * rng.range(0, 0.18) : d * (1 - rng.range(0, 0.18)),
    })).map(roundPoint);
  }
  return rect;
}

/** Unit vector pointing toward a compass bearing, in plot coordinates (x east, y south). */
export function bearingVector(bearingDeg: number): Point {
  const r = (bearingDeg * Math.PI) / 180;
  return { x: Math.sin(r), y: -Math.cos(r) };
}

function makeWater(
  kind: "creek" | "pond" | "lake" | "wash",
  w: number,
  d: number,
  downhillDeg: number,
  rng: Rng,
): Plot["waterFeatures"][number] {
  const center = { x: w / 2, y: d / 2 };
  const down = bearingVector(downhillDeg);
  const across = { x: -down.y, y: down.x };
  const span = Math.hypot(w, d);

  if (kind === "creek" || kind === "wash") {
    // Runs downhill across the plot, offset to one side, with gentle bends.
    const offset = rng.range(-0.3, 0.3) * Math.min(w, d);
    const bend = rng.range(0.04, 0.1) * Math.min(w, d);
    const phase = rng.range(0, Math.PI * 2);
    const points: Point[] = [];
    const steps = 14;
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps - 0.5) * span * 1.1;
      const wiggle = offset + Math.sin(phase + (i / steps) * Math.PI * 2.2) * bend;
      points.push(
        roundPoint({
          x: center.x + down.x * t + across.x * wiggle,
          y: center.y + down.y * t + across.y * wiggle,
        }),
      );
    }
    return { kind, points };
  }

  if (kind === "pond") {
    // A rounded pond in the lower part of the plot.
    const r = Math.min(w, d) * rng.range(0.08, 0.14);
    const c = {
      x: center.x + down.x * Math.min(w, d) * 0.22 + across.x * rng.range(-0.2, 0.2) * Math.min(w, d),
      y: center.y + down.y * Math.min(w, d) * 0.22 + across.y * rng.range(-0.2, 0.2) * Math.min(w, d),
    };
    const points: Point[] = [];
    const n = 14;
    const lobes = rng.range(0, Math.PI * 2);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * (1 + 0.18 * Math.sin(a * 2 + lobes) + 0.1 * Math.sin(a * 3 + lobes * 2));
      points.push(roundPoint({ x: c.x + Math.cos(a) * rr * 1.25, y: c.y + Math.sin(a) * rr }));
    }
    return { kind, points };
  }

  // Lake frontage: the shoreline runs along the downhill edge, water beyond it.
  const side = nearestSide(downhillDeg);
  const shoreInset = rng.range(0.04, 0.1);
  const wobble = rng.range(0, Math.PI * 2);
  const far = span; // the lake extends well past the plot
  const pts: Point[] = [];
  const n = 12;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const wave = Math.sin(wobble + t * Math.PI * 3) * 0.025;
    if (side === "S") pts.push({ x: t * w, y: d * (1 - shoreInset + wave) });
    if (side === "N") pts.push({ x: (1 - t) * w, y: d * (shoreInset + wave) });
    if (side === "E") pts.push({ x: w * (1 - shoreInset + wave), y: (1 - t) * d });
    if (side === "W") pts.push({ x: w * (shoreInset + wave), y: t * d });
  }
  if (side === "S") pts.push({ x: w + far, y: d + far }, { x: -far, y: d + far });
  if (side === "N") pts.push({ x: -far, y: -far }, { x: w + far, y: -far });
  if (side === "E") pts.push({ x: w + far, y: -far }, { x: w + far, y: d + far });
  if (side === "W") pts.push({ x: -far, y: d + far }, { x: -far, y: -far });
  return { kind: "lake", points: pts.map(roundPoint) };
}

export function nearestSide(bearingDeg: number): "N" | "E" | "S" | "W" {
  return (["N", "E", "S", "W"] as const)[Math.round((((bearingDeg % 360) + 360) % 360) / 90) % 4];
}

function rateDrainage(
  slopePercent: number,
  soil: Soil,
  water: "creek" | "pond" | "lake" | "wash" | null,
): Plot["drainage"] {
  const factors: { score: number; text: string }[] = [{ score: soil.drainage, text: soilReason(soil) }];
  if (slopePercent < 1.5) factors.push({ score: -1.25, text: "the ground is nearly level, so rain can pond" });
  else if (slopePercent <= 12) factors.push({ score: 0.5, text: "a gentle slope carries rain away" });
  else if (slopePercent > 18) factors.push({ score: -0.75, text: "steep ground sends fast runoff toward any cut" });
  if (water === "creek" || water === "pond" || water === "lake")
    factors.push({ score: -1, text: `the ${water} means a higher water table` });
  if (water === "wash") factors.push({ score: -1, text: "a seasonal wash floods across it in spring storms" });

  const total = factors.reduce((s, f) => s + f.score, 0);
  const rating = total >= 0.5 ? "good" : total >= -0.75 ? "fair" : "poor";
  // Explain with the factor that pushed the rating hardest in its direction.
  const sorted = [...factors].sort((a, b) => (rating === "good" ? b.score - a.score : a.score - b.score));
  const reason = sorted[0].text;
  return { rating, reason: reason.charAt(0).toUpperCase() + reason.slice(1) + "." };
}

function soilReason(soil: Soil): string {
  if (soil.drainage > 0) return `${soil.name.toLowerCase()} soil drains quickly`;
  if (soil.drainage === 0) return `${soil.name.toLowerCase()} soil drains at a moderate pace`;
  if (soil.name === "Caliche") return "a caliche hardpan stops water from soaking in";
  return `${soil.name.toLowerCase()} soil drains slowly`;
}

/** Area inside the outline, in square inches (shoelace formula). */
export function polygonArea(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function plotAcres(plot: Plot): number {
  return polygonArea(plot.outline) / ACRE_SQ_IN;
}

/** One-line description of the slope, e.g. "6% grade, falls to the south-east". */
export function describeSlope(plot: Plot): string {
  if (plot.slope.percent < 0.5) return "Flat";
  return `${plot.slope.percent}% grade, falls to the ${compassName(plot.slope.downhillDeg)}`;
}

const round = (n: number) => Math.round(n);
const round1 = (n: number) => Math.round(n * 10) / 10;
const roundPoint = (p: Point): Point => ({ x: Math.round(p.x), y: Math.round(p.y) });
