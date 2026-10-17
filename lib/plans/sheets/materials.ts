import type { Project } from "@/lib/model/schema";
import { exteriorPartsFor, exteriorPick, accentPlaceFor, ACCENT_BAND_FT } from "@/lib/exterior/picks";
import type { ExteriorCategoryId } from "@/lib/catalog/exterior";
import { codeNum, codeRef } from "@/lib/codes/data";
import { inchText } from "@/lib/codes/rules";
import { DRAW_AREA } from "../frame";
import { capHeight, heading, HEADING_H, lineHeight, rect, table, textBlock, type Item } from "../draw";

/**
 * The exterior materials schedule: every outside part of this house, the
 * product picked for it in the Exterior design window (or "not picked yet"), its
 * color, where it goes, and the code numbers it has to meet.
 */

const WHERE: Partial<Record<ExteriorCategoryId, string>> = {
  roofing: "All sloped roofs",
  siding: "Outside walls",
  "siding-paint": "Siding",
  "trim-paint": "Fascia, corner boards, window and door trim",
  gutters: "Every eave, with downspouts (roof plan A-111)",
  windows: "All windows (tags W1… on the plans)",
  "entry-doors": "Front door",
  "patio-doors": "Sliding glass doors",
  "garage-doors": "Garage doors",
  "exterior-lighting": "Beside each outside door, each side of the garage doors",
  decking: "Deck",
  patio: "Covered patio",
  walk: "Front walk (site plan C-101)",
  driveway: "Driveway (site plan C-101)",
  lawn: "Lawn (landscape plan L-101)",
  beds: "Planting beds (landscape plan L-101)",
  shrubs: "Shrubs (landscape plan L-101)",
  trees: "Trees (landscape plan L-101)",
};

function notesFor(id: ExteriorCategoryId, kind: string | undefined): string {
  switch (id) {
    case "roofing":
      return kind === "metal"
        ? `Lapped seams without sealant need at least ${codeNum("roof.metalLappedMinSlope")}:12 (${codeRef("roof.metalLappedMinSlope")}).`
        : `Shingles need at least ${codeNum("roof.shingleMinSlope")}:12; two underlayment layers below ${codeNum("roof.shingleDoubleUnderlaymentBelow")}:12 (${codeRef("roof.shingleMinSlope")}).`;
    case "siding":
      return `Over a water-resistive barrier (IRC R703.2). Wood at least ${inchText(codeNum("siding.woodClearanceToGrade"))} above the ground (${codeRef("siding.woodClearanceToGrade")}).`;
    case "windows":
      return `U-factor ${codeNum("energy.fenestrationU")} or lower (${codeRef("energy.fenestrationU")}). Safety glass where tagged TEMP.`;
    case "patio-doors":
      return `Safety glass (IRC R308.4.1). U-factor ${codeNum("energy.fenestrationU")} or lower.`;
    default:
      return "";
  }
}

export function materialsSheet(project: Project): Item[] {
  const items: Item[] = [];
  const parts = exteriorPartsFor(project);
  const sel = project.exterior.selections;
  const x = DRAW_AREA.x0;
  let y = DRAW_AREA.y0;
  const W = DRAW_AREA.x1 - DRAW_AREA.x0;
  items.push(...heading("Exterior materials schedule", x, y, W, 11));
  y += HEADING_H + 0.15;
  const hasGables = project.house3d.roof.style === "gable" || project.house3d.roof.style === "shed";
  const where = (id: ExteriorCategoryId) =>
    id === "accent" ? (accentPlaceFor(project.exterior, hasGables) === "gables" ? "Gable ends" : `A ${ACCENT_BAND_FT}'-0" band along the base of the walls`) : (WHERE[id] ?? "");
  const cols = [
    { title: "Part", width: 2.1 },
    { title: "Color", width: 0.8 },
    { title: "Product", width: 6.2 },
    { title: "Maker", width: 2.6 },
    { title: "Where it goes", width: 5.6 },
    { title: "Must meet", width: W - 17.3 },
  ];
  const rows = parts.map((c) => {
    const p = exteriorPick(sel, c.id)?.product;
    return [c.label, "", p ? `${p.name}${p.line ? `, ${p.line}` : ""}${p.sku ? ` (${p.sku})` : ""}` : "Not picked yet", p?.brand ?? "", where(c.id), notesFor(c.id, p?.kind)];
  });
  const tb = table(x, y, cols, rows, { size: 8, boldFirst: true });
  items.push(...tb.items);
  // Color swatches in the second column, one per row.
  const pad = 0.05;
  let ry = y + lineHeight(8) + pad * 2;
  parts.forEach((c, i) => {
    const cells = rows[i].map((cell, k) => textBlock(cell, 0, 0, cols[k].width - pad * 2, 8, { bold: k === 0 }).items.length);
    const hh = Math.max(1, ...cells) * lineHeight(8) + pad * 2;
    const color = exteriorPick(sel, c.id)?.product.color;
    if (color) items.push(rect(x + cols[0].width + 0.12, ry + 0.06, cols[1].width - 0.24, Math.min(0.22, hh - 0.12), "hair", color));
    ry += hh;
  });
  y += tb.height + 0.3;
  const notes = [
    "Products and colors are the owner's picks in House Design App's Exterior design window (press X in the Walkthrough). Equal products may be used; install each to its maker's instructions and listing.",
    "Flash every door, window and roof-to-wall joint (IRC R703.4). Caulk and seal per the siding maker.",
    "Colors print as close as the printer allows; use the maker's color names and samples.",
  ];
  items.push(...heading("Notes", x, y, 10));
  y += HEADING_H + 0.08;
  notes.forEach((n, i) => {
    items.push({ t: "text", at: { x, y: y + capHeight(8) }, text: `${i + 1}.`, size: 8 });
    const b = textBlock(n, x + 0.25, y, 9.75, 8);
    items.push(...b.items);
    y += b.height + 0.08;
  });
  return items;
}
