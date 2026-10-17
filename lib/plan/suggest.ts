import type { BubbleDiagram, Level, Point } from "@/lib/model/schema";
import { MAIN_LEVEL_ID } from "@/lib/brief/levels";
import { exteriorWallIn, levelBelow, riseBetween } from "./basics";
import { roomLinks } from "./connect";
import { emptyPlan, type Plans } from "./edit";
import { plansFromSketch, type PlanContext } from "./fromSketch";
import { boundsOf, type Bounds } from "./geometry";
import { stairsDrawing } from "./stairs";
import { addHallways, addStairHalls, bridgeStairHalls, roomsNeedingHall, type StairFit } from "./hallways";
import { anchor, floorsOf, hallFloor, hallLimit, hallOn, linkStacks, stackIds } from "./anchor";
import { connectAll } from "./doors";
import { addClosets } from "./closets";
import { addWindows } from "./windows";
import { coveredAbove } from "./wells";
import { keepInside, supportOf } from "./support";
export { HALL_IN, addHallways, addStairHalls, isWayIn, roomsNeedingHall } from "./hallways";
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

/** For each set of stairs on a level (same order as `stairsBoxes`), the stair hall its stack allows. */
function stairFits(plans: Plans, ctx: Pick<PlanContext, "levels" | "basics">, level: Level): (StairFit | null)[] {
  return stairsOnLevel(plans, ctx, level).map(({ s }) => {
    const outline = s.stackId ? hallLimit(plans, ctx, s.stackId) : null;
    return outline && s.stackId ? { outline, stackId: s.stackId, floor: hallFloor(plans, ctx, s.stackId) } : null;
  });
}

export type SuggestResult = {
  plans: Plans;
  notes: string[];
  /** Why each door went where it did, by opening id: shown when the door is selected, never saved. */
  doorReasons: Map<string, string>;
};

export function suggestPlans(diagrams: Record<string, BubbleDiagram>, ctx: PlanContext): SuggestResult {
  const sketched = plansFromSketch(diagrams, ctx);
  // Stairs that stack share one anchored stack, so their stair halls can be fitted and lined up on every floor.
  const base = { ...sketched, plans: linkStacks(sketched.plans, ctx) };
  const exteriorIn = exteriorWallIn(ctx.basics);
  const plans: Plans = {};
  let halls = 0;
  let stairHalls = 0;
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
      const sh = addStairHalls(plan, obstacles, stairFits(base.plans, ctx, level));
      stairHalls += sh.added;
      const h = addHallways(sh.plan, obstacles, 3, ctx.limits);
      halls += h.added;
      plan = h.plan;
      const support = supportOf(plans, ctx.levels, level);
      if (support) plan = keepInside(plan, support.regions, support.arcs).plan;
      // A room a few feet from a fitted stair hall gets a short hallway to it.
      const bridge = bridgeStairHalls(plan, support?.regions);
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
  // A floor whose stair hall couldn't fit as it was (a room in the way) gets one now, trimming rooms around it, and doors.
  for (const stackId of stackIds(plans)) {
    const floors = floorsOf(plans, ctx, stackId).filter((id) => plans[id]?.rooms.length);
    const missing = floors.filter((id) => !hallOn(plans[id], stackId));
    const start = Object.entries(plans).flatMap(([levelId, p]) => p.stairs.filter((s) => s.stackId === stackId).map((s) => ({ levelId, id: s.id })))[0];
    if (!missing.length || !start) continue;
    const res = anchor(plans, ctx, start.levelId, start.id);
    if (!res) continue;
    Object.assign(plans, res.plans);
    stairHalls += missing.length;
    for (const id of floors) {
      const level = ctx.levels.find((l) => l.id === id)!;
      plans[id] = connectAll(plans[id], stairsBoxes(plans, ctx, level), ctx.brief?.openKitchen ?? false, doorOpts(level));
    }
  }
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const notes = [
    `Added ${count(halls + stairHalls, "hallway", "hallways")}${stairHalls ? ` (${stairHalls === 1 ? "one" : stairHalls} around the stairs)` : ""}, ${count(closets, "closet", "closets")} and ${count(windows, "window", "windows")}, with doors so every room can be reached.`,
  ];
  notes.push(...base.notes);
  if (stuck.length) notes.push(`${stuck.join("; ")}. Push rooms around, or draw a hallway with the Room tool, if you'd rather they had their own way in.`);
  // Reasons only for doors that made it into the final plans.
  const kept = new Set(Object.values(plans).flatMap((p) => p.openings.map((o) => o.id)));
  for (const id of [...doorReasons.keys()]) if (!kept.has(id)) doorReasons.delete(id);
  return { plans, notes, doorReasons };
}
