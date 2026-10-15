import type { FloorPlan, Opening, Point, WindowOperation } from "@/lib/model/schema";
import { dist, pointInPolygon, project, edgesOf } from "@/lib/plan/geometry";
import { openingGeometries, type OpeningGeometry } from "@/lib/plan/walls";
import { openingRooms } from "@/lib/plan/connect";
import { codeNum, codeRef } from "./data";

/**
 * What the code needs to know about a door or window: how it opens, how
 * much glass it has, the clear opening you could climb through, and whether
 * it needs safety glass. Sizes on the plan are the unit's rough size, so
 * clear openings are estimates; the maker's numbers are the real ones.
 */

export type { WindowOperation };

export const OPERATION_LABEL: Record<WindowOperation, string> = {
  "single-hung": "Single-hung",
  "double-hung": "Double-hung",
  slider: "Slider",
  casement: "Casement",
  awning: "Awning",
  fixed: "Fixed",
};

/** What each one means, for the window panel. */
export const OPERATION_HINT: Record<WindowOperation, string> = {
  "single-hung": "Bottom half slides up",
  "double-hung": "Both halves slide",
  slider: "One half slides sideways",
  casement: "Swings out on side hinges, opens all the way",
  awning: "Hinged at the top, swings out",
  fixed: "Doesn't open",
};

/** How a window opens: what was picked for it, else what its type usually is. */
export function operationOf(o: Pick<Opening, "style" | "operation">): WindowOperation {
  if (o.operation) return o.operation;
  return defaultOperation(o.style);
}

export function defaultOperation(style: string): WindowOperation {
  if (style === "window-picture") return "fixed";
  if (style === "window-high") return "slider";
  return "single-hung";
}

/** The frame around the glass, inches, taken off the width and height. */
const FRAME_IN = 3.5;
/** Where two sashes meet. */
const RAIL_IN = 1.5;

/** The clear opening when a window is fully open, inches (zero for a fixed window). */
export function clearOpening(o: Pick<Opening, "style" | "operation" | "widthIn" | "heightIn">): { widthIn: number; heightIn: number; sqft: number } {
  const w = o.widthIn - FRAME_IN;
  const h = o.heightIn - FRAME_IN;
  let cw = 0;
  let ch = 0;
  switch (operationOf(o)) {
    case "single-hung":
    case "double-hung":
      cw = w;
      ch = (h - RAIL_IN) / 2;
      break;
    case "slider":
      cw = (w - RAIL_IN) / 2;
      ch = h;
      break;
    case "casement":
      cw = w - 2;
      ch = h;
      break;
    case "awning":
      cw = w;
      ch = h - 4;
      break;
    case "fixed":
      break;
  }
  cw = Math.max(0, cw);
  ch = Math.max(0, ch);
  return { widthIn: cw, heightIn: ch, sqft: (cw * ch) / 144 };
}

/** Glass area of a window or glass door, square feet. */
export function glassSqft(o: Pick<Opening, "kind" | "style" | "widthIn" | "heightIn">): number {
  if (o.kind === "window") return (Math.max(0, o.widthIn - FRAME_IN) * Math.max(0, o.heightIn - FRAME_IN)) / 144;
  if (o.style === "door-slider") return (Math.max(0, o.widthIn - 8) * Math.max(0, o.heightIn - 10)) / 144;
  return 0;
}

/** The part you can open for fresh air, square feet. */
export function openableSqft(o: Pick<Opening, "kind" | "style" | "operation" | "widthIn" | "heightIn">): number {
  if (o.kind === "window") return clearOpening(o).sqft;
  if (o.style === "door-slider") return glassSqft(o) / 2;
  return 0;
}

/** Glass panes in the unit, for the large-pane rule. */
function panes(o: Pick<Opening, "kind" | "style" | "operation">): number {
  if (o.kind !== "window") return 2;
  const op = operationOf(o);
  return op === "fixed" || op === "casement" || op === "awning" ? 1 : 2;
}

/** Does a window meet the emergency escape sizes? `gradeFloor` allows the smaller opening for basements. */
export function escapeCheck(o: Opening, gradeFloor: boolean): { ok: boolean; problems: string[]; clear: ReturnType<typeof clearOpening> } {
  const clear = clearOpening(o);
  const problems: string[] = [];
  const area = gradeFloor ? codeNum("egress.netClearOpeningGradeFloor") : codeNum("egress.netClearOpening");
  if (o.kind !== "window") return { ok: false, problems: ["not a window"], clear };
  if (clear.sqft < area - 0.005) problems.push(`clear opening about ${clear.sqft.toFixed(1)} sq ft (needs ${area})`);
  if (clear.heightIn < codeNum("egress.minClearHeight")) problems.push(`clear height about ${Math.round(clear.heightIn)}" (needs ${codeNum("egress.minClearHeight")}")`);
  if (clear.widthIn < codeNum("egress.minClearWidth")) problems.push(`clear width about ${Math.round(clear.widthIn)}" (needs ${codeNum("egress.minClearWidth")}")`);
  const sill = o.sillIn ?? 30;
  if (sill > codeNum("egress.maxSillHeight")) problems.push(`sill ${Math.round(sill)}" above the floor (${codeNum("egress.maxSillHeight")}" at most)`);
  return { ok: problems.length === 0, problems, clear };
}

const WET = new Set(["tub", "shower"]);

/**
 * Doors and windows that need safety glass (tempered or laminated), with the
 * reasons, for one floor. `stairs` are the stairs' outlines on this floor.
 */
export function safetyGlazing(plan: FloorPlan, stairs: Point[][]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const geos = openingGeometries(plan);
  const doors = geos.filter((g) => g.opening.kind === "door" && g.opening.style !== "door-garage");
  const add = (id: string, why: string) => out.set(id, [...(out.get(id) ?? []), why]);
  const wet = plan.fixtures.filter((f) => WET.has(f.kind));

  for (const g of geos) {
    const o = g.opening;
    if (o.style === "door-slider") {
      add(o.id, "glass in a door (IRC R308.4.1)");
      continue;
    }
    if (o.kind !== "window") continue;
    const sill = o.sillIn ?? 30;
    const top = sill + o.heightIn;
    // Next to a door: within 24" of the door's edge and low enough to walk into.
    if (sill < codeNum("glazing.doorAdjacentMaxBottom") && doors.some((d) => near(g, d) <= codeNum("glazing.doorAdjacentArc"))) {
      add(o.id, `next to a door (${codeRef("glazing.doorAdjacentArc")})`);
    }
    // A big, low pane.
    const pane = glassSqft(o) / panes(o);
    if (pane > codeNum("glazing.largePaneArea") && sill < codeNum("glazing.largePaneMaxBottom") && top > codeNum("glazing.largePaneMinTop")) {
      add(o.id, `large low pane (${codeRef("glazing.largePaneArea")})`);
    }
    // Next to a tub or shower.
    const rooms = openingRooms(plan, o);
    if (sill < codeNum("glazing.wetSurfaceMaxBottom") && wet.some((f) => (!f.roomId || rooms.includes(f.roomId)) && dist(g.center, { x: f.x, y: f.y }) - Math.max(f.widthIn, f.depthIn) / 2 < 60)) {
      add(o.id, `near a tub or shower (${codeRef("glazing.wetSurfaceMaxBottom")})`);
    }
    // Next to stairs.
    if (sill < 60 && stairs.some((poly) => distToPolygon(g.center, poly) < (sill < codeNum("glazing.stairMaxBottom") ? 36 : 60))) {
      add(o.id, `next to stairs (${codeRef("glazing.stairMaxBottom")})`);
    }
  }
  return out;
}

/** Closest distance between the ends of two openings. */
function near(a: OpeningGeometry, b: OpeningGeometry): number {
  return Math.min(dist(a.a, b.a), dist(a.a, b.b), dist(a.b, b.a), dist(a.b, b.b));
}

function distToPolygon(p: Point, poly: Point[]): number {
  if (pointInPolygon(p, poly)) return 0;
  return Math.min(...edgesOf(poly).map((e) => project(p, e.a, e.b).d));
}
