import type { Fixture, Level, Project } from "@/lib/model/schema";
import { add, pointInPolygon, rotate } from "@/lib/plan/geometry";
import { placedHookups } from "@/lib/plan/devices";
import { roleOf } from "@/lib/plan/connect";
import { codeName, codeNum, codeRef, codeText, codeEntry } from "@/lib/codes/data";
import { DRAW_AREA } from "../frame";
import { localFacts } from "../local";
import { viewTitle } from "../view";
import { houseFacts } from "../house";
import { levelDevices } from "../systems";
import { planBase } from "./floorPlan";
import { fixtureTags } from "./schedules";
import { deviceSymbol, NotesColumn } from "./symbols";
import { NOTES_W, type SystemsSheet } from "./electrical";
import { textWidth, type Item } from "../draw";

/**
 * Plumbing plan, one sheet per floor: fixtures tagged to the fixture
 * schedule (P-601), the water heater, hose bibs, gas outlets, and the
 * drainage and water supply fixture units for sizing the pipes.
 */

/** Fixture kinds and their fixture-unit keys in the code data. */
const UNITS: { kind: string; key: string; label: string }[] = [
  { kind: "vanity", key: "lavatory", label: "Lavatory (bathroom sink)" },
  { kind: "sink", key: "kitchenSink", label: "Kitchen sink" },
  { kind: "dishwasher", key: "dishwasher", label: "Dishwasher" },
  { kind: "washer", key: "clothesWasher", label: "Clothes washer" },
  { kind: "shower", key: "shower", label: "Shower" },
  { kind: "tub", key: "bathtub", label: "Bathtub" },
  { kind: "toilet", key: "waterCloset", label: "Toilet (1.6 gal)" },
  { kind: "laundry-sink", key: "laundrySink", label: "Laundry sink" },
];

/** Gas appliances, given the house's fuel choices. */
export function gasFixtures(project: Project, fixtures: Fixture[]): Fixture[] {
  const s = project.plans.systems;
  return fixtures.filter(
    (f) =>
      (f.kind === "range" && s.cooking === "gas") ||
      (f.kind === "dryer" && s.dryer === "gas") ||
      (f.kind === "furnace" && s.heating === "gas-furnace") ||
      (f.kind === "water-heater" && (s.waterHeater === "gas" || s.waterHeater === "tankless-gas")) ||
      f.kind === "fireplace",
  );
}

/** Fixture counts for the whole house, with drainage (DFU) and water supply (WSFU) units. */
export function fixtureUnits(project: Project): { rows: { label: string; count: number; dfu: number; wsfu: number }[]; dfu: number; wsfu: number } {
  const h = houseFacts(project);
  const fixtures = h.levels.flatMap((l) => h.plan(l.id).fixtures);
  const rows = UNITS.map((u) => {
    // A vanity 60" or wider has two basins.
    const count = fixtures.filter((f) => f.kind === u.kind).reduce((s, f) => s + (u.kind === "vanity" && f.widthIn >= 60 ? 2 : 1), 0);
    return { label: u.label, count, dfu: codeNum(`plumbing.dfu.${u.key}`), wsfu: codeNum(`plumbing.wsfu.${u.key}`) };
  }).filter((r) => r.count > 0);
  const bibs = h.levels.reduce((s, l) => s + levelDevices(project, l).filter((d) => d.kind === "hose-bib").length, 0);
  if (bibs) rows.push({ label: "Hose bib", count: bibs, dfu: 0, wsfu: codeNum("plumbing.wsfu.hoseBib") });
  return { rows, dfu: rows.reduce((s, r) => s + r.count * r.dfu, 0), wsfu: rows.reduce((s, r) => s + r.count * r.wsfu, 0) };
}

const n1 = (n: number) => (Math.round(n * 10) / 10).toString();

export function plumbingSheet(project: Project, level: Level): SystemsSheet {
  const h = houseFacts(project);
  const plan = h.plan(level.id);
  const base = planBase(project, level);
  const { T } = base;
  const items: Item[] = [...base.items];
  const tags = fixtureTags(project);

  // Tags on each plumbing fixture.
  for (const f of plan.fixtures) {
    const tag = tags.get(f.id);
    if (!tag || (!tag.startsWith("P") && !["washer", "dishwasher"].includes(f.kind))) continue;
    const c = T({ x: f.x, y: f.y });
    const w = textWidth(tag, 5.5, true) + 0.08;
    items.push({ t: "poly", pts: [add(c, { x: -w / 2, y: -0.07 }), add(c, { x: w / 2, y: -0.07 }), add(c, { x: w / 2, y: 0.07 }), add(c, { x: -w / 2, y: 0.07 })], stroke: "fine", fill: "#ffffff" });
    items.push({ t: "text", at: c, text: tag, size: 5.5, bold: true, align: "center", valign: "middle" });
  }
  // Water, drain and gas hookups: the ones fixtures bring (less any taken away) and ones placed in Furnish.
  const hookups = placedHookups(plan, project.plans.systems).filter((d) => ["water", "drain", "gas"].includes(d.kind));
  for (const d of hookups) items.push(...deviceSymbol(d.kind, T({ x: d.x, y: d.y }), rotate({ x: 0, y: 1 }, d.rotation)));
  // Hose bibs.
  for (const d of levelDevices(project, level).filter((x) => x.kind === "hose-bib")) items.push(...deviceSymbol("hose-bib", T({ x: d.x, y: d.y }), rotate({ x: 0, y: 1 }, d.rotation)));

  // ---------- Legend, fixture units, notes ----------
  const col = new NotesColumn(DRAW_AREA.x1 - NOTES_W, DRAW_AREA.y0, NOTES_W, DRAW_AREA.y1);
  col.heading("Plumbing legend");
  {
    const c = { x: col.x + 0.25, y: col.y + 0.1 };
    col.items.push({ t: "poly", pts: [add(c, { x: -0.1, y: -0.07 }), add(c, { x: 0.1, y: -0.07 }), add(c, { x: 0.1, y: 0.07 }), add(c, { x: -0.1, y: 0.07 })], stroke: "fine", fill: "#ffffff" });
    col.items.push({ t: "text", at: c, text: "P1", size: 5.5, bold: true, align: "center", valign: "middle" });
    col.items.push({ t: "text", at: { x: col.x + 0.6, y: col.y + 0.12 }, text: "Fixture tag; see the fixture schedule (P-601).", size: 6.5 });
    col.y += 0.34;
  }
  col.legend("hose-bib", `Frost-free hose bib with backflow protection (${codeRef("plumbing.hoseBibBackflow")}).`);
  if (hookups.some((d) => d.kind === "water")) col.legend("water", "Hot and cold water supply stub-out, with a shutoff valve.");
  if (hookups.some((d) => d.kind === "drain")) col.legend("drain", "Drain and vent stub-out.");
  if (hookups.some((d) => d.kind === "gas")) col.legend("gas", "Gas outlet with a shutoff valve at the appliance.");

  const fu = fixtureUnits(project);
  col.heading("Fixture units, whole house");
  col.table(
    [
      { title: "Fixture", width: 2 },
      { title: "Qty", width: 0.5 },
      { title: "DFU each", width: 0.75 },
      { title: "DFU", width: 0.6 },
      { title: "WSFU each", width: 0.85 },
      { title: "WSFU", width: 0.7 },
    ],
    [...fu.rows.map((r) => [r.label, `${r.count}`, r.dfu ? n1(r.dfu) : "-", r.dfu ? n1(r.dfu * r.count) : "-", n1(r.wsfu), n1(r.wsfu * r.count)]), ["Total", "", "", n1(fu.dfu), "", n1(fu.wsfu)]],
  );
  {
    const tb = `DFU: drainage fixture units (${codeRef("plumbing.dfu.lavatory")}), for sizing the drains and building sewer. WSFU: water supply fixture units, private use (${codeRef("plumbing.wsfu.lavatory")}), for sizing the water service and meter.`;
    col.notes([tb]);
  }

  col.heading("Plumbing notes");
  const sys = project.plans.systems;
  const wh = h.levels.flatMap((l) => h.plan(l.id).fixtures.filter((f) => f.kind === "water-heater").map((f) => ({ f, l })));
  const whInGarage = wh.some(({ f, l }) => h.plan(l.id).rooms.some((r) => roleOf(r) === "garage" && pointInPolygon({ x: f.x, y: f.y }, r.polygon)));
  const gas = sys.waterHeater === "gas" || sys.waterHeater === "tankless-gas";
  const notes = [
    `All work to the ${codeName("Plumbing")}, by a licensed plumber or the owner under a plumbing permit from ${localFacts().plumbingPermit ?? localFacts().reviewer}.`,
    `Water use: toilets ${codeNum("plumbing.wcMaxFlush")} gal per flush (${codeRef("plumbing.wcMaxFlush")}), shower heads ${codeNum("plumbing.showerheadMaxFlow")} gpm (${codeRef("plumbing.showerheadMaxFlow")}), bathroom faucets ${codeNum("plumbing.lavatoryFaucetMaxFlow")} gpm, kitchen faucets ${codeNum("plumbing.kitchenFaucetMaxFlow")} gpm at most.`,
    `Shower and tub-shower valves: pressure-balance or thermostatic, limited to ${codeNum("plumbing.showerValveMaxTemp")}°F (${codeRef("plumbing.showerValveMaxTemp")}).`,
    `Water heater: ${sys.waterHeater === "tankless-gas" ? "tankless, gas" : sys.waterHeater === "heat-pump" ? "heat pump" : sys.waterHeater}. Relief valve drain to a safe, visible spot with no valve in the line (${codeRef("plumbing.waterHeaterTPRDischarge")}).${gas && whInGarage ? ` In the garage, the burner sits at least ${codeNum("mech.garageIgnitionHeight")}" above the floor (${codeRef("mech.garageIgnitionHeight")}).` : ""}${codeEntry("plumbing.whStrapRequired").value === true ? ` Strap the water heater against earthquakes (${codeRef("plumbing.whStrapRequired")}).` : ` No earthquake strap is required here (${codeRef("plumbing.whStrapRequired")}); strap it if the maker asks.`}`,
    `Hose bibs: ${codeText("plumbing.hoseBibBackflow")} (${codeRef("plumbing.hoseBibBackflow")}).`,
    "Size the water service, meter and pipes from the WSFU total and the street pressure (UPC chapter 6); add a pressure-reducing valve if the street pressure is high. Size drains and the building sewer from the DFU total (UPC chapter 7).",
    gasFixtures(project, h.levels.flatMap((l) => h.plan(l.id).fixtures)).length
      ? "Gas piping sized for the total input of every gas appliance and the length of the longest run (IRC chapter 24), with a shutoff valve at each appliance and a sediment trap where the code asks."
      : "No gas appliances.",
    "Pipe routes, cleanouts, vents and the water and sewer entry are laid out by the plumber; show the water service and sewer on the site plan when known.",
  ];
  col.notes(notes);
  items.push(...col.items);

  items.push(...viewTitle(base.area.x0 + 0.1, DRAW_AREA.y1 - 0.45, { number: 1, title: `${level.name} plumbing plan`, scaleLabel: base.scaleLabel, inPerFt: base.inPerFt, north: true }));
  return { items, scaleLabel: base.scaleLabel };
}
