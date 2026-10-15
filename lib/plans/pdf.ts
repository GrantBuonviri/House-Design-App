import type { jsPDF as JsPDF } from "jspdf";
import type { Point } from "@/lib/model/schema";
import { capHeight, textWidth, WEIGHT_IN, type Item, type Sheet } from "./draw";

/**
 * Draw sheets into a PDF with jsPDF: real vector lines and text, in inches,
 * one page per sheet. `scale` shrinks everything for half-size prints.
 */

/** Where a text item's baseline starts, after its alignment, in sheet inches. */
export function textOrigin(it: Extract<Item, { t: "text" }>): Point {
  const a = ((it.rotate ?? 0) * Math.PI) / 180;
  const d = { x: Math.cos(a), y: -Math.sin(a) };
  const n = { x: Math.sin(a), y: Math.cos(a) };
  const w = textWidth(it.text, it.size, it.bold);
  const back = it.align === "center" ? w / 2 : it.align === "right" ? w : 0;
  const down = it.valign === "middle" ? capHeight(it.size) / 2 : it.valign === "top" ? capHeight(it.size) : 0;
  return { x: it.at.x - d.x * back + n.x * down, y: it.at.y - d.y * back + n.y * down };
}

function hex(color: string): [number, number, number] {
  const c = color.replace("#", "");
  return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
}

export async function sheetsToPdf(sheets: Sheet[], scale = 1): Promise<JsPDF> {
  const { jsPDF } = await import("jspdf");
  const first = sheets[0];
  const doc = new jsPDF({ orientation: first.w >= first.h ? "landscape" : "portrait", unit: "in", format: [first.w * scale, first.h * scale], compress: true });
  sheets.forEach((sheet, i) => {
    if (i) doc.addPage([sheet.w * scale, sheet.h * scale], sheet.w >= sheet.h ? "landscape" : "portrait");
    drawSheet(doc, sheet, scale);
  });
  doc.setProperties({ title: sheets.map((s) => s.number).join(", "), creator: "House Design App" });
  return doc;
}

function drawSheet(doc: JsPDF, sheet: Sheet, k: number) {
  // Lines stay readable on half-size prints: they shrink less than the drawing.
  const lw = (w: keyof typeof WEIGHT_IN) => WEIGHT_IN[w] * Math.max(k, 0.7);
  const P = (p: Point): [number, number] => [p.x * k, p.y * k];
  doc.setLineCap("butt");
  doc.setLineJoin("miter");
  for (const it of sheet.items) {
    if (it.t === "line") {
      if (it.pts.length < 2) continue;
      doc.setDrawColor(...hex(it.color ?? "#000000"));
      doc.setLineWidth(lw(it.w));
      doc.setLineDashPattern(it.dash ? it.dash.map((d) => d * k) : [], 0);
      const [x0, y0] = P(it.pts[0]);
      const segs = it.pts.slice(1).map((p, j) => [(p.x - it.pts[j].x) * k, (p.y - it.pts[j].y) * k]);
      doc.lines(segs, x0, y0, [1, 1], "S", false);
    } else if (it.t === "poly") {
      if (it.pts.length < 3) continue;
      const [x0, y0] = P(it.pts[0]);
      const segs = it.pts.slice(1).map((p, j) => [(p.x - it.pts[j].x) * k, (p.y - it.pts[j].y) * k]);
      if (it.fill) doc.setFillColor(...hex(it.fill));
      if (it.stroke) {
        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(lw(it.stroke));
      }
      doc.setLineDashPattern(it.dash ? it.dash.map((d) => d * k) : [], 0);
      const style = it.fill && it.stroke ? "FD" : it.fill ? "F" : "S";
      if (!it.fill && !it.stroke) continue;
      doc.lines(segs, x0, y0, [1, 1], style, true);
    } else if (it.t === "circle") {
      doc.setLineDashPattern([], 0);
      if (it.fill) doc.setFillColor(...hex(it.fill));
      if (it.stroke) {
        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(lw(it.stroke));
      }
      const [x, y] = P(it.c);
      if (!it.fill && !it.stroke) continue;
      doc.circle(x, y, it.r * k, it.fill && it.stroke ? "FD" : it.fill ? "F" : "S");
    } else if (it.t === "text") {
      if (!it.text) continue;
      doc.setFont("helvetica", it.bold ? "bold" : "normal");
      doc.setFontSize(it.size * k);
      doc.setTextColor(...hex(it.color ?? "#000000"));
      const o = textOrigin(it);
      doc.text(it.text, o.x * k, o.y * k, { angle: it.rotate ?? 0, baseline: "alphabetic" });
    }
  }
  doc.setLineDashPattern([], 0);
}

/** Save a PDF through the browser's download. */
export function downloadPdf(doc: JsPDF, fileName: string) {
  const blob = doc.output("blob");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pdfFileName(houseName: string, what: string): string {
  const safe = houseName.replace(/[^\w\- ]+/g, "").trim() || "House";
  return `${safe} - ${what}.pdf`;
}
