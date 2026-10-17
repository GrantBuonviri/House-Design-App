import type { jsPDF as JsPDF } from "jspdf";
import { placeLabel } from "@/lib/location/cities";
import { fullMoney, type CostLine, type Estimate } from "./estimate";

/**
 * The estimate as a file to hold next to builders' bids: a spreadsheet
 * (CSV, which Excel, Numbers and Google Sheets all open) and a printable
 * PDF. Both list every line with what was measured, the rate and the
 * low / likely / high cost, grouped by category.
 */

const UNIT: Record<CostLine["unit"], string> = { sqft: "sq ft", linft: "ft", each: "each", cuyd: "cu yd", percent: "%", value: "building value" };

export type EstimateRow = {
  category: string;
  item: string;
  amount: number;
  unit: string;
  /** Likely per unit, when the line has one. */
  rate: number | null;
  low: number;
  likely: number;
  high: number;
  source: string;
  note: string;
};

/** One row per priced line, category by category. */
export function estimateRows(e: Estimate): EstimateRow[] {
  return e.categories.flatMap((c) =>
    c.lines.map((l) => ({
      category: c.label,
      item: l.product ? `${l.label}: ${l.product}` : l.label,
      amount: l.unit === "each" || l.unit === "percent" ? Math.round(l.qty * 10) / 10 : Math.round(l.qty),
      unit: UNIT[l.unit],
      rate: l.material === null ? null : Math.round(l.material * 100) / 100,
      low: Math.round(l.cost.low),
      likely: Math.round(l.cost.likely),
      high: Math.round(l.cost.high),
      source: l.source + (l.checked ? ` (checked ${l.checked})` : ""),
      note: l.note ?? "",
    })),
  );
}

const cell = (v: string | number | null) => {
  const s = v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function heading(e: Estimate, houseName: string): string[] {
  return [
    `${houseName}: materials estimate`,
    `For ${placeLabel(e.place)}, cost level ${e.place.costIndex.toFixed(2)}${e.source === "rough" ? ". Rough, from the room list" : ""}`,
    "Materials only; jobs usually hired out as a whole (digging, trenching, well, septic...) are full price. Permits and fees included. Land not included.",
  ];
}

/** The estimate as CSV text, with an empty "Bid" column to fill in from each builder's quote. */
export function estimateCsv(e: Estimate, houseName: string): string {
  const rows: (string | number | null)[][] = [
    ...heading(e, houseName).map((h) => [h]),
    [],
    ["Category", "Item", "Amount", "Unit", "Rate (likely, per unit)", "Low", "Likely", "High", "Bid", "Source", "Note"],
    ...estimateRows(e).map((r) => [r.category, r.item, r.amount, r.unit, r.rate, r.low, r.likely, r.high, "", r.source, r.note]),
    [],
    ["Total", "", "", "", "", Math.round(e.total.low), Math.round(e.total.likely), Math.round(e.total.high)],
    ["Land", "", "", "", "", 0, 0, 0],
  ];
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function estimateFileName(houseName: string, ext: "csv" | "pdf"): string {
  const safe = houseName.replace(/[^\w\- ]+/g, "").trim() || "House";
  return `${safe} - Materials estimate.${ext}`;
}

/** The estimate as a letter-size PDF: a summary, then every line by category. */
export async function estimatePdf(e: Estimate, houseName: string, today = new Date()): Promise<JsPDF> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "in", format: "letter", compress: true });
  doc.setLineWidth(0.01);
  const W = 8.5;
  const M = 0.6;
  const bottom = 10.4;
  let y = M + 0.2;
  const text = (s: string, x: number, size: number, opts: { bold?: boolean; right?: boolean; grey?: boolean; maxW?: number } = {}) => {
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(opts.grey ? 110 : 20);
    const lines: string[] = opts.maxW ? doc.splitTextToSize(s, opts.maxW) : [s];
    doc.text(lines, x, y, { align: opts.right ? "right" : "left" });
    return lines.length;
  };
  const newPageIfNeeded = (need: number) => {
    if (y + need <= bottom) return;
    doc.addPage();
    y = M + 0.2;
  };

  text(`${houseName}: materials estimate`, M, 16, { bold: true });
  y += 0.3;
  const [, place, terms] = heading(e, houseName);
  text(`${place}. Made ${today.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}.`, M, 9, { grey: true });
  y += 0.35;
  text(`Likely ${fullMoney(e.total.likely)}`, M, 14, { bold: true });
  text(`Range ${fullMoney(e.total.low)} to ${fullMoney(e.total.high)}`, W - M, 10, { right: true });
  y += 0.25;
  const q = e.quantities;
  text(`About ${fullMoney(e.perSqft.likely)} per sq ft for ${Math.round(q.livingSqft).toLocaleString("en-US")} sq ft of living space.`, M, 9, { grey: true });
  y += 0.2;
  y += 0.16 * text(`${terms} This is an estimate, not a bid. Real prices vary by store and change over time.`, M, 9, { grey: true, maxW: W - 2 * M });
  y += 0.15;

  // Columns: item, amount, low, likely, high.
  const cols = { item: M, amount: 4.6, low: 5.85, likely: 6.85, high: W - M };
  const header = () => {
    doc.setDrawColor(180);
    doc.line(M, y + 0.06, W - M, y + 0.06);
    text("Item", cols.item, 8, { bold: true });
    text("Amount", cols.amount, 8, { bold: true, right: true });
    text("Low", cols.low, 8, { bold: true, right: true });
    text("Likely", cols.likely, 8, { bold: true, right: true });
    text("High", cols.high, 8, { bold: true, right: true });
    y += 0.25;
  };
  const money = (n: number) => fullMoney(n);
  header();
  for (const c of e.categories) {
    if (!c.lines.length) continue;
    newPageIfNeeded(0.5);
    text(c.label, cols.item, 9.5, { bold: true });
    text(money(c.cost.likely), cols.likely, 9.5, { bold: true, right: true });
    y += 0.2;
    for (const r of estimateRows({ ...e, categories: [c] })) {
      newPageIfNeeded(0.2);
      const amount = r.unit === "building value" ? `on ${money(r.amount)}` : r.unit === "%" ? `${r.amount}%` : `${r.amount.toLocaleString("en-US")} ${r.unit}`;
      text(r.item, cols.item + 0.15, 8, { maxW: cols.amount - 1.1 - cols.item });
      const rows = doc.splitTextToSize(r.item, cols.amount - 1.1 - cols.item).length;
      text(amount, cols.amount, 8, { right: true, grey: true });
      text(money(r.low), cols.low, 8, { right: true, grey: true });
      text(money(r.likely), cols.likely, 8, { right: true });
      text(money(r.high), cols.high, 8, { right: true, grey: true });
      y += 0.17 * rows;
    }
    y += 0.08;
  }
  newPageIfNeeded(0.6);
  doc.setDrawColor(120);
  doc.line(M, y - 0.08, W - M, y - 0.08);
  y += 0.1;
  text("Total", cols.item, 10, { bold: true });
  text(money(e.total.low), cols.low, 10, { right: true });
  text(money(e.total.likely), cols.likely, 10, { bold: true, right: true });
  text(money(e.total.high), cols.high, 10, { right: true });
  y += 0.22;
  text("Land: $0 (not included). The total's low and high are not the sum of every line's low and high, since prices rarely all land at one end at once.", M, 8, { grey: true, maxW: W - 2 * M });
  return doc;
}
