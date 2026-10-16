import type { Level, PlanRoom, Point, Project } from "@/lib/model/schema";
import { roleOf } from "@/lib/plan/connect";
import { codeEntry, codeNum } from "@/lib/codes/data";
import { deviceLayout, isBath, type PlacedDevice } from "@/lib/plan/devices";
import { stairsDrawing } from "@/lib/plan/stairs";
import { dist, pointInPolygon } from "@/lib/plan/geometry";
import { houseFacts } from "./house";
import { levelCabinets } from "./sheets/cabinets";
import { flatProject, savedRoom } from "@/lib/plan/flatten";
import { roomArea } from "@/lib/plan/arcs";

/**
 * What the electrical, plumbing and mechanical sheets and the code checks
 * share: each floor's devices (placed by the code rules, plus the owner's
 * changes), and facts about the house's systems.
 */

const cache = new WeakMap<Project, Map<string, PlacedDevice[]>>();

/** Does the house burn anything: gas heat, water heater, range or dryer, or a fireplace? */
export function hasFuel(project: Project): boolean {
  const s = project.plans.systems;
  const h = houseFacts(project);
  return s.heating === "gas-furnace" || s.waterHeater === "gas" || s.waterHeater === "tankless-gas" || s.cooking === "gas" || s.dryer === "gas" || h.levels.some((l) => h.plan(l.id).fixtures.some((f) => f.kind === "fireplace"));
}

export function hasAttachedGarage(project: Project): boolean {
  const h = houseFacts(project);
  return project.plan.basics?.garage !== "detached" && h.levels.some((l) => h.plan(l.id).rooms.some((r) => roleOf(r) === "garage"));
}

/** CO alarms are needed with fuel-burning appliances or an attached garage (IRC R315.2.1). */
export const coNeeded = (project: Project) => hasFuel(project) || hasAttachedGarage(project);

/** The floor at the ground: the lowest one that isn't a basement. */
export function gradeLevel(project: Project): Level | undefined {
  const h = houseFacts(project);
  return h.drawn.find((l) => l.kind !== "basement") ?? h.drawn[0];
}

export function panelLevel(project: Project): Level | undefined {
  const h = houseFacts(project);
  return h.drawn.find((l) => h.plan(l.id).rooms.some((r) => roleOf(r) === "garage")) ?? gradeLevel(project);
}

export function levelDevices(project: Project, level: Pick<Level, "id" | "kind" | "elevationIn">): PlacedDevice[] {
  project = flatProject(project);
  let byLevel = cache.get(project);
  if (!byLevel) cache.set(project, (byLevel = new Map()));
  const hit = byLevel.get(level.id);
  if (hit) return hit;
  const h = houseFacts(project);
  const plan = h.plan(level.id);
  const full = h.levels.find((l) => l.id === level.id);
  const own = full ? plan.stairs.map((s) => stairsDrawing(s, h.riseFor(s, full))) : [];
  const arriving = h.levels
    .filter((l) => l.elevationIn < level.elevationIn)
    .flatMap((l) => h.plan(l.id).stairs.filter((s) => s.toLevelId === level.id).map((s) => stairsDrawing(s, h.riseFor(s, l))));
  const devices = deviceLayout({
    plan,
    cabinets: levelCabinets(project, level),
    exteriorIn: h.exteriorIn,
    systems: project.plans.systems,
    coNeeded: coNeeded(project),
    garageHeat: codeEntry("smoke.garageHeatAlarm").value === true && hasAttachedGarage(project),
    islandOutlet: codeEntry("elec.islandReceptacleRequired").value === true,
    grade: gradeLevel(project)?.id === level.id,
    panel: panelLevel(project)?.id === level.id,
    thermostat: gradeLevel(project)?.id === level.id,
    stairEnds: [...own.filter((d) => d.risers >= 2).map((d) => d.arrow[0]), ...arriving.map((d) => d.arrow[d.arrow.length - 1])],
    stairs: own.map((d) => d.footprint),
  });
  byLevel.set(level.id, devices);
  return devices;
}

export const roomAt = (rooms: PlanRoom[], p: Point) => rooms.find((r) => pointInPolygon(p, r.polygon));

/** Does an outlet here need GFCI protection (NEC 210.8(A), as Idaho amended it)? */
export function needsGfci(rooms: PlanRoom[], sinks: Point[], d: Pick<PlacedDevice, "x" | "y">, levelKind: Level["kind"]): boolean {
  const p = { x: d.x, y: d.y };
  const r = roomAt(rooms, p);
  if (!r || roleOf(r) === "outdoor" || roleOf(r) === "garage") return true;
  if (isBath(r) || ["kitchen", "laundry", "outdoor-kitchen"].includes(r.type ?? "")) return true;
  if (levelKind === "basement" && ["storage", "mechanical"].includes(r.type ?? "")) return true;
  return sinks.some((s) => dist(s, p) <= 72);
}

/** Is the device outside the house walls? */
export const outside = (rooms: PlanRoom[], d: Pick<PlacedDevice, "x" | "y">) => {
  const r = roomAt(rooms, { x: d.x, y: d.y });
  return !r || roleOf(r) === "outdoor";
};

/** Heated floor area, sq ft: every room but the garage and outdoor rooms. */
export function conditionedSqft(project: Project): number {
  const h = houseFacts(project);
  return Math.round(h.levels.reduce((s, l) => s + h.plan(l.id).rooms.filter((r) => roleOf(r) !== "garage" && roleOf(r) !== "outdoor").reduce((a, r) => a + roomArea(savedRoom(r)) / 144, 0), 0));
}

export function bedroomCount(project: Project): number {
  const h = houseFacts(project);
  return h.levels.reduce((s, l) => s + h.plan(l.id).rooms.filter((r) => ["bedroom", "primary-bedroom", "guest-suite"].includes(r.type ?? "")).length, 0);
}

/** Whole-house fresh air, cfm, run all the time (IRC M1505.4.3, Equation 15-1). */
export function wholeHouseCfm(project: Project): number {
  return Math.ceil(codeNum("vent.wholeHouseCfmPerSqFt") * conditionedSqft(project) + codeNum("vent.wholeHouseCfmPerBedroomPlusOne") * (bedroomCount(project) + 1));
}
