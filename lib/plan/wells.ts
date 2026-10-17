import type { FloorPlan, Level, Opening, PlanBasics, Point } from "@/lib/model/schema";
import { codeNum, codeRef } from "@/lib/codes/data";
import { escapeCheck } from "@/lib/codes/openings";
import { FLOOR_ABOVE_GRADE_IN } from "@/lib/house3d/site";
import { levelHeights } from "@/lib/house3d/levels";
import { exteriorWallIn } from "./basics";
import { openingRooms } from "./connect";
import { planOf, type Plans } from "./edit";
import { add, pointInPolygon, scale } from "./geometry";
import { areaKind } from "./measure";
import { openingGeometries } from "./walls";
import { flatPlans } from "./flatten";

/**
 * Window wells, worked out by code (nothing is saved): every escape window
 * on a basement floor gets one, dug outside the wall so you can climb up
 * and out (IRC R310.2.3). At least 9 sq ft, sticking out at least 36" and
 * as wide as the window plus 6" each side (36" at least), with a ladder
 * when it's deeper than 44".
 */

export type WindowWell = {
  levelId: string;
  openingId: string;
  /** The well's outline on the plan, outside the wall's outer face. */
  outline: Point[];
  /** Middle of the well's open side, away from the house: where its label goes. */
  outer: Point;
  widthIn: number;
  projectionIn: number;
  /** From the ground down to the gravel, inches. */
  depthIn: number;
  ladder: boolean;
};

/** Gravel goes this far below the window's sill. */
const BELOW_SILL_IN = 6;
const SIDE_IN = 6;

/** Ground height at a plan point, inches relative to the main floor. Left out: flat ground, the usual 8" below the main floor. */
type GroundAt = (p: Point) => number;

export function windowWells(plans: Plans, levels: Level[], basics: PlanBasics | null, groundAt: GroundAt = () => -FLOOR_ABOVE_GRADE_IN): WindowWell[] {
  plans = flatPlans(plans);
  const covered = coveredAbove(plans, levels);
  const heights = levelHeights(levels, basics);
  const half = exteriorWallIn(basics) / 2;
  const out: WindowWell[] = [];
  for (const level of levels) {
    if (level.kind !== "basement") continue;
    const plan = planOf(plans, level.id);
    for (const g of openingGeometries(plan)) {
      const o = g.opening;
      if (o.kind !== "window" || !escapeCheck(o, true).ok || !outsideOf(plan, o, g.center, g.n, half)) continue;
      // Under the main floor there's no ground to dig a well in: the window looks into the house's foundation.
      if (covered.some((poly) => pointInPolygon(add(g.center, scale(g.n, half + 18)), poly))) continue;
      const projectionIn = codeNum("egress.windowWellProjection");
      const widthIn = Math.max(o.widthIn + 2 * SIDE_IN, Math.ceil((codeNum("egress.windowWellArea") * 144) / projectionIn));
      const face = add(g.center, scale(g.n, half));
      const along = (t: number, d: number) => add(add(face, scale(g.u, t)), scale(g.n, d));
      const outline = [along(-widthIn / 2, 0), along(widthIn / 2, 0), along(widthIn / 2, projectionIn), along(-widthIn / 2, projectionIn)];
      const sillAt = heights[level.id].floorIn + (o.sillIn ?? 30);
      const depthIn = Math.max(0, Math.round(groundAt(along(0, projectionIn / 2)) - sillAt + BELOW_SILL_IN));
      out.push({ levelId: level.id, openingId: o.id, outline, outer: along(0, projectionIn), widthIn, projectionIn, depthIn, ladder: depthIn > codeNum("egress.windowWellLadderDepth") });
    }
  }
  return out;
}

/** Where the main floor covers the ground: a basement wall under it is buried, so it can't take a window to climb out of. */
export function coveredAbove(plans: Plans, levels: Level[]): Point[][] {
  return levels.filter((l) => l.kind === "main").flatMap((l) => (plans[l.id]?.rooms ?? []).filter((r) => areaKind(r) !== "outdoor").map((r) => r.polygon));
}

/** Does this window look outside (no indoor room just past the wall)? */
function outsideOf(plan: FloorPlan, o: Opening, center: Point, n: Point, half: number): boolean {
  if (!openingRooms(plan, o).includes(null)) return false;
  const p = add(center, scale(n, half + 18));
  return !plan.rooms.some((r) => areaKind(r) !== "outdoor" && pointInPolygon(p, r.polygon));
}

/** The plan note for a floor's wells: sizes and when a ladder is needed (IRC R310.2.3). */
export function wellNote(wells: WindowWell[]): string {
  const ladders = wells.filter((w) => w.ladder).length;
  const sizes = [...new Set(wells.map((w) => `${w.widthIn}" wide x ${w.projectionIn}" out`))].join(", ");
  return `Window wells (WELL): galvanized metal, ${sizes}, at least ${codeNum("egress.windowWellArea")} sq ft and ${codeNum("egress.windowWellProjection")}" out from the wall, gravel bottom drained to the foundation drain. ${ladders ? `Wells deeper than ${codeNum("egress.windowWellLadderDepth")}" get a permanent ladder or steps that the open window doesn't block (${codeRef("egress.windowWellLadderDepth")}).` : ""}`.trim();
}
