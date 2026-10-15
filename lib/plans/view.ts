import type { Point } from "@/lib/model/schema";
import { add } from "@/lib/plan/geometry";
import { line, rect, textWidth, type Item } from "./draw";

/**
 * The title under a drawing: a numbered circle, the view's name underlined,
 * its scale, a scale bar and (on plans) a north arrow.
 */
export function viewTitle(
  x: number,
  y: number,
  opts: { number: number | string; title: string; scaleLabel?: string; inPerFt?: number; barFeet?: number[]; barUnit?: string; north?: boolean; minWidth?: number },
): Item[] {
  const items: Item[] = [];
  items.push({ t: "circle", c: { x: x + 0.25, y }, r: 0.25, stroke: "medium" });
  items.push({ t: "text", at: { x: x + 0.25, y }, text: String(opts.number), size: 11, bold: true, align: "center", valign: "middle" });
  const title = opts.title.toUpperCase();
  const tw = Math.max(opts.minWidth ?? 4, textWidth(title, 14, true));
  items.push({ t: "text", at: { x: x + 0.65, y: y - 0.04 }, text: title, size: 14, bold: true });
  items.push(line({ x: x + 0.65, y: y + 0.04 }, { x: x + 0.65 + tw, y: y + 0.04 }, "heavy"));
  if (opts.scaleLabel) items.push({ t: "text", at: { x: x + 0.65, y: y + 0.24 }, text: `SCALE: ${opts.scaleLabel}`, size: 8 });
  let ex = x + 0.65 + tw;
  if (opts.inPerFt) {
    const sbx = ex + 0.5;
    const ft = opts.inPerFt;
    const ticks = opts.barFeet ?? [0, 4, 8, 16];
    for (let i = 0; i < ticks.length - 1; i++) items.push(rect(sbx + ticks[i] * ft, y - 0.05, (ticks[i + 1] - ticks[i]) * ft, 0.08, "fine", i % 2 ? "#ffffff" : "#000000"));
    for (const k of ticks) items.push({ t: "text", at: { x: sbx + k * ft, y: y + 0.2 }, text: k ? `${k}'` : "0", size: 6, align: "center" });
    ex = sbx + ticks[ticks.length - 1] * ft;
  }
  if (opts.north) items.push(...northArrow({ x: ex + 0.8, y: y - 0.05 }));
  return items;
}

/** North arrow; north is up the page. */
export function northArrow(na: Point, r = 0.28): Item[] {
  const k = r / 0.28;
  return [
    { t: "circle", c: na, r, stroke: "fine" },
    { t: "poly", pts: [add(na, { x: 0, y: -0.26 * k }), add(na, { x: 0.1 * k, y: 0.12 * k }), add(na, { x: 0, y: 0.05 * k }), add(na, { x: -0.1 * k, y: 0.12 * k })], fill: "#000000" },
    { t: "text", at: add(na, { x: 0, y: -0.36 * k }), text: "N", size: 8, bold: true, align: "center" },
  ];
}
