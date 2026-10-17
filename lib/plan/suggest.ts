import type { BubbleDiagram, Level, Point } from "@/lib/model/schema";
import { MAIN_LEVEL_ID } from "@/lib/brief/levels";
import { exteriorWallIn, levelBelow, riseBetween } from "./basics";
import { roomLinks } from "./connect";
import { emptyPlan, type Plans } from "./edit";
import { plansFromSketch, type PlanContext } from "./fromSketch";
import { boundsOf, type Bounds } from "./geometry";
import { stairsDrawing } from "./stairs";
import { addHallways, bridgeToStairs, coverStairs, roomsNeedingHall } from "./hallways";
import { linkStacks } from "./anchor";
import { connectAll } from "./doors";
import { addClosets } from "./closets";
import { addWindows } from "./windows";
import { coveredAbove } from "./wells";
import { keepInside, supportOf } from "./support";
export { HALL_IN, addHallways, coverStairs, isWayIn, roomsNeedingHall } from "./hallways";
export { connectAll, wayInRooms } from "./doors";
export { addClosets } from "./closets";
export { addWindows, makeEscapeWindow, outsideStretches, roomJustOutside, type Stretch } from "./windows";

/**
 * "Suggest a plan": the flow sketch turned into a plan, plus what a real plan
 * needs that the sketch doesn't show. A hallway where bedrooms and bathrooms
 * would otherwise only open off other bedrooms, doors so every room can be
 * reached, a closet in each bedroom, and windows on outside walls (more and
 * bigger on the sunny south side). All built-in rules.
 */

// The steps live in hallways.ts, doors.ts, closets.ts and windows.ts; this file runs them in order.

// ---------- All together ----------

/** The stairs a level shows: going up from it, and coming up from below. */
function stairsOnLevel(plans: Plans, ctx: Pick<PlanContext, "levels" | "basics">, level: Level) {
  const below = levelBelow(ctx.levels, level);
  const list = [
    ...(plans[level.id]?.stairs ?? []).map((s) => ({ s, from: level })),
    ...(below ? (plans[below.id]?.stairs ?? []).filter((s) => s.toLevelId === level.id).map((s) => ({ s, from: below })) : []),
  ];
  return list.map(({ s, from }) => {
    const to = ctx.levels.find((l) => l.id === s.toLevelId);
    return { s, footprint: stairsDrawing(s, to ? riseBetween(ctx.basics, from, to) : 121).footprint };
  });
}

/** The outlines of the stairs on a level: going up from it, and coming up from below. */
export function stairsFootprints(plans: Plans, ctx: Pick<PlanContext, "levels" | "basics">, level: Level): Point[][] {
  return stairsOnLevel(plans, ctx, level).map((x) => x.footprint);
}

/** The stairs' footprints on a level, as boxes. */
export function stairsBoxes(plans: Plans, ctx: Pick<PlanContext, "levels" | "basics">, level: Level): Bounds[] {
  return stairsFootprints(plans, ctx, level).map((f) => boundsOf(f)!);
}

export type SuggestResult = {
  plans: Plans;
  notes: string[];
  /** Why each door went where it did, by opening id: shown when the door is selected, never saved. */
  doorReasons: Map<string, string>;
};

export function suggestPlans(diagrams: Record<string, BubbleDiagram>, ctx: PlanContext): SuggestResult {
  const sketched = plansFromSketch(diagrams, ctx);
  // Stairs that stack share one anchored stack, so they line up on every floor.
  const base = { ...sketched, plans: linkStacks(sketched.plans, ctx) };
  const exteriorIn = exteriorWallIn(ctx.basics);
  const plans: Plans = {};
  let halls = 0;
  let closets = 0;
  let windows = 0;
  const stuck: string[] = [];
  const doorReasons = new Map<string, string>();
  const doorOpts = (level: Level) => ({ reasons: doorReasons, brief: ctx.brief, main: level.kind === "main" || level.id === MAIN_LEVEL_ID });
  // From the bottom up, so hallways that push upper rooms out can be pulled back over the finished floor below.
  for (const level of [...ctx.levels].sort((a, b) => a.elevationIn - b.elevationIn)) {
    let plan = base.plans[level.id] ?? emptyPlan();
    if (plan.rooms.length) {
      const obstacles = stairsBoxes(base.plans, ctx, level);
      const support = supportOf(plans, ctx.levels, level);
      // Stairs outside every room get taken into an ordinary room.
      plan = coverStairs(plan, obstacles, ctx.limits, support?.regions).plan;
      const h = addHallways(plan, obstacles, 3, ctx.limits);
      halls += h.added;
      plan = h.plan;
      if (support) plan = keepInside(plan, support.regions, support.arcs).plan;
      // A room a few feet from the room the stairs sit in gets a short hallway to it.
      const bridge = bridgeToStairs(plan, obstacles, support?.regions);
      halls += bridge.added;
      plan = bridge.plan;
      plan = connectAll(plan, obstacles, ctx.brief?.openKitchen ?? false, doorOpts(level));
      const c = addClosets(plan, exteriorIn, ctx.brief, doorReasons, Boolean(support));
      closets += c.added;
      // A basement's walls under the main floor are buried: no windows there.
      const w = addWindows(c.plan, level, level.kind === "basement" ? coveredAbove(base.plans, ctx.levels) : []);
      windows += w.added;
      plan = w.plan;
      const links = roomLinks(plan);
      for (const r of roomsNeedingHall(plan)) {
        const through = [...(links.get(r.id) ?? [])]
          .map((id) => plan.rooms.find((x) => x.id === id))
          .filter((x) => x && x.type !== "closet")
          .map((x) => x!.name);
        stuck.push(through.length ? `${r.name} opens only through ${through.join(" or ")}` : `${r.name} has no door yet`);
      }
    }
    plans[level.id] = plan;
  }
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const notes = [
    `Added ${count(halls, "hallway", "hallways")}, ${count(closets, "closet", "closets")} and ${count(windows, "window", "windows")}, with doors so every room can be reached.`,
  ];
  notes.push(...base.notes);
  if (stuck.length) notes.push(`${stuck.join("; ")}. Push rooms around, or draw a hallway with the Room tool, if you'd rather they had their own way in.`);
  // Reasons only for doors that made it into the final plans.
  const kept = new Set(Object.values(plans).flatMap((p) => p.openings.map((o) => o.id)));
  for (const id of [...doorReasons.keys()]) if (!kept.has(id)) doorReasons.delete(id);
  return { plans, notes, doorReasons };
}
