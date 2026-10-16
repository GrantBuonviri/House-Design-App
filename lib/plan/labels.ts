import type { FloorPlan, PlanLabels, Point } from "@/lib/model/schema";
import { formatFeetInches } from "@/lib/model/units";
import { add, boundsOf, dist, isRectangle, scale as scaleV, sub, unit, type Bounds } from "./geometry";
import type { OpeningGeometry } from "./walls";

/**
 * What the floor plan's labels say, and the measuring math behind them:
 * room sizes, the dimension strings around the outside, distance guides
 * while dragging, and the measuring tape. Pure functions, drawn by
 * `components/plan/PlanCanvasLayers.tsx`.
 */

export const DEFAULT_LABELS: PlanLabels = {
  hideAll: false,
  roomNames: true,
  sqft: true,
  roomSizes: true,
  wallLengths: true,
  outsideDims: true,
  openingTags: true,
  fixtureNames: true,
  textSize: 1,
  textColor: "dark",
  boldNames: true,
  background: "none",
  units: "feet",
};

/** Is this kind of label showing? Everything is off while "hide all" is on. */
export function labelOn(labels: PlanLabels, kind: "roomNames" | "sqft" | "roomSizes" | "wallLengths" | "outsideDims" | "openingTags" | "fixtureNames"): boolean {
  return !labels.hideAll && labels[kind];
}

/** A length as 12' 6" or, with inches only, 150". */
export function formatLength(inches: number, units: PlanLabels["units"] = "feet"): string {
  return units === "inches" ? `${Math.round(inches)}"` : formatFeetInches(inches);
}

/** "12' 6" × 14'" for a rectangle; for other shapes, the longest width and depth. */
export function roomSizeText(polygon: Point[], units: PlanLabels["units"] = "feet"): string {
  if (isRectangle(polygon, 1)) {
    const w = dist(polygon[0], polygon[1]);
    const d = dist(polygon[1], polygon[2]);
    return `${formatLength(w, units)} × ${formatLength(d, units)}`;
  }
  const b = boundsOf(polygon);
  if (!b) return "";
  return `${formatLength(b.x1 - b.x0, units)} × ${formatLength(b.y1 - b.y0, units)}`;
}

/** A door or window's size, like `3' × 6' 8"`. */
export function openingTagText(widthIn: number, heightIn: number, units: PlanLabels["units"] = "feet"): string {
  return `${formatLength(widthIn, units)} × ${formatLength(heightIn, units)}`;
}

// ---------- Outside dimension strings ----------

export type DimLine = {
  a: Point;
  b: Point;
  text: string;
  /** The side of the house this string is on. */
  side: "top" | "bottom" | "left" | "right";
  /** 1 for the stretch of each room, 2 for the overall length. */
  row: 1 | 2;
  /** Which way is out, away from the house. */
  out: Point;
};

const ROW_GAP_IN = 30;
const ROW_FIRST_IN = 36;
const MIN_STRETCH_IN = 12;

/** Sorted values with those within `tol` of each other merged into one. */
function cluster(values: number[], tol = 3): number[] {
  const out: number[] = [];
  for (const v of [...values].sort((x, y) => x - y)) {
    if (!out.length || v - out[out.length - 1] > tol) out.push(v);
  }
  return out;
}

/**
 * Dimension strings around the outside of a floor, like a real plan: on each
 * of the four sides, one string with each room's stretch and one with the
 * overall length. A side's stretches come from the rooms that reach that side.
 */
export function outsideDimensions(plan: FloorPlan, units: PlanLabels["units"] = "feet"): DimLine[] {
  const living = plan.rooms.filter((r) => r.polygon.length >= 3);
  const all = boundsOf(living.flatMap((r) => r.polygon));
  if (!all) return [];
  const lines: DimLine[] = [];
  const reach = 6;
  const sides: { side: DimLine["side"]; horizontal: boolean; edge: number; out: Point; touches: (b: Bounds) => boolean }[] = [
    { side: "top", horizontal: true, edge: all.y0, out: { x: 0, y: -1 }, touches: (b) => b.y0 <= all.y0 + reach },
    { side: "bottom", horizontal: true, edge: all.y1, out: { x: 0, y: 1 }, touches: (b) => b.y1 >= all.y1 - reach },
    { side: "left", horizontal: false, edge: all.x0, out: { x: -1, y: 0 }, touches: (b) => b.x0 <= all.x0 + reach },
    { side: "right", horizontal: false, edge: all.x1, out: { x: 1, y: 0 }, touches: (b) => b.x1 >= all.x1 - reach },
  ];
  for (const sd of sides) {
    const at = (along: number, row: 1 | 2): Point => {
      const off = ROW_FIRST_IN + (row - 1) * ROW_GAP_IN;
      return sd.horizontal ? { x: along, y: sd.edge + sd.out.y * off } : { x: sd.edge + sd.out.x * off, y: along };
    };
    const span = (b: Bounds): [number, number] => (sd.horizontal ? [b.x0, b.x1] : [b.y0, b.y1]);
    const touching = living.map((r) => boundsOf(r.polygon)!).filter(sd.touches);
    const breaks = cluster(touching.flatMap((b) => span(b)));
    const [lo, hi] = sd.horizontal ? [all.x0, all.x1] : [all.y0, all.y1];
    const stretches: [number, number][] = [];
    for (let i = 0; i + 1 < breaks.length; i++) {
      const [p, q] = [breaks[i], breaks[i + 1]];
      const mid = (p + q) / 2;
      if (q - p >= MIN_STRETCH_IN && touching.some((b) => span(b)[0] <= mid && mid <= span(b)[1])) stretches.push([p, q]);
    }
    // One stretch that is the whole side adds nothing beside the overall string.
    if (stretches.length > 1 || (stretches.length === 1 && hi - lo - (stretches[0][1] - stretches[0][0]) > 3)) {
      for (const [p, q] of stretches) lines.push({ a: at(p, 1), b: at(q, 1), text: formatLength(q - p, units), side: sd.side, row: 1, out: sd.out });
    }
    lines.push({ a: at(lo, 2), b: at(hi, 2), text: formatLength(hi - lo, units), side: sd.side, row: 2, out: sd.out });
  }
  return lines;
}

// ---------- Distance guides ----------

export type Guide = { from: Point; to: Point; inches: number };

type Seg = { a: Point; b: Point };

/** Where the ray from `o` along `dir` first hits a segment, in inches, or null. */
function rayHit(o: Point, dir: Point, seg: Seg): number | null {
  const e = sub(seg.b, seg.a);
  const den = dir.x * e.y - dir.y * e.x;
  if (Math.abs(den) < 1e-9) return null;
  const w = sub(seg.a, o);
  const t = (w.x * e.y - w.y * e.x) / den;
  const s = (w.x * dir.y - w.y * dir.x) / den;
  if (t < 0.5 || s < -1e-6 || s > 1 + 1e-6) return null;
  return t;
}

/** The walls of a plan as segments, leaving out the rooms and loose walls listed. */
export function wallSegments(plan: FloorPlan, skipRooms: string[] = [], skipWalls: string[] = []): Seg[] {
  const segs: Seg[] = [];
  for (const r of plan.rooms) {
    if (skipRooms.includes(r.id)) continue;
    r.polygon.forEach((a, i) => segs.push({ a, b: r.polygon[(i + 1) % r.polygon.length] }));
  }
  for (const w of plan.walls) if (!skipWalls.includes(w.id)) segs.push({ a: w.a, b: w.b });
  return segs;
}

const MAX_GUIDE_IN = 40 * 12;

/**
 * The distance from each side of a box being moved to the nearest wall in
 * that direction. Sides with nothing close, or touching, show no guide.
 */
export function distanceGuides(box: Bounds, segs: Seg[]): Guide[] {
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const sides: { o: Point; dir: Point }[] = [
    { o: { x: cx, y: box.y0 }, dir: { x: 0, y: -1 } },
    { o: { x: cx, y: box.y1 }, dir: { x: 0, y: 1 } },
    { o: { x: box.x0, y: cy }, dir: { x: -1, y: 0 } },
    { o: { x: box.x1, y: cy }, dir: { x: 1, y: 0 } },
  ];
  const out: Guide[] = [];
  for (const { o, dir } of sides) {
    let best: number | null = null;
    for (const seg of segs) {
      const t = rayHit(o, dir, seg);
      if (t !== null && (best === null || t < best)) best = t;
    }
    if (best !== null && best <= MAX_GUIDE_IN) out.push({ from: o, to: add(o, scaleV(dir, best)), inches: best });
  }
  return out;
}

/** How far a door or window sits from each end of its wall (the room corners). */
export function openingGuides(g: OpeningGeometry): Guide[] {
  const start = sub(g.center, scaleV(g.u, g.opening.offsetIn));
  const end = add(start, scaleV(g.u, g.hostLength));
  const out: Guide[] = [];
  if (dist(start, g.a) > 0.5) out.push({ from: start, to: g.a, inches: dist(start, g.a) });
  if (dist(g.b, end) > 0.5) out.push({ from: g.b, to: end, inches: dist(g.b, end) });
  return out;
}

// ---------- Measuring tape ----------

/** The distance and angle (degrees, 0 east, counterclockwise looking at the screen) between two points. */
export function tapeReading(a: Point, b: Point): { inches: number; angle: number } {
  const d = unit(sub(b, a));
  const deg = (Math.atan2(-d.y, d.x) * 180) / Math.PI;
  return { inches: dist(a, b), angle: Math.round(((deg % 360) + 360) % 360 * 10) / 10 };
}
