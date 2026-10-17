import type { Project } from "@/lib/model/schema";
import { capHeight, line, lineHeight, rect, textBlock, type Item } from "./draw";
import { localFacts } from "./local";

/**
 * The sheet border and the title block down the right edge, the same on
 * every sheet: the house, owner, address, who drew it, the status label,
 * the "not reviewed or stamped" note, a box for a professional's seal,
 * revisions, date, and the sheet title and number.
 */

export const SHEET_W = 36;
export const SHEET_H = 24;
/** Wider on the left for binding. */
export const BORDER = { left: 0.75, top: 0.375, right: 0.375, bottom: 0.375 };
export const TITLE_W = 3.25;

/** The space inside the border, left of the title block. */
export const DRAW_AREA = {
  x0: BORDER.left + 0.25,
  y0: BORDER.top + 0.25,
  x1: SHEET_W - BORDER.right - TITLE_W - 0.25,
  y1: SHEET_H - BORDER.bottom - 0.25,
};

export type SetInfo = {
  project: Project;
  /** PRELIMINARY or PERMIT REVIEW SET. */
  label: string;
  /** Issue date, like "October 15, 2026". */
  date: string;
  half: boolean;
  total: number;
};

export function designerOf(p: Project): string {
  return p.plans.designer.trim() || p.profile.ownerName?.trim() || "Owner";
}

export function ownerOf(p: Project): string {
  return p.profile.ownerName?.trim() || "Owner";
}

/** The note every title block carries. */
export function preparedNote(p: Project): string {
  return `Prepared by ${designerOf(p)} with House Design App. Not reviewed or stamped by a licensed architect or engineer.`;
}

export function frame(info: SetInfo, sheet: { number: string; title: string; index: number; scale?: string }): Item[] {
  const p = info.project;
  const items: Item[] = [];
  const x0 = BORDER.left;
  const y0 = BORDER.top;
  const x1 = SHEET_W - BORDER.right;
  const y1 = SHEET_H - BORDER.bottom;
  items.push(rect(x0, y0, x1 - x0, y1 - y0, "heavy"));
  const tx = x1 - TITLE_W;
  items.push(line({ x: tx, y: y0 }, { x: tx, y: y1 }, "heavy"));

  const pad = 0.12;
  const w = TITLE_W - pad * 2;
  const L = tx + pad;
  let y = y0 + pad;
  const label = (text: string) => {
    items.push({ t: "text", at: { x: L, y: y + capHeight(5.5) }, text: text.toUpperCase(), size: 5.5, color: "#555555" });
    y += lineHeight(5.5) + 0.02;
  };
  const value = (text: string, size = 8, bold = false) => {
    const b = textBlock(text, L, y, w, size, { bold });
    items.push(...b.items);
    y += b.height + 0.04;
  };
  const rule = (weight: "medium" | "fine" = "fine") => {
    y += 0.04;
    items.push(line({ x: tx, y }, { x: x1, y }, weight));
    y += 0.08;
  };

  label("Project");
  value(p.name, 12, true);
  value("New single-family house");
  label("Site address");
  value(p.plans.address.trim() || "TBD");
  value(localFacts().place, 7);
  label("Parcel number");
  value(p.plans.parcel.trim() || "TBD");
  rule();
  label("Owner");
  value(ownerOf(p));
  label("Drawn by");
  value(designerOf(p));
  rule();

  // The status label, big, in a box.
  const s = textBlock(info.label, L + 0.06, y + 0.08, w - 0.12, 10, { bold: true, align: "center" });
  items.push(rect(L, y, w, s.height + 0.16, "heavy"));
  items.push(...s.items);
  y += s.height + 0.26;
  value(preparedNote(p), 7);
  if (info.half) value("HALF-SIZE PRINT: drawings are at half the scale noted.", 7, true);
  rule();

  // Room for a seal if a professional is hired later.
  const sealH = 2.2;
  items.push(rect(L, y, w, sealH, "hair"));
  items.push(...textBlock("Space for a design professional's seal, only if one is hired later", L + 0.1, y + 0.1, w - 0.2, 5.5, { color: "#777777" }).items);
  y += sealH + 0.08;
  rule();

  label("Revisions");
  for (let i = 0; i < 3; i++) {
    items.push(line({ x: L, y: y + 0.18 }, { x: L + w, y: y + 0.18 }, "hair"));
    y += 0.2;
  }
  y += 0.06;
  rule();

  // From the bottom up: sheet number, sheet title, date and scale.
  const numSize = 26;
  const bottom = y1 - pad;
  items.push({ t: "text", at: { x: L, y: bottom - 0.12 }, text: sheet.number, size: numSize, bold: true });
  items.push({ t: "text", at: { x: L + w, y: bottom - 0.12 }, text: `${sheet.index} of ${info.total}`, size: 7, align: "right" });
  const titleY = bottom - 0.12 - capHeight(numSize) - 0.2;
  const t = textBlock(sheet.title.toUpperCase(), L, 0, w, 10, { bold: true });
  const top = titleY - t.height;
  for (const it of t.items) if (it.t === "text") items.push({ ...it, at: { x: it.at.x, y: it.at.y + top } });
  items.push(line({ x: tx, y: top - 0.12 }, { x: x1, y: top - 0.12 }, "medium"));
  const metaY = top - 0.6;
  items.push({ t: "text", at: { x: L, y: metaY + capHeight(5.5) }, text: "DATE", size: 5.5, color: "#555555" });
  items.push({ t: "text", at: { x: L, y: metaY + 0.32 }, text: info.date, size: 7.5 });
  items.push({ t: "text", at: { x: L + w / 2, y: metaY + capHeight(5.5) }, text: "SCALE", size: 5.5, color: "#555555" });
  items.push({ t: "text", at: { x: L + w / 2, y: metaY + 0.32 }, text: sheet.scale ?? "As noted", size: 7.5 });
  items.push(line({ x: tx, y: metaY - 0.1 }, { x: x1, y: metaY - 0.1 }, "fine"));
  return items;
}
