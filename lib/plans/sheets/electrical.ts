import type { DeviceKind, Level, Point, Project } from "@/lib/model/schema";
import { add, dist, pointInPolygon, rotate } from "@/lib/plan/geometry";
import { DEVICE_INFO, isLight, isSwitch, type PlacedDevice } from "@/lib/plan/devices";
import { roleOf } from "@/lib/plan/connect";
import { codeNum, codeRef, codeText } from "@/lib/codes/data";
import { archFeet } from "../draw";
import { DRAW_AREA } from "../frame";
import { viewTitle } from "../view";
import { houseFacts } from "../house";
import { coNeeded, levelDevices, needsGfci, outside, roomAt } from "../systems";
import { planBase } from "./floorPlan";
import { deviceSymbol, legArc, NotesColumn } from "./symbols";
import type { Item } from "../draw";

/**
 * Electrical plan, one sheet per floor: the plan drawn lightly with every
 * outlet, switch, light, fan, smoke and CO alarm and the panel on top,
 * switch legs to the lights they control, GFCI and weatherproof marks, a
 * legend, the circuits the code asks for, and notes.
 */

export const NOTES_W = 5.6;

/** E-101, E-102 and so on, one per floor. */
export const systemsNumber = (prefix: string, i: number) => `${prefix}-${101 + i}`;

export type SystemsSheet = { items: Item[]; scaleLabel: string };

/** Sinks, tubs and showers: outlets within 6 ft need GFCI. */
export const sinksOf = (project: Project, levelId: string): Point[] =>
  houseFacts(project)
    .plan(levelId)
    .fixtures.filter((f) => ["sink", "vanity", "laundry-sink", "tub", "shower"].includes(f.kind))
    .map((f) => ({ x: f.x, y: f.y }));

export function electricalSheet(project: Project, level: Level): SystemsSheet {
  const h = houseFacts(project);
  const plan = h.plan(level.id);
  const base = planBase(project, level);
  const { T } = base;
  const items: Item[] = [...base.items];
  const devices = levelDevices(project, level).filter((d) => DEVICE_INFO[d.kind].system === "electrical");
  const sinks = sinksOf(project, level.id);
  const front = (d: PlacedDevice) => rotate({ x: 0, y: 1 }, d.rotation);

  // Switch legs first, under the symbols.
  for (const [a, b] of switchLegs(plan.rooms, devices)) items.push(legArc(T(a), T(b)));

  for (const d of devices) {
    let note: string | undefined;
    if (d.kind === "outlet") {
      const out = outside(plan.rooms, d);
      note = out ? "WP GFI" : needsGfci(plan.rooms, sinks, d, level.kind) ? "GFI" : undefined;
    }
    if (d.kind === "outlet-240") note = "240V";
    if (d.kind === "junction") note = "FUTURE";
    items.push(...deviceSymbol(d.kind, T({ x: d.x, y: d.y }), front(d), { note, amps: project.plans.systems.panelAmps }));
  }

  // Working space in front of the panel (110.26(A)).
  const panel = devices.find((d) => d.kind === "panel");
  if (panel) {
    const f = front(panel);
    const along = rotate({ x: 1, y: 0 }, panel.rotation);
    const w = codeNum("elec.panelWorkingWidth");
    const dep = codeNum("elec.panelWorkingDepth");
    const p = { x: panel.x, y: panel.y };
    const corner = (a: number, b: number) => T(add(add(p, { x: along.x * a, y: along.y * a }), { x: f.x * b, y: f.y * b }));
    items.push({ t: "poly", pts: [corner(-w / 2, 0), corner(w / 2, 0), corner(w / 2, dep), corner(-w / 2, dep)], stroke: "hair", dash: [0.04, 0.03] });
  }

  // ---------- Legend and notes ----------
  const col = new NotesColumn(DRAW_AREA.x1 - NOTES_W, DRAW_AREA.y0, NOTES_W, DRAW_AREA.y1);
  col.heading("Electrical legend");
  const present = new Set<DeviceKind>(devices.map((d) => d.kind));
  const LEGEND: [DeviceKind, string, string?][] = [
    ["outlet", `Duplex outlet, 120V, tamper-resistant (${codeRef("elec.tamperResistant")}), about 16" up. GFI: GFCI protected. WP: weatherproof with an in-use cover.`],
    ["outlet-240", "240V outlet for an electric range or dryer, sized to the appliance's nameplate."],
    ["junction", "Box for a future island outlet (not required, room left to add one).", "FUTURE"],
    ["switch", "Light switch, 48\" to the top."],
    ["switch-3way", "3-way switch: two switches for the same light."],
    ["light", "Ceiling light."],
    ["light-recessed", "Recessed ceiling light."],
    ["light-wall", "Wall light (over a vanity, or outside at a door)."],
    ["fan", "Exhaust fan. Sizes on the mechanical plan."],
    ["smoke", "Smoke alarm, wired, with battery backup, all wired together."],
    ["smoke-co", "Combination smoke and carbon monoxide alarm."],
    ["co", "Carbon monoxide alarm."],
    ["heat", "Heat alarm in the garage, wired to the smoke alarms (Boise amendment)."],
    ["panel", `Electrical panel, ${project.plans.systems.panelAmps} amp.`],
  ];
  for (const [k, text, note] of LEGEND) if (present.has(k)) col.legend(k, text, { note });
  if (present.has("switch") || present.has("switch-3way")) {
    const c = { x: col.x + 0.25, y: col.y + 0.1 };
    col.items.push(legArc({ x: c.x - 0.2, y: c.y + 0.04 }, { x: c.x + 0.2, y: c.y + 0.04 }));
    const tb = { x: col.x + 0.6, y: col.y + 0.02 };
    col.items.push({ t: "text", at: { x: tb.x, y: tb.y + 0.07 }, text: "Switch leg: the switch and the lights it turns on.", size: 6.5 });
    col.y += 0.3;
  }

  col.heading("Circuits the code asks for");
  col.table(
    [
      { title: "Circuit", width: 1.6 },
      { title: "Serves", width: 2.6 },
      { title: "Protection", width: 1.4 },
    ],
    circuitRows(project),
  );

  col.heading("Electrical notes");
  const sys = project.plans.systems;
  const notes = [
    "All work to the 2023 National Electrical Code with Idaho amendments, by a licensed electrician or the owner under an electrical permit from the State of Idaho (DOPL).",
    `GFCI protection: ${codeText("elec.gfciLocations")} (${codeRef("elec.gfciLocations")}).`,
    `AFCI protection: ${codeText("elec.afciLocations")} (${codeRef("elec.afciLocations")}, Idaho amendment).`,
    `Wall outlets: no point along a wall more than ${codeNum("elec.wallReceptacleMaxDistance")} ft from an outlet, every wall ${codeNum("elec.wallSpaceMinWidth")} ft or wider (${codeRef("elec.wallReceptacleMaxDistance")}); outlets over ${codeNum("elec.receptacleMaxHeight")} ft up don't count. Counters: no point more than ${codeNum("elec.counterReceptacleMaxDistance")}" from an outlet, every counter ${codeNum("elec.counterSpaceMinWidth")}" or wider, no more than ${codeNum("elec.counterReceptacleMaxAbove")}" above it (${codeRef("elec.counterReceptacleMaxDistance")}).`,
    `Bathrooms: an outlet within ${codeNum("elec.bathroomReceptacleFromBasin")}" of each basin (${codeRef("elec.bathroomReceptacleFromBasin")}). Laundry: an outlet within ${codeNum("elec.laundryReceptacleFromAppliance")} ft of the washer (${codeRef("elec.laundryReceptacleFromAppliance")}). Hallways ${codeNum("elec.hallwayReceptacleLength")} ft or longer get one (${codeRef("elec.hallwayReceptacleLength")}). Garages: one in each car bay (${codeRef("elec.garageReceptaclePerBay")}).`,
    `Outside: GFCI outlets at the front and back, no more than ${archFeet(codeNum("elec.outdoorReceptacleMaxHeight"))} above the ground, and one on each deck, porch or balcony (${codeRef("elec.outdoorReceptacleMaxHeight")}).`,
    `Lights: a wall-switched light in every habitable room, bathroom, hallway, stairway and the garage (${codeRef("elec.switchedLightEveryRoom")}); a switched light outside every outside door (${codeRef("elec.outdoorLightAtDoors")}); a switch at each floor for stairs with ${codeNum("elec.stairSwitchRisers")} or more risers (${codeRef("elec.stairSwitchRisers")}). At least ${codeNum("energy.highEfficacyLampsPct")}% of permanent lamps high-efficacy (LED) (${codeRef("energy.highEfficacyLampsPct")}).`,
    `Smoke alarms in each bedroom, outside each sleeping area and on every floor, wired with battery backup and all wired together so one sounds them all (${codeRef("smoke.inEachBedroom")}, ${codeRef("smoke.interconnected")}). None within ${codeNum("smoke.minDistanceFromBathroom")}" of a bathroom door, none within ${codeNum("smoke.minDistanceFromCookingAppliance") / 12} ft of the range unless photoelectric, and photoelectric ones at least ${codeNum("smoke.minDistanceFromCookingPhotoelectric") / 12} ft away (${codeRef("smoke.minDistanceFromCookingAppliance")}).`,
    coNeeded(project)
      ? `Carbon monoxide alarms outside each sleeping area, because the house has ${[sys.heating === "gas-furnace" || sys.waterHeater.includes("gas") || sys.cooking === "gas" || sys.dryer === "gas" ? "gas appliances" : "", h.levels.some((l) => h.plan(l.id).rooms.some((r) => roleOf(r) === "garage")) ? "an attached garage" : ""].filter(Boolean).join(" and ") || "a fuel-burning appliance"} (${codeRef("co.outsideSleepingAreas")}).`
      : `No carbon monoxide alarms needed: no fuel-burning appliances and no attached garage (${codeRef("co.requiredWithFuelOrAttachedGarage")}).`,
    `Panel: ${project.plans.systems.panelAmps} amp. Clear working space ${codeNum("elec.panelWorkingWidth")}" wide, ${codeNum("elec.panelWorkingDepth")}" deep and ${archFeet(codeNum("elec.panelWorkingHeight") * 12)} high in front (dashed) (${codeRef("elec.panelWorkingDepth")}). Not in ${codeText("elec.panelNotIn")} (${codeRef("elec.panelNotIn")}).`,
    "Outlet and switch spots are shown for the layout; the electrician sets exact spots, circuits and wire sizes, and the service size with the load calculation.",
  ];
  col.notes(notes);
  items.push(...col.items);

  items.push(...viewTitle(base.area.x0 + 0.1, DRAW_AREA.y1 - 0.45, { number: 1, title: `${level.name} electrical plan`, scaleLabel: base.scaleLabel, inPerFt: base.inPerFt, north: true }));
  return { items, scaleLabel: base.scaleLabel };
}

/** Each switch to the nearest light it turns on, then light to light: lights in its room, or an outside light by its door. */
export function switchLegs(rooms: { id: string; polygon: Point[] }[], devices: PlacedDevice[]): [Point, Point][] {
  const legs: [Point, Point][] = [];
  const P = (d: PlacedDevice): Point => ({ x: d.x, y: d.y });
  const lights = devices.filter((d) => isLight(d.kind) || d.kind === "fan");
  const linked = new Set<string>();
  for (const s of devices.filter((d) => isSwitch(d.kind))) {
    const room = roomAt(rooms as never, P(s));
    let targets = lights.filter((l) => room && pointInPolygon(P(l), room.polygon) && l.kind !== "fan");
    if (!targets.length) targets = lights.filter((l) => dist(P(l), P(s)) < 120 && l.kind !== "fan").sort((a, b) => dist(P(a), P(s)) - dist(P(b), P(s))).slice(0, 1);
    const outsideLight = lights.find((l) => l.kind === "light-wall" && dist(P(l), P(s)) < 60 && !(room && pointInPolygon(P(l), room.polygon)));
    let from = P(s);
    const left = [...targets];
    while (left.length) {
      left.sort((a, b) => dist(P(a), from) - dist(P(b), from));
      const next = left.shift()!;
      const key = `${from.x},${from.y}>${next.id}`;
      if (!linked.has(key)) legs.push([from, P(next)]);
      linked.add(key);
      from = P(next);
    }
    if (outsideLight) legs.push([P(s), P(outsideLight)]);
  }
  return legs;
}

function circuitRows(project: Project): string[][] {
  const h = houseFacts(project);
  const sys = project.plans.systems;
  const fixtures = h.levels.flatMap((l) => h.plan(l.id).fixtures);
  const has = (k: string) => fixtures.some((f) => f.kind === k);
  const rooms = h.levels.flatMap((l) => h.plan(l.id).rooms);
  const amps = codeNum("elec.smallApplianceAmps");
  const rows: string[][] = [[`Small appliance (${codeNum("elec.smallApplianceCircuits")})`, "Kitchen, dining and pantry counter and wall outlets", `${amps}A, GFCI (${codeRef("elec.smallApplianceCircuits")})`]];
  if (has("washer") || rooms.some((r) => r.type === "laundry")) rows.push(["Laundry", "Laundry outlets", `${amps}A, GFCI (${codeRef("elec.laundryCircuits")})`]);
  if (rooms.some((r) => ["bathroom", "half-bath", "primary-bath"].includes(r.type ?? ""))) rows.push(["Bathrooms", "Bathroom outlets", `${codeNum("elec.bathroomCircuitAmps")}A, GFCI (${codeRef("elec.bathroomCircuitAmps")})`]);
  if (has("range") && sys.cooking === "electric") rows.push(["Range, 240V", "Electric range", "Sized to the nameplate"]);
  if (has("range") && sys.cooking === "gas") rows.push(["Range, 120V", "Gas range igniter and clock", "Small appliance circuit or its own"]);
  if (has("dryer") && sys.dryer === "electric") rows.push(["Dryer, 240V", "Electric dryer", "Sized to the nameplate"]);
  if (has("dishwasher")) rows.push(["Dishwasher", "Dishwasher (and disposal, if any)", "Sized to the nameplate"]);
  rows.push(["Heating", sys.heating === "heat-pump" ? "Heat pump air handler" : sys.heating === "electric-furnace" ? "Electric furnace, 240V" : "Gas furnace blower and controls", "Sized to the nameplate"]);
  if (sys.cooling || sys.heating === "heat-pump") rows.push(["Outdoor unit, 240V", sys.heating === "heat-pump" ? "Heat pump" : "Air conditioner", "Disconnect within sight"]);
  if (sys.waterHeater === "electric" || sys.waterHeater === "heat-pump") rows.push(["Water heater, 240V", sys.waterHeater === "heat-pump" ? "Heat pump water heater" : "Electric water heater", "Sized to the nameplate"]);
  if (rooms.some((r) => roleOf(r) === "garage")) rows.push(["Garage", "Garage outlets", "GFCI"]);
  rows.push(["Outside", "Outside and deck outlets", "GFCI, in-use covers"]);
  rows.push(["Bedrooms", "Bedroom outlets and lights", "AFCI (Idaho)"]);
  rows.push(["General", "Other lights and outlets", "15A or 20A, by the electrician"]);
  return rows;
}
