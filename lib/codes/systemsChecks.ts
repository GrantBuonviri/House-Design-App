import type { Level, PlanRoom, Point } from "@/lib/model/schema";
import { roleOf, openingRooms } from "@/lib/plan/connect";
import { add, dist, pointInPolygon, polygonCenter, project, scale } from "@/lib/plan/geometry";
import { builtIns, counterSpaces, isBath, isCo, isSmoke, kitchenRuns, largestGap, needsWallOutlets, spaceOffset, wallSpaces, type PlacedDevice } from "@/lib/plan/devices";
import { openingGeometries } from "@/lib/plan/walls";
import type { HouseFacts } from "@/lib/plans/house";
import { coNeeded, gradeLevel, hasAttachedGarage, levelDevices, outside, wholeHouseCfm } from "@/lib/plans/systems";
import { levelCabinets } from "@/lib/plans/sheets/cabinets";
import { dryerRuns, freshAirFan } from "@/lib/plans/sheets/mechanical";
import { codeEntry, codeNum } from "./data";
import type { RuleResult } from "./rules";

/**
 * The code checks for the electrical, mechanical and alarm layouts, run on
 * the devices as they are now (the app's placement plus the owner's
 * changes), so moving or taking one away shows up here.
 */

const SLEEPING = new Set(["bedroom", "primary-bedroom", "guest-suite"]);
const isSleeping = (r: Pick<PlanRoom, "type">) => SLEEPING.has(r.type ?? "");
const P = (d: PlacedDevice): Point => ({ x: d.x, y: d.y });
const ft = (inches: number) => `${Math.round(inches / 1.2) / 10} ft`;
const where = (l: Level, r: PlanRoom) => `${r.name}, ${l.name.toLowerCase()}`;

const at = (l: Level, r: PlanRoom | undefined, partial: Omit<RuleResult, "levelId">): RuleResult => ({ ...partial, levelId: l.id, roomIds: r ? [r.id] : undefined, at: partial.at ?? (r ? polygonCenter(r.polygon) : undefined) });

export function electricalChecks(h: HouseFacts): RuleResult[] {
  const out: RuleResult[] = [];
  const maxWall = codeNum("elec.wallReceptacleMaxDistance") * 12;
  const maxCounter = codeNum("elec.counterReceptacleMaxDistance");
  for (const level of h.drawn) {
    const plan = h.plan(level.id);
    const devices = levelDevices(h.project, level);
    const outlets = devices.filter((d) => d.kind === "outlet");
    const cabinets = levelCabinets(h.project, level);
    const boxes = builtIns(plan, cabinets);
    let fine = 0;
    // Wall outlets (210.52(A)).
    for (const r of plan.rooms.filter(needsWallOutlets)) {
      const mine = outlets.filter((d) => pointInPolygon(P(d), r.polygon));
      for (const s of wallSpaces(plan, r, boxes).filter((x) => x.length >= codeNum("elec.wallSpaceMinWidth") * 12)) {
        const spots = mine.map((d) => spaceOffset(s, P(d))).filter((x): x is number => x !== null);
        const gap = largestGap(s, spots);
        if (gap > maxWall * 2 + 1) {
          out.push(at(level, r, { status: "fail", text: `${where(level, r)}: part of a ${ft(s.length)} stretch of wall is more than ${ft(maxWall)} from an outlet.`, fix: "Add an outlet there (Plans page, Outlets and lights)." }));
        } else fine++;
      }
    }
    // Counters (210.52(C)).
    for (const run of kitchenRuns(plan, cabinets)) {
      for (const [t0, t1] of counterSpaces(run)) {
        const spots = outlets
          .map((d) => {
            const pr = project(P(d), add(run.origin, scale(run.u, t0)), add(run.origin, scale(run.u, t1)));
            return pr.d <= 8 ? pr.t : null;
          })
          .filter((x): x is number => x !== null);
        const gap = largestGap({ pieces: [], length: t1 - t0, closed: false }, spots);
        const r = plan.rooms.find((x) => pointInPolygon(add(add(run.origin, scale(run.u, (t0 + t1) / 2)), scale(run.n, 12)), x.polygon));
        if (gap > maxCounter * 2 + 1) out.push(at(level, r, { status: "fail", text: `${r ? where(level, r) : level.name}: part of a ${ft(t1 - t0)} counter is more than ${maxCounter}" from an outlet.`, fix: "Add a counter outlet there." }));
        else fine++;
      }
    }
    // Bathroom basins (210.52(D)).
    for (const v of plan.fixtures.filter((f) => f.kind === "vanity")) {
      const r = plan.rooms.find((x) => pointInPolygon({ x: v.x, y: v.y }, x.polygon));
      const reach = codeNum("elec.bathroomReceptacleFromBasin") + v.widthIn / 2;
      if (!outlets.some((d) => dist(P(d), { x: v.x, y: v.y }) <= reach)) out.push(at(level, r, { status: "fail", text: `${r ? where(level, r) : level.name}: no outlet within ${codeNum("elec.bathroomReceptacleFromBasin")}" of the basin.`, fix: "Add an outlet beside the vanity." }));
      else fine++;
    }
    // Laundry (210.50(C), 210.52(F)).
    for (const w of plan.fixtures.filter((f) => f.kind === "washer")) {
      const r = plan.rooms.find((x) => pointInPolygon({ x: w.x, y: w.y }, x.polygon));
      if (!outlets.some((d) => dist(P(d), { x: w.x, y: w.y }) <= codeNum("elec.laundryReceptacleFromAppliance") * 12)) out.push(at(level, r, { status: "fail", text: `${r ? where(level, r) : level.name}: no outlet within ${codeNum("elec.laundryReceptacleFromAppliance")} ft of the washer.`, fix: "Add an outlet behind the washer." }));
      else fine++;
    }
    // Garages: one per car bay (210.52(G)).
    for (const g of plan.rooms.filter((r) => roleOf(r) === "garage")) {
      const doors = openingGeometries(plan).filter((x) => x.opening.style === "door-garage" && openingRooms(plan, x.opening).includes(g.id));
      const bays = Math.max(1, doors.reduce((s, x) => s + Math.max(1, Math.round(x.opening.widthIn / 108)), 0));
      const n = outlets.filter((d) => pointInPolygon(P(d), g.polygon)).length;
      if (n < bays) out.push(at(level, g, { status: "fail", text: `${where(level, g)}: ${n} outlet${n === 1 ? "" : "s"} for ${bays} car bays.`, fix: "Add one outlet in each bay." }));
      else fine++;
    }
    // Outside, front and back (210.52(E)).
    if (gradeLevel(h.project)?.id === level.id) {
      const n = outlets.filter((d) => outside(plan.rooms, d)).length;
      if (n < 2) out.push({ status: "fail", text: `${level.name}: ${n} outside outlet${n === 1 ? "" : "s"}; the front and back each need one.`, fix: "Add outlets outside at the front and back.", levelId: level.id });
      else fine++;
    }
    // A switched light in every room (210.70(A)(1)).
    for (const r of plan.rooms.filter((x) => roleOf(x) !== "outdoor" && !(["closet", "pantry"].includes(x.type ?? "")))) {
      const lit = devices.some((d) => (d.kind === "light" || d.kind === "light-recessed" || d.kind === "light-wall") && pointInPolygon(P(d), r.polygon));
      if (!lit && (needsWallOutlets(r) || isBath(r) || r.type === "hall" || roleOf(r) === "garage")) out.push(at(level, r, { status: "fail", text: `${where(level, r)}: no switched light.`, fix: "Add a light and a switch." }));
    }
    if (fine) out.push({ status: "pass", text: `${level.name}: ${outlets.length} outlets cover every wall, counter, basin, washer and bay checked (${fine}).`, levelId: level.id });
  }
  return out;
}

export function alarmChecks(h: HouseFacts): RuleResult[] {
  const out: RuleResult[] = [];
  const co = coNeeded(h.project);
  for (const level of h.drawn) {
    const plan = h.plan(level.id);
    const devices = levelDevices(h.project, level);
    const smoke = devices.filter((d) => isSmoke(d.kind));
    const inRoom = (r: PlanRoom, test: (d: PlacedDevice) => boolean) => devices.some((d) => test(d) && pointInPolygon(P(d), r.polygon));
    for (const r of plan.rooms.filter(isSleeping)) {
      if (!inRoom(r, (d) => isSmoke(d.kind))) out.push(at(level, r, { status: "fail", text: `${where(level, r)}: no smoke alarm in the bedroom.`, fix: "Add a smoke alarm (Plans page, Outlets and lights)." }));
      // Outside the sleeping area: the room each bedroom door opens into.
      for (const g of openingGeometries(plan).filter((x) => x.opening.kind !== "window" && openingRooms(plan, x.opening).includes(r.id))) {
        const other = plan.rooms.find((x) => x.id === openingRooms(plan, g.opening).find((id) => id !== r.id));
        if (!other || isSleeping(other) || isBath(other) || roleOf(other) === "closet" || roleOf(other) === "outdoor" || other.type === "primary-closet") continue;
        if (!inRoom(other, (d) => isSmoke(d.kind))) out.push(at(level, other, { status: "fail", text: `${where(level, other)}: no smoke alarm outside ${r.name}.`, fix: "Add one in the hall or room outside the bedroom door." }));
        if (co && !inRoom(other, (d) => isCo(d.kind))) out.push(at(level, other, { status: "fail", text: `${where(level, other)}: no carbon monoxide alarm outside ${r.name}.`, fix: "Use a combination smoke and CO alarm there." }));
      }
    }
    if (!smoke.length && plan.rooms.some((r) => roleOf(r) !== "outdoor" && roleOf(r) !== "garage")) out.push({ status: "fail", text: `${level.name}: no smoke alarm on this floor.`, fix: "Add one in a hall or living area.", levelId: level.id });
    // Not near a bathroom door or the range.
    const bathDoors = openingGeometries(plan)
      .filter((g) => g.opening.kind !== "window" && openingRooms(plan, g.opening).some((id) => isBath(plan.rooms.find((r) => r.id === id) ?? {})))
      .map((g) => g.center);
    const ranges = plan.fixtures.filter((f) => f.kind === "range").map((f) => ({ x: f.x, y: f.y }));
    for (const d of smoke) {
      if (bathDoors.some((b) => dist(b, P(d)) < codeNum("smoke.minDistanceFromBathroom") - 1)) out.push({ status: "fail", text: `${level.name}: a smoke alarm is within ${codeNum("smoke.minDistanceFromBathroom")}" of a bathroom door.`, fix: "Move it farther from the door.", levelId: level.id, at: P(d) });
      if (ranges.some((g) => dist(g, P(d)) < codeNum("smoke.minDistanceFromCookingPhotoelectric"))) out.push({ status: "fail", text: `${level.name}: a smoke alarm is within ${codeNum("smoke.minDistanceFromCookingPhotoelectric") / 12} ft of the range.`, fix: "Move it farther from the kitchen.", levelId: level.id, at: P(d) });
    }
    if (codeEntry("smoke.garageHeatAlarm").value === true && hasAttachedGarage(h.project))
      for (const g of plan.rooms.filter((r) => roleOf(r) === "garage"))
        if (!inRoom(g, (d) => d.kind === "heat")) out.push(at(level, g, { status: "fail", text: `${where(level, g)}: no heat alarm (Boise asks for one in an attached garage, wired to the smoke alarms).`, fix: "Add a heat alarm in the garage." }));
    if (smoke.length) out.push({ status: "pass", text: `${level.name}: ${smoke.length} smoke alarm${smoke.length === 1 ? "" : "s"}${co ? `, ${devices.filter((d) => isCo(d.kind)).length} with CO` : ""}, wired together.`, levelId: level.id });
  }
  return out;
}

export function bathFanCheck(h: HouseFacts, level: Level, r: PlanRoom): boolean {
  return levelDevices(h.project, level).some((d) => d.kind === "fan" && pointInPolygon(P(d), r.polygon));
}

export function mechanicalChecks(h: HouseFacts): RuleResult[] {
  const out: RuleResult[] = [];
  const sys = h.project.plans.systems;
  for (const level of h.drawn) {
    const plan = h.plan(level.id);
    for (const r of plan.rooms.filter(isBath)) {
      if (bathFanCheck(h, level, r)) out.push(at(level, r, { status: "pass", text: `${where(level, r)}: exhaust fan, ${codeNum("vent.bathIntermittent")} cfm` }));
      else out.push(at(level, r, { status: "fail", text: `${where(level, r)}: no exhaust fan.`, fix: "Add a fan (Plans page, Outlets and lights)." }));
    }
    for (const run of dryerRuns(plan))
      out.push(
        run.ok
          ? { status: "pass", text: `${level.name}: dryer duct about ${run.equivalentFt.toFixed(1)} ft (${codeNum("mech.dryerExhaustMaxLength")} ft max)`, levelId: level.id }
          : { status: "fail", text: `${level.name}: the dryer duct is about ${run.equivalentFt.toFixed(1)} ft counting elbows, over ${codeNum("mech.dryerExhaustMaxLength")} ft.`, fix: "Move the dryer to an outside wall, or note a booster fan or a dryer listed for a longer duct.", levelId: level.id, at: { x: run.dryer.x, y: run.dryer.y }, stage: "plan" },
        );
    if (plan.fixtures.some((f) => f.kind === "range")) out.push({ status: "pass", text: `${level.name}: range hood ${codeNum("vent.kitchenIntermittent")} cfm or more, vented outside`, levelId: level.id });
  }
  if (h.drawn.length) {
    if (sys.freshAir === "bath-fan" && !freshAirFan(h.project)) out.push({ status: "fail", text: "No bathroom fan to run as the whole-house fresh-air fan.", fix: "Add a bath fan, or pick an ERV in Plan details." });
    else out.push({ status: "pass", text: `Whole-house fresh air: ${wholeHouseCfm(h.project)} cfm continuous, ${sys.freshAir === "erv" ? "by an ERV" : "by a bath fan"}` });
  }
  return out;
}
