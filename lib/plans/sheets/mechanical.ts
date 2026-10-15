import type { Fixture, FloorPlan, Level, Point, Project } from "@/lib/model/schema";
import { add, dist, dot, pointInPolygon, polygonArea, rotate, scale, sub, unit } from "@/lib/plan/geometry";
import { roleOf } from "@/lib/plan/connect";
import { roomEdges, isBath } from "@/lib/plan/devices";
import { codeNum, codeRef } from "@/lib/codes/data";
import { DASH, type Item } from "../draw";
import { DRAW_AREA } from "../frame";
import { viewTitle } from "../view";
import { houseFacts } from "../house";
import { conditionedSqft, bedroomCount, gradeLevel, levelDevices, wholeHouseCfm } from "../systems";
import { planBase } from "./floorPlan";
import { deviceSymbol, NotesColumn } from "./symbols";
import { NOTES_W, type SystemsSheet } from "./electrical";

/**
 * Mechanical plan, one sheet per floor: the furnace and water heater with
 * their working space, supply registers, the return and thermostat, bath
 * fans and the kitchen hood with their airflow, the dryer duct with its
 * length, and the whole-house fresh air rate.
 */

/** The dryer duct: from the back of the dryer to the nearest outside wall. */
export type DryerRun = { dryer: Fixture; from: Point; to: Point; lengthFt: number; elbows: number; equivalentFt: number; ok: boolean };

/** Points along the outside walls of a floor (where the outside is not another room). */
function outsidePoints(plan: FloorPlan): { p: Point; out: Point }[] {
  const pts: { p: Point; out: Point }[] = [];
  const inside = plan.rooms.filter((r) => roleOf(r) !== "outdoor");
  for (const room of inside)
    for (const e of roomEdges(room)) {
      const out = scale(e.inward, -1);
      for (let t = 6; t < e.length - 5; t += 6) {
        const p = add(e.a, scale(e.u, t));
        if (!inside.some((r) => r.id !== room.id && pointInPolygon(add(p, scale(out, 8)), r.polygon))) pts.push({ p, out });
      }
    }
  return pts;
}

export function dryerRuns(plan: FloorPlan): DryerRun[] {
  const walls = outsidePoints(plan);
  return plan.fixtures
    .filter((f) => f.kind === "dryer")
    .flatMap((dryer) => {
      const back = rotate({ x: 0, y: -1 }, dryer.rotation);
      const from = add({ x: dryer.x, y: dryer.y }, scale(back, dryer.depthIn / 2));
      const best = walls.sort((a, b) => dist(a.p, from) - dist(b.p, from))[0];
      if (!best) return [];
      const straight = dot(unit(sub(best.p, from)), back) > 0.94 || dist(best.p, from) < 8;
      const elbows = straight ? 1 : 2;
      const lengthFt = (dist(best.p, from) + 12) / 12;
      const equivalentFt = lengthFt + elbows * codeNum("mech.dryerElbow90Deduct");
      return [{ dryer, from, to: best.p, lengthFt, elbows, equivalentFt, ok: equivalentFt <= codeNum("mech.dryerExhaustMaxLength") }];
    });
}

/** The bath fan that runs all the time for fresh air: in the biggest bathroom on the main floor. */
export function freshAirFan(project: Project): { levelId: string; deviceId: string } | null {
  if (project.plans.systems.freshAir !== "bath-fan") return null;
  const h = houseFacts(project);
  const levels = [gradeLevel(project), ...h.drawn].filter((l): l is Level => Boolean(l));
  for (const l of levels) {
    const plan = h.plan(l.id);
    const baths = plan.rooms.filter(isBath).sort((a, b) => polygonArea(b.polygon) - polygonArea(a.polygon));
    for (const b of baths) {
      const fan = levelDevices(project, l).find((d) => d.kind === "fan" && pointInPolygon({ x: d.x, y: d.y }, b.polygon));
      if (fan) return { levelId: l.id, deviceId: fan.id };
    }
  }
  return null;
}

const ft1 = (n: number) => `${Math.round(n * 10) / 10} ft`;

export function mechanicalSheet(project: Project, level: Level): SystemsSheet {
  const h = houseFacts(project);
  const plan = h.plan(level.id);
  const base = planBase(project, level);
  const { T } = base;
  const items: Item[] = [...base.items];
  const devices = levelDevices(project, level);
  const fresh = freshAirFan(project);
  const cfm = wholeHouseCfm(project);
  const sys = project.plans.systems;

  for (const d of devices.filter((x) => ["supply", "return", "thermostat", "fan"].includes(x.kind))) {
    const note = d.kind === "fan" ? (fresh?.deviceId === d.id ? `${Math.max(cfm, codeNum("vent.bathContinuous"))} CFM CONT.` : `${codeNum("vent.bathIntermittent")} CFM`) : undefined;
    items.push(...deviceSymbol(d.kind, T({ x: d.x, y: d.y }), rotate({ x: 0, y: 1 }, d.rotation), { note }));
  }

  // Hood over each range.
  for (const f of plan.fixtures.filter((x) => x.kind === "range")) {
    const L = (x: number, y: number) => T(add({ x: f.x, y: f.y }, rotate({ x, y }, f.rotation)));
    const w = f.widthIn / 2;
    items.push({ t: "poly", pts: [L(-w, -f.depthIn / 2), L(w, -f.depthIn / 2), L(w, f.depthIn / 2 - 6), L(-w, f.depthIn / 2 - 6)], stroke: "fine", dash: DASH.hidden });
    items.push({ t: "text", at: L(0, f.depthIn / 2 + 8), text: `HOOD ${codeNum("vent.kitchenIntermittent")} CFM MIN., VENT OUT`, size: 5, bold: true, align: "center", valign: "middle" });
  }
  // Working space in front of the furnace and water heater.
  for (const f of plan.fixtures.filter((x) => x.kind === "furnace" || x.kind === "water-heater")) {
    const ws = codeNum("mech.applianceWorkingSpace");
    const L = (x: number, y: number) => T(add({ x: f.x, y: f.y }, rotate({ x, y }, f.rotation)));
    const half = Math.max(ws, f.widthIn) / 2;
    items.push({ t: "poly", pts: [L(-half, f.depthIn / 2), L(half, f.depthIn / 2), L(half, f.depthIn / 2 + ws), L(-half, f.depthIn / 2 + ws)], stroke: "hair", dash: [0.04, 0.03] });
    if (f.kind === "furnace") items.push({ t: "text", at: L(0, f.depthIn / 2 + ws / 2), text: `${ws}" x ${ws}" WORK SPACE`, size: 4.5, align: "center", valign: "middle" });
  }
  // Dryer ducts.
  const runs = dryerRuns(plan);
  for (const r of runs) {
    items.push({ t: "line", pts: [T(r.from), T(r.to)], w: "fine", dash: DASH.hidden });
    const m = T(scale(add(r.from, r.to), 0.5));
    items.push({ t: "text", at: add(m, { x: 0.05, y: -0.08 }), text: `4" DRYER DUCT ${ft1(r.equivalentFt)} EQUIV.`, size: 4.8, bold: true });
  }

  // ---------- Legend and notes ----------
  const col = new NotesColumn(DRAW_AREA.x1 - NOTES_W, DRAW_AREA.y0, NOTES_W, DRAW_AREA.y1);
  col.heading("Mechanical legend");
  col.legend("supply", "Heating and cooling supply register, under a window where there is one.");
  col.legend("return", "Return air grille.");
  col.legend("thermostat", `Programmable thermostat, about 54" up (${codeRef("energy.programmableThermostat")}).`);
  col.legend("fan", "Exhaust fan, ducted outside, with its airflow.");

  col.heading("Ventilation");
  const fanRows: string[][] = [];
  for (const l of h.drawn)
    for (const r of h.plan(l.id).rooms.filter(isBath))
      fanRows.push([r.name, `Exhaust fan, ${l.name.toLowerCase()}`, levelDevices(project, l).some((d) => fresh?.deviceId === d.id && pointInPolygon({ x: d.x, y: d.y }, r.polygon)) ? `${Math.max(cfm, codeNum("vent.bathContinuous"))} cfm continuous (also the fresh-air fan)` : `${codeNum("vent.bathIntermittent")} cfm, switched`]);
  const ranges = h.levels.flatMap((l) => h.plan(l.id).fixtures.filter((f) => f.kind === "range"));
  if (ranges.length) fanRows.push(["Kitchen", "Range hood, ducted outside", `${codeNum("vent.kitchenIntermittent")} cfm or more; over ${codeNum("vent.makeupAirHoodCfm")} cfm needs makeup air`]);
  fanRows.push(["Whole house", sys.freshAir === "erv" ? "Energy recovery ventilator (ERV) near the furnace" : "The bath fan marked CONT., on a timer or always on", `${cfm} cfm continuous: ${codeNum("vent.wholeHouseCfmPerSqFt")} x ${conditionedSqft(project).toLocaleString("en-US")} sq ft + ${codeNum("vent.wholeHouseCfmPerBedroomPlusOne")} x (${bedroomCount(project)} bedrooms + 1)`]);
  col.table(
    [
      { title: "Space", width: 1.3 },
      { title: "Fan", width: 2.1 },
      { title: "Airflow", width: 2.2 },
    ],
    fanRows,
  );

  col.heading("Mechanical notes");
  const heat = sys.heating === "gas-furnace" ? "Gas furnace" : sys.heating === "heat-pump" ? "Heat pump with an air handler" : "Electric furnace";
  const notes = [
    "All work to the 2018 IRC mechanical and fuel gas chapters with Idaho amendments, by a licensed HVAC contractor or the owner under a mechanical permit.",
    `${heat}${sys.cooling && sys.heating !== "heat-pump" ? " with central air conditioning" : ""}. Equipment and duct sizes come from the HVAC contractor's Manual J, D and S, using Boise's design temperatures: ${codeNum("design.manualJWinter")}°F winter, ${codeNum("design.manualJSummer")}°F summer (Boise design criteria).`,
    `Whole-house fresh air: ${cfm} cfm continuous (${codeRef("vent.wholeHouseCfmPerSqFt")}). Bath fans ${codeNum("vent.bathIntermittent")} cfm switched or ${codeNum("vent.bathContinuous")} cfm continuous; kitchen hood ${codeNum("vent.kitchenIntermittent")} cfm (${codeRef("vent.bathIntermittent")}). Hoods over ${codeNum("vent.makeupAirHoodCfm")} cfm need makeup air (${codeRef("vent.makeupAirHoodCfm")}).`,
    `Exhaust ducts end outside at least ${codeNum("mech.exhaustTerminationFromOpenings")} ft from doors, opening windows and air intakes, and ${codeNum("mech.exhaustTerminationFromLotLine")} ft from lot lines (${codeRef("mech.exhaustTerminationFromLotLine")}); never into the attic or crawlspace.`,
    `Dryer duct: 4" smooth metal, no longer than ${codeNum("mech.dryerExhaustMaxLength")} ft, less ${codeNum("mech.dryerElbow90Deduct")} ft for each 90° elbow, unless the dryer maker allows more (${codeRef("mech.dryerExhaustMaxLength")}).${runs.length ? ` Here: ${runs.map((r) => `${ft1(r.lengthFt)} with ${r.elbows} elbow${r.elbows > 1 ? "s" : ""} = ${ft1(r.equivalentFt)}`).join("; ")}.` : ""}`,
    `Furnace and water heater: ${codeNum("mech.applianceWorkingSpace")}" deep, ${codeNum("mech.applianceWorkingSpace")}" wide working space in front (${codeRef("mech.applianceWorkingSpace")}).${sys.heating === "gas-furnace" || sys.waterHeater.includes("gas") ? ` Gas appliances: combustion air and venting to their listing (IRC G2407, G2427); in a garage, burners ${codeNum("mech.garageIgnitionHeight")}" above the floor (${codeRef("mech.garageIgnitionHeight")}).` : ""}`,
    `Ducts: insulated R-${codeNum("energy.ductRAttic")} in the attic and R-${codeNum("energy.ductROther")} elsewhere outside the heated space (${codeRef("energy.ductRAttic")}); sealed and leak-tested (${codeRef("energy.ductTestRequired")}).`,
    `Hot water pipes insulated to R-${codeNum("energy.hotWaterPipeR")} where the energy code asks (${codeRef("energy.hotWaterPipeR")}).`,
    "Register and duct spots are shown for the layout; the HVAC contractor sets the final ones.",
  ];
  col.notes(notes);
  items.push(...col.items);

  items.push(...viewTitle(base.area.x0 + 0.1, DRAW_AREA.y1 - 0.45, { number: 1, title: `${level.name} mechanical plan`, scaleLabel: base.scaleLabel, inPerFt: base.inPerFt, north: true }));
  return { items, scaleLabel: base.scaleLabel };
}
