import type { Point } from "@/lib/model/schema";

/**
 * A plan sheet is drawn once into a simple list of shapes, in sheet inches
 * (x right, y down, origin at the top-left corner of the paper). The same
 * list draws the in-app preview (SVG) and the PDF (jsPDF), so a sheet looks
 * the same on screen and on paper.
 */

/** Line weights, US National CAD Standard style. */
export type Weight = "heavy" | "medium" | "fine" | "hair";

/** Line widths in inches at full size. */
export const WEIGHT_IN: Record<Weight, number> = { heavy: 0.028, medium: 0.016, fine: 0.009, hair: 0.005 };

export const DASH = { hidden: [0.09, 0.05], center: [0.25, 0.05, 0.05, 0.05], dotted: [0.02, 0.04] };

export type Item =
  | { t: "line"; pts: Point[]; w: Weight; dash?: number[]; color?: string }
  | { t: "poly"; pts: Point[]; fill?: string; stroke?: Weight; dash?: number[] }
  | { t: "circle"; c: Point; r: number; fill?: string; stroke?: Weight }
  | {
      t: "text";
      at: Point;
      text: string;
      /** Points (1/72"). */
      size: number;
      bold?: boolean;
      align?: "left" | "center" | "right";
      /** Where `at` sits on the text: its baseline (default), middle or top. */
      valign?: "baseline" | "middle" | "top";
      /** Degrees counter-clockwise. */
      rotate?: number;
      color?: string;
    };

export type Sheet = {
  id: string;
  /** "A-101". */
  number: string;
  title: string;
  /** Paper size in inches at full size: 36 x 24. */
  w: number;
  h: number;
  items: Item[];
};

export const INK = "#000000";
export const POCHE = "#3a3a3a";
export const GREY = "#7a7a7a";
export const LIGHT = "#e6e6e6";

// ---------- Text ----------

// Helvetica character widths (per 1000 units of the font size) for ASCII 32 to 126, from the font metrics jsPDF uses.
const HELV = [280,280,350,550,550,890,660,190,330,330,390,580,280,330,280,280,550,550,550,550,550,550,550,550,550,550,280,280,580,580,580,550,1010,660,660,720,720,660,610,780,720,280,500,660,550,830,720,780,660,780,720,660,610,720,660,940,660,660,610,280,280,280,470,550,330,550,550,500,550,550,280,550,550,220,220,500,220,830,550,550,550,550,330,500,280,550,500,720,500,500,500,330,260,330,580];
const HELV_BOLD = [280,330,470,550,550,890,720,240,330,330,390,580,280,330,280,280,550,550,550,550,550,550,550,550,550,550,330,330,580,580,580,610,970,720,720,720,720,660,610,780,720,280,550,720,610,830,720,780,660,780,720,660,610,720,660,940,660,660,610,330,280,330,580,550,330,550,610,550,610,550,330,610,610,280,280,550,280,890,610,610,610,610,390,550,330,610,550,780,550,550,500,390,280,390,580];
const OTHER: Record<string, number> = { "–": 556, "—": 1000, "½": 834, "¼": 834, "¾": 834, "°": 400, "±": 584, "×": 584, "·": 278, "’": 222, "“": 333, "”": 333, "…": 1000 };

/** Width of a line of text, inches. */
export function textWidth(text: string, size: number, bold = false): number {
  const table = bold ? HELV_BOLD : HELV;
  let units = 0;
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    units += c >= 32 && c <= 126 ? table[c - 32] : (OTHER[ch] ?? 556);
  }
  return (units / 1000) * (size / 72);
}

/** Cap height and line height for a font size, inches. */
export const capHeight = (size: number) => (size / 72) * 0.72;
export const lineHeight = (size: number) => (size / 72) * 1.25;

/** Break text into lines that fit a width. */
export function wrap(text: string, width: number, size: number, bold = false): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && textWidth(next, size, bold) > width) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

/** Text in a box: wrapped lines from the top. Returns the items and the height used. */
export function textBlock(text: string, x: number, y: number, width: number, size: number, opts: { bold?: boolean; color?: string; align?: "left" | "center" | "right" } = {}): { items: Item[]; height: number } {
  const lines = wrap(text, width, size, opts.bold);
  const lh = lineHeight(size);
  const ax = opts.align === "center" ? x + width / 2 : opts.align === "right" ? x + width : x;
  const items: Item[] = lines.map((line, i) => ({ t: "text", at: { x: ax, y: y + capHeight(size) + i * lh }, text: line, size, bold: opts.bold, color: opts.color, align: opts.align }));
  return { items, height: lines.length * lh };
}

// ---------- Units ----------

/** Architectural feet and inches: 12'-6", 0'-8", 3'-4 1/2". */
export function archFeet(inches: number): string {
  const halfIn = Math.round(Math.abs(inches) * 2) / 2;
  const sign = inches < 0 ? "-" : "";
  const ft = Math.floor(halfIn / 12);
  const rest = halfIn - ft * 12;
  const whole = Math.floor(rest);
  const half = rest - whole >= 0.5 ? " 1/2" : "";
  return `${sign}${ft}'-${whole}${half}"`;
}

/** Drawing scales, largest first, as sheet inches per real foot, with their labels. */
export const SCALES = [
  { inPerFt: 1 / 2, label: '1/2" = 1\'-0"' },
  { inPerFt: 1 / 4, label: '1/4" = 1\'-0"' },
  { inPerFt: 3 / 16, label: '3/16" = 1\'-0"' },
  { inPerFt: 1 / 8, label: '1/8" = 1\'-0"' },
  { inPerFt: 3 / 32, label: '3/32" = 1\'-0"' },
  { inPerFt: 1 / 16, label: '1/16" = 1\'-0"' },
];

// ---------- Shapes ----------

export function rect(x: number, y: number, w: number, h: number, stroke: Weight = "fine", fill?: string): Item {
  return {
    t: "poly",
    pts: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
    stroke,
    fill,
  };
}

export function line(a: Point, b: Point, w: Weight = "fine", dash?: number[]): Item {
  return { t: "line", pts: [a, b], w, dash };
}

/** An arc as a polyline. Angles in degrees, measured on the sheet (y down), from a0 to a1. */
export function arc(c: Point, r: number, a0: number, a1: number, w: Weight = "fine", dash?: number[]): Item {
  const n = Math.max(6, Math.ceil(Math.abs(a1 - a0) / 6));
  const pts: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    pts.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
  }
  return { t: "line", pts, w, dash };
}

export function ellipse(c: Point, rx: number, ry: number, rotDeg: number, w: Weight = "fine"): Item {
  const pts: Point[] = [];
  const t = (rotDeg * Math.PI) / 180;
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry;
    pts.push({ x: c.x + x * Math.cos(t) - y * Math.sin(t), y: c.y + x * Math.sin(t) + y * Math.cos(t) });
  }
  return { t: "poly", pts, stroke: w };
}

/** A simple table: column widths, header row, body rows. Returns items, height, and how many rows fit in maxHeight. */
export function table(
  x: number,
  y: number,
  cols: { title: string; width: number }[],
  rows: string[][],
  opts: { size?: number; maxHeight?: number; boldFirst?: boolean } = {},
): { items: Item[]; height: number; fitted: number } {
  const size = opts.size ?? 7;
  const pad = 0.05;
  const lh = lineHeight(size);
  const width = cols.reduce((s, c) => s + c.width, 0);
  const items: Item[] = [];
  const header = cols.some((c) => c.title);
  const headH = header ? lh + pad * 2 : 0;
  let cx = x;
  if (header) {
    items.push(rect(x, y, width, headH, "fine", LIGHT));
    for (const c of cols) {
      items.push({ t: "text", at: { x: cx + pad, y: y + pad + capHeight(size) }, text: c.title, size, bold: true });
      cx += c.width;
    }
  }
  let at = y + headH;
  let fitted = 0;
  for (const row of rows) {
    const cells = row.map((cell, i) => wrap(cell, cols[i].width - pad * 2, size, opts.boldFirst && i === 0));
    const h = Math.max(1, ...cells.map((c) => c.length)) * lh + pad * 2;
    if (opts.maxHeight !== undefined && at + h - y > opts.maxHeight) break;
    cx = x;
    cells.forEach((cell, i) => {
      cell.forEach((ln, k) => items.push({ t: "text", at: { x: cx + pad, y: at + pad + capHeight(size) + k * lh }, text: ln, size, bold: opts.boldFirst && i === 0 }));
      cx += cols[i].width;
    });
    items.push(line({ x, y: at + h }, { x: x + width, y: at + h }, "hair"));
    at += h;
    fitted++;
  }
  items.push(rect(x, y, width, at - y, "fine"));
  cx = x;
  for (const c of cols.slice(0, -1)) {
    cx += c.width;
    items.push(line({ x: cx, y }, { x: cx, y: at }, "hair"));
  }
  return { items, height: at - y, fitted };
}

/** A heading with a rule under it. */
export function heading(text: string, x: number, y: number, width: number, size = 9): Item[] {
  return [
    { t: "text", at: { x, y: y + capHeight(size) }, text: text.toUpperCase(), size, bold: true },
    line({ x, y: y + capHeight(size) + 0.06 }, { x: x + width, y: y + capHeight(size) + 0.06 }, "medium"),
  ];
}

export const HEADING_H = 0.25;

/** Every piece of text on a sheet, for checks. */
export function sheetText(sheet: Sheet): string[] {
  return sheet.items.filter((i): i is Extract<Item, { t: "text" }> => i.t === "text").map((i) => i.text);
}
