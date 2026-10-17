import type { FloorPlan, Plot, Point, Project } from "@/lib/model/schema";
import { MAIN_LEVEL_ID } from "@/lib/brief/levels";
import { diagramOf } from "@/lib/bubbles/edit";
import { defaultLotOffset, houseCenter, lotCenter } from "@/lib/bubbles/land";
import { createTerrain, type HeightFn } from "@/lib/land/terrain";
import { planOf } from "@/lib/plan/edit";
import { boundsOf, pointInPolygon } from "@/lib/plan/geometry";
import { areaKind } from "@/lib/plan/measure";
import { flatPlans } from "@/lib/plan/flatten";

/**
 * Where the house sits on the land. Plan and plot coordinates are both
 * inches with x east and y south; a plot point is a plan point plus the lot
 * offset (set by "Move on lot" in the flow sketch and floor plan).
 */

/** The main floor sits this far above the highest ground under it. */
export const FLOOR_ABOVE_GRADE_IN = 8;

/** The lot offset in use: the saved one, or the house centered on the lot. */
export function lotOffsetFor(p: Pick<Project, "plot" | "sketch" | "bubbles" | "floorPlans">): Point {
  if (p.sketch.lotOffset) return p.sketch.lotOffset;
  if (!p.plot) return { x: 0, y: 0 };
  const mainBubbles = diagramOf(p.bubbles, MAIN_LEVEL_ID).bubbles;
  if (mainBubbles.length) return defaultLotOffset(p.plot, mainBubbles);
  const bb = planBounds(p.floorPlans, true);
  const lot = lotCenter(p.plot);
  return bb ? { x: Math.round(lot.x - (bb.x0 + bb.x1) / 2), y: Math.round(lot.y - (bb.y0 + bb.y1) / 2) } : { x: 0, y: 0 };
}

/**
 * Where the middle of the house sits on the land (plot inches), for the notes that depend on
 * the ground under it (foundation, slope). Undefined until there is a house to place.
 */
export function houseSpot(p: Pick<Project, "plot" | "sketch" | "bubbles" | "floorPlans">): Point | undefined {
  if (!p.plot) return undefined;
  const bubbles = diagramOf(p.bubbles, MAIN_LEVEL_ID).bubbles;
  const bb = bubbles.length ? null : planBounds(p.floorPlans, true);
  if (!bubbles.length && !bb) return undefined;
  const mid = bubbles.length ? houseCenter(bubbles) : { x: (bb!.x0 + bb!.x1) / 2, y: (bb!.y0 + bb!.y1) / 2 };
  const off = lotOffsetFor(p);
  return { x: mid.x + off.x, y: mid.y + off.y };
}

/** The box around the house's rooms (the main floor's when `mainFirst` and it has any). */
export function planBounds(plans: Record<string, FloorPlan>, mainFirst = false) {
  plans = flatPlans(plans);
  const main = planOf(plans, MAIN_LEVEL_ID).rooms.flatMap((r) => r.polygon);
  const all = Object.values(plans).flatMap((pl) => pl.rooms.flatMap((r) => r.polygon));
  return boundsOf(mainFirst && main.length ? main : all);
}

export type Site = {
  plot: Plot | null;
  offset: Point;
  /** Ground height at a plot point, inches (relative to the middle of the plot). */
  terrain: HeightFn;
  /** Ground height of the main floor's floor, on the same scale as `terrain`. */
  base: number;
  /** Ground height at a plan point, inches relative to the main floor. */
  groundAt: (p: Point) => number;
};

/** Every 2 ft under the rooms, plus their corners. */
function samplesUnder(polys: Point[][]): Point[] {
  const out: Point[] = polys.flat();
  for (const poly of polys) {
    const bb = boundsOf(poly);
    if (!bb) continue;
    for (let x = bb.x0; x <= bb.x1; x += 24) for (let y = bb.y0; y <= bb.y1; y += 24) if (pointInPolygon({ x, y }, poly)) out.push({ x, y });
  }
  return out;
}

export function siteFor(plot: Plot | null, offset: Point, plans: Record<string, FloorPlan>): Site {
  plans = flatPlans(plans);
  const terrain = plot ? createTerrain(plot) : () => 0;
  const atPlan = (p: Point) => terrain(p.x + offset.x, p.y + offset.y);
  const indoor = (pl: FloorPlan | undefined) => (pl?.rooms ?? []).filter((r) => areaKind(r) !== "outdoor").map((r) => r.polygon);
  let polys = indoor(plans[MAIN_LEVEL_ID]);
  if (!polys.length) polys = Object.values(plans).flatMap(indoor);
  const pts = samplesUnder(polys);
  const ground = pts.length ? Math.max(...pts.map(atPlan)) : atPlan({ x: 0, y: 0 });
  const base = ground + FLOOR_ABOVE_GRADE_IN;
  return { plot, offset, terrain, base, groundAt: (p) => atPlan(p) - base };
}
