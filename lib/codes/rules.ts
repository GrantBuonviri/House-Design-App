import type { FloorPlan, Level, PlanRoom, Point, Project, Stage } from "@/lib/model/schema";
import { MAIN_LEVEL_ID } from "@/lib/brief/levels";
import { ceilingFor, INTERIOR_WALL_IN } from "@/lib/plan/basics";
import { openingType } from "@/lib/plan/catalog";
import { OUTSIDE, openingRooms, roleOf } from "@/lib/plan/connect";
import { add, dist, dot, edgesOf, leftNormal, polygonArea, polygonCenter, rotate, sub, unit } from "@/lib/plan/geometry";
import { stairsDrawing, TREAD_IN } from "@/lib/plan/stairs";
import { formatFeetInches } from "@/lib/model/units";
import { houseFacts, type HouseFacts } from "@/lib/plans/house";
import { codeNum, codeRef } from "./data";
import { escapeCheck, glassSqft, openableSqft } from "./openings";

/**
 * The code check: a list of rules from the codes Boise uses, each with its
 * section, worked out from the project every time. A rule gives one result
 * per thing it looks at (a room, a window, the stairs). "Check by hand" is
 * for what the app can't see or doesn't draw yet.
 */

export type RuleStatus = "pass" | "fail" | "manual";

export type RuleResult = {
  status: RuleStatus;
  /** What was found, in plain words. */
  text: string;
  /** How to fix a failure. */
  fix?: string;
  levelId?: string;
  roomIds?: string[];
  at?: Point;
  /** The part of the app to go to. */
  stage?: Stage;
};

export type RuleGroup = "Rooms" | "Escape and exits" | "Stairs" | "Glass" | "Garage" | "Attic and foundation" | "Bathrooms" | "Systems" | "Site";

export type CodeRule = {
  id: string;
  group: RuleGroup;
  title: string;
  /** Code value keys whose sections the rule prints. */
  ref: string;
  check: (h: HouseFacts) => RuleResult[];
};

export type RuleReport = {
  rule: CodeRule;
  status: RuleStatus;
  section: string;
  results: RuleResult[];
};

/** Habitable rooms: for living, sleeping, eating or cooking. */
const NOT_HABITABLE = new Set(["entry", "bathroom", "half-bath", "primary-bath", "closet", "primary-closet", "pantry", "hall", "laundry", "mudroom", "storage", "mechanical", "garage", "patio", "deck", "porch", "outdoor-kitchen"]);
export const isHabitable = (r: Pick<PlanRoom, "type">) => !NOT_HABITABLE.has(r.type ?? "other");
const SLEEPING = new Set(["bedroom", "primary-bedroom", "guest-suite"]);
export const isSleeping = (r: Pick<PlanRoom, "type">) => SLEEPING.has(r.type ?? "");
const BATHS = new Set(["bathroom", "half-bath", "primary-bath"]);

/** 0.625 as 5/8", 7.75 as 7 3/4", in eighths. */
export function inchText(n: number): string {
  const whole = Math.floor(n + 1e-9);
  const eighths = Math.round((n - whole) * 8);
  if (!eighths) return `${whole}"`;
  const g = eighths % 4 === 0 ? 4 : eighths % 2 === 0 ? 2 : 1;
  const frac = `${eighths / g}/${8 / g}`;
  return whole ? `${whole} ${frac}"` : `${frac}"`;
}

const f1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString("en-US");
const where = (l: Level, r?: PlanRoom) => (r ? `${r.name}, ${l.name.toLowerCase()}` : l.name);

/** Rooms with the level they're on. */
function rooms(h: HouseFacts, keep: (r: PlanRoom) => boolean = () => true): { level: Level; plan: FloorPlan; room: PlanRoom }[] {
  return h.drawn.flatMap((level) => {
    const plan = h.plan(level.id);
    return plan.rooms.filter(keep).map((room) => ({ level, plan, room }));
  });
}

/** Floor area inside the walls (room outlines run down the middle of the walls). */
export function clearSqft(r: PlanRoom): number {
  const perimeter = edgesOf(r.polygon).reduce((s, e) => s + dist(e.a, e.b), 0);
  return Math.max(0, polygonArea(r.polygon) - (perimeter * INTERIOR_WALL_IN) / 2) / 144;
}

/** The narrowest width across a room, inside the walls. */
export function clearWidthIn(r: PlanRoom): number {
  let best = Infinity;
  for (const e of edgesOf(r.polygon)) {
    const n = leftNormal(unit(sub(e.b, e.a)));
    const ds = r.polygon.map((p) => dot(sub(p, e.a), n));
    best = Math.min(best, Math.max(...ds) - Math.min(...ds));
  }
  return best - INTERIOR_WALL_IN;
}

const openingsOf = (plan: FloorPlan, r: PlanRoom) => plan.openings.filter((o) => openingRooms(plan, o).includes(r.id));

const room = (l: Level, r: PlanRoom, partial: Omit<RuleResult, "levelId" | "roomIds" | "at" | "stage">): RuleResult => ({
  ...partial,
  levelId: l.id,
  roomIds: [r.id],
  at: polygonCenter(r.polygon),
  stage: "plan",
});

export const RULES: CodeRule[] = [
  {
    id: "room-area",
    group: "Rooms",
    title: `Habitable rooms are at least ${codeNum("rooms.minHabitableArea")} sq ft`,
    ref: "rooms.minHabitableArea",
    check: (h) =>
      rooms(h, (r) => isHabitable(r) && r.type !== "kitchen").map(({ level, room: r }) => {
        const a = clearSqft(r);
        const min = codeNum("rooms.minHabitableArea");
        return a >= min
          ? room(level, r, { status: "pass", text: `${where(level, r)}: ${Math.round(a)} sq ft` })
          : room(level, r, { status: "fail", text: `${where(level, r)} is about ${Math.round(a)} sq ft inside the walls.`, fix: `Make it at least ${min} sq ft.` });
      }),
  },
  {
    id: "room-width",
    group: "Rooms",
    title: `Habitable rooms are at least ${formatFeetInches(codeNum("rooms.minHabitableDimension"))} wide`,
    ref: "rooms.minHabitableDimension",
    check: (h) =>
      rooms(h, (r) => isHabitable(r) && r.type !== "kitchen").map(({ level, room: r }) => {
        const w = clearWidthIn(r);
        const min = codeNum("rooms.minHabitableDimension");
        return w >= min - 0.5
          ? room(level, r, { status: "pass", text: `${where(level, r)}: ${formatFeetInches(w)} at the narrowest` })
          : room(level, r, { status: "fail", text: `${where(level, r)} is ${formatFeetInches(w)} wide at the narrowest.`, fix: `Widen it to ${formatFeetInches(min)} inside the walls.` });
      }),
  },
  {
    id: "ceiling",
    group: "Rooms",
    title: `Ceilings in habitable rooms are at least ${formatFeetInches(codeNum("rooms.minCeilingHabitable"))}`,
    ref: "rooms.minCeilingHabitable",
    check: (h) =>
      h.drawn
        .filter((l) => h.plan(l.id).rooms.some(isHabitable))
        .map((l) => {
          const c = ceilingFor(h.basics, l);
          const min = codeNum("rooms.minCeilingHabitable");
          return c >= min
            ? { status: "pass" as const, text: `${l.name}: ${formatFeetInches(c)} ceilings`, levelId: l.id }
            : { status: "fail" as const, text: `${l.name} has ${formatFeetInches(c)} ceilings.`, fix: `Raise them to at least ${formatFeetInches(min)} on the plan basics page.`, levelId: l.id, stage: "plan" as const };
        }),
  },
  {
    id: "light",
    group: "Rooms",
    title: `Habitable rooms have window glass of at least ${codeNum("light.glazingPctOfFloor")}% of the floor`,
    ref: "light.glazingPctOfFloor",
    check: (h) =>
      rooms(h, isHabitable).map(({ level, plan, room: r }) => {
        const glass = openingsOf(plan, r).reduce((s, o) => s + glassSqft(o), 0);
        const need = (clearSqft(r) * codeNum("light.glazingPctOfFloor")) / 100;
        return glass >= need
          ? room(level, r, { status: "pass", text: `${where(level, r)}: ${f1(glass)} sq ft of glass (needs ${f1(need)})` })
          : room(level, r, {
              status: "fail",
              text: `${where(level, r)} has ${f1(glass)} sq ft of glass; it needs ${f1(need)}.`,
              fix: "Add or widen a window. (The code also allows electric light of 6 footcandles instead, R303.1 exception, which the app doesn't design.)",
            });
      }),
  },
  {
    id: "ventilation",
    group: "Rooms",
    title: `Habitable rooms have openable windows of ${codeNum("light.ventOpenablePctOfFloor")}% of the floor, or mechanical ventilation`,
    ref: "light.ventOpenablePctOfFloor",
    check: (h) =>
      rooms(h, isHabitable).map(({ level, plan, room: r }) => {
        const open = openingsOf(plan, r).reduce((s, o) => s + openableSqft(o), 0);
        const need = (clearSqft(r) * codeNum("light.ventOpenablePctOfFloor")) / 100;
        return open >= need
          ? room(level, r, { status: "pass", text: `${where(level, r)}: about ${f1(open)} sq ft opens (needs ${f1(need)})` })
          : room(level, r, {
              status: "pass",
              text: `${where(level, r)}: about ${f1(open)} sq ft opens (under ${f1(need)}), covered by the whole-house fresh-air fan Idaho requires in every new house (R303.1 exception, R303.4)`,
            });
      }),
  },
  {
    id: "bath-vent",
    group: "Bathrooms",
    title: `Bathrooms have a ${codeNum("light.bathroomGlazingArea")} sq ft window or an exhaust fan`,
    ref: "light.bathroomGlazingArea",
    check: (h) =>
      rooms(h, (r) => BATHS.has(r.type ?? "")).map(({ level, plan, room: r }) => {
        const glass = openingsOf(plan, r).filter((o) => o.kind === "window");
        const ok = glass.some((o) => glassSqft(o) >= codeNum("light.bathroomGlazingArea") && openableSqft(o) >= glassSqft(o) / 2 - 0.01);
        return ok
          ? room(level, r, { status: "pass", text: `${where(level, r)}: window big enough` })
          : room(level, r, { status: "manual", text: `${where(level, r)} needs an exhaust fan. Fans are placed with the mechanical plan, coming in a later update.` });
      }),
  },
  {
    id: "egress-bedroom",
    group: "Escape and exits",
    title: "Every bedroom has an emergency escape window or door",
    ref: "egress.netClearOpening",
    check: (h) =>
      rooms(h, isSleeping).map(({ level, plan, room: r }) => {
        const own = openingsOf(plan, r);
        const door = own.some((o) => o.kind === "door" && openingRooms(plan, o).includes(null));
        const below = level.kind === "basement";
        const windows = own.filter((o) => o.kind === "window").map((o) => ({ o, c: escapeCheck(o, below) }));
        const good = windows.find((w) => w.c.ok);
        if (door) return room(level, r, { status: "pass", text: `${where(level, r)}: door straight outside` });
        if (good) return room(level, r, { status: "pass", text: `${where(level, r)}: ${h.tags.get(good.o.id) ?? "window"} opens about ${f1(good.c.clear.sqft)} sq ft` });
        if (!windows.length) return room(level, r, { status: "fail", text: `${where(level, r)} has no window.`, fix: "Add a window you can climb out of (about 36\" wide by 60\" tall works as a single-hung)." });
        return room(level, r, {
          status: "fail",
          text: `${where(level, r)}: no window is big enough to escape through (${windows[0].c.problems.join("; ")}).`,
          fix: "Make one window bigger or lower, or use a casement window.",
        });
      }),
  },
  {
    id: "egress-basement",
    group: "Escape and exits",
    title: "Basements have an emergency escape window or door",
    ref: "egress.netClearOpeningGradeFloor",
    check: (h) =>
      h.drawn
        .filter((l) => l.kind === "basement")
        .map((l) => {
          const plan = h.plan(l.id);
          const ok = plan.openings.some((o) => (o.kind === "window" && escapeCheck(o, true).ok) || (o.kind === "door" && openingRooms(plan, o).includes(null)));
          return ok
            ? { status: "pass" as const, text: `${l.name}: has an escape window or door`, levelId: l.id }
            : { status: "fail" as const, text: `${l.name} has no emergency escape window or outside door.`, fix: "Add an escape window with a window well, or a door outside.", levelId: l.id, stage: "plan" as const };
        }),
  },
  {
    id: "exit-door",
    group: "Escape and exits",
    title: `One outside door is at least ${codeNum("exit.doorClearWidth")}" wide and ${codeNum("exit.doorClearHeight")}" tall, clear`,
    ref: "exit.doorClearWidth",
    check: (h) => {
      const level = h.drawn.find((l) => l.id === MAIN_LEVEL_ID) ?? h.drawn.find((l) => l.kind === "main");
      if (!level) return [];
      const plan = h.plan(level.id);
      const outdoor = new Set(plan.rooms.filter((r) => roleOf(r) === "outdoor").map((r) => r.id));
      const garage = new Set(plan.rooms.filter((r) => roleOf(r) === "garage").map((r) => r.id));
      const exits = plan.openings.filter((o) => {
        if (o.kind !== "door" || !openingType(o.style).swings) return false;
        const [a, b] = openingRooms(plan, o);
        const sides = [a, b];
        const outside = sides.some((s) => s === null || outdoor.has(s));
        const inside = sides.some((s) => s !== null && !outdoor.has(s) && !garage.has(s));
        return outside && inside;
      });
      // A hinged door's clear width is about 3 1/4" less than the door (the door's thickness and the stop).
      const ok = exits.find((o) => o.widthIn - 3.25 >= codeNum("exit.doorClearWidth") && o.heightIn - 1.5 >= codeNum("exit.doorClearHeight"));
      if (ok) return [{ status: "pass", text: `${h.tags.get(ok.id) ?? "Front door"}: ${formatFeetInches(ok.widthIn)} door`, levelId: level.id }];
      return [
        {
          status: "fail",
          text: exits.length ? "No hinged outside door is wide enough (a 36\" door gives about 32 3/4\" clear)." : "There's no hinged door to the outside on the main floor.",
          fix: "Use a 36\" wide front door.",
          levelId: level.id,
          stage: "plan",
        },
      ];
    },
  },
  {
    id: "hall-width",
    group: "Escape and exits",
    title: `Hallways are at least ${formatFeetInches(codeNum("exit.hallwayMinWidth"))} wide`,
    ref: "exit.hallwayMinWidth",
    check: (h) =>
      rooms(h, (r) => r.type === "hall").map(({ level, room: r }) => {
        const w = clearWidthIn(r);
        return w >= codeNum("exit.hallwayMinWidth") - 0.5
          ? room(level, r, { status: "pass", text: `${where(level, r)}: ${formatFeetInches(w)} wide` })
          : room(level, r, { status: "fail", text: `${where(level, r)} is ${formatFeetInches(w)} wide inside.`, fix: `Widen it to ${formatFeetInches(codeNum("exit.hallwayMinWidth"))} between the walls.` });
      }),
  },
  {
    id: "stairs-width",
    group: "Stairs",
    title: `Stairs are at least ${codeNum("stairs.minWidth")}" wide`,
    ref: "stairs.minWidth",
    check: (h) =>
      stairsList(h).map(({ level, s }) =>
        s.widthIn >= codeNum("stairs.minWidth") - 0.1
          ? { status: "pass", text: `${level.name} stairs: ${formatFeetInches(s.widthIn)} wide`, levelId: level.id }
          : { status: "fail", text: `${level.name} stairs are ${formatFeetInches(s.widthIn)} wide.`, fix: "Make them at least 3' wide.", levelId: level.id, at: { x: s.x, y: s.y }, stage: "plan" },
      ),
  },
  {
    id: "stairs-steps",
    group: "Stairs",
    title: `Steps are at most ${inchText(codeNum("stairs.maxRiser"))} tall with treads of at least ${inchText(codeNum("stairs.minTread"))}`,
    ref: "stairs.maxRiser",
    check: (h) =>
      stairsList(h).map(({ level, s }) => {
        const d = stairsDrawing(s, h.riseFor(s, level));
        const ok = d.riserIn <= codeNum("stairs.maxRiser") + 0.001 && TREAD_IN >= codeNum("stairs.minTread");
        return ok
          ? { status: "pass", text: `${level.name} stairs: ${d.risers} steps of ${f1(d.riserIn)}", ${TREAD_IN}" treads`, levelId: level.id }
          : { status: "fail", text: `${level.name} stairs have ${f1(d.riserIn)}" steps.`, fix: "Add a step.", levelId: level.id, stage: "plan" };
      }),
  },
  {
    id: "stairs-landing",
    group: "Stairs",
    title: `A flight climbs at most ${formatFeetInches(codeNum("stairs.maxRiseBetweenLandings"))} between landings`,
    ref: "stairs.maxRiseBetweenLandings",
    check: (h) =>
      stairsList(h).map(({ level, s }) => {
        const rise = h.riseFor(s, level);
        const max = codeNum("stairs.maxRiseBetweenLandings");
        return s.shape !== "straight" || rise <= max
          ? { status: "pass", text: `${level.name} stairs climb ${formatFeetInches(rise)}${s.shape === "straight" ? "" : " with a landing"}`, levelId: level.id }
          : { status: "fail", text: `${level.name} stairs climb ${formatFeetInches(rise)} in one flight.`, fix: "Use L-shaped or U-shaped stairs with a landing.", levelId: level.id, stage: "plan" };
      }),
  },
  {
    id: "stairs-handrail",
    group: "Stairs",
    title: `Stairs with ${codeNum("stairs.handrailRequiredRisers")} or more risers have a handrail ${codeNum("stairs.handrailMinHeight")}" to ${codeNum("stairs.handrailMaxHeight")}" high`,
    ref: "stairs.handrailMinHeight",
    check: (h) => stairsList(h).map(({ level }) => ({ status: "pass", text: `${level.name} stairs: handrail noted on the floor plan`, levelId: level.id })),
  },
  {
    id: "stairs-headroom",
    group: "Stairs",
    title: `Stairs have ${formatFeetInches(codeNum("stairs.minHeadroom"))} of headroom`,
    ref: "stairs.minHeadroom",
    check: (h) => stairsList(h).map(({ level }) => ({ status: "manual", text: `${level.name} stairs: headroom is shown on the stair section, coming in a later update.`, levelId: level.id })),
  },
  {
    id: "safety-glass",
    group: "Glass",
    title: "Glass in hazardous spots is safety glass",
    ref: "glazing.doorAdjacentArc",
    check: (h) => (h.safety.size ? [{ status: "pass", text: `${h.safety.size} door${h.safety.size === 1 ? "" : "s"} and windows marked TEMP on the plans need tempered glass.` }] : [{ status: "pass", text: "No glass in hazardous spots." }]),
  },
  {
    id: "garage-door",
    group: "Garage",
    title: "Doors from the garage into the house are solid or fire-rated, and never into a bedroom",
    ref: "garage.doorFireRatingMinutes",
    check: (h) =>
      h.drawn.flatMap((l) => {
        const plan = h.plan(l.id);
        const garage = new Set(plan.rooms.filter((r) => roleOf(r) === "garage").map((r) => r.id));
        return plan.openings
          .filter((o) => o.kind !== "window" && o.style !== "door-garage")
          .flatMap((o): RuleResult[] => {
            const [a, b] = openingRooms(plan, o);
            const other = garage.has(a ?? "") ? b : garage.has(b ?? "") ? a : undefined;
            if (other === undefined || other === null || other === OUTSIDE || garage.has(other)) return [];
            const r = plan.rooms.find((x) => x.id === other);
            if (r && roleOf(r) === "outdoor") return [];
            if (r && isSleeping(r)) return [{ status: "fail", text: `${h.tags.get(o.id) ?? "A door"} opens from the garage straight into ${r.name}.`, fix: "Move the door so the garage opens into a hall, mudroom or laundry.", levelId: l.id, roomIds: [r.id], stage: "plan" }];
            if (o.kind === "opening") return [{ status: "fail", text: `There's an opening with no door between the garage and ${r?.name ?? "the house"}.`, fix: "Put a door in it.", levelId: l.id, stage: "plan" }];
            return [{ status: "pass", text: `${h.tags.get(o.id) ?? "Garage door"}: noted as ${inchText(codeNum("garage.doorSolidWoodThickness"))} solid or ${codeNum("garage.doorFireRatingMinutes")}-minute door`, levelId: l.id }];
          });
      }),
  },
  {
    id: "garage-gypsum",
    group: "Garage",
    title: `The garage side of the walls and ceiling between garage and house gets ${inchText(codeNum("garage.gypsumGarageSide"))} gypsum board`,
    ref: "garage.gypsumGarageSide",
    check: (h) => {
      const has = h.drawn.some((l) => h.plan(l.id).rooms.some((r) => roleOf(r) === "garage"));
      return has ? [{ status: "pass", text: "Noted on the floor plan." }] : [];
    },
  },
  {
    id: "alarms",
    group: "Systems",
    title: "Smoke alarms in bedrooms, outside them and on every floor; CO alarms with gas or an attached garage",
    ref: "garage.gypsumGarageSide",
    check: () => [{ status: "manual", text: "Smoke and CO alarms are placed on the electrical plan, coming in a later update." }],
  },
  {
    id: "attic-access",
    group: "Attic and foundation",
    title: `There's a ${codeNum("attic.accessMinWidth")}" x ${codeNum("attic.accessMinLength")}" attic access`,
    ref: "attic.accessMinWidth",
    check: (h) => {
      if (h.project.house3d.roof.style === "flat" || !h.drawn.length) return [];
      const spot = atticAccessSpot(h);
      return spot
        ? [{ status: "pass", text: `Shown in ${spot.room.name}, ${spot.level.name.toLowerCase()}.`, levelId: spot.level.id }]
        : [{ status: "manual", text: "No hallway or closet on the top floor to put it in; pick a spot and note it." }];
    },
  },
  {
    id: "frost",
    group: "Attic and foundation",
    title: `Footings go ${codeNum("design.frostDepth")}" below the ground (frost depth)`,
    ref: "design.frostDepth",
    check: () => [{ status: "pass", text: "In the general notes. The foundation plan comes in a later update." }],
  },
  {
    id: "toilet-room",
    group: "Bathrooms",
    title: `Toilets have ${codeNum("plumbing.wcSideClearance")}" to each side and ${codeNum("plumbing.wcFrontClearance")}" in front`,
    ref: "plumbing.wcSideClearance",
    check: (h) =>
      h.drawn.flatMap((l) => {
        const plan = h.plan(l.id);
        return plan.fixtures
          .filter((f) => f.kind === "toilet")
          .map((f): RuleResult => {
            const c = toiletClearance(plan, f);
            const side = codeNum("plumbing.wcSideClearance");
            const front = codeNum("plumbing.wcFrontClearance");
            const r = plan.rooms.find((x) => x.id === f.roomId);
            const name = r ? where(l, r) : l.name;
            const base = { levelId: l.id, roomIds: r ? [r.id] : [], at: { x: f.x, y: f.y }, stage: "plan" as const };
            if (c.side >= side - 0.5 && c.front >= front - 0.5) return { status: "pass", text: `${name}: ${Math.round(c.side)}" to the side, ${Math.round(c.front)}" in front`, ...base };
            return { status: "fail", text: `${name}: the toilet has ${Math.round(c.side)}" to the side and ${Math.round(c.front)}" in front.`, fix: `Move it to get ${side}" from its middle to each side and ${front}" clear in front.`, ...base };
          });
      }),
  },
  {
    id: "shower-size",
    group: "Bathrooms",
    title: `Showers are at least ${codeNum("plumbing.showerMinArea").toLocaleString("en-US")} sq in with room for a ${codeNum("plumbing.showerMinCircle")}" circle`,
    ref: "plumbing.showerMinArea",
    check: (h) =>
      h.drawn.flatMap((l) =>
        h
          .plan(l.id)
          .fixtures.filter((f) => f.kind === "shower")
          .map((f): RuleResult => {
            // The fixture is drawn to the outside of the curb; the floor inside is about 3" smaller each way.
            const w = f.widthIn - 3;
            const d = f.depthIn - 3;
            const ok = w * d >= codeNum("plumbing.showerMinArea") && Math.min(w, d) >= codeNum("plumbing.showerMinCircle");
            return ok
              ? { status: "pass", text: `${l.name}: shower about ${Math.round(w)}" x ${Math.round(d)}" inside`, levelId: l.id }
              : { status: "fail", text: `${l.name}: a shower is about ${Math.round(w)}" x ${Math.round(d)}" inside.`, fix: "Make the shower bigger (36\" x 36\" or more outside always works).", levelId: l.id, at: { x: f.x, y: f.y }, stage: "plan" };
          }),
      ),
  },
  {
    id: "electrical",
    group: "Systems",
    title: "Outlets, GFCI and AFCI protection, kitchen and bath circuits",
    ref: "plumbing.wcSideClearance",
    check: () => [{ status: "manual", text: "Placed on the electrical plan, coming in a later update." }],
  },
  {
    id: "mechanical",
    group: "Systems",
    title: "Bath fans, kitchen hood and whole-house fresh air",
    ref: "plumbing.wcSideClearance",
    check: () => [{ status: "manual", text: "Placed on the mechanical plan, coming in a later update." }],
  },
  {
    id: "energy",
    group: "Systems",
    title: "Insulation and window U-factors for climate zone 5",
    ref: "design.climateZone",
    check: () => [{ status: "manual", text: "On the energy sheet, coming in a later update. The REScheck report comes from energycodes.gov." }],
  },
  {
    id: "setbacks",
    group: "Site",
    title: "The house is inside the lot's setbacks",
    ref: "design.frostDepth",
    check: () => [{ status: "manual", text: "Check with Boise zoning for your lot. The \"My real lot\" form and site plan come in the next update." }],
  },
  {
    id: "soil",
    group: "Site",
    title: "Soil can carry the footings",
    ref: "footing.minDepthBelowGrade",
    check: () => [{ status: "manual", text: "The app can't see the soil. Footings assume ordinary soil; a soils report or the building inspector confirms it." }],
  },
];

/** Section references printed for rules whose `ref` key is only a stand-in. */
const SECTION: Record<string, string> = {
  ventilation: "IRC R303.1, R303.4",
  "safety-glass": "IRC R308.4",
  "garage-door": "IRC R302.5.1",
  "garage-gypsum": "IRC R302.6",
  alarms: "IRC R314, R315",
  "attic-access": "IRC R807.1",
  frost: "IRC R403.1.4.1",
  "toilet-room": "ISPC 402.5",
  "shower-size": "ISPC 408.6",
  electrical: "NEC 210.8, 210.11, 210.12, 210.52",
  mechanical: "IRC M1505",
  energy: "IECC R402",
  setbacks: "Boise City Code Title 11",
  soil: "IRC R401.4",
  "stairs-handrail": "IRC R311.7.8",
  "egress-bedroom": "IRC R310.1, R310.2",
  "egress-basement": "IRC R310.1",
  "exit-door": "IRC R311.2",
};

export function ruleSection(rule: CodeRule): string {
  return SECTION[rule.id] ?? codeRef(rule.ref);
}

const RANK: Record<RuleStatus, number> = { pass: 0, manual: 1, fail: 2 };

/** Every rule with its results. Rules with nothing to look at are left out. */
export function codeReport(project: Project): RuleReport[] {
  const h = houseFacts(project);
  return RULES.map((rule) => {
    const results = rule.check(h);
    const status = results.reduce<RuleStatus>((w, r) => (RANK[r.status] > RANK[w] ? r.status : w), "pass");
    return { rule, status, section: ruleSection(rule), results };
  }).filter((r) => r.results.length > 0);
}

export function reportCounts(report: RuleReport[]): Record<RuleStatus, number> {
  const c = { pass: 0, fail: 0, manual: 0 };
  for (const r of report) c[r.status]++;
  return c;
}

function stairsList(h: HouseFacts) {
  return h.drawn.flatMap((level) => h.plan(level.id).stairs.map((s) => ({ level, s })));
}

/** Where the attic access goes: a hallway or closet on the top floor. */
export function atticAccessSpot(h: HouseFacts): { level: Level; room: PlanRoom } | null {
  const top = h.drawn[h.drawn.length - 1];
  if (!top || top.kind === "basement") return null;
  const plan = h.plan(top.id);
  const fits = (r: PlanRoom) => clearWidthIn(r) >= codeNum("attic.accessMinWidth");
  for (const type of ["hall", "closet", "primary-closet", "laundry", "mudroom"]) {
    const r = plan.rooms.find((x) => x.type === type && fits(x));
    if (r) return { level: top, room: r };
  }
  return null;
}

/** The clear space beside and in front of a toilet: to walls and other fixtures. */
export function toiletClearance(plan: FloorPlan, f: FloorPlan["fixtures"][number]): { side: number; front: number } {
  const c = { x: f.x, y: f.y };
  // In the fixture's frame its back is toward -y; front is +y.
  const dir = (x: number, y: number) => rotate({ x, y }, f.rotation);
  const r = plan.rooms.find((x) => x.id === f.roomId);
  const obstacles: [Point, Point][] = [];
  const half = INTERIOR_WALL_IN / 2;
  if (r) for (const e of edgesOf(r.polygon)) obstacles.push([e.a, e.b]);
  for (const g of plan.fixtures) {
    if (g.id === f.id) continue;
    const pts = [
      { x: -g.widthIn / 2, y: -g.depthIn / 2 },
      { x: g.widthIn / 2, y: -g.depthIn / 2 },
      { x: g.widthIn / 2, y: g.depthIn / 2 },
      { x: -g.widthIn / 2, y: g.depthIn / 2 },
    ].map((p) => add(rotate(p, g.rotation), { x: g.x, y: g.y }));
    for (let i = 0; i < 4; i++) obstacles.push([pts[i], pts[(i + 1) % 4]]);
  }
  const ray = (from: Point, d: Point, wallPad: number) => {
    let best = 120;
    for (const [a, b] of obstacles) {
      const t = rayHit(from, d, a, b);
      if (t !== null) best = Math.min(best, t - (r && edgesOf(r.polygon).some((e) => e.a === a) ? wallPad : 0));
    }
    return best;
  };
  const left = ray(c, dir(-1, 0), half);
  const right = ray(c, dir(1, 0), half);
  const frontEdge = add(c, dir(0, f.depthIn / 2));
  const front = ray(frontEdge, dir(0, 1), half);
  return { side: Math.min(left, right), front };
}

/** Distance along a ray to a segment, or null. */
function rayHit(o: Point, d: Point, a: Point, b: Point): number | null {
  const e = sub(b, a);
  const den = d.x * e.y - d.y * e.x;
  if (Math.abs(den) < 1e-9) return null;
  const w = sub(a, o);
  const t = (w.x * e.y - w.y * e.x) / den;
  const u = (w.x * d.y - w.y * d.x) / den;
  return t > 0.01 && u >= -1e-6 && u <= 1 + 1e-6 ? t : null;
}
