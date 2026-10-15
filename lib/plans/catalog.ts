import type { Project, Stage } from "@/lib/model/schema";
import { codeReport, type RuleReport } from "@/lib/codes/rules";
import { houseFacts } from "./house";
import { siteLayout } from "./lot";
import { houseScene } from "./scene";
import { exteriorPartsFor, exteriorPick } from "@/lib/exterior/picks";

/**
 * Every plan sheet a Boise house permit asks for (checklist #402), grouped
 * the way a set is bound, each with a readiness rule worked out from the
 * project. Sheets that come in later updates show as "coming".
 */

export type SheetStatus = "ready" | "notes" | "needs" | "not-needed" | "outside" | "soon";

export const STATUS_LABEL: Record<SheetStatus, string> = {
  ready: "Ready",
  notes: "Ready, with notes",
  needs: "Needs more",
  "not-needed": "Not needed",
  outside: "From outside the app",
  soon: "Coming in a later update",
};

export type SheetGroup = "General" | "Site" | "Architectural" | "Interiors" | "Systems" | "Structural" | "From outside the app";
export const SHEET_GROUPS: SheetGroup[] = ["General", "Site", "Architectural", "Interiors", "Systems", "Structural", "From outside the app"];

export type Reason = { text: string; stage?: Stage; action?: "details" | "lot" };

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

type Later = { id: string; number: string; title: string; group: SheetGroup; optional?: boolean; part: number };

/** Sheets that come with later parts of this feature. */
const LATER: Later[] = [
  { id: "energy", number: "G-003", title: "Energy: insulation, windows and REScheck inputs", group: "General", part: 4 },
  { id: "sections", number: "A-301", title: "Building sections", group: "Architectural", part: 5 },
  { id: "stair-section", number: "A-501", title: "Stair section and details", group: "Architectural", part: 5 },
  { id: "door-window", number: "A-601", title: "Door and window schedules", group: "Architectural", part: 3 },
  { id: "cabinets", number: "I-201", title: "Cabinet plans and elevations", group: "Interiors", part: 3 },
  { id: "finishes", number: "I-601", title: "Room finish schedule", group: "Interiors", part: 3 },
  { id: "electrical", number: "E-101", title: "Electrical plan", group: "Systems", part: 4 },
  { id: "plumbing", number: "P-101", title: "Plumbing plan", group: "Systems", part: 4 },
  { id: "fixtures", number: "P-601", title: "Appliance and plumbing fixture schedule", group: "Systems", part: 3 },
  { id: "mechanical", number: "M-101", title: "Mechanical plan", group: "Systems", part: 4 },
  { id: "foundation", number: "S-101", title: "Foundation plan", group: "Structural", part: 5 },
  { id: "floor-framing", number: "S-201", title: "Floor framing plans", group: "Structural", part: 5 },
  { id: "roof-framing", number: "S-301", title: "Roof framing plan (truss layout)", group: "Structural", part: 5 },
  { id: "bracing", number: "S-401", title: "Wall bracing plan", group: "Structural", part: 5 },
];

/** Documents a permit needs that the app can't make, who makes them, and what the app gives them. */
export const OUTSIDE_DOCS: { id: string; title: string; who: string; gives: string }[] = [
  { id: "manual-j", title: "Heating and cooling loads (Manual J, D and S)", who: "Your HVAC contractor, using ACCA Manual J, D and S software", gives: "Room list, floor areas, window sizes and Boise's design temperatures (11°F winter, 95°F summer)." },
  { id: "rescheck", title: "Energy compliance report (REScheck or an energy rating)", who: "You, with the free REScheck tool at energycodes.gov, or an energy rater", gives: "Wall, window, ceiling and floor areas (on the energy sheet, coming in a later update)." },
  { id: "trusses", title: "Roof truss drawings", who: "The truss supplier's engineer", gives: "Roof shape, pitch, overhangs and spans." },
  { id: "engineering", title: "Structural engineering", who: "An Idaho-licensed engineer, only where a sheet says \"Engineer required\"", gives: "The framing layout and loads." },
  { id: "survey", title: "Survey or recorded plat", who: "A licensed land surveyor, or the county's recorded plat", gives: "Nothing; the site plan is drawn from it." },
  { id: "fire-flow", title: "Fire flow letter", who: "Your water company (Veolia or the city)", gives: "The address and house size." },
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

const cache = new WeakMap<Project, Readiness>();

export function readiness(project: Project): Readiness {
  const hit = cache.get(project);
  if (hit) return hit;
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
    if (!site.real) reasons.push({ text: "Sample lot, not a real property: fill in My real lot", action: "lot" });
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

  for (const s of LATER) sheets.push({ id: s.id, number: s.number, title: s.title, group: s.group, optional: s.optional, status: "soon", reasons: [{ text: `Added in part ${s.part} of the plans export` }] });
  for (const d of OUTSIDE_DOCS) sheets.push({ id: `outside:${d.id}`, number: "", title: d.title, group: "From outside the app", status: "outside", reasons: [{ text: `Made by: ${d.who}.` }, { text: `The app gives them: ${d.gives}` }] });

  const order = (g: SheetGroup) => SHEET_GROUPS.indexOf(g);
  sheets.sort((a, b) => order(a.group) - order(b.group) || a.number.localeCompare(b.number));

  const labelReasons: string[] = [];
  const missing = sheets.filter((s) => !s.optional && (s.status === "needs" || s.status === "soon"));
  if (missing.length) labelReasons.push(`${missing.length} sheet${missing.length === 1 ? " isn't" : "s aren't"} ready yet`);
  if (fails.length) labelReasons.push(`${fails.length} code check${fails.length === 1 ? "" : "s"} fail`);
  const out: Readiness = { sheets, report, label: labelReasons.length ? LABEL_PRELIMINARY : LABEL_REVIEW, labelReasons };
  cache.set(project, out);
  return out;
}
