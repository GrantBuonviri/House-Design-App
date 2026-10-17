import type { Project, Stage } from "@/lib/model/schema";
import { codeReport, type RuleReport } from "@/lib/codes/rules";
import { houseFacts } from "./house";
import { siteLayout } from "./lot";
import { houseScene } from "./scene";
import { exteriorPartsFor, exteriorPick } from "@/lib/exterior/picks";
import { hasCabinetRuns } from "./sheets/cabinets";
import { fixtureLines } from "./sheets/schedules";
import { gasFixtures } from "./sheets/plumbing";
import { levelDevices } from "./systems";
import { structureOf } from "@/lib/structure";
import { flatProject } from "@/lib/plan/flatten";
import { codeNum, codeSetKey } from "@/lib/codes/data";
import { licensedEngineer, localFacts, placeShort } from "./local";

/**
 * Every plan sheet a typical house permit asks for (or the city's own list), grouped
 * the way a set is bound, each with a readiness rule worked out from the
 * project. Sheets that come in later updates show as "coming".
 */

export type SheetStatus = "ready" | "notes" | "needs" | "not-needed" | "outside";

export const STATUS_LABEL: Record<SheetStatus, string> = {
  ready: "Ready",
  notes: "Ready, with notes",
  needs: "Needs more",
  "not-needed": "Not needed",
  outside: "From outside the app",
};

export type SheetGroup = "General" | "Site" | "Architectural" | "Interiors" | "Systems" | "Structural" | "From outside the app";
export const SHEET_GROUPS: SheetGroup[] = ["General", "Site", "Architectural", "Interiors", "Systems", "Structural", "From outside the app"];

export type Reason = { text: string; stage?: Stage; action?: "details" | "lot" | "cabinets" | "devices" };

export type SheetEntry = {
  id: string;
  number: string;
  title: string;
  group: SheetGroup;
  status: SheetStatus;
  reasons: Reason[];
  optional?: boolean;
  /** The floor, for floor plans. */
  levelId?: string;
};

/** Can the sheet be drawn and exported? */
export const canDraw = (s: SheetEntry) => s.status === "ready" || s.status === "notes";

/** Documents a permit needs that the app can't make, who makes them, and what the app gives them. */
export const outsideDocs = (): { id: string; title: string; who: string; gives: string }[] => [
  { id: "manual-j", title: "Heating and cooling loads (Manual J, D and S)", who: "Your HVAC contractor, using ACCA Manual J, D and S software", gives: `Room list, floor areas, window sizes and ${placeShort()}'s design temperatures (${codeNum("design.manualJWinter")}°F winter, ${codeNum("design.manualJSummer")}°F summer).` },
  { id: "rescheck", title: "Energy compliance report (REScheck or an energy rating)", who: "You, with the free REScheck tool at energycodes.gov, or an energy rater", gives: "Wall, window, door, ceiling and floor areas by direction, on the energy sheet (G-003)." },
  { id: "trusses", title: "Roof truss drawings", who: "The truss supplier's engineer", gives: "Roof shape, pitch, overhangs and spans." },
  { id: "engineering", title: "Structural engineering", who: `${licensedEngineer().replace(/^an/, "An")}, only where a sheet says "Engineer required"`, gives: "The framing layout and loads." },
  { id: "survey", title: "Survey or recorded plat", who: "A licensed land surveyor, or the county's recorded plat", gives: "Nothing; the site plan is drawn from it." },
  { id: "fire-flow", title: "Fire flow letter", who: "Your water company or fire district", gives: "The address and house size." },
];

/** Floor plan sheet numbers: A-101 for the lowest floor with rooms, then up. */
export function floorPlanNumber(index: number): string {
  return `A-${101 + index}`;
}

/** Text that goes in the title block's status box. */
export const LABEL_PRELIMINARY = "PRELIMINARY – NOT FOR CONSTRUCTION";
export const LABEL_REVIEW = "PERMIT REVIEW SET – Owner-prepared";

export type Readiness = {
  sheets: SheetEntry[];
  report: RuleReport[];
  /** The status label printed on every sheet. */
  label: string;
  /** Why the set is still preliminary, in short words. */
  labelReasons: string[];
};

/** Keyed by project, then by the code set (the place). */
const cache = new WeakMap<Project, { key: string; v: Readiness }>();

export function readiness(project: Project): Readiness {
  project = flatProject(project);
  const key = codeSetKey();
  const hit = cache.get(project);
  if (hit && hit.key === key) return hit.v;
  const h = houseFacts(project);
  const report = codeReport(project);
  const fails = report.filter((r) => r.status === "fail");
  const failsOn = (levelId: string) => fails.flatMap((r) => r.results.filter((x) => x.status === "fail" && x.levelId === levelId).map((x) => ({ text: `${x.text} (${r.section})`, stage: x.stage })));
  const sheets: SheetEntry[] = [];
  const hasPlan = h.drawn.length > 0;
  const needPlan: Reason[] = [];
  if (!project.plan.basics) needPlan.push({ text: "Answer the plan basics (ceilings, walls, garage)", stage: "plan" });
  if (!hasPlan) needPlan.push({ text: "Draw a floor plan", stage: "plan" });

  // Cover sheet.
  const coverNotes: Reason[] = [];
  if (!project.plans.address.trim()) coverNotes.push({ text: "Site address prints TBD: add it in Plan details", action: "details" });
  if (!project.plans.parcel.trim()) coverNotes.push({ text: "Parcel number prints TBD: add it in Plan details", action: "details" });
  if (!hasPlan) coverNotes.push({ text: "Floor areas print once there's a floor plan", stage: "plan" });
  sheets.push({ id: "cover", number: "G-001", title: "Cover sheet", group: "General", status: coverNotes.length ? "notes" : "ready", reasons: coverNotes });

  // Code summary and check.
  if (needPlan.length) sheets.push({ id: "code", number: "G-002", title: "Code summary and code check", group: "General", status: "needs", reasons: needPlan });
  else
    sheets.push({
      id: "code",
      number: "G-002",
      title: "Code summary and code check",
      group: "General",
      status: fails.length ? "notes" : "ready",
      reasons: fails.length ? [{ text: `${fails.length} code check${fails.length === 1 ? "" : "s"} fail. See the Code check tab.` }] : [],
    });

  // Floor plans, one per floor.
  if (needPlan.length) sheets.push({ id: "floor", number: "A-101", title: "Floor plans", group: "Architectural", status: "needs", reasons: needPlan });
  else
    h.drawn.forEach((l, i) => {
      const notes = failsOn(l.id);
      sheets.push({ id: `floor:${l.id}`, number: floorPlanNumber(i), title: `${l.name} plan`, group: "Architectural", status: notes.length ? "notes" : "ready", reasons: notes, levelId: l.id });
    });

  // Outside of the house.
  const outside = (id: string, number: string, title: string, group: SheetGroup, more: () => Pick<SheetEntry, "status" | "reasons">, optional?: boolean) =>
    sheets.push({ id, number, title, group, optional, ...(needPlan.length ? { status: "needs" as const, reasons: needPlan } : more()) });
  outside("site", "C-101", "Site plan", "Site", () => {
    const site = siteLayout(project);
    if (!site) return { status: "needs", reasons: [{ text: "Fill in My real lot", action: "lot" }, { text: "Or pick a piece of land", stage: "land" }] };
    const reasons: Reason[] = [];
    if (!site.real) reasons.push({ text: project.plot?.source === "custom" ? "Designed lot, not a surveyed property: fill in My real lot (it can copy your designed land)" : "Sample lot, not a real property: fill in My real lot", action: "lot" });
    for (const p of site.problems) reasons.push({ text: p, action: "lot" });
    for (const c of site.checks) {
      if (c.ok === false) reasons.push({ text: `${c.name} setback: the house is ${c.providedFt.toFixed(1)} ft from the lot line, ${c.requiredFt} ft needed`, action: "lot" });
      if (c.ok === null) reasons.push({ text: `${c.name} setback isn't entered`, action: "lot" });
    }
    return { status: reasons.length ? "notes" : "ready", reasons };
  });
  outside(
    "landscape",
    "L-101",
    "Landscape plan",
    "Site",
    () => {
      const picked = ["lawn", "beds", "shrubs", "trees"].some((id) => exteriorPick(project.exterior.selections, id as "lawn"));
      return picked ? { status: "ready", reasons: [] } : { status: "notes", reasons: [{ text: "No lawn, beds, shrubs or trees picked yet: the plan shows the layout only", stage: "exterior" }] };
    },
    true,
  );
  outside("roof", "A-111", "Roof plan", "Architectural", () => {
    const fell = houseScene(project).roofs.some((r) => r.flat && project.house3d.roof.style !== "flat" && r.shape.fellBack);
    return fell ? { status: "notes", reasons: [{ text: "Part of the roof couldn't be worked out and is drawn flat. Simplify the outline there or check the 3D view.", stage: "plan" }] } : { status: "ready", reasons: [] };
  });
  outside("elevations", "A-201", "Exterior elevations", "Architectural", () => ({ status: "ready", reasons: [] }));
  outside("exterior-materials", "A-602", "Exterior materials schedule", "Architectural", () => {
    const parts = exteriorPartsFor(project);
    const missing = parts.filter((c) => !exteriorPick(project.exterior.selections, c.id));
    if (missing.length === parts.length) return { status: "needs", reasons: [{ text: "Pick at least one outside material", stage: "exterior" }] };
    return missing.length ? { status: "notes", reasons: [{ text: `Not picked yet: ${missing.map((c) => c.label.toLowerCase()).join(", ")}`, stage: "exterior" }] } : { status: "ready", reasons: [] };
  });
  outside("views", "A-901", "3D views", "Architectural", () => ({ status: "ready", reasons: [] }), true);

  // Schedules and cabinets.
  outside("door-window", "A-601", "Door and window schedules", "Architectural", () => {
    const any = h.levels.some((l) => h.plan(l.id).openings.some((o) => o.kind !== "opening"));
    if (!any) return { status: "needs", reasons: [{ text: "Place at least one door or window", stage: "plan" }] };
    const missing = (["windows", "entry-doors"] as const).filter((id) => !exteriorPick(project.exterior.selections, id));
    return missing.length ? { status: "notes", reasons: [{ text: `Products print "Owner's pick" until you pick ${missing.map((m) => (m === "windows" ? "windows" : "an entry door")).join(" and ")}`, stage: "exterior" }] } : { status: "ready", reasons: [] };
  });
  outside("finishes", "I-601", "Room finish schedule", "Interiors", () => {
    const picks = project.interior.selections;
    if (!picks.length) return { status: "needs", reasons: [{ text: "Pick at least one inside finish (floors, paint, trim)", stage: "interior" }] };
    const house = (cat: string) => picks.some((s) => s.category === cat && !s.wall);
    const missing = [["flooring", "flooring"], ["paint", "wall paint"], ["trim", "baseboard and casing"]].filter(([c]) => !house(c)).map(([, l]) => l);
    return missing.length ? { status: "notes", reasons: [{ text: `Not picked yet, prints "Owner's pick": ${missing.join(", ")}`, stage: "interior" }] } : { status: "ready", reasons: [] };
  });
  outside("cabinets", "I-201", "Cabinet plans and elevations", "Interiors", () => {
    if (!hasCabinetRuns(project)) return { status: "needs", reasons: [{ text: "Place a counter, island or vanity on the floor plan (Fixtures, Kitchen or Bath)", stage: "plan" }] };
    const picked = project.interior.selections.some((s) => s.category === "cabinets");
    const edit: Reason = { text: "The app lays them out from your counters and appliances.", action: "cabinets" };
    return picked ? { status: "ready", reasons: [edit] } : { status: "notes", reasons: [{ text: "No cabinet style picked yet: the notes say \"owner's pick\"", stage: "interior" }, edit] };
  });
  outside("fixtures", "P-601", "Appliance and plumbing fixture schedule", "Systems", () => {
    const { plumbing, appliances } = fixtureLines(project);
    if (!plumbing.length && !appliances.length) return { status: "needs", reasons: [{ text: "Place plumbing fixtures or appliances on the floor plan (Fixtures)", stage: "plan" }] };
    const unpicked = [...plumbing, ...appliances].filter((l) => l.product === "Owner's pick" && !["laundry-sink", "water-heater", "washer", "dryer"].includes(l.kind));
    return unpicked.length ? { status: "notes", reasons: [{ text: `No product picked yet for: ${[...new Set(unpicked.map((l) => l.label.toLowerCase()))].join(", ")}`, stage: "interior" }] } : { status: "ready", reasons: [] };
  });

  // Systems: electrical, plumbing and mechanical plans, one per floor, and the energy sheet.
  const failsIn = (levelId: string | undefined, ids: string[]) =>
    fails.filter((r) => ids.includes(r.rule.id)).flatMap((r) => r.results.filter((x) => x.status === "fail" && (!levelId || x.levelId === levelId)).map((x) => ({ text: `${x.text} (${r.section})`, action: "devices" as const })));
  const sys = project.plans.systems;
  const perLevel = (id: string, prefix: string, title: string, levels: typeof h.drawn, rules: string[], info: Reason[]) =>
    levels.forEach((l, i) => {
      const notes = failsIn(l.id, rules);
      sheets.push({ id: `${id}:${l.id}`, number: `${prefix}-${101 + i}`, title: `${l.name} ${title}`, group: "Systems", status: notes.length ? "notes" : "ready", reasons: notes.length ? notes : info, levelId: l.id });
    });
  if (needPlan.length) {
    sheets.push({ id: "electrical", number: "E-101", title: "Electrical plans", group: "Systems", status: "needs", reasons: needPlan });
    sheets.push({ id: "plumbing", number: "P-101", title: "Plumbing plans", group: "Systems", status: "needs", reasons: needPlan });
    sheets.push({ id: "mechanical", number: "M-101", title: "Mechanical plans", group: "Systems", status: "needs", reasons: needPlan });
    sheets.push({ id: "energy", number: "G-003", title: "Energy: insulation, windows and REScheck inputs", group: "General", status: "needs", reasons: needPlan });
  } else {
    const edit: Reason = { text: "Placed by the code rules; move, add or take away any of them.", action: "devices" };
    perLevel("electrical", "E", "electrical plan", h.drawn, ["electrical", "alarms"], [edit]);
    const all = h.levels.flatMap((l) => h.plan(l.id).fixtures);
    const plumbingKinds = ["sink", "vanity", "toilet", "tub", "shower", "laundry-sink", "washer", "dishwasher"];
    const fuel = `${sys.heating === "gas-furnace" ? "gas furnace" : sys.heating === "heat-pump" ? "heat pump" : "electric furnace"}, ${sys.waterHeater.replace("-", " ")} water heater, ${sys.foundation}`;
    const details: Reason = { text: `Systems: ${fuel}. Change them in Plan details.`, action: "details" };
    if (!all.some((f) => plumbingKinds.includes(f.kind)) || !all.some((f) => f.kind === "water-heater")) {
      const reasons: Reason[] = [];
      if (!all.some((f) => plumbingKinds.includes(f.kind))) reasons.push({ text: "Place plumbing fixtures on the floor plan (Fixtures, Kitchen or Bath)", stage: "plan" });
      if (!all.some((f) => f.kind === "water-heater")) reasons.push({ text: "Place a water heater (Fixtures, Other)", stage: "plan" });
      sheets.push({ id: "plumbing", number: "P-101", title: "Plumbing plans", group: "Systems", status: "needs", reasons });
    } else {
      const levels = h.drawn.filter((l) => h.plan(l.id).fixtures.some((f) => plumbingKinds.includes(f.kind) || f.kind === "water-heater") || gasFixtures(project, h.plan(l.id).fixtures).length || levelDevices(project, l).some((d) => d.kind === "hose-bib"));
      perLevel("plumbing", "P", "plumbing plan", levels, [], [details]);
    }
    if (!all.some((f) => f.kind === "furnace")) sheets.push({ id: "mechanical", number: "M-101", title: "Mechanical plans", group: "Systems", status: "needs", reasons: [{ text: "Place a furnace or air handler (Fixtures, Other)", stage: "plan" }] });
    else perLevel("mechanical", "M", "mechanical plan", h.drawn, ["mechanical", "bath-vent"], [details]);
    const windows = h.levels.some((l) => h.plan(l.id).openings.some((o) => o.kind === "window"));
    sheets.push(
      windows
        ? { id: "energy", number: "G-003", title: "Energy: insulation, windows and REScheck inputs", group: "General", status: failsIn(undefined, ["energy"]).length ? "notes" : "ready", reasons: [...failsIn(undefined, ["energy"]), details] }
        : { id: "energy", number: "G-003", title: "Energy: insulation, windows and REScheck inputs", group: "General", status: "needs", reasons: [{ text: "Place windows on the floor plan", stage: "plan" }] },
    );
  }

  structuralSheets(project, needPlan, fails).forEach((e) => sheets.push(e));
  for (const d of outsideDocs()) sheets.push({ id: `outside:${d.id}`, number: "", title: d.title, group: "From outside the app", status: "outside", reasons: [{ text: `Made by: ${d.who}.` }, { text: `The app gives them: ${d.gives}` }] });

  const order = (g: SheetGroup) => SHEET_GROUPS.indexOf(g);
  sheets.sort((a, b) => order(a.group) - order(b.group) || a.number.localeCompare(b.number));

  const labelReasons: string[] = [];
  const missing = sheets.filter((s) => !s.optional && s.status === "needs");
  if (missing.length) labelReasons.push(`${missing.length} sheet${missing.length === 1 ? " isn't" : "s aren't"} ready yet`);
  if (fails.length) labelReasons.push(`${fails.length} code check${fails.length === 1 ? "" : "s"} fail`);
  const out: Readiness = { sheets, report, label: labelReasons.length ? LABEL_PRELIMINARY : LABEL_REVIEW, labelReasons };
  cache.set(project, { key, v: out });
  return out;
}

/** Sections, the stair section and the structural sheets (part 5). */
function structuralSheets(project: Project, needPlan: Reason[], fails: RuleReport[]): SheetEntry[] {
  const out: SheetEntry[] = [];
  if (needPlan.length) {
    for (const [id, number, title, group] of [
      ["sections", "A-301", "Building sections", "Architectural"],
      ["stair-section", "A-501", "Stair section and details", "Architectural"],
      ["struct-notes", "S-001", "Structural notes and header schedule", "Structural"],
      ["foundation", "S-101", "Foundation plan", "Structural"],
      ["floor-framing", "S-201", "Floor framing plans", "Structural"],
      ["roof-framing", "S-301", "Roof framing plan (truss layout)", "Structural"],
      ["bracing", "S-401", "Wall bracing plans", "Structural"],
    ] as const)
      out.push({ id, number, title, group, status: "needs", reasons: needPlan });
    return out;
  }
  const h = houseFacts(project);
  const s = structureOf(project);
  const eng = (list: { text: string }[]): Reason[] => list.map((e) => ({ text: `Engineer required: ${e.text}` }));
  const stairs = h.levels.some((l) => h.plan(l.id).stairs.length > 0);
  out.push({ id: "sections", number: "A-301", title: "Building sections", group: "Architectural", status: "ready", reasons: [] });
  const stairFails = fails.filter((r) => r.rule.group === "Stairs").flatMap((r) => r.results.filter((x) => x.status === "fail").map((x) => ({ text: `${x.text} (${r.section})`, stage: x.stage })));
  out.push(
    stairs
      ? { id: "stair-section", number: "A-501", title: "Stair section and details", group: "Architectural", status: stairFails.length ? "notes" : "ready", reasons: stairFails }
      : { id: "stair-section", number: "A-501", title: "Stair section and details", group: "Architectural", status: "not-needed", reasons: [{ text: "No stairs in this house" }] },
  );
  const settings = project.plans.structure;
  const basis: Reason = { text: `Soil ${settings.soilPsf.toLocaleString()} psf, wind exposure ${settings.windExposure}, ${settings.lumber === "df-l" ? "Douglas fir" : "hem-fir"} lumber. Change them in Plan details.`, action: "details" };
  out.push({ id: "struct-notes", number: "S-001", title: "Structural notes and header schedule", group: "Structural", status: s.engineer.length ? "notes" : "ready", reasons: s.engineer.length ? [{ text: `${s.engineer.length} item${s.engineer.length === 1 ? " needs" : "s need"} an engineer; they're listed on this sheet.` }, basis] : [basis] });
  const fd = s.foundation;
  if (fd) {
    const reasons: Reason[] = fd.hillside ? [{ text: `An engineer must design this foundation (${localFacts().hillsideRule ? `${placeShort()} hillside rules` : "steep lot"})` }, ...eng(fd.engineer.slice(1))] : eng(fd.engineer);
    out.push({ id: "foundation", number: "S-101", title: "Foundation plan", group: "Structural", status: reasons.length ? "notes" : "ready", reasons: [...reasons, basis] });
  }
  if (!s.floors.length) out.push({ id: "floor-framing", number: "S-201", title: "Floor framing plans", group: "Structural", status: "not-needed", reasons: [{ text: "Not needed: the only floor sits on a slab" }] });
  s.floors.forEach((f, i) => {
    const level = h.levels.find((l) => l.id === f.levelId)!;
    out.push({ id: `floor-framing:${f.levelId}`, number: `S-${201 + i}`, title: `${level.name} floor framing`, group: "Structural", status: f.engineer.length ? "notes" : "ready", reasons: eng(f.engineer), levelId: f.levelId });
  });
  out.push({ id: "roof-framing", number: "S-301", title: "Roof framing plan (truss layout)", group: "Structural", status: "ready", reasons: [{ text: "The truss supplier's engineer designs the trusses from this layout." }] });
  const levels = [...(s.main ? [s.main] : []), ...s.upper];
  levels.forEach((level, i) => {
    const bad = s.bracing.filter((b) => b.levelId === level.id && b.problems.length);
    out.push({ id: `bracing:${level.id}`, number: `S-${401 + i}`, title: `${level.name} wall bracing`, group: "Structural", status: bad.length ? "notes" : "ready", reasons: bad.map((b) => ({ text: `Line ${b.label}: ${b.problems.join(" ")}`, stage: "plan" as const })), levelId: level.id });
  });
  return out;
}
