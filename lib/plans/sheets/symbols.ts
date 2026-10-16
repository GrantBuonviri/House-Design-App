import type { DeviceKind, Point } from "@/lib/model/schema";
import { add, scale, sub, unit, leftNormal, dist } from "@/lib/plan/geometry";
import { DASH, heading, HEADING_H, capHeight, table, textBlock, type Item, type Weight } from "../draw";

/**
 * Electrical, plumbing and mechanical symbols, drawn at a fixed size on the
 * sheet (they don't grow with the plan's scale), and the legend and notes
 * column the systems sheets share.
 */

const R = 0.065;

/** The short tag a built-in or extra carries on the floor plan. */
export const ADDON_TAG: Record<string, string> = {
  shelving: "SHELF",
  bookcase: "BK",
  "window-seat": "SEAT",
  bench: "BENCH",
  desk: "DESK",
  "ceiling-fan": "CF",
  mirror: "MIR",
  "towel-bar": "TB",
  "grab-bar": "GB",
  "medicine-cabinet": "MC",
  "coat-hooks": "HOOKS",
  lockers: "LKR",
};

/** Draw a device. `c` is its spot on the wall face (sheet inches); `front` points into the room. */
export function deviceSymbol(kind: DeviceKind | "hood" | "gas", c: Point, front: Point, opts: { note?: string; amps?: number } = {}): Item[] {
  const items: Item[] = [];
  const along = leftNormal(front);
  const at = (f: number, a = 0) => add(add(c, scale(front, f)), scale(along, a));
  const circle = (p: Point, r: number, fill?: string, stroke: Weight = "fine") => items.push({ t: "circle", c: p, r, fill: fill ?? "#ffffff", stroke });
  const text = (p: Point, t: string, size = 4.8, bold = true) => items.push({ t: "text", at: p, text: t, size, bold, align: "center", valign: "middle" });
  const ln = (a: Point, b: Point, w: Weight = "fine") => items.push({ t: "line", pts: [a, b], w });
  const note = (f: number) => opts.note && items.push({ t: "text", at: at(f), text: opts.note, size: 4.5, bold: true, align: "center", valign: "middle" });
  switch (kind) {
    case "outlet": {
      const m = at(R);
      circle(m, R);
      ln(add(m, scale(along, -0.025)), add(add(m, scale(along, -0.025)), scale(front, 0.1)));
      ln(add(m, scale(along, 0.025)), add(add(m, scale(along, 0.025)), scale(front, 0.1)));
      note(R * 2 + 0.11);
      break;
    }
    case "outlet-240": {
      const m = at(R + 0.01);
      circle(m, R + 0.01);
      for (const k of [-0.03, 0, 0.03]) ln(add(m, scale(along, k)), add(add(m, scale(along, k)), scale(front, 0.11)));
      note(R * 2 + 0.13);
      break;
    }
    case "junction":
      circle(c, R + 0.01);
      text(c, "J");
      note(0.17);
      break;
    case "switch":
    case "switch-3way": {
      const m = at(0.09);
      text(m, kind === "switch" ? "S" : "S3", 6.5);
      break;
    }
    case "light": {
      circle(c, 0.09);
      ln(add(c, { x: -0.064, y: -0.064 }), add(c, { x: 0.064, y: 0.064 }), "hair");
      ln(add(c, { x: -0.064, y: 0.064 }), add(c, { x: 0.064, y: -0.064 }), "hair");
      break;
    }
    case "light-recessed":
      circle(c, 0.06);
      circle(c, 0.028, "#000000", "hair");
      break;
    case "light-wall": {
      const m = at(0.09);
      ln(c, at(0.03));
      circle(m, 0.06);
      ln(add(m, scale(add(along, front), -0.042)), add(m, scale(add(along, front), 0.042)), "hair");
      ln(add(m, scale(sub(along, front), -0.042)), add(m, scale(sub(along, front), 0.042)), "hair");
      break;
    }
    case "fan":
      items.push({ t: "poly", pts: [add(c, { x: -0.1, y: -0.1 }), add(c, { x: 0.1, y: -0.1 }), add(c, { x: 0.1, y: 0.1 }), add(c, { x: -0.1, y: 0.1 })], stroke: "fine", fill: "#ffffff" });
      text(c, "EF");
      if (opts.note) items.push({ t: "text", at: add(c, { x: 0, y: 0.19 }), text: opts.note, size: 4.5, bold: true, align: "center", valign: "middle" });
      break;
    case "smoke":
    case "co":
    case "smoke-co":
    case "heat":
      circle(c, kind === "smoke-co" ? 0.12 : 0.1);
      text(c, kind === "smoke" ? "SD" : kind === "co" ? "CO" : kind === "heat" ? "HD" : "S/CO", kind === "smoke-co" ? 4.2 : 4.8);
      break;
    case "panel": {
      const a = add(c, scale(along, -0.2));
      const b = add(c, scale(along, 0.2));
      items.push({ t: "poly", pts: [a, b, add(b, scale(front, 0.08)), add(a, scale(front, 0.08))], fill: "#000000" });
      items.push({ t: "text", at: at(0.2), text: `PANEL${opts.amps ? ` ${opts.amps}A` : ""}`, size: 5, bold: true, align: "center", valign: "middle" });
      break;
    }
    case "supply": {
      const s = 0.075;
      items.push({ t: "poly", pts: [add(c, { x: -s, y: -s }), add(c, { x: s, y: -s }), add(c, { x: s, y: s }), add(c, { x: -s, y: s })], stroke: "fine", fill: "#ffffff" });
      ln(add(c, { x: -s, y: -s }), add(c, { x: s, y: s }), "hair");
      ln(add(c, { x: -s, y: s }), add(c, { x: s, y: -s }), "hair");
      break;
    }
    case "return": {
      const a = add(c, scale(along, -0.14));
      const b = add(c, scale(along, 0.14));
      const pts = [a, b, add(b, scale(front, 0.09)), add(a, scale(front, 0.09))];
      items.push({ t: "poly", pts, stroke: "fine", fill: "#ffffff" });
      ln(a, add(b, scale(front, 0.09)), "hair");
      text(at(0.2), "RA", 4.5);
      break;
    }
    case "thermostat":
      circle(at(0.08), 0.07);
      text(at(0.08), "T");
      break;
    case "hose-bib": {
      const tip = at(0.12);
      items.push({ t: "poly", pts: [add(c, scale(along, -0.05)), add(c, scale(along, 0.05)), tip], fill: "#000000" });
      text(at(0.22), "HB", 4.8);
      break;
    }
    case "hood":
      text(c, "HOOD", 5);
      break;
    case "gas":
      circle(c, 0.055);
      text(c, "G", 4.5);
      break;
    case "water": {
      // Hot and cold supply stub: a square with W.
      const m = at(0.07);
      items.push({ t: "poly", pts: [add(m, { x: -0.055, y: -0.055 }), add(m, { x: 0.055, y: -0.055 }), add(m, { x: 0.055, y: 0.055 }), add(m, { x: -0.055, y: 0.055 })], stroke: "fine", fill: "#ffffff" });
      text(m, "W", 4.5);
      break;
    }
    case "drain": {
      // Drain: a filled circle with D beside it.
      const m = at(0.07);
      circle(m, 0.05, "#000000");
      text(at(0.17), "D", 4.5);
      break;
    }
    case "dryer-vent": {
      const m = at(0.08);
      circle(m, 0.065);
      text(m, "DV", 4.2);
      break;
    }
  }
  return items;
}

/** A gentle dashed arc between two sheet points: switch legs on the electrical plan. */
export function legArc(a: Point, b: Point): Item {
  const d = dist(a, b);
  const mid = add(scale(add(a, b), 0.5), scale(leftNormal(unit(sub(b, a))), d * 0.22));
  const pts: Point[] = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    pts.push(add(add(scale(a, (1 - t) * (1 - t)), scale(mid, 2 * t * (1 - t))), scale(b, t * t)));
  }
  return { t: "line", pts, w: "hair", dash: DASH.hidden };
}

/** The legend and notes column at the right of a systems sheet. */
export class NotesColumn {
  items: Item[] = [];
  y: number;
  constructor(
    public x: number,
    y0: number,
    public w: number,
    public y1: number,
  ) {
    this.y = y0;
  }
  heading(text: string) {
    this.y += this.items.length ? 0.1 : 0;
    this.items.push(...heading(text, this.x, this.y, this.w));
    this.y += HEADING_H + 0.08;
  }
  legend(kind: Parameters<typeof deviceSymbol>[0], text: string, opts: { note?: string } = {}) {
    const c = { x: this.x + 0.25, y: this.y + 0.1 };
    const wall = ["outlet", "outlet-240", "switch", "switch-3way", "light-wall", "panel", "return", "thermostat", "hose-bib"].includes(kind);
    if (wall) this.items.push({ t: "line", pts: [add(c, { x: -0.2, y: -0.04 }), add(c, { x: 0.2, y: -0.04 })], w: "medium" });
    this.items.push(...deviceSymbol(kind, wall ? add(c, { x: 0, y: -0.04 }) : c, { x: 0, y: 1 }, opts));
    const tb = textBlock(text, this.x + 0.6, this.y + 0.02, this.w - 0.6, 6.5);
    this.items.push(...tb.items);
    this.y += Math.max(0.34, tb.height + 0.12);
  }
  notes(list: string[]) {
    list.forEach((n, i) => {
      this.items.push({ t: "text", at: { x: this.x, y: this.y + capHeight(6.5) }, text: `${i + 1}.`, size: 6.5 });
      const tb = textBlock(n, this.x + 0.22, this.y, this.w - 0.22, 6.5);
      this.items.push(...tb.items);
      this.y += tb.height + 0.07;
    });
  }
  table(cols: { title: string; width: number }[], rows: string[][]) {
    const tb = table(this.x, this.y, cols, rows, { size: 6, maxHeight: this.y1 - this.y, boldFirst: true });
    this.items.push(...tb.items);
    this.y += tb.height + 0.08;
    return tb.fitted;
  }
}
