import type { LandFeature, Plot, Point } from "@/lib/model/schema";
import { plotRoadEdges, type RoadEdge } from "./custom";
import { closestPointOnPolyline, distanceToPolyline, pointInPolygon } from "./geometry";

/**
 * The house on its land: where the driveway can reach a road or lane, and
 * what the house sits on (a rock, water, a river bank, past the lot line).
 * Everything here is in plot inches (x east, y south); callers add the lot
 * offset to plan points first.
 */

const FT = 12;

/** The main road along its real lot edge (made-up plots get the edge facing their road side). */
export function mainRoad(plot: Plot): RoadEdge | null {
  const edges = plotRoadEdges(plot);
  return edges.find((e) => e.road.kind === "main") ?? edges[0] ?? null;
}

/** Plots drawn in the designer (or any with real roads or lanes) use their real edges; made-up plots keep the box side. */
const usesRealEdges = (plot: Plot) => plot.roads.length > 0 || plot.lanes.some((l) => l.points.length > 1);

export type Access = { at: Point; kind: "road" | "lane" };

/**
 * Where a driveway from `p` meets the street: the nearest point on the main
 * road's lot edge, or on a private lane when that's closer. Made-up plots
 * have no lanes and keep the straight line to their road side of the box.
 */
export function nearestAccess(plot: Plot, p: Point): Access {
  if (!usesRealEdges(plot)) {
    const xs = plot.outline.length ? plot.outline.map((q) => q.x) : [0, plot.widthIn];
    const ys = plot.outline.length ? plot.outline.map((q) => q.y) : [0, plot.depthIn];
    const at = {
      N: { x: p.x, y: Math.min(...ys) },
      S: { x: p.x, y: Math.max(...ys) },
      W: { x: Math.min(...xs), y: p.y },
      E: { x: Math.max(...xs), y: p.y },
    }[plot.roadSide];
    return { at, kind: "road" };
  }
  let best: Access | null = null;
  let bestD = Infinity;
  const road = mainRoad(plot);
  if (road) {
    const at = closestPointOnPolyline(p, [road.a, road.b]);
    best = { at, kind: "road" };
    bestD = Math.hypot(at.x - p.x, at.y - p.y);
  }
  for (const lane of plot.lanes) {
    if (lane.points.length < 2) continue;
    const q = closestPointOnPolyline(p, lane.points);
    // Meet the lane at its near edge, not its middle.
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    const half = (lane.widthFt * FT) / 2;
    const at = d > half ? { x: q.x + ((p.x - q.x) * half) / d, y: q.y + ((p.y - q.y) * half) / d } : q;
    const dd = Math.max(0, d - half);
    if (dd < bestD) {
      bestD = dd;
      best = { at, kind: "lane" };
    }
  }
  return best ?? { at: p, kind: "road" };
}

/** Points around and across a footprint: its corners, every 2 ft along its edges, and every 4 ft inside. */
function samplesOf(poly: Point[]): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 24));
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  for (let x = Math.min(...xs) + 24; x < Math.max(...xs); x += 48) {
    for (let y = Math.min(...ys) + 24; y < Math.max(...ys); y += 48) if (pointInPolygon({ x, y }, poly)) out.push({ x, y });
  }
  return out;
}

/** How close to running water is "in" it, and how close is on its bank. */
export const WATER_REACH_FT = {
  creek: { inFt: 5, bankFt: 25 },
  river: { inFt: 25, bankFt: 75 },
  wash: { inFt: 8, bankFt: 0 },
} as const;

export type LandHit =
  | { kind: "rock"; rock: LandFeature; footprint: number }
  | { kind: "water"; water: "pond" | "lake" | "creek" | "river"; footprint: number; at: Point }
  | { kind: "bank"; water: "creek" | "river"; footprint: number; at: Point; distFt: number }
  | { kind: "wash"; footprint: number; at: Point }
  | { kind: "lot"; footprint: number; at: Point };

/** A rock's circle overlaps the footprint. */
function rockOn(rock: LandFeature, poly: Point[]): boolean {
  const r = (rock.sizeFt * FT) / 2;
  if (pointInPolygon(rock.at, poly)) return true;
  for (let i = 0; i < poly.length; i++) {
    if (distanceToPolyline(rock.at, [poly[i], poly[(i + 1) % poly.length]]) < r) return true;
  }
  return false;
}

/**
 * What each footprint (plot inches) sits on: rocks, ponds, lakes, creeks and
 * rivers, a river or creek bank, a dry wash's path, or past the lot line.
 * `footprint` is the index of the footprint it was found under.
 */
export function landUnder(plot: Plot, footprints: Point[][]): LandHit[] {
  const out: LandHit[] = [];
  footprints.forEach((poly, i) => {
    if (poly.length < 3) return;
    const pts = samplesOf(poly);
    const past = plot.outline.length >= 3 ? pts.find((p) => !pointInPolygon(p, plot.outline)) : undefined;
    if (past) out.push({ kind: "lot", footprint: i, at: past });
    for (const f of plot.features) if (f.kind === "rock" && rockOn(f, poly)) out.push({ kind: "rock", rock: f, footprint: i });
    for (const w of plot.waterFeatures) {
      if (w.kind === "pond" || w.kind === "lake") {
        const wet = pts.find((p) => pointInPolygon(p, w.points)) ?? w.points.find((p) => pointInPolygon(p, poly));
        if (wet) out.push({ kind: "water", water: w.kind, footprint: i, at: wet });
        continue;
      }
      if (w.points.length < 2) continue;
      const crossing = w.points.find((p) => pointInPolygon(p, poly));
      let near = crossing ?? pts[0];
      let d = crossing ? 0 : Infinity;
      if (!crossing) {
        for (const p of pts) {
          const dd = distanceToPolyline(p, w.points);
          if (dd < d) {
            d = dd;
            near = p;
          }
        }
      }
      const reach = WATER_REACH_FT[w.kind];
      if (d <= reach.inFt * FT) out.push(w.kind === "wash" ? { kind: "wash", footprint: i, at: near } : { kind: "water", water: w.kind, footprint: i, at: near });
      else if (w.kind !== "wash" && d <= reach.bankFt * FT) out.push({ kind: "bank", water: w.kind, footprint: i, at: near, distFt: Math.round(d / FT) });
    }
  });
  return out;
}

/** The rocks the house sits on (each once), for the cost estimate. */
export function rocksUnder(plot: Plot, footprints: Point[][]): LandFeature[] {
  const seen = new Map<string, LandFeature>();
  for (const h of landUnder(plot, footprints)) if (h.kind === "rock") seen.set(h.rock.id, h.rock);
  return [...seen.values()];
}

/** Cubic yards to break up and haul away for a rock this many feet across (a half-buried boulder). */
export function rockCuyd(sizeFt: number): number {
  return ((Math.PI / 6) * sizeFt ** 3 * 0.75) / 27;
}
