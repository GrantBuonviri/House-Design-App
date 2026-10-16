import type { BubbleDiagram, Level, Point } from "@/lib/model/schema";
import { exteriorWallIn, levelBelow, riseBetween } from "./basics";
import { roomLinks } from "./connect";
import { emptyPlan, type Plans } from "./edit";
import { plansFromSketch, type PlanContext } from "./fromSketch";
import { boundsOf, type Bounds } from "./geometry";
import { stairsDrawing } from "./stairs";
import { addHallways, addStairHalls, roomsNeedingHall } from "./hallways";
import { connectAll } from "./doors";
import { addClosets } from "./closets";
import { addWindows } from "./windows";
export { HALL_IN, addHallways, addStairHalls, isWayIn, roomsNeedingHall } from "./hallways";
export { connectAll, wayInRooms } from "./doors";
export { addClosets } from "./closets";
export { addWindows, outsideStretches, roomJustOutside, type Stretch } from "./windows";

/**
 * "Suggest a plan": the flow sketch turned into a plan, plus what a real plan
 * needs that the sketch doesn't show. A hallway where bedrooms and bathrooms
 * would otherwise only open off other bedrooms, doors so every room can be
 * reached, a closet in each bedroom, and windows on outside walls (more and
 * bigger on the sunny south side). All built-in rules.
 */

// The steps live in hallways.ts, doors.ts, closets.ts and windows.ts; this file runs them in order.

// ---------- All together ----------

/** The outlines of the stairs on a level: going up from it, and coming up from below. */
export function stairsFootprints(plans: Plans, ctx: Pick<PlanContext, "levels" | "basics">, level: Level): Point[][] {
  const below = levelBelow(ctx.levels, level);
  const list = [
    ...(plans[level.id]?.stairs ?? []).map((s) => ({ s, from: level })),
    ...(below ? (plans[below.id]?.stairs ?? []).filter((s) => s.toLevelId === level.id).map((s) => ({ s, from: below })) : []),
  ];
  return list.map(({ s, from }) => {
    const to = ctx.levels.find((l) => l.id === s.toLevelId);
    return stairsDrawing(s, to ? riseBetween(ctx.basics, from, to) : 121).footprint;
  });
}

/** The stairs' footprints on a level, as boxes. */
export function stairsBoxes(plans: Plans, ctx: Pick<PlanContext, "levels" | "basics">, level: Level): Bounds[] {
  return stairsFootprints(plans, ctx, level).map((f) => boundsOf(f)!);
}

export type SuggestResult = { plans: Plans; notes: string[] };

export function suggestPlans(diagrams: Record<string, BubbleDiagram>, ctx: PlanContext): SuggestResult {
  const base = plansFromSketch(diagrams, ctx);
  const exteriorIn = exteriorWallIn(ctx.basics);
  const plans: Plans = {};
  let halls = 0;
  let stairHalls = 0;
  let closets = 0;
  let windows = 0;
  const stuck: string[] = [];
  for (const level of ctx.levels) {
    let plan = base.plans[level.id] ?? emptyPlan();
    if (plan.rooms.length) {
      const obstacles = stairsBoxes(base.plans, ctx, level);
      const sh = addStairHalls(plan, obstacles);
      stairHalls += sh.added;
      const h = addHallways(sh.plan, obstacles);
      halls += h.added;
      plan = connectAll(h.plan, obstacles, ctx.brief?.openKitchen ?? false);
      const c = addClosets(plan, exteriorIn, ctx.brief);
      closets += c.added;
      const w = addWindows(c.plan, level);
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
    `Added ${count(halls + stairHalls, "hallway", "hallways")}${stairHalls ? ` (${stairHalls === 1 ? "one" : stairHalls} around the stairs)` : ""}, ${count(closets, "closet", "closets")} and ${count(windows, "window", "windows")}, with doors so every room can be reached.`,
  ];
  if (stuck.length) notes.push(`${stuck.join("; ")}. Push rooms around, or draw a hallway with the Room tool, if you'd rather they had their own way in.`);
  return { plans, notes };
}
