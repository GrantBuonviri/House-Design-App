import type { CustomLand, Point, Road, WaterFeature } from "@/lib/model/schema";
import { centroid } from "./geometry";
import { groundLabel } from "./groundTools";

/**
 * Editing helpers for the designer's natural features, roads and lanes. Pure
 * functions on the designer's settings (inches, the frame the lot was drawn in).
 */

const FT = 12;
const round = (p: Point): Point => ({ x: Math.round(p.x), y: Math.round(p.y) });

/** What is selected in the designer, besides the lot's corners. */
export type Pick =
  | { type: "water"; index: number }
  | { type: "feature"; index: number }
  | { type: "lane"; index: number }
  | { type: "road"; index: number }
  | { type: "ground"; index: number }
  | null;

export type PathKind = "creek" | "river" | "wash";
export const PATH_KINDS: { id: PathKind; label: string }[] = [
  { id: "creek", label: "Creek" },
  { id: "river", label: "River" },
  { id: "wash", label: "Dry wash" },
];

export const TREE_SIZES = [
  { id: "small", label: "Small", ft: 12 },
  { id: "medium", label: "Medium", ft: 22 },
  { id: "large", label: "Large", ft: 34 },
] as const;
export const ROCK_MIN_FT = 3;
export const ROCK_MAX_FT = 20;
export const LANE_MIN_FT = 12;
export const LANE_MAX_FT = 20;

export function isPathWater(w: WaterFeature): w is WaterFeature & { kind: PathKind } {
  return w.kind === "creek" || w.kind === "river" || w.kind === "wash";
}

export function addWater(land: CustomLand, kind: WaterFeature["kind"], points: Point[]): CustomLand {
  return { ...land, water: [...land.water, { kind, points: points.map(round) }] };
}

/** A rounded pond outline of ten points around `center`. */
export function pondShape(center: Point, radiusFt: number): Point[] {
  const r = radiusFt * FT;
  return Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2;
    // A little unevenness so it doesn't look like a coin.
    const k = 1 + 0.08 * Math.sin(i * 2.3);
    return round({ x: center.x + Math.cos(a) * r * k, y: center.y + Math.sin(a) * r * k });
  });
}

export function addPond(land: CustomLand, center: Point, radiusFt: number): CustomLand {
  return addWater(land, "pond", pondShape(center, Math.max(8, radiusFt)));
}

/**
 * A lake along side `edge`: the shore follows the side (with two handles you
 * can push in or out) and the water reaches `reachFt` beyond the lot.
 */
export function lakeShape(outline: Point[], edge: number, reachFt = 120): Point[] {
  const a = outline[edge];
  const b = outline[(edge + 1) % outline.length];
  const c = centroid(outline);
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  let nx = (b.y - a.y) / len;
  let ny = -(b.x - a.x) / len;
  if (nx * ((a.x + b.x) / 2 - c.x) + ny * ((a.y + b.y) / 2 - c.y) < 0) {
    nx = -nx;
    ny = -ny;
  }
  const at = (t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const far = reachFt * FT;
  const out = (p: Point): Point => round({ x: p.x + nx * far, y: p.y + ny * far });
  return [a, at(1 / 3), at(2 / 3), b].map(round).concat([out(b), out(a)]);
}

export function addLake(land: CustomLand, edge: number): CustomLand {
  return addWater(land, "lake", lakeShape(land.outline, edge));
}

export function addFeature(land: CustomLand, kind: "rock" | "tree", at: Point, sizeFt: number): CustomLand {
  return { ...land, features: [...land.features, { id: crypto.randomUUID(), kind, at: round(at), sizeFt }] };
}

/**
 * Trees from `from` to `to` (a Shift-drag): one every `spacingFt`, nudged a
 * little so a row doesn't look ruled. With `from` null it's a single tree.
 */
export function addTreesAlong(land: CustomLand, from: Point | null, to: Point, sizeFt: number, spacingFt = sizeFt * 0.9): CustomLand {
  const spots: Point[] = [];
  if (!from) spots.push(to);
  else {
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const n = Math.max(1, Math.floor(dist / (spacingFt * FT)));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const jitter = (k: number) => Math.sin((land.features.length + i) * k) * spacingFt * FT * 0.12;
      spots.push({ x: from.x + (to.x - from.x) * t + jitter(12.9898), y: from.y + (to.y - from.y) * t + jitter(78.233) });
    }
  }
  let next = land;
  for (const s of spots) next = addFeature(next, "tree", s, sizeFt);
  return next;
}

export function setFeatureSize(land: CustomLand, index: number, sizeFt: number): CustomLand {
  const f = land.features[index];
  if (!f) return land;
  const [lo, hi] = f.kind === "rock" ? [ROCK_MIN_FT, ROCK_MAX_FT] : [6, 60];
  return { ...land, features: land.features.map((g, i) => (i === index ? { ...g, sizeFt: Math.min(hi, Math.max(lo, sizeFt)) } : g)) };
}

export function addLane(land: CustomLand, points: Point[], widthFt = 14): CustomLand {
  return { ...land, lanes: [...land.lanes, { id: crypto.randomUUID(), points: points.map(round), widthFt }] };
}

export function setLaneWidth(land: CustomLand, index: number, widthFt: number): CustomLand {
  const w = Math.min(LANE_MAX_FT, Math.max(LANE_MIN_FT, widthFt));
  return { ...land, lanes: land.lanes.map((l, i) => (i === index ? { ...l, widthFt: w } : l)) };
}

/** Change what a river, creek or wash is called. */
export function setPathKind(land: CustomLand, index: number, kind: PathKind): CustomLand {
  const w = land.water[index];
  if (!w || !isPathWater(w)) return land;
  return { ...land, water: land.water.map((x, i) => (i === index ? { ...x, kind } : x)) };
}

/** Put a road along side `edge`. The first road is the main street; later ones are side streets. */
export function addRoad(land: CustomLand, edge: number): CustomLand {
  if (edge < 0 || edge >= land.outline.length || land.roads.some((r) => r.edge === edge)) return land;
  const hasMain = land.roads.some((r) => r.kind === "main");
  const road: Road = { id: crypto.randomUUID(), edge, kind: hasMain ? "side" : "main", widthFt: hasMain ? 22 : 26 };
  return { ...land, roads: [...land.roads, road].sort((a, b) => a.edge - b.edge) };
}

export function removeRoad(land: CustomLand, index: number): CustomLand {
  const gone = land.roads[index];
  if (!gone) return land;
  const roads = land.roads.filter((_, i) => i !== index);
  // A lot always keeps a main street if it has any road.
  if (gone.kind === "main" && roads.length && !roads.some((r) => r.kind === "main")) roads[0] = { ...roads[0], kind: "main" };
  return { ...land, roads };
}

export function setMainRoad(land: CustomLand, index: number): CustomLand {
  if (!land.roads[index]) return land;
  return { ...land, roads: land.roads.map((r, i) => ({ ...r, kind: i === index ? "main" : "side" })) };
}

export function removePick(land: CustomLand, pick: NonNullable<Pick>): CustomLand {
  const drop = <T,>(list: T[]) => list.filter((_, i) => i !== pick.index);
  if (pick.type === "road") return removeRoad(land, pick.index);
  if (pick.type === "water") return { ...land, water: drop(land.water) };
  if (pick.type === "feature") return { ...land, features: drop(land.features) };
  if (pick.type === "ground") return { ...land, ground: drop(land.ground) };
  return { ...land, lanes: drop(land.lanes) };
}

/** Move one point of a river, pond, lake or lane. */
export function movePoint(land: CustomLand, pick: NonNullable<Pick>, v: number, to: Point): CustomLand {
  const set = (pts: Point[]) => pts.map((p, k) => (k === v ? round(to) : p));
  if (pick.type === "water") return { ...land, water: land.water.map((w, i) => (i === pick.index ? { ...w, points: set(w.points) } : w)) };
  if (pick.type === "lane") return { ...land, lanes: land.lanes.map((l, i) => (i === pick.index ? { ...l, points: set(l.points) } : l)) };
  return land;
}

/** Move a rock or tree. */
export function moveFeature(land: CustomLand, index: number, to: Point): CustomLand {
  return { ...land, features: land.features.map((f, i) => (i === index ? { ...f, at: round(to) } : f)) };
}

/** Take out one point (never leaving a path under two points or a shape under three). */
export function removePoint(land: CustomLand, pick: NonNullable<Pick>, v: number): CustomLand {
  const without = (pts: Point[], min: number) => (pts.length > min ? pts.filter((_, k) => k !== v) : pts);
  if (pick.type === "water") {
    const closed = (w: WaterFeature) => w.kind === "pond" || w.kind === "lake";
    return { ...land, water: land.water.map((w, i) => (i === pick.index ? { ...w, points: without(w.points, closed(w) ? 3 : 2) } : w)) };
  }
  if (pick.type === "lane") return { ...land, lanes: land.lanes.map((l, i) => (i === pick.index ? { ...l, points: without(l.points, 2) } : l)) };
  return land;
}

/**
 * True when a path drawn from its first to its last point climbs: water
 * flows downhill, so a river drawn that way would run uphill.
 */
export function flowsUphill(land: CustomLand, points: Point[]): boolean {
  if (points.length < 2 || land.slope.percent < 0.5) return false;
  const a = (land.slope.downhillDeg * Math.PI) / 180;
  const first = points[0];
  const last = points[points.length - 1];
  const along = (last.x - first.x) * Math.sin(a) + (last.y - first.y) * -Math.cos(a);
  // Ignore a path that barely changes height (under a foot of drop).
  return along * (land.slope.percent / 100) < -FT;
}

/** Name for a selected thing, for the panel. */
export function pickLabel(land: CustomLand, pick: NonNullable<Pick>): string {
  if (pick.type === "road") return land.roads[pick.index]?.kind === "main" ? "Main street" : "Side street";
  if (pick.type === "lane") return "Lane";
  if (pick.type === "ground") return groundLabel(land.ground[pick.index]?.kind);
  if (pick.type === "feature") return land.features[pick.index]?.kind === "rock" ? "Big rock" : "Tree";
  const w = land.water[pick.index];
  return w ? { creek: "Creek", river: "River", wash: "Dry wash", pond: "Pond", lake: "Lake" }[w.kind] : "";
}
