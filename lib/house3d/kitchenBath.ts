import type { Fixture } from "@/lib/model/schema";
import { rotate, sub } from "@/lib/plan/geometry";
import { COLORS } from "./colors";
import { ItemFrame, lightness, shade, type Ring } from "./detail";
import { FRONT_IN, handle, HARDWARE, TOE_KICK_IN } from "./cabinets3d";
import { PATTERN, type RoomLook } from "./finishes";
import { finished, finishPattern } from "./fixtures";
import { hex, type Frame, type MeshBuilder, type RGB } from "./mesh";

/**
 * Kitchen, bath and laundry fixtures in detail, for Pretty graphics:
 * countertops with a thick edge cut round sinks and ranges, undermount and
 * apron-front sinks with real bowls, a range with its cooktop, oven door and
 * knobs, a hood, a French-door fridge, a dishwasher, a toilet, vanity tops
 * with bowls, a tub, a framed glass shower, front-load washer and dryer, a
 * utility sink, a water heater and a furnace. Each is drawn inside the
 * fixture's saved size, in its frame (back toward -y). Cabinet boxes and
 * fronts come from cabinets3d.ts; Fast keeps the plain shapes in fixtures.ts.
 */

/** Kinds drawn here with Pretty (the rest keep their simple shapes in both settings). */
export const DETAILED_KINDS = new Set([
  "counter",
  "island",
  "sink",
  "prep-sink",
  "range",
  "fridge",
  "dishwasher",
  "toilet",
  "vanity",
  "tub",
  "shower",
  "washer",
  "dryer",
  "laundry-sink",
  "water-heater",
  "furnace",
]);

export type DetailContext = {
  /** Every fixture on the floor, for the ranges, sinks and dishwashers that sit in a counter. */
  others: Fixture[];
  ceilingIn: number;
  /** A cabinet hangs over this range (so its hood goes under it). */
  cabinetOverRange?: boolean;
};

const COUNTER_IN = 1.5;
const OVERHANG_IN = 1;
const BLACK_GLASS = hex("#141414");
const IRON = hex("#1d1d1d");
const WHITE = hex("#f7f7f5");

/** Kinds that cut through a counter's top and box, or only its box (they slide in under the top). */
const CUT_TOP = new Set(["range", "fridge", "sink", "prep-sink", "washer", "dryer", "laundry-sink"]);
const CUT_BOX = new Set(["dishwasher"]);

/** Where other fixtures stand inside this counter, along its width: what to leave out of the top and of the box. */
export function counterCuts(fx: Fixture, others: Fixture[]): { top: [number, number][]; box: [number, number][] } {
  const top: [number, number][] = [];
  const box: [number, number][] = [];
  for (const o of others) {
    if (o.id === fx.id || !(CUT_TOP.has(o.kind) || CUT_BOX.has(o.kind))) continue;
    const local = rotate(sub({ x: o.x, y: o.y }, { x: fx.x, y: fx.y }), -(fx.rotation ?? 0));
    if (Math.abs(local.y) > fx.depthIn / 2 || Math.abs(local.x) > fx.widthIn / 2 + o.widthIn / 2) continue;
    // Its width along the counter (turned the same way, or across it).
    const turned = Math.abs(((((o.rotation ?? 0) - (fx.rotation ?? 0)) % 180) + 180) % 180 - 90) < 45;
    const half = (turned ? o.depthIn : o.widthIn) / 2;
    const span: [number, number] = [local.x - half, local.x + half];
    if (CUT_TOP.has(o.kind)) top.push(span);
    box.push(span);
  }
  return { top, box };
}

/** What's left of x0..x1 once the spans are taken out. */
export function leftOver(x0: number, x1: number, cuts: [number, number][]): [number, number][] {
  let pieces: [number, number][] = [[x0, x1]];
  for (const [a, b] of cuts) {
    pieces = pieces.flatMap(([p, q]): [number, number][] => {
      if (b <= p || a >= q) return [[p, q]];
      return [
        [p, Math.max(p, a)],
        [Math.min(q, b), q],
      ].filter(([s, e]) => e - s > 0.25) as [number, number][];
    });
  }
  return pieces;
}

/** An apron-front (farmhouse) sink, when the kitchen sink pick is one. */
export const isFarmhouse = (fx: Pick<Fixture, "kind" | "widthIn">, look: Pick<RoomLook, "sinkApron"> | undefined) => fx.kind === "sink" && fx.widthIn >= 30 && Boolean(look?.sinkApron);
/** How tall a farmhouse sink's apron is. */
export const APRON_IN = 10;

/**
 * A fixture in detail. Returns false for kinds without a detailed shape
 * (those keep their simple one in both settings).
 */
export function drawFixtureDetail(solid: MeshBuilder, glass: MeshBuilder, f: Frame, fx: Fixture, floorIn: number, look: RoomLook | undefined, ctx: DetailContext): boolean {
  if (!DETAILED_KINDS.has(fx.kind)) return false;
  const it = new ItemFrame(solid, f, { x: fx.x, y: fx.y }, fx.rotation ?? 0, floorIn);
  const W = fx.widthIn;
  const D = fx.depthIn;
  const color = (c: RGB) => finished(fx.kind, c, look);
  const cabinet = color(COLORS.cabinet);
  const counter = color(COLORS.counter);
  const stone = finishPattern(COLORS.counter, look);
  const steel = color(COLORS.steel);
  switch (fx.kind) {
    case "counter":
    case "island": {
      const cuts = counterCuts(fx, ctx.others);
      const island = fx.kind === "island";
      // The box stands back from the front (the cabinets' fronts cover it); an island's seating side overhangs.
      const front = D / 2 - OVERHANG_IN - FRONT_IN - 0.25;
      const backY = island ? -D / 2 + (D >= 36 ? 10 : OVERHANG_IN) : -D / 2;
      for (const [a, b] of leftOver(-W / 2 + (island ? OVERHANG_IN : 0), W / 2 - (island ? OVERHANG_IN : 0), cuts.box)) {
        it.box(a, b, backY, front - 3, 0, TOE_KICK_IN, shade(cabinet, 0.35), PATTERN.satin);
        it.box(a, b, backY, front, TOE_KICK_IN, 36 - COUNTER_IN, cabinet, PATTERN.cabinet);
      }
      for (const [a, b] of leftOver(-W / 2, W / 2, cuts.top)) countertop(it, a, b, -D / 2, D / 2, 36, counter, stone);
      break;
    }
    case "sink":
    case "prep-sink":
      kitchenSink(it, fx, color(COLORS.steel), isFarmhouse(fx, look), counter, stone, hostSpan(fx, ctx.others));
      break;
    case "vanity": {
      const bowl: Ring = { z: 34, rx: W * 0.25, ry: D * 0.275, cy: D * 0.02 };
      it.slabWithHole(-W / 2, W / 2, -D / 2, D / 2 + OVERHANG_IN * 0.75, 34 - COUNTER_IN, 34, ItemFrame.ringPoints(bowl, 24), counter, stone);
      basin(it, bowl, 6, color(COLORS.porcelain), PATTERN.ceramic, 24);
      // A short backsplash of the same stone.
      it.box(-W / 2, W / 2, -D / 2, -D / 2 + 0.75, 34, 38, counter, stone);
      break;
    }
    case "range":
      range(it, W, D, color(COLORS.steel), ctx);
      break;
    case "fridge":
      fridge(it, W, D, Math.min(70, ctx.ceilingIn - 12), steel);
      break;
    case "dishwasher":
      dishwasher(it, W, D, steel, inCounter(fx, ctx.others) ? null : counter, stone);
      break;
    case "toilet":
      toilet(it, W, D, color(COLORS.porcelain));
      break;
    case "tub":
      tub(it, W, D, color(COLORS.porcelain));
      break;
    case "shower":
      shower(it, glass, f, fx, floorIn, color(COLORS.tile));
      break;
    case "washer":
    case "dryer":
      laundryMachine(it, W, D, fx.kind === "washer", color(COLORS.porcelain));
      break;
    case "laundry-sink":
      utilitySink(it, W, D, color(COLORS.porcelain));
      break;
    case "water-heater":
      waterHeater(it, W, D, color(COLORS.mechanical));
      break;
    case "furnace":
      furnace(it, W, D, color(COLORS.mechanical));
      break;
  }
  solid.pattern = 0;
  return true;
}

/** The back and front of the counter a sink sits in, in the sink's own frame (so its stone meets the counter's edge). */
function hostSpan(fx: Fixture, others: Fixture[]): { y0: number; y1: number } {
  const host = others.find((o) => (o.kind === "counter" || o.kind === "island") && counterCuts(o, [fx]).top.length > 0);
  if (!host) return { y0: -fx.depthIn / 2, y1: fx.depthIn / 2 };
  const ys = [-1, 1].map((s) => {
    const edge = { x: host.x, y: host.y };
    const p = rotate({ x: 0, y: (s * host.depthIn) / 2 }, host.rotation ?? 0);
    return rotate(sub({ x: edge.x + p.x, y: edge.y + p.y }, { x: fx.x, y: fx.y }), -(fx.rotation ?? 0)).y;
  });
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  // Only when it lines up with the counter (turned the same way); otherwise its own size.
  return y1 > 0 && y0 < 0 && y1 - y0 < fx.depthIn + 20 ? { y0: Math.min(y0, -fx.depthIn / 2), y1: Math.max(y1, fx.depthIn / 2) } : { y0: -fx.depthIn / 2, y1: fx.depthIn / 2 };
}

/** A dishwasher with a counter fixture over it. */
function inCounter(fx: Fixture, others: Fixture[]): boolean {
  return others.some((o) => (o.kind === "counter" || o.kind === "island") && counterCuts(o, [fx]).box.length > 0);
}

/** A stone countertop with a thick edge, overhanging the cabinets' fronts. */
function countertop(it: ItemFrame, x0: number, x1: number, y0: number, y1: number, top: number, color: RGB, pattern: number) {
  it.box(x0, x1, y0, y1 - 0.25, top - COUNTER_IN, top, color, pattern);
  // The eased front edge: a little lower bead along the front.
  it.box(x0, x1, y1 - 0.25, y1, top - COUNTER_IN + 0.15, top - 0.15, color, pattern);
}

/** A sink bowl's inside, going down from its rim ring `depth` inches. */
function basin(it: ItemFrame, rim: Ring, depth: number, color: RGB, pattern: number, segments = 20) {
  const p = rim.power ?? 2;
  const r = (k: number, dz: number): Ring => ({ ...rim, z: rim.z - dz, rx: rim.rx * k, ry: rim.ry * k, power: p });
  it.loft([r(1, 0.01), r(0.97, depth * 0.6), r(0.88, depth * 0.95), r(0.75, depth), r(0, depth)], color, pattern, segments);
  // The drain.
  it.loft([{ ...rim, z: rim.z - depth + 0.05, rx: 1.4, ry: 1.4, power: 2 }, { ...rim, z: rim.z - depth + 0.05, rx: 0, ry: 0, power: 2 } ], HARDWARE, PATTERN.metal, 10);
}

function kitchenSink(it: ItemFrame, fx: Fixture, sinkColor: RGB, apron: boolean, counter: RGB, stone: number, span: { y0: number; y1: number }) {
  const W = fx.widthIn;
  const D = fx.depthIn;
  const prep = fx.kind === "prep-sink";
  const { y0, y1 } = span;
  if (apron) {
    // An apron-front sink (fireclay or steel): its front stands proud of the cabinets, the counter runs round its sides and back.
    const pat = lightness(sinkColor) > 0.6 ? PATTERN.ceramic : PATTERN.metal;
    const sw = W * 0.86;
    const back = -D / 2 + 3;
    const front = y1 - 0.5;
    countertop(it, -W / 2, -sw / 2, y0, y1, 36, counter, stone);
    countertop(it, sw / 2, W / 2, y0, y1, 36, counter, stone);
    it.box(-sw / 2, sw / 2, y0, back, 36 - COUNTER_IN, 36, counter, stone);
    const rimIn = 1.25;
    const inner: Ring = { z: 36, rx: sw / 2 - rimIn, ry: (front - back) / 2 - rimIn, cy: (front + back) / 2, power: 8 };
    it.slabWithHole(-sw / 2, sw / 2, back, front, 36 - 0.75, 36, ItemFrame.ringPoints(inner, 32), sinkColor, pat);
    it.openBox(-sw / 2, sw / 2, back, front, 36 - APRON_IN, 36 - 0.75, sinkColor, pat);
    basin(it, inner, APRON_IN - 1.5, sinkColor, pat, 32);
    return;
  }
  // Undermount: a rounded-square bowl cut into the stone (a prep sink's is small).
  const bowl: Ring = { z: 36, rx: (W * (prep ? 0.7 : 0.75)) / 2, ry: (D * 0.6) / 2, cy: D * 0.02, power: 6 };
  it.slabWithHole(-W / 2, W / 2, y0, y1, 36 - COUNTER_IN, 36, ItemFrame.ringPoints(bowl, 32), counter, stone);
  basin(it, bowl, prep ? 6 : 9, sinkColor, PATTERN.metal, 32);
}

/** A slide-in range: oven door with a window and a bar handle, a drawer, knobs, a black glass top with grates; and the hood above. */
function range(it: ItemFrame, W: number, D: number, steel: RGB, ctx: DetailContext) {
  const y0 = -D / 2;
  const y1 = D / 2 - 1;
  it.box(-W / 2, W / 2, y0, y1, 1, 35.25, steel, PATTERN.metal);
  it.box(-W / 2 + 0.5, W / 2 - 0.5, y0, y1 - 1, 0, 1, IRON, PATTERN.satin);
  // Oven door with its window, the drawer under it.
  it.box(-W / 2 + 0.25, W / 2 - 0.25, y1, y1 + 1, 7.5, 29, steel, PATTERN.metal);
  it.box(-W / 2 + 4, W / 2 - 4, y1 + 1, y1 + 1.05, 13, 25, BLACK_GLASS, PATTERN.ceramic);
  it.box(-W / 2 + 0.25, W / 2 - 0.25, y1, y1 + 1, 1.5, 7.25, steel, PATTERN.metal);
  handle(it, { x: 0, z: 27, pull: true }, y1 + 1, W - 6);
  handle(it, { x: 0, z: 6, pull: true }, y1 + 1, W - 10);
  // Knobs along the front, above the door.
  const knobs = 5;
  for (let i = 0; i < knobs; i++) {
    const x = -W / 2 + (W * (i + 0.5)) / knobs;
    it.loft(
      [
        { z: y1, rx: 0.9, ry: 0.9, cx: x, cy: 32.5 },
        { z: y1 + 1, rx: 0.9, ry: 0.9, cx: x, cy: 32.5 },
        { z: y1 + 1.05, rx: 0, ry: 0, cx: x, cy: 32.5 },
      ],
      IRON,
      PATTERN.satin,
      10,
      "y",
    );
  }
  // The glass top, a low back with the controls' strip, and two cast iron grates.
  it.box(-W / 2, W / 2, y0, y1 + 0.5, 35.25, 36, BLACK_GLASS, PATTERN.ceramic);
  it.box(-W / 2, W / 2, y0, y0 + 2, 36, 39, steel, PATTERN.metal);
  const gw = W / 2 - 1;
  for (const cx of [-W / 4, W / 4]) {
    const gx0 = cx - gw / 2;
    const gx1 = cx + gw / 2;
    const gy0 = y0 + 3;
    const gy1 = y1 - 0.5;
    const t = 0.5;
    it.box(gx0, gx1, gy0, gy0 + t, 36, 36.75, IRON, PATTERN.satin);
    it.box(gx0, gx1, gy1 - t, gy1, 36, 36.75, IRON, PATTERN.satin);
    it.box(gx0, gx0 + t, gy0, gy1, 36, 36.75, IRON, PATTERN.satin);
    it.box(gx1 - t, gx1, gy0, gy1, 36, 36.75, IRON, PATTERN.satin);
    it.box(cx - t / 2, cx + t / 2, gy0, gy1, 36, 36.75, IRON, PATTERN.satin);
    it.box(gx0, gx1, (gy0 + gy1) / 2 - t / 2, (gy0 + gy1) / 2 + t / 2, 36, 36.75, IRON, PATTERN.satin);
    // Burner caps, front and back.
    for (const by of [gy0 + (gy1 - gy0) * 0.27, gy0 + (gy1 - gy0) * 0.73]) {
      it.loft([{ z: 36, rx: 1.8, ry: 1.8, cx, cy: by }, { z: 36.5, rx: 1.8, ry: 1.8, cx, cy: by }, { z: 36.6, rx: 0, ry: 0, cx, cy: by }], IRON, PATTERN.satin, 12);
    }
  }
  hood(it, W, D, steel, ctx);
}

/** A range hood: a slim insert under the cabinet over the range, or a chimney hood up to the ceiling. */
function hood(it: ItemFrame, W: number, D: number, steel: RGB, ctx: DetailContext) {
  const back = -D / 2;
  const deep = 20;
  const bottom = 36 + 30;
  if (ctx.cabinetOverRange) {
    it.box(-W / 2, W / 2, back, back + deep, bottom - 5, bottom, steel, PATTERN.metal);
    it.box(-W / 2 + 1, W / 2 - 1, back + 1, back + deep - 1, bottom - 5.1, bottom - 5, IRON, PATTERN.satin);
    return;
  }
  const top = Math.max(bottom + 14, ctx.ceilingIn);
  const cy = back + deep / 2;
  const chimney = { rx: 6, ry: 5 };
  it.box(-W / 2 - 0.5, W / 2 + 0.5, back, back + deep, bottom, bottom + 3, steel, PATTERN.metal);
  it.loft(
    [
      { z: bottom + 3, rx: W / 2 + 0.5, ry: deep / 2, cy, power: 14 },
      { z: bottom + 12, rx: chimney.rx, ry: chimney.ry, cy: back + chimney.ry, power: 14 },
    ],
    steel,
    PATTERN.metal,
    24,
  );
  it.box(-chimney.rx, chimney.rx, back, back + 2 * chimney.ry, bottom + 12, top, steel, PATTERN.metal);
  it.box(-W / 2, W / 2, back + 0.5, back + deep - 0.5, bottom - 0.1, bottom, IRON, PATTERN.satin);
}

/** A French-door fridge: two doors over a freezer drawer, long bar handles. */
function fridge(it: ItemFrame, W: number, D: number, H: number, steel: RGB) {
  const y1 = D / 2 - 2;
  it.box(-W / 2, W / 2, -D / 2, y1, 0, H, steel, PATTERN.metal);
  // Dark behind the doors, so the gaps between them show.
  it.box(-W / 2 + 0.3, W / 2 - 0.3, y1, y1 + 0.5, 3, H - 0.3, IRON, PATTERN.satin);
  const split = H * 0.62;
  const g = 0.2;
  it.box(-W / 2, W / 2, y1, y1 + 2, 3, split - g, steel, PATTERN.metal);
  it.box(-W / 2, -g, y1, y1 + 2, split + g, H, steel, PATTERN.metal);
  it.box(g, W / 2, y1, y1 + 2, split + g, H, steel, PATTERN.metal);
  // A dark grille along the bottom.
  it.box(-W / 2 + 1, W / 2 - 1, y1 - 0.5, y1 + 1.5, 0.25, 3, IRON, PATTERN.satin);
  // Long bars on the doors (posts and a bar standing out), one across the drawer.
  for (const x of [-2, 2]) {
    it.box(x - 0.4, x + 0.4, y1 + 3.2, y1 + 4, split + 6, H - 6, HARDWARE, PATTERN.metal);
    for (const z of [split + 7, H - 7]) it.box(x - 0.3, x + 0.3, y1 + 2, y1 + 3.2, z - 0.4, z + 0.4, HARDWARE, PATTERN.metal);
  }
  handle(it, { x: 0, z: split - 4, pull: true }, y1 + 2, W * 0.6);
}

function dishwasher(it: ItemFrame, W: number, D: number, steel: RGB, top: RGB | null, stone: number) {
  const y1 = D / 2 - 0.25;
  it.box(-W / 2 + 0.25, W / 2 - 0.25, -D / 2, y1 - 0.75, 0, 34.5, shade(steel, 0.6), PATTERN.metal);
  it.box(-W / 2 + 0.25, W / 2 - 0.25, y1 - 0.75, y1, TOE_KICK_IN, 34.25, steel, PATTERN.metal);
  it.box(-W / 2 + 0.5, W / 2 - 0.5, y1 - 2, y1 - 0.75, 0.25, TOE_KICK_IN, IRON, PATTERN.satin);
  handle(it, { x: 0, z: 31, pull: true }, y1, W * 0.7);
  if (top) countertop(it, -W / 2, W / 2, -D / 2, D / 2, 36, top, stone);
}

/** A two-piece toilet: tank with its lid and lever, a bowl on a pedestal, seat and lid down. */
function toilet(it: ItemFrame, W: number, D: number, white: RGB) {
  const back = -D / 2;
  const tankD = Math.min(8.5, D * 0.3);
  const tw = Math.min(W * 0.9, 19);
  const tank: Ring = { z: 15, rx: tw / 2, ry: tankD / 2, cy: back + tankD / 2, power: 6 };
  it.loft([{ ...tank, z: 14.5, rx: tank.rx * 0.9 }, tank, { ...tank, z: 29 }, { ...tank, z: 29, rx: 0, ry: 0 }], white, PATTERN.ceramic, 24);
  const lid: Ring = { z: 29, rx: tw / 2 + 0.4, ry: tankD / 2 + 0.4, cy: back + tankD / 2, power: 6 };
  it.loft([{ ...lid, rx: lid.rx - 0.4 }, lid, { ...lid, z: 30.25 }, { ...lid, z: 30.25, rx: 0, ry: 0 }], white, PATTERN.ceramic, 24);
  it.box(-tw / 2 + 1.5, -tw / 2 + 3.5, back + tankD, back + tankD + 0.6, 25.5, 26.3, HARDWARE, PATTERN.metal);
  // The bowl: narrow at the floor, widening to the rim; the seat and lid ride on top.
  const by = back + tankD + (D - tankD) / 2 - 0.5;
  const rx = Math.min(W / 2 - 1.5, 7.25);
  const ry = Math.min((D - tankD) / 2 - 0.5, 10);
  const ring = (z: number, k: number, kx = k): Ring => ({ z, rx: rx * kx, ry: ry * k, cy: by - (1 - k) * 2 });
  it.loft([ring(0, 0), ring(0, 0.62, 0.62), ring(5, 0.5, 0.5), ring(10, 0.82), ring(14, 0.98), ring(15, 1), ring(15, 0)], white, PATTERN.ceramic, 24);
  it.loft([ring(15.1, 1.01), ring(16.1, 1.01), ring(16.3, 0.97), ring(16.3, 0)], white, PATTERN.ceramic, 24);
  it.box(-1.5, 1.5, back + tankD - 0.5, by - ry + 1, 15, 16.6, white, PATTERN.ceramic);
}

/** An alcove tub: a front apron, a rim round a rounded basin. */
function tub(it: ItemFrame, W: number, D: number, white: RGB) {
  const rim = 3;
  const inner: Ring = { z: 20, rx: W / 2 - rim - 1, ry: D / 2 - rim, cx: 1, power: 5 };
  it.slabWithHole(-W / 2, W / 2, -D / 2, D / 2, 19, 20, ItemFrame.ringPoints(inner, 40), white, PATTERN.ceramic);
  it.openBox(-W / 2, W / 2, -D / 2, D / 2, 0, 19, white, PATTERN.ceramic);
  const r = (z: number, k: number, kx = k): Ring => ({ ...inner, z, rx: inner.rx * kx, ry: inner.ry * k });
  it.loft([r(20, 1), r(10, 0.96, 0.97), r(5.5, 0.88, 0.92), r(4, 0.78, 0.86), r(4, 0)], white, PATTERN.ceramic, 40);
  it.loft([{ z: 4.05, rx: 1.3, ry: 1.3, cx: -W / 2 + rim + 5 }, { z: 4.05, rx: 0, ry: 0, cx: -W / 2 + rim + 5 } ], HARDWARE, PATTERN.metal, 10);
}

/** A shower: a low pan with a curb and drain, and a framed glass front split into a fixed panel and a door. */
function shower(it: ItemFrame, glass: MeshBuilder, f: Frame, fx: Fixture, floorIn: number, tile: RGB) {
  const W = fx.widthIn;
  const D = fx.depthIn;
  const front = D / 2 - 1;
  it.box(-W / 2, W / 2, -D / 2, D / 2, 0, 2, tile, PATTERN.tile);
  it.box(-W / 2, W / 2, front - 2, D / 2, 2, 4, WHITE, PATTERN.ceramic);
  it.loft([{ z: 2.02, rx: 2, ry: 2 }, { z: 2.02, rx: 0, ry: 0 } ], HARDWARE, PATTERN.metal, 12);
  const g = new ItemFrame(glass, f, { x: fx.x, y: fx.y }, fx.rotation ?? 0, floorIn);
  const top = 76;
  const split = W >= 40 ? -W / 2 + W * 0.45 : 0;
  g.box(-W / 2 + 0.75, split - 0.25, front - 0.3, front + 0.3, 4.5, top - 0.75, COLORS.glass, 0);
  g.box(split + 0.25, W / 2 - 0.75, front - 0.3, front + 0.3, 4.5, top - 0.75, COLORS.glass, 0);
  // The frame: a channel round the glass, a post where the door meets the panel, and a long pull.
  const t = 0.75;
  it.box(-W / 2, W / 2, front - 0.6, front + 0.6, top - t, top, HARDWARE, PATTERN.metal);
  it.box(-W / 2, W / 2, front - 0.6, front + 0.6, 4, 4.5, HARDWARE, PATTERN.metal);
  it.box(-W / 2, -W / 2 + t, front - 0.6, front + 0.6, 4, top, HARDWARE, PATTERN.metal);
  it.box(W / 2 - t, W / 2, front - 0.6, front + 0.6, 4, top, HARDWARE, PATTERN.metal);
  it.box(split - 0.3, split + 0.3, front - 0.6, front + 0.6, 4, top, HARDWARE, PATTERN.metal);
  it.box(split + 2, split + 2.6, front + 0.6, front + 2.4, 30, 54, HARDWARE, PATTERN.metal);
}

/** A front-load washer or dryer: a round door with a chrome ring, a control panel with a dial. */
function laundryMachine(it: ItemFrame, W: number, D: number, washer: boolean, white: RGB) {
  const y1 = D / 2 - 1.5;
  it.box(-W / 2, W / 2, -D / 2, y1, 1, 38, white, PATTERN.ceramic);
  it.box(-W / 2 + 1, W / 2 - 1, -D / 2 + 1, y1 - 1, 0, 1, IRON, PATTERN.satin);
  // The control panel along the top, a little proud, with a dial and a dark display.
  it.box(-W / 2, W / 2, y1, y1 + 0.75, 32, 38, shade(white, 0.92), PATTERN.ceramic);
  it.box(-3, 3, y1 + 0.75, y1 + 0.8, 33.5, 36.5, BLACK_GLASS, PATTERN.ceramic);
  const dx = W / 2 - 5;
  it.loft(
    [
      { z: y1 + 0.75, rx: 1.8, ry: 1.8, cx: dx, cy: 35 },
      { z: y1 + 1.9, rx: 1.7, ry: 1.7, cx: dx, cy: 35 },
      { z: y1 + 2, rx: 0, ry: 0, cx: dx, cy: 35 },
    ],
    HARDWARE,
    PATTERN.metal,
    16,
    "y",
  );
  // The door: a chrome ring standing out, a dark window.
  const r = Math.min(W / 2 - 3, 11);
  const cz = 17;
  it.loft(
    [
      { z: y1, rx: r, ry: r, cy: cz },
      { z: y1 + 1.5, rx: r, ry: r, cy: cz },
      { z: y1 + 1.5, rx: r - 2, ry: r - 2, cy: cz },
      { z: y1 + 0.6, rx: r - 2, ry: r - 2, cy: cz },
      { z: y1 + 0.6, rx: 0, ry: 0, cy: cz },
    ],
    HARDWARE,
    PATTERN.metal,
    28,
    "y",
  );
  it.box(-r + 2.5, r - 2.5, y1 + 0.61, y1 + 0.65, cz - r + 2.5, cz + r - 2.5, washer ? hex("#2b3640") : BLACK_GLASS, PATTERN.ceramic);
}

/** A utility sink: a deep tub on four legs. */
function utilitySink(it: ItemFrame, W: number, D: number, white: RGB) {
  const outer: Ring = { z: 34, rx: W / 2, ry: D / 2, power: 6 };
  const inner: Ring = { ...outer, rx: W / 2 - 1.25, ry: D / 2 - 1.25 };
  it.loft([{ ...outer, z: 21, rx: outer.rx - 1, ry: outer.ry - 1 }, outer, inner], white, PATTERN.ceramic, 28);
  basin(it, inner, 12, white, PATTERN.ceramic, 28);
  it.loft([{ ...outer, z: 21, rx: 0, ry: 0 }, { ...outer, z: 21, rx: outer.rx - 1, ry: outer.ry - 1 }], white, PATTERN.ceramic, 28);
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    const x = sx * (W / 2 - 2);
    const y = sy * (D / 2 - 2);
    it.box(x - 0.6, x + 0.6, y - 0.6, y + 0.6, 0, 21, white, PATTERN.ceramic);
  }
}

/** A tank water heater: a tall drum with a domed top, pipes out the top and a control box. */
function waterHeater(it: ItemFrame, W: number, D: number, color: RGB) {
  const r = (Math.min(W, D) / 2) * 0.92;
  const drum = (z: number, k: number): Ring => ({ z, rx: r * k, ry: r * k });
  it.loft([drum(0, 0), drum(0, 0.97), drum(1.5, 1), drum(56, 1), drum(58.5, 0.85), drum(60, 0.5), drum(60.3, 0)], color, PATTERN.satin, 28);
  for (const x of [-r * 0.45, r * 0.45]) {
    const pipe = (z: number, k = 1): Ring => ({ z, rx: 0.5 * k, ry: 0.5 * k, cx: x });
    it.loft([pipe(59), pipe(72), pipe(72, 0)], hex("#b87333"), PATTERN.metal, 10);
  }
  it.box(-2.5, 2.5, r * 0.95, r + 2.5, 9, 14, IRON, PATTERN.satin);
  it.box(r * 0.6, r * 0.6 + 1, r * 0.7, r * 0.7 + 3, 48, 49, HARDWARE, PATTERN.metal);
}

/** A furnace: a tall cabinet with two panels, louvers in the lower one, and a flue pipe. */
function furnace(it: ItemFrame, W: number, D: number, color: RGB) {
  const y1 = D / 2 - 0.5;
  it.box(-W / 2, W / 2, -D / 2, y1, 0, 48, color, PATTERN.satin);
  it.box(-W / 2 + 0.5, W / 2 - 0.5, y1, y1 + 0.5, 22.25, 47.5, color, PATTERN.satin);
  it.box(-W / 2 + 0.5, W / 2 - 0.5, y1, y1 + 0.5, 0.5, 21.75, color, PATTERN.satin);
  for (let i = 0; i < 6; i++) {
    const z = 5 + i * 2.2;
    it.box(-W / 2 + 4, W / 2 - 4, y1 + 0.5, y1 + 0.8, z, z + 0.8, shade(color, 0.6), PATTERN.satin);
  }
  handle(it, { x: 0, z: 44, pull: true }, y1 + 0.5, 4);
  const pipe = (z: number, k = 1): Ring => ({ z, rx: 2.5 * k, ry: 2.5 * k, cx: W / 4 - 2, cy: 0 });
  it.loft([pipe(48), pipe(62), pipe(62, 0)], HARDWARE, PATTERN.metal, 14);
}

