import type { Level, PlanRoom, Point, Project } from "@/lib/model/schema";
import { add, boundsOf, pointInPolygon, rotate, scale, sub } from "@/lib/plan/geometry";
import { ceilingFor } from "@/lib/plan/basics";
import { openingGeometries } from "@/lib/plan/walls";
import {
  alongRun,
  BASE_HEIGHT_IN,
  cabinetCorners,
  cabinetLayout,
  CABINET_LABEL,
  COUNTER_TOP_IN,
  UPPER_BOTTOM_IN,
  upperTop,
  type CabinetLayout,
  type CabinetRun,
  type PlacedCabinet,
} from "@/lib/plan/cabinets";
import { effectivePick, productTitle } from "@/lib/interior/picks";
import { codeNum, codeRef } from "@/lib/codes/data";
import { inchText } from "@/lib/codes/rules";
import { DRAW_AREA } from "../frame";
import { archFeet, capHeight, DASH, heading, HEADING_H, line, readable, rect, table, textBlock, type Item } from "../draw";
import { houseFacts } from "../house";
import { viewTitle } from "../view";
import { flatProject } from "@/lib/plan/flatten";

/**
 * Cabinet plans and elevations (I-201): an enlarged plan of each room with
 * cabinets (base boxes drawn solid, uppers dashed, each with its code), and
 * an elevation of each run looking at the wall, with heights, the counter,
 * appliances and the windows behind. A cabinet list and notes go on the right.
 */

const NOTES_W = 6.5;
const GAP = 0.6;
const TITLE_H = 0.75;
const PLAN_SCALES = [
  { inPerFt: 1 / 2, label: '1/2" = 1\'-0"' },
  { inPerFt: 3 / 8, label: '3/8" = 1\'-0"' },
  { inPerFt: 1 / 4, label: '1/4" = 1\'-0"' },
];
const ELEV = { inPerFt: 1 / 2, label: '1/2" = 1\'-0"' };

/** A floor's cabinets, with that floor's ceiling height and the range clearance from the code data. */
export function levelCabinets(project: Project, level: Pick<Level, "id" | "kind">): CabinetLayout {
  project = flatProject(project);
  const plan = houseFacts(project).plan(level.id);
  return cabinetLayout(plan, ceilingFor(project.plan.basics, level), codeNum("kitchen.rangeClearanceAbove"));
}

/** Does the house have anything to make cabinets from? */
export function hasCabinetRuns(project: Project): boolean {
  const h = houseFacts(project);
  return h.levels.some((l) => h.plan(l.id).fixtures.some((f) => f.kind === "counter" || f.kind === "island" || f.kind === "vanity"));
}

type View = { w: number; h: number; draw: (x: number, y: number) => Item[] };

export function cabinetSheets(project: Project): { items: Item[]; scaleLabel: string }[] {
  const h = houseFacts(project);
  const views: View[] = [];
  const all: PlacedCabinet[] = [];
  let number = 0;
  for (const level of h.levels) {
    const plan = h.plan(level.id);
    const layout = levelCabinets(project, level);
    if (!layout.runs.length && !layout.cabinets.length) continue;
    all.push(...layout.cabinets);
    const ceiling = ceilingFor(h.basics, level);
    // Which room each run is in.
    const roomOf = (run: CabinetRun): PlanRoom | undefined => {
      const p = add(run.origin, add(scale(run.u, (run.t0 + run.t1) / 2), scale(run.n, run.depthIn / 2)));
      return plan.rooms.find((r) => pointInPolygon(p, r.polygon));
    };
    const byRoom = new Map<string, { room?: PlanRoom; runs: CabinetRun[] }>();
    for (const run of layout.runs) {
      const room = roomOf(run);
      const key = room?.id ?? run.id;
      byRoom.set(key, { room, runs: [...(byRoom.get(key)?.runs ?? []), run] });
    }
    for (const { room, runs } of byRoom.values()) {
      const elevNumbers = new Map<string, number>();
      const planNumber = ++number;
      for (const run of runs) elevNumbers.set(run.id, ++number);
      views.push(planView(project, level, room, runs, layout, planNumber, elevNumbers));
      for (const run of runs) views.push(elevationView(project, level, room, run, layout, ceiling, elevNumbers.get(run.id)!));
    }
  }

  // Pack the views in rows, left to right, onto as many sheets as they need.
  const area = { x0: DRAW_AREA.x0, y0: DRAW_AREA.y0, x1: DRAW_AREA.x1 - NOTES_W - 0.4, y1: DRAW_AREA.y1 };
  const pages: Item[][] = [[]];
  let x = area.x0;
  let y = area.y0;
  let rowH = 0;
  for (const v of views) {
    if (x > area.x0 && x + v.w > area.x1) {
      x = area.x0;
      y += rowH + GAP;
      rowH = 0;
    }
    if (y > area.y0 && y + v.h > area.y1) {
      pages.push([]);
      x = area.x0;
      y = area.y0;
      rowH = 0;
    }
    pages[pages.length - 1].push(...v.draw(x, y));
    x += v.w + GAP;
    rowH = Math.max(rowH, v.h);
  }
  pages[0].push(...notesColumn(project, all));
  return pages.map((items) => ({ items, scaleLabel: "As shown" }));
}

// ---------- Enlarged plan ----------

function planView(project: Project, level: Level, room: PlanRoom | undefined, runs: CabinetRun[], layout: CabinetLayout, number: number, elevNumbers: Map<string, number>): View {
  const plan = houseFacts(project).plan(level.id);
  const ids = new Set(runs.map((r) => r.id));
  const cabs = layout.cabinets.filter((c) => (c.runId ? ids.has(c.runId) : room ? pointInPolygon({ x: c.x, y: c.y }, room.polygon) : false));
  const fixtures = plan.fixtures.filter((f) => (room ? f.roomId === room.id || pointInPolygon({ x: f.x, y: f.y }, room.polygon) : false));
  const outline = room?.polygon ?? [];
  const b = boundsOf([...outline, ...cabs.flatMap(cabinetCorners), ...runs.flatMap((r) => [add(r.origin, scale(r.u, r.t0)), add(r.origin, scale(r.u, r.t1))])])!;
  const pad = 18;
  const wIn = b.x1 - b.x0 + pad * 2;
  const hIn = b.y1 - b.y0 + pad * 2;
  const maxW = DRAW_AREA.x1 - DRAW_AREA.x0 - NOTES_W - 0.4;
  const choice = PLAN_SCALES.find((sc) => (wIn / 12) * sc.inPerFt <= Math.min(maxW, 14) && (hIn / 12) * sc.inPerFt <= 10) ?? PLAN_SCALES[PLAN_SCALES.length - 1];
  const s = choice.inPerFt / 12;
  const w = Math.max(wIn * s, 5.2);
  const h = hIn * s + TITLE_H;
  return {
    w,
    h,
    draw: (x, y) => {
      const items: Item[] = [];
      const T = (p: Point): Point => ({ x: x + (p.x - b.x0 + pad) * s, y: y + (p.y - b.y0 + pad) * s });
      if (outline.length) items.push({ t: "poly", pts: outline.map(T), stroke: "heavy" });
      // Doors and windows in the room's walls: a gap with thin lines.
      for (const g of openingGeometries(plan)) {
        if (!room || !outline.some((p, i) => onSegment(g.center, p, outline[(i + 1) % outline.length]))) continue;
        items.push({ t: "line", pts: [T(g.a), T(g.b)], w: "heavy", color: "#ffffff" });
        const off = scale(g.n, 3);
        items.push(line(T(add(g.a, off)), T(add(g.b, off)), "hair"), line(T(sub(g.a, off)), T(sub(g.b, off)), "hair"));
        if (g.opening.kind === "window") items.push(line(T(g.a), T(g.b), "hair"));
      }
      // Appliances and the sink.
      for (const f of fixtures) {
        if (f.kind === "counter" || f.kind === "island" || f.kind === "vanity") {
          // The countertop's edge.
          const L = (px: number, py: number) => add(rotate({ x: px, y: py }, f.rotation), { x: f.x, y: f.y });
          items.push({ t: "poly", pts: [L(-f.widthIn / 2, -f.depthIn / 2), L(f.widthIn / 2, -f.depthIn / 2), L(f.widthIn / 2, f.depthIn / 2), L(-f.widthIn / 2, f.depthIn / 2)].map(T), stroke: "fine" });
          continue;
        }
        const L = (px: number, py: number) => add(rotate({ x: px, y: py }, f.rotation), { x: f.x, y: f.y });
        items.push({ t: "poly", pts: [L(-f.widthIn / 2, -f.depthIn / 2), L(f.widthIn / 2, -f.depthIn / 2), L(f.widthIn / 2, f.depthIn / 2), L(-f.widthIn / 2, f.depthIn / 2)].map(T), stroke: "fine", fill: "#f2f2f2" });
        const label = APPLIANCE_TEXT[f.kind];
        if (label) items.push({ t: "text", at: T({ x: f.x, y: f.y }), text: label, size: 5.5, bold: true, align: "center", valign: "middle", rotate: readable(rotate({ x: 1, y: 0 }, f.rotation)) });
        if (f.kind === "sink" || f.kind === "laundry-sink") items.push({ t: "poly", pts: [L(-f.widthIn / 2 + 3, -f.depthIn / 2 + 4), L(f.widthIn / 2 - 3, -f.depthIn / 2 + 4), L(f.widthIn / 2 - 3, f.depthIn / 2 - 3), L(-f.widthIn / 2 + 3, f.depthIn / 2 - 3)].map(T), stroke: "hair" });
      }
      // Cabinets: base boxes solid, uppers dashed, each with its code.
      for (const c of cabs) {
        const pts = cabinetCorners(c).map(T);
        const upper = c.bottomIn > 24;
        items.push({ t: "poly", pts, stroke: upper ? "hair" : "fine", dash: upper ? DASH.hidden : undefined });
        const at = T(add({ x: c.x, y: c.y }, rotate({ x: 0, y: upper ? -c.depthIn / 2 + 4 : c.depthIn / 2 - 6 }, c.rotation)));
        items.push({ t: "text", at, text: c.code, size: 4.5, align: "center", valign: "middle", rotate: readable(rotate({ x: 1, y: 0 }, c.rotation)), color: upper ? "#555555" : undefined });
      }
      // Elevation markers, out in front of each run, pointing at it.
      for (const run of runs) {
        const mid = add(run.origin, add(scale(run.u, (run.t0 + run.t1) / 2), scale(run.n, run.depthIn + 14)));
        const c = T(mid);
        const tip = T(add(mid, scale(run.n, -9)));
        const side = scale(rotate(run.n, 90), 5);
        items.push({ t: "poly", pts: [tip, T(add(mid, side)), T(sub(mid, side))], fill: "#000000" });
        items.push({ t: "circle", c, r: 0.12, stroke: "fine", fill: "#ffffff" });
        items.push({ t: "text", at: c, text: String(elevNumbers.get(run.id)), size: 6, bold: true, align: "center", valign: "middle" });
      }
      items.push(...viewTitle(x, y + hIn * s + 0.4, { number, title: `${room?.name ?? "Cabinets"} cabinet plan`, scaleLabel: choice.label, minWidth: Math.min(3, w - 1) }));
      return items;
    },
  };
}

const APPLIANCE_TEXT: Record<string, string> = { range: "RANGE", fridge: "REF", dishwasher: "DW", washer: "W", dryer: "D", sink: "", "laundry-sink": "" };

function onSegment(p: Point, a: Point, b: Point): boolean {
  const ab = sub(b, a);
  const L = Math.hypot(ab.x, ab.y);
  if (L < 1e-6) return false;
  const t = ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / (L * L);
  const q = add(a, scale(ab, t));
  return t > -0.01 && t < 1.01 && Math.hypot(p.x - q.x, p.y - q.y) < 2;
}

// ---------- Elevation ----------

function elevationView(project: Project, level: Level, room: PlanRoom | undefined, run: CabinetRun, layout: CabinetLayout, ceilingIn: number, number: number): View {
  const s = ELEV.inPerFt / 12;
  const cabs = layout.cabinets.filter((c) => c.runId === run.id);
  const span = (c: PlacedCabinet): [number, number] => {
    const t = alongRun(run, c);
    return [t - c.widthIn / 2, t + c.widthIn / 2];
  };
  let t0 = run.t0;
  let t1 = run.t1;
  for (const c of cabs) {
    const [a, b] = span(c);
    t0 = Math.min(t0, a);
    t1 = Math.max(t1, b);
  }
  const top = Math.max(ceilingIn, upperTop(ceilingIn).topIn + 6);
  const left = 1.1;
  const w = (t1 - t0) * s + left + 0.5;
  const h = top * s + 0.5 + TITLE_H + 0.2;
  const kindName = run.kind === "island" ? "island" : run.kind === "vanity" ? "vanity" : run.kind === "laundry" ? "laundry wall" : "wall";
  return {
    w: Math.max(w, 5.2),
    h,
    draw: (x, y) => {
      const items: Item[] = [];
      const X = (t: number) => x + left + (t - t0) * s;
      const Z = (z: number) => y + (top - z) * s + 0.1;
      const box = (a: number, b: number, z0: number, z1: number, stroke: "fine" | "hair" | "medium" = "fine", fill?: string) => items.push(rect(X(a), Z(z1), (b - a) * s, (z1 - z0) * s, stroke, fill));
      // Floor and ceiling.
      items.push(line({ x: X(t0) - 0.3, y: Z(0) }, { x: X(t1) + 0.3, y: Z(0) }, "heavy"));
      if (run.kind !== "island") items.push(line({ x: X(t0) - 0.3, y: Z(ceilingIn) }, { x: X(t1) + 0.3, y: Z(ceilingIn) }, "fine", DASH.hidden));
      // Windows and doors behind.
      for (const o of run.openings) {
        const a = Math.max(t0, o.t0);
        const b = Math.min(t1, o.t1);
        if (b - a < 1) continue;
        items.push({ t: "poly", pts: [{ x: X(a), y: Z(o.topIn) }, { x: X(b), y: Z(o.topIn) }, { x: X(b), y: Z(o.bottomIn) }, { x: X(a), y: Z(o.bottomIn) }], stroke: "hair", dash: DASH.hidden });
        items.push({ t: "text", at: { x: (X(a) + X(b)) / 2, y: Z(o.topIn) + 0.12 }, text: o.kind === "window" ? "WINDOW" : "DOOR", size: 5, align: "center", color: "#555555" });
      }
      // Countertop over the bases, sink and dishwasher.
      const counter: [number, number][] = [];
      for (const c of cabs) if (c.bottomIn < 1 && c.kind !== "tall" && c.kind !== "vanity") counter.push(span(c));
      for (const a of run.appliances) if (a.fixture.kind === "dishwasher" || a.fixture.kind === "sink") counter.push([a.t0, a.t1]);
      for (const [a, b] of merge(counter)) box(a, b, BASE_HEIGHT_IN, COUNTER_TOP_IN, "fine", "#d9d9d9");
      const vanityTop = merge(cabs.filter((c) => c.kind === "vanity").map(span));
      for (const [a, b] of vanityTop) box(a, b, cabs.find((c) => c.kind === "vanity")!.heightIn, cabs.find((c) => c.kind === "vanity")!.heightIn + 2, "fine", "#d9d9d9");
      // Appliances.
      for (const a of run.appliances) {
        const k = a.fixture.kind;
        const hgt = k === "fridge" ? 70 : k === "range" ? 36 : k === "dishwasher" ? BASE_HEIGHT_IN : k === "washer" || k === "dryer" ? 38 : 0;
        if (!hgt) continue;
        box(a.t0, a.t1, 0, hgt, "fine", "#f2f2f2");
        items.push({ t: "text", at: { x: (X(a.t0) + X(a.t1)) / 2, y: Z(hgt / 2) }, text: APPLIANCE_TEXT[k] || k.toUpperCase(), size: 6, bold: true, align: "center", valign: "middle" });
        if (k === "range") {
          // The hood, under the cabinet over the range.
          const over = cabs.find((c) => c.bottomIn > COUNTER_TOP_IN && Math.abs(alongRun(run, c) - (a.t0 + a.t1) / 2) < 3);
          const hoodTop = over ? over.bottomIn : upperTop(ceilingIn).topIn;
          const hoodBottom = Math.max(COUNTER_TOP_IN + 24, hoodTop - 8);
          const m = 1.5;
          items.push({ t: "poly", pts: [{ x: X(a.t0 + 4), y: Z(hoodTop) }, { x: X(a.t1 - 4), y: Z(hoodTop) }, { x: X(a.t1 + m), y: Z(hoodBottom) }, { x: X(a.t0 - m), y: Z(hoodBottom) }], stroke: "fine", fill: "#f2f2f2" });
          items.push({ t: "text", at: { x: (X(a.t0) + X(a.t1)) / 2, y: (Z(hoodTop) + Z(hoodBottom)) / 2 }, text: "HOOD", size: 5, align: "center", valign: "middle" });
        }
      }
      // Cabinet boxes with their doors and drawers.
      for (const c of cabs) {
        const [a, b] = span(c);
        const z0 = c.bottomIn;
        const z1 = c.bottomIn + c.heightIn;
        box(a, b, z0, z1, "medium", "#ffffff");
        const mid = (a + b) / 2;
        const base = z0 < 1;
        const kick = base && c.kind !== "filler" ? 4 : 0;
        if (kick) items.push(line({ x: X(a), y: Z(kick) }, { x: X(b), y: Z(kick) }, "hair"));
        if (c.kind === "drawer") for (const k of [1, 2]) items.push(line({ x: X(a), y: Z(kick + ((z1 - kick) * k) / 3) }, { x: X(b), y: Z(kick + ((z1 - kick) * k) / 3) }, "hair"));
        else if (c.kind === "open-shelf") for (const k of [1, 2]) items.push(line({ x: X(a), y: Z(z0 + ((z1 - z0) * k) / 3) }, { x: X(b), y: Z(z0 + ((z1 - z0) * k) / 3) }, "hair"));
        else if (c.kind === "wine") {
          items.push(line({ x: X(a), y: Z(z0 + kick) }, { x: X(b), y: Z(z1) }, "hair"), line({ x: X(a), y: Z(z1) }, { x: X(b), y: Z(z0 + kick) }, "hair"));
        } else if (c.kind === "appliance-garage") items.push(line({ x: X(a), y: Z(z0 + (z1 - z0) * 0.3) }, { x: X(b), y: Z(z0 + (z1 - z0) * 0.3) }, "hair"));
        else if (c.kind !== "filler") {
          if (base) items.push(line({ x: X(a), y: Z(z1 - 6) }, { x: X(b), y: Z(z1 - 6) }, "hair"));
          if (c.widthIn >= 24) items.push(line({ x: X(mid), y: Z(base ? z1 - 6 : z1) }, { x: X(mid), y: Z(kick || z0) }, "hair"));
        }
        // The code on the left door when there are two, so the meeting line doesn't run through it.
        const lx = c.kind !== "drawer" && c.widthIn >= 24 ? a + (b - a) / 4 : mid;
        if (c.kind !== "filler") items.push({ t: "text", at: { x: X(lx), y: Z((z0 + z1) / 2 + (base ? -4 : 0)) }, text: c.code, size: 5.5, align: "center", valign: "middle" });
        if (c.kind === "sink") items.push({ t: "poly", pts: [{ x: X(a + 4), y: Z(COUNTER_TOP_IN) }, { x: X(b - 4), y: Z(COUNTER_TOP_IN) }, { x: X(b - 6), y: Z(COUNTER_TOP_IN - 9) }, { x: X(a + 6), y: Z(COUNTER_TOP_IN - 9) }], stroke: "hair", dash: DASH.hidden });
      }
      // Overall length under the floor line, and heights on the left.
      const dy = Z(0) + 0.25;
      items.push(line({ x: X(t0), y: dy }, { x: X(t1), y: dy }, "hair"), line({ x: X(t0), y: dy - 0.07 }, { x: X(t0), y: dy + 0.07 }, "hair"), line({ x: X(t1), y: dy - 0.07 }, { x: X(t1), y: dy + 0.07 }, "hair"));
      items.push({ t: "text", at: { x: (X(t0) + X(t1)) / 2, y: dy - 0.05 }, text: archFeet(t1 - t0), size: 6, align: "center" });
      const marks = run.kind === "vanity" ? [cabs.find((c) => c.kind === "vanity")?.heightIn ?? 32] : run.kind === "island" ? [BASE_HEIGHT_IN, COUNTER_TOP_IN] : [COUNTER_TOP_IN, UPPER_BOTTOM_IN, upperTop(ceilingIn).topIn];
      const hx = X(t0) - 0.35;
      items.push(line({ x: hx, y: Z(0) }, { x: hx, y: Z(Math.max(...marks)) }, "hair"));
      for (const m of marks) {
        items.push(line({ x: hx - 0.06, y: Z(m) }, { x: hx + 0.06, y: Z(m) }, "hair"));
        items.push({ t: "text", at: { x: hx - 0.08, y: Z(m) }, text: archFeet(m), size: 5.5, align: "right", valign: "middle" });
      }
      items.push(...viewTitle(x, Z(0) + 0.75, { number, title: `${room?.name ?? "Cabinet"} ${kindName}`, scaleLabel: ELEV.label, minWidth: 3 }));
      return items;
    },
  };
}

function merge(spans: [number, number][]): [number, number][] {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 0.5) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

// ---------- Notes and cabinet list ----------

function notesColumn(project: Project, cabs: PlacedCabinet[]): Item[] {
  const items: Item[] = [];
  const x = DRAW_AREA.x1 - NOTES_W;
  let y = DRAW_AREA.y0;
  const sel = project.interior.selections;
  const pick = (cat: string) => {
    for (const s of sel) if (s.category === cat && !s.wall) return s.product;
    return effectivePick(sel, "house", cat)?.pick.product;
  };
  const cab = pick("cabinets");
  const counter = pick("counters");
  const pulls = pick("hardware");
  const vanity = pick("vanities");
  items.push(...heading("Cabinet notes", x, y, NOTES_W, 10));
  y += HEADING_H + 0.1;
  const notes = [
    `Kitchen cabinets: ${cab ? productTitle(cab) : "owner's pick"}. Countertops: ${counter ? productTitle(counter) : "owner's pick"}. Pulls: ${pulls ? productTitle(pulls) : "owner's pick"}. Vanities: ${vanity ? productTitle(vanity) : "owner's pick"}.`,
    `Codes are standard box sizes: B base, SB sink base, DB drawer base, W wall (width then height), T tall, V vanity, F filler; the number is the width in inches. Base boxes ${inchText(BASE_HEIGHT_IN)} high and 24" deep, counter at ${inchText(COUNTER_TOP_IN)}; uppers 12" deep, ${inchText(UPPER_BOTTOM_IN)} above the floor.`,
    `Cabinets over the range: at least ${inchText(codeNum("kitchen.rangeClearanceAbove"))} above the cooking top unless the range or hood listing allows less (${codeRef("kitchen.rangeClearanceAbove")}).`,
    `Range hood vented outside, ${codeNum("vent.kitchenIntermittent")} cfm or more (${codeRef("vent.kitchenIntermittent")}); over ${codeNum("vent.makeupAirHoodCfm")} cfm needs makeup air (${codeRef("vent.makeupAirHoodCfm")}).`,
    "Field-verify every wall before ordering. Fillers and end panels are scribed to the walls; the cabinet supplier's shop drawings govern.",
    "Fasten wall cabinets through the back rail into studs. Leave access to the sink shutoffs and the dishwasher's electrical box.",
  ];
  notes.forEach((n, i) => {
    items.push({ t: "text", at: { x, y: y + capHeight(7) }, text: `${i + 1}.`, size: 7 });
    const b = textBlock(n, x + 0.28, y, NOTES_W - 0.28, 7);
    items.push(...b.items);
    y += b.height + 0.1;
  });
  // The cabinet list: each code with its count.
  const counts = new Map<string, { kind: PlacedCabinet["kind"]; n: number }>();
  for (const c of cabs) counts.set(c.code, { kind: c.kind, n: (counts.get(c.code)?.n ?? 0) + 1 });
  const rows = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })).map(([code, v]) => [code, CABINET_LABEL[v.kind], String(v.n)]);
  y += 0.15;
  items.push(...heading("Cabinet list", x, y, NOTES_W, 10));
  y += HEADING_H + 0.08;
  const tb = table(x, y, [
    { title: "Code", width: 1.3 },
    { title: "Box", width: NOTES_W - 2.1 },
    { title: "Qty", width: 0.8 },
  ], rows, { size: 7, boldFirst: true, maxHeight: DRAW_AREA.y1 - y });
  items.push(...tb.items);
  if (tb.fitted < rows.length) items.push({ t: "text", at: { x, y: y + tb.height + 0.15 }, text: `${rows.length - tb.fitted} more sizes; see the plans.`, size: 7 });
  return items;
}
