import type { Point, Project } from "@/lib/model/schema";
import { add, boundsOf, leftNormal, scale, sub, unit } from "@/lib/plan/geometry";
import { yardAmounts, yardLayout, type Strip } from "@/lib/exterior/yard";
import { exteriorPick } from "@/lib/exterior/picks";
import type { ExteriorCategoryId } from "@/lib/catalog/exterior";
import { DRAW_AREA } from "../frame";
import { capHeight, DASH, heading, HEADING_H, LIGHT, SCALES, table, textBlock, type Item } from "../draw";
import { houseFacts } from "../house";
import { lotAsPlot, siteLayout } from "../lot";
import { viewTitle } from "../view";

/**
 * The landscape plan: the yard the app lays out around the house (lawn,
 * planting beds, shrubs, trees, driveway and walk) with the picked plants
 * and a planting schedule with counts and areas.
 */

const NOTES_W = 6;
const TITLE_BAND = 1.1;
const LAWN_FILL = "#e6eedc";
const BED_FILL = "#efe7dc";

export function landscapeSheet(project: Project): { items: Item[]; scaleLabel: string } {
  const items: Item[] = [];
  const h = houseFacts(project);
  const site = siteLayout(project);
  const lp = site ? lotAsPlot(site, project.plot) : { plot: project.plot, offset: { x: 0, y: 0 } };
  const yard = yardLayout(project.floorPlans, project.levels, h.basics, lp.plot, lp.offset);
  const house = site?.house ?? [];
  const lawnPts = yard ? yard.lawn.cells.flatMap((c) => [c, add(c, { x: yard.lawn.cell, y: yard.lawn.cell })]) : [];
  const b = boundsOf([...house.flat(), ...lawnPts, ...(site?.outline ?? []), ...(yard ? [...yard.trees, ...yard.driveway.flatMap((d) => [d.a, d.b])] : [])]) ?? { x0: 0, y0: 0, x1: 1, y1: 1 };
  const area = { x0: DRAW_AREA.x0, y0: DRAW_AREA.y0, x1: DRAW_AREA.x1 - NOTES_W - 0.3, y1: DRAW_AREA.y1 - TITLE_BAND };
  const fits = (inPerFt: number) => ((b.x1 - b.x0) / 12) * inPerFt + 1 <= area.x1 - area.x0 && ((b.y1 - b.y0) / 12) * inPerFt + 1 <= area.y1 - area.y0;
  const choice = SCALES.slice(1).find((x) => fits(x.inPerFt)) ?? SCALES[SCALES.length - 1];
  const s = choice.inPerFt / 12;
  const mid = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
  const center = { x: (area.x0 + area.x1) / 2, y: (area.y0 + area.y1) / 2 };
  const T = (p: Point): Point => ({ x: center.x + (p.x - mid.x) * s, y: center.y + (p.y - mid.y) * s });
  const strip = (st: Strip) => {
    const n = scale(leftNormal(unit(sub(st.b, st.a))), st.width / 2);
    return [add(st.a, n), add(st.b, n), sub(st.b, n), sub(st.a, n)].map(T);
  };
  const name = (id: ExteriorCategoryId, fallback: string) => exteriorPick(project.exterior.selections, id)?.product.name ?? fallback;

  if (yard) {
    // Lawn, as runs of cells along each row.
    const c = yard.lawn.cell;
    const rows = new Map<number, number[]>();
    for (const p of yard.lawn.cells) rows.set(p.y, [...(rows.get(p.y) ?? []), p.x]);
    for (const [y, xs] of rows) {
      xs.sort((a, b2) => a - b2);
      let start = xs[0];
      for (let i = 1; i <= xs.length; i++) {
        if (i < xs.length && xs[i] === xs[i - 1] + c) continue;
        const end = xs[i - 1] + c;
        items.push({ t: "poly", pts: [T({ x: start, y }), T({ x: end, y }), T({ x: end, y: y + c }), T({ x: start, y: y + c })], fill: LAWN_FILL });
        start = xs[i];
      }
    }
    for (const d of [...yard.driveway, ...yard.walk]) items.push({ t: "poly", pts: strip(d), fill: "#f4f4f4", stroke: "fine" });
    for (const bed of yard.beds) items.push({ t: "poly", pts: strip(bed), fill: BED_FILL, stroke: "hair" });
    for (const p of yard.shrubs) items.push({ t: "circle", c: T(p), r: 18 * s, stroke: "fine", fill: "#ffffff" }, { t: "circle", c: T(p), r: 0.015, fill: "#000000" });
    for (const p of yard.trees) {
      items.push({ t: "circle", c: T(p), r: 90 * s, stroke: "fine" });
      items.push({ t: "circle", c: T(p), r: 0.03, fill: "#000000" });
    }
  }
  for (const ring of house) items.push({ t: "poly", pts: ring.map(T), fill: LIGHT, stroke: "heavy" });
  if (site) items.push({ t: "poly", pts: site.outline.map(T), stroke: "medium", dash: DASH.center });
  const hb = boundsOf(house.flat());
  if (hb) items.push({ t: "text", at: T({ x: (hb.x0 + hb.x1) / 2, y: (hb.y0 + hb.y1) / 2 }), text: "HOUSE", size: 9, bold: true, align: "center", valign: "middle" });

  // ---------- Planting schedule ----------
  const nx = DRAW_AREA.x1 - NOTES_W;
  let ny = DRAW_AREA.y0;
  items.push(...heading("Planting schedule", nx, ny, NOTES_W));
  ny += HEADING_H + 0.05;
  const a = yard ? yardAmounts(yard) : null;
  const f0 = (n: number) => Math.round(n).toLocaleString("en-US");
  const rows = a
    ? [
        ["Trees", name("trees", "Tree, to be picked"), `${a.trees}`],
        ["Shrubs", name("shrubs", "Shrub, to be picked"), `${a.shrubs}`],
        ["Planting beds", name("beds", "Mulch, to be picked"), `${f0(a.bedSqft)} sq ft`],
        ["Lawn", name("lawn", "Lawn, to be picked"), `${f0(a.lawnSqft)} sq ft`],
        ["Driveway", name("driveway", "Concrete"), `${f0(a.driveSqft)} sq ft`],
        ["Front walk", name("walk", "Concrete"), `${f0(a.walkSqft)} sq ft`],
      ]
    : [["No yard yet", "Place the house on the land first", ""]];
  const tb = table(nx, ny, [{ title: "Part", width: 1.4 }, { title: "Pick", width: NOTES_W - 2.6 }, { title: "Amount", width: 1.2 }], rows, { size: 7, boldFirst: true });
  items.push(...tb.items);
  ny += tb.height + 0.3;
  items.push(...heading("Legend and notes", nx, ny, NOTES_W));
  ny += HEADING_H + 0.1;
  const box = (y: number, fill: string, stroke?: "hair"): Item => ({ t: "poly", pts: [{ x: nx + 0.05, y: y + 0.04 }, { x: nx + 0.35, y: y + 0.04 }, { x: nx + 0.35, y: y + 0.2 }, { x: nx + 0.05, y: y + 0.2 }], fill, stroke });
  const legend: [(y: number) => Item, string][] = [
    [(y) => ({ t: "circle", c: { x: nx + 0.2, y: y + 0.12 }, r: 0.12, stroke: "fine" }), "Tree, drawn about 15 ft across when grown"],
    [(y) => ({ t: "circle", c: { x: nx + 0.2, y: y + 0.12 }, r: 0.06, stroke: "fine" }), "Shrub"],
    [(y) => box(y, BED_FILL, "hair"), "Planting bed with mulch"],
    [(y) => box(y, LAWN_FILL), "Lawn"],
  ];
  for (const [sym, text] of legend) {
    items.push(sym(ny), { t: "text", at: { x: nx + 0.5, y: ny + 0.12 + capHeight(7) / 2 }, text, size: 7 });
    ny += 0.3;
  }
  ny += 0.1;
  const notes = [
    "The app lays out the yard from the house and the lot; a landscaper can change it. Plant counts and areas match the cost estimate.",
    "Keep beds, mulch and soil below the siding and slope them away from the house (see the site plan).",
    "Sprinklers for the lawn and drip lines for beds and trees, by the landscaper. Call 811 before digging.",
  ];
  notes.forEach((n, i) => {
    items.push({ t: "text", at: { x: nx, y: ny + capHeight(7) }, text: `${i + 1}.`, size: 7 });
    const bl = textBlock(n, nx + 0.22, ny, NOTES_W - 0.22, 7);
    items.push(...bl.items);
    ny += bl.height + 0.08;
  });

  items.push(...viewTitle(area.x0 + 0.1, DRAW_AREA.y1 - 0.45, { number: 1, title: "Landscape plan", scaleLabel: choice.label, inPerFt: choice.inPerFt, barFeet: [0, 8, 16, 32], north: true }));
  return { items, scaleLabel: choice.label };
}
