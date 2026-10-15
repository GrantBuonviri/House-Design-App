import type { Project } from "@/lib/model/schema";
import { canDraw, readiness, type SheetEntry } from "./catalog";
import { frame, SHEET_H, SHEET_W } from "./frame";
import type { Item, Sheet } from "./draw";
import { houseFacts } from "./house";
import { coverSheet, codeSheets } from "./sheets/general";
import { floorPlanSheet } from "./sheets/floorPlan";
import { elevationSheets } from "./sheets/elevations";
import { siteSheet } from "./sheets/site";
import { roofSheet } from "./sheets/roof";
import { viewsSheet } from "./sheets/views";
import { materialsSheet } from "./sheets/materials";
import { landscapeSheet } from "./sheets/landscape";
import { doorWindowSheets, finishSheets, fixtureSheets } from "./sheets/schedules";
import { cabinetSheets } from "./sheets/cabinets";
import { electricalSheet } from "./sheets/electrical";
import { plumbingSheet } from "./sheets/plumbing";
import { mechanicalSheet } from "./sheets/mechanical";
import { energySheets } from "./sheets/energy";

/**
 * Put a set of sheets together: draw each chosen sheet, then add the
 * border and title block with its number, "3 of 7" and the status label.
 */

export type SetOptions = {
  /** Sheet ids to draw. Left out: every sheet that can be drawn and isn't excluded in the project's settings. */
  only?: string[];
  date?: Date;
};

export function issueDate(d = new Date()): string {
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

/** The sheet ids "Export selected" uses. */
export function selectedIds(project: Project): string[] {
  const excluded = new Set(project.plans.excluded);
  return readiness(project)
    .sheets.filter((s) => canDraw(s) && !excluded.has(s.id))
    .map((s) => s.id);
}

export function buildSet(project: Project, opts: SetOptions = {}): Sheet[] {
  const r = readiness(project);
  const ids = new Set(opts.only ?? selectedIds(project));
  const chosen = r.sheets.filter((s) => canDraw(s) && ids.has(s.id));
  const h = houseFacts(project);
  const drafts: { entry: SheetEntry; number: string; title: string; items: Item[]; scale?: string }[] = [];
  for (const entry of chosen) {
    if (entry.id === "cover") drafts.push({ entry, number: entry.number, title: entry.title, items: coverSheet(project, { sheets: chosen, report: r.report, label: r.label }) });
    else if (entry.id === "code") {
      codeSheets(project, r.report).forEach((items, i) => drafts.push({ entry, number: i ? `${entry.number}.${i}` : entry.number, title: i ? `${entry.title} (continued)` : entry.title, items }));
    } else if (entry.id === "site") {
      const sp = siteSheet(project);
      drafts.push({ entry, number: entry.number, title: entry.title, items: sp.items, scale: sp.scaleLabel });
    } else if (entry.id === "roof") {
      const rp = roofSheet(project);
      drafts.push({ entry, number: entry.number, title: entry.title, items: rp.items, scale: rp.scaleLabel });
    } else if (entry.id === "views") {
      const v = viewsSheet(project);
      drafts.push({ entry, number: entry.number, title: entry.title, items: v.items, scale: v.scaleLabel });
    } else if (entry.id === "exterior-materials") {
      drafts.push({ entry, number: entry.number, title: entry.title, items: materialsSheet(project) });
    } else if (entry.id === "landscape") {
      const lp = landscapeSheet(project);
      drafts.push({ entry, number: entry.number, title: entry.title, items: lp.items, scale: lp.scaleLabel });
    } else if (entry.id === "door-window" || entry.id === "finishes" || entry.id === "fixtures") {
      const pages = entry.id === "door-window" ? doorWindowSheets(project) : entry.id === "finishes" ? finishSheets(project) : fixtureSheets(project);
      pages.forEach((items, i) => drafts.push({ entry, number: i ? `${entry.number}.${i}` : entry.number, title: i ? `${entry.title} (continued)` : entry.title, items }));
    } else if (entry.id === "cabinets") {
      const pages = cabinetSheets(project);
      pages.forEach((pg, i) => drafts.push({ entry, number: i ? `I-${201 + i}` : entry.number, title: pages.length > 1 ? `${entry.title} (${i + 1} of ${pages.length})` : entry.title, items: pg.items, scale: pg.scaleLabel }));
    } else if (entry.id === "elevations") {
      for (const e of elevationSheets(project)) drafts.push({ entry, number: e.part ? `A-${201 + e.part}` : entry.number, title: e.parts > 1 ? `${entry.title} (${e.part + 1} of ${e.parts})` : entry.title, items: e.items, scale: e.scaleLabel });
    } else if (entry.levelId && /^(electrical|plumbing|mechanical):/.test(entry.id)) {
      const level = h.levels.find((l) => l.id === entry.levelId)!;
      const kind = entry.id.split(":")[0];
      const sp = kind === "electrical" ? electricalSheet(project, level) : kind === "plumbing" ? plumbingSheet(project, level) : mechanicalSheet(project, level);
      drafts.push({ entry, number: entry.number, title: entry.title, items: sp.items, scale: sp.scaleLabel });
    } else if (entry.id === "energy") {
      energySheets(project).forEach((items, i) => drafts.push({ entry, number: i ? `${entry.number}.${i}` : entry.number, title: i ? `${entry.title} (continued)` : entry.title, items }));
    } else if (entry.levelId) {
      const level = h.levels.find((l) => l.id === entry.levelId)!;
      const fp = floorPlanSheet(project, level);
      drafts.push({ entry, number: entry.number, title: entry.title, items: fp.items, scale: fp.scaleLabel });
    }
  }
  const info = { project, label: r.label, date: issueDate(opts.date), half: project.plans.sheetSize === "half", total: drafts.length };
  return drafts.map((d, i) => ({
    id: i && drafts[i - 1].entry.id === d.entry.id ? `${d.entry.id}:${i}` : d.entry.id,
    number: d.number,
    title: d.title,
    w: SHEET_W,
    h: SHEET_H,
    items: [...d.items, ...frame(info, { number: d.number, title: d.title, index: i + 1, scale: d.scale })],
  }));
}
