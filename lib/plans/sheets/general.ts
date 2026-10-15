import type { Project, RealLot } from "@/lib/model/schema";
import { CODE_DATA, CODE_EDITIONS, codeEntry, codeNum, codeText } from "@/lib/codes/data";
import { reportCounts, type RuleReport } from "@/lib/codes/rules";
import { inchText } from "@/lib/codes/rules";
import { planTotals } from "@/lib/plan/measure";
import { plotImplications } from "@/lib/land/implications";
import { houseFacts } from "../house";
import { realLotOk } from "../lot";
import { fittedView } from "./views";
import { DRAW_AREA, designerOf, ownerOf, preparedNote } from "../frame";
import { OUTSIDE_DOCS, type SheetEntry } from "../catalog";
import { capHeight, heading, HEADING_H, lineHeight, rect, table, textBlock, type Item } from "../draw";

/**
 * The general sheets: the cover sheet (project data, sheet index, areas,
 * codes, design criteria, general notes, what comes from outside the app)
 * and the code summary with the full code check.
 */

const COL_GAP = 0.45;

function columns(n: number): { x: number; w: number }[] {
  const total = DRAW_AREA.x1 - DRAW_AREA.x0;
  const w = (total - COL_GAP * (n - 1)) / n;
  return Array.from({ length: n }, (_, i) => ({ x: DRAW_AREA.x0 + i * (w + COL_GAP), w }));
}

export function designCriteriaRows(): string[][] {
  const row = (label: string, key: string, unit = "") => {
    const e = codeEntry(key);
    const v = typeof e.value === "boolean" ? (e.value ? "Yes" : "No") : `${codeText(key)}${unit}`;
    return [label, v, e.amendment ? "Boise / Idaho" : e.section];
  };
  return [
    row("Ground snow load", "design.groundSnowLoad", " psf"),
    row("Roof snow load, at least", "design.roofSnowLoadMin", " psf"),
    row("Wind speed", "design.windSpeed", " mph"),
    row("Seismic design category", "design.seismicCategory"),
    row("Frost line depth", "design.frostDepth", '"'),
    row("Weathering", "design.weathering"),
    row("Termite", "design.termite"),
    row("Winter design temperature", "design.winterDesignTemp", "°F"),
    row("Ice barrier required", "design.iceBarrierRequired"),
    row("Climate zone", "design.climateZone"),
    row("Manual J temperatures", "design.manualJWinter", "°F winter"),
    ["", `${codeText("design.manualJSummer")}°F summer`, ""],
    row("Elevation", "design.elevation", " ft"),
  ];
}

function generalNotes(): string[] {
  return [
    "These drawings show a new single-family house: occupancy R-3, construction type V-B, built under the International Residential Code.",
    "All work follows the codes listed on this sheet as the City of Boise has adopted them. Where the drawings and the code differ, the code governs.",
    "Verify all dimensions and code requirements with the City of Boise before construction.",
    `Design loads (IRC Table R301.2(1), Boise): ground snow ${codeNum("design.groundSnowLoad")} psf, roof snow at least ${codeNum("design.roofSnowLoadMin")} psf, wind ${codeNum("design.windSpeed")} mph, seismic design category ${codeText("design.seismicCategory")}.`,
    `Footings bear on undisturbed soil at least ${codeNum("design.frostDepth")}" below finished grade (frost depth) and ${codeNum("footing.minDepthBelowGrade")}" at the least (IRC R403.1.4). Soil is assumed ordinary; the inspector confirms it at the footing inspection.`,
    "Anything marked \"Engineer required\" must be designed and sealed by an Idaho-licensed engineer before it is built.",
    "Roof trusses are designed by the truss supplier's engineer; their drawings go to the city before framing (IRC R802.10).",
    "Glass marked TEMP is safety glass, tempered or laminated (IRC R308.4).",
    `Smoke alarms in each bedroom, outside each sleeping area and on every floor, wired together with battery backup; carbon monoxide alarms outside sleeping areas when the house has gas appliances or an attached garage (IRC R314, R315).`,
    `Gypsum board between an attached garage and the house: ${inchText(codeNum("garage.gypsumGarageSide"))} Type X on the garage side (IRC Table R302.6 as amended by Idaho).`,
    "Install every product to its maker's instructions and listing.",
  ];
}

export function coverSheet(project: Project, ctx: { sheets: SheetEntry[]; report: RuleReport[]; label: string }): Item[] {
  const items: Item[] = [];
  const h = houseFacts(project);
  const [c1, c2, c3, c4] = columns(4);

  // Banner.
  let y = DRAW_AREA.y0 + 0.1;
  items.push({ t: "text", at: { x: DRAW_AREA.x0, y: y + capHeight(30) }, text: project.name.toUpperCase(), size: 30, bold: true });
  y += capHeight(30) + 0.3;
  const place = project.plans.address.trim() ? `${project.plans.address.trim()}, Boise, Idaho` : "Boise, Idaho (site address TBD)";
  items.push({ t: "text", at: { x: DRAW_AREA.x0, y: y + capHeight(12) }, text: `NEW SINGLE-FAMILY HOUSE  ·  ${place.toUpperCase()}`, size: 12 });
  y += capHeight(12) + 0.25;
  items.push({ t: "text", at: { x: DRAW_AREA.x0, y: y + capHeight(10) }, text: ctx.label, size: 10, bold: true });
  y += 0.5;
  items.push({ t: "line", pts: [{ x: DRAW_AREA.x0, y }, { x: DRAW_AREA.x1, y }], w: "heavy" });
  const top = y + 0.3;

  // Column 1: project data and areas.
  let y1 = top;
  items.push(...heading("Project information", c1.x, y1, c1.w));
  y1 += HEADING_H + 0.05;
  const plot = project.plot;
  const above = h.levels.filter((l) => l.elevationIn >= 0 && l.kind !== "split").length;
  const info: string[][] = [
    ["Owner", ownerOf(project)],
    ["Drawn by", designerOf(project)],
    ["Site address", project.plans.address.trim() || "TBD"],
    ["Parcel number", project.plans.parcel.trim() || "TBD"],
    ["Jurisdiction", "City of Boise, Ada County, Idaho"],
    ["Occupancy", "R-3, single-family house (IRC)"],
    ["Construction type", "V-B, wood frame"],
    ["Stories", `${above} above ground${h.levels.some((l) => l.kind === "basement") ? ", plus a basement" : ""}`],
    ["Fire sprinklers", "None (not required for a house under the IRC as Idaho adopted it)"],
    ["Foundation", foundationText(project)],
    ["Lot", realLotOk(project.plans.lot) ? lotText(project.plans.lot) : plot ? "Sample lot from the app, not a real property" : "TBD"],
  ];
  let tb = table(c1.x, y1, [{ title: "", width: 1.8 }, { title: "", width: c1.w - 1.8 }], info, { size: 7.5, boldFirst: true });
  items.push(...tb.items);
  y1 += tb.height + 0.35;

  items.push(...heading("Floor areas (square feet)", c1.x, y1, c1.w));
  y1 += HEADING_H + 0.05;
  const rows: string[][] = [];
  const sum = { living: 0, garage: 0, outdoor: 0 };
  for (const l of h.drawn) {
    const t = planTotals(h.plan(l.id));
    sum.living += t.living;
    sum.garage += t.garage;
    sum.outdoor += t.outdoor;
    rows.push([l.name, f(t.living), f(t.garage), f(t.outdoor)]);
  }
  rows.push(["Total", f(sum.living), f(sum.garage), f(sum.outdoor)]);
  const cw = (c1.w - 2.2) / 3;
  tb = table(c1.x, y1, [{ title: "Floor", width: 2.2 }, { title: "Living", width: cw }, { title: "Garage", width: cw }, { title: "Porches, decks", width: cw }], h.drawn.length ? rows : [["No floor plan yet", "", "", ""]], { size: 7.5, boldFirst: true });
  items.push(...tb.items);
  y1 += tb.height + 0.1;
  items.push(...textBlock("Areas are measured to the middle of the walls.", c1.x, y1, c1.w, 6.5).items);
  y1 += 0.4;

  items.push(...heading("Design criteria (IRC Table R301.2(1), Boise)", c1.x, y1, c1.w));
  y1 += HEADING_H + 0.05;
  tb = table(c1.x, y1, [{ title: "Item", width: 2.6 }, { title: "Value", width: 2.4 }, { title: "Source", width: c1.w - 5 }], designCriteriaRows(), { size: 7 });
  items.push(...tb.items);

  // Column 2: sheet index and codes.
  let y2 = top;
  items.push(...heading("Sheet index", c2.x, y2, c2.w));
  y2 += HEADING_H + 0.05;
  const index = ctx.sheets.map((s) => [s.number, s.title]);
  tb = table(c2.x, y2, [{ title: "Sheet", width: 1 }, { title: "Title", width: c2.w - 1 }], index, { size: 7.5, boldFirst: true });
  items.push(...tb.items);
  y2 += tb.height + 0.35;
  items.push(...heading("Codes used", c2.x, y2, c2.w));
  y2 += HEADING_H + 0.08;
  for (const e of CODE_EDITIONS) {
    let b = textBlock(e.label, c2.x, y2, c2.w, 7.5, { bold: true });
    items.push(...b.items);
    y2 += b.height;
    b = textBlock(e.detail, c2.x, y2, c2.w, 7);
    items.push(...b.items);
    y2 += b.height + 0.08;
  }
  y2 += 0.05;
  items.push(...textBlock(`Code numbers checked ${CODE_DATA.meta.checked}. Only numbers and section references are used; the code books are the authority.`, c2.x, y2, c2.w, 6.5).items);

  // Column 3: general notes.
  let y3 = top;
  items.push(...heading("General notes", c3.x, y3, c3.w));
  y3 += HEADING_H + 0.08;
  generalNotes().forEach((n, i) => {
    items.push({ t: "text", at: { x: c3.x, y: y3 + capHeight(7.5) }, text: `${i + 1}.`, size: 7.5 });
    const b = textBlock(n, c3.x + 0.25, y3, c3.w - 0.25, 7.5);
    items.push(...b.items);
    y3 += b.height + 0.1;
  });

  // A 3D view of the house under the notes, when there's room.
  if (h.drawn.length && DRAW_AREA.y1 - y3 > 3.5) {
    y3 += 0.25;
    items.push(...heading("3D view", c3.x, y3, c3.w));
    y3 += HEADING_H + 0.1;
    items.push(...fittedView(project, { x: c3.x, y: y3, w: c3.w, h: Math.min(DRAW_AREA.y1 - y3, c3.w * 0.8) }));
  }

  // Column 4: what was checked, what comes from elsewhere, and the disclaimer.
  let y4 = top;
  items.push(...heading("Code check", c4.x, y4, c4.w));
  y4 += HEADING_H + 0.08;
  const counts = reportCounts(ctx.report);
  for (const [label, n] of [
    ["Pass", counts.pass],
    ["Fail", counts.fail],
    ["Check by hand", counts.manual],
  ] as const) {
    items.push({ t: "text", at: { x: c4.x, y: y4 + capHeight(8) }, text: label, size: 8 });
    items.push({ t: "text", at: { x: c4.x + 1.6, y: y4 + capHeight(8) }, text: String(n), size: 8, bold: true });
    y4 += lineHeight(8) + 0.02;
  }
  y4 += 0.05;
  let b = textBlock(`${ctx.report.length} code rules were checked against these drawings. The full list, with sections and what to fix, is on sheet G-002.`, c4.x, y4, c4.w, 7);
  items.push(...b.items);
  y4 += b.height + 0.3;

  items.push(...heading("From outside the app", c4.x, y4, c4.w));
  y4 += HEADING_H + 0.08;
  for (const d of OUTSIDE_DOCS) {
    b = textBlock(d.title, c4.x, y4, c4.w, 7.5, { bold: true });
    items.push(...b.items);
    y4 += b.height;
    b = textBlock(d.who, c4.x, y4, c4.w, 7);
    items.push(...b.items);
    y4 += b.height + 0.08;
  }
  y4 += 0.2;

  const disclaimer = [
    preparedNote(project),
    "The app checked the code rules listed on G-002 against these drawings and shows each result. It does not check anything else, and it can be wrong. Items marked \"Check by hand\" and every document listed above must come from the person or company named.",
    "Plan review by the City of Boise is the real check. Verify all dimensions and code requirements with the City of Boise before construction.",
  ].join("\n");
  b = textBlock(disclaimer, c4.x + 0.12, y4 + 0.12, c4.w - 0.24, 7.5);
  items.push(rect(c4.x, y4, c4.w, b.height + 0.24, "medium"));
  items.push(...b.items);

  return items;
}

function lotText(lot: RealLot): string {
  const sides = lot.shape === "rectangle" ? `${lot.frontFt}' x ${lot.leftFt}'` : `front ${lot.frontFt}', rear ${lot.rearFt}', sides ${lot.leftFt}' and ${lot.rightFt}'`;
  return `${sides}, from the owner's entry of the recorded plat. Site plan C-101.`;
}

function foundationText(p: Project): string {
  if (!p.plot) return "TBD";
  const f = plotImplications(p.plot).foundation;
  const basement = p.levels.some((l) => l.kind === "basement");
  if (basement) return f.type === "slab" || f.type === "crawlspace" ? "Full basement" : f.label;
  return f.type === "slab" ? "Slab or crawlspace" : "Crawlspace with stepped stem walls";
}

const f = (n: number) => (n ? n.toLocaleString("en-US") : "–");

/** Rows of the code check table: failures one per line, passing and by-hand rules one line each. */
export function codeRows(report: RuleReport[]): string[][] {
  const rows: string[][] = [];
  report.forEach((r, i) => {
    const n = String(i + 1);
    if (r.status === "fail") {
      for (const x of r.results.filter((x) => x.status === "fail")) rows.push([n, r.rule.title, r.section, "FAIL", x.text, x.fix ?? ""]);
      return;
    }
    const text = r.status === "manual" ? r.results.filter((x) => x.status === "manual").map((x) => x.text).join(" ") : summary(r);
    rows.push([n, r.rule.title, r.section, r.status === "pass" ? "Pass" : "Check by hand", text, ""]);
  });
  return rows;
}

function summary(r: RuleReport): string {
  if (r.results.length === 1) return r.results[0].text;
  const shown = r.results.slice(0, 3).map((x) => x.text).join("; ");
  return r.results.length > 3 ? `${r.results.length} checked. ${shown}; and ${r.results.length - 3} more` : shown;
}

export const CODE_COLS = (w: number) => [
  { title: "#", width: 0.35 },
  { title: "Rule", width: w * 0.24 },
  { title: "Code section", width: w * 0.12 },
  { title: "Result", width: 0.95 },
  { title: "What the app found", width: w * 0.34 },
  { title: "How to fix", width: w - 0.35 - 0.95 - w * 0.7 },
];

/** The code summary and code check, over as many sheets as it takes. */
export function codeSheets(project: Project, report: RuleReport[]): Item[][] {
  const pages: Item[][] = [];
  const rows = codeRows(report);
  const [s1, rest] = [7.4, DRAW_AREA.x1 - DRAW_AREA.x0 - 7.4 - COL_GAP];
  let start = 0;
  let first = true;
  while (first || start < rows.length) {
    const items: Item[] = [];
    let tx = DRAW_AREA.x0;
    let tw = DRAW_AREA.x1 - DRAW_AREA.x0;
    if (first) {
      // Left: the code summary.
      let y = DRAW_AREA.y0;
      items.push(...heading("Code summary", DRAW_AREA.x0, y, s1));
      y += HEADING_H + 0.08;
      for (const e of CODE_EDITIONS) {
        let b = textBlock(e.label, DRAW_AREA.x0, y, s1, 7.5, { bold: true });
        items.push(...b.items);
        y += b.height;
        b = textBlock(e.detail, DRAW_AREA.x0, y, s1, 7);
        items.push(...b.items);
        y += b.height + 0.08;
      }
      y += 0.2;
      items.push(...heading("Idaho and Boise changes used here", DRAW_AREA.x0, y, s1));
      y += HEADING_H + 0.08;
      const amended = Object.entries(CODE_DATA.values).filter(([, e]) => e.amendment);
      for (const [, e] of amended) {
        const b = textBlock(`${e.code.replace(/ \d{4}$/, "")} ${e.section}: ${e.amendment}`, DRAW_AREA.x0, y, s1, 6.5);
        if (y + b.height > DRAW_AREA.y1 - 4.2) break;
        items.push(...b.items);
        y += b.height + 0.05;
      }
      y += 0.2;
      items.push(...heading("Design criteria", DRAW_AREA.x0, y, s1));
      y += HEADING_H + 0.05;
      items.push(...table(DRAW_AREA.x0, y, [{ title: "Item", width: 2.7 }, { title: "Value", width: 2.5 }, { title: "Source", width: s1 - 5.2 }], designCriteriaRows(), { size: 6.5 }).items);
      tx = DRAW_AREA.x0 + s1 + COL_GAP;
      tw = rest;
    }
    let y = DRAW_AREA.y0;
    items.push(...heading(first ? "Code check" : "Code check, continued", tx, y, tw));
    y += HEADING_H + 0.05;
    if (first) {
      const b = textBlock("Each rule the app checks, the code section it comes from, and the result for these drawings. Fail: fix before submitting. Check by hand: the app can't see it or doesn't draw it yet.", tx, y, tw, 7);
      items.push(...b.items);
      y += b.height + 0.1;
    }
    const t = table(tx, y, CODE_COLS(tw), rows.slice(start), { size: 6.5, maxHeight: DRAW_AREA.y1 - y });
    items.push(...t.items);
    start += Math.max(1, t.fitted);
    pages.push(items);
    first = false;
    if (pages.length > 20) break;
  }
  return pages;
}
