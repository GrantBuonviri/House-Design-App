import type { AddOn, FurnitureItem } from "@/lib/model/schema";
import { ItemFrame, lightness, shade, type Ring } from "./detail";
import { PATTERN } from "./finishes";
import { hex, type Frame, type MeshBuilder, type RGB } from "./mesh";

/**
 * Decor in detail, for Pretty graphics: table and floor lamps, pendants,
 * wall art, throw pillows, curtains and blinds, plants and patterned rugs.
 * Like furniture3d.ts, each is drawn inside its saved size in its own frame
 * (back toward -y). Lamp shades go into a separate `glow` builder: the
 * walkthrough lights them up in the evening and at night.
 */

const LINEN = hex("#efe7d8");
const BRASS = hex("#b08d57");
const BRONZE = hex("#3b3430");
const SOIL = hex("#3b2b1e");
const SNAKE = hex("#55703f");
const OLIVE = hex("#7d8a5c");
const TRUNK = hex("#6b5a46");
const POT_WHITE = hex("#ece8e1");
const TERRACOTTA = hex("#b3704f");
const MAT = hex("#f6f4ef");
const ART = ["#1f3b4d", "#c8a26b", "#a14b3a", "#e9e2d3", "#4e6b5a", "#2b2b2b", "#d9b8a0", "#7d8fa3"].map(hex);

/** Kinds drawn here. */
export const DETAILED_DECOR = new Set(["table-lamp", "pendant", "wall-art", "throw-pillows", "curtains", "blinds"]);

/** A small repeatable random number from a string and a counter. */
function rand(seed: string, i: number): number {
  let h = 2166136261 ^ i;
  for (let k = 0; k < seed.length; k++) h = Math.imul(h ^ seed.charCodeAt(k), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

/** A round post from z0 to z1 (radius r0 at the bottom, r1 at the top). */
function post(it: ItemFrame, x: number, y: number, z0: number, z1: number, r0: number, r1: number, color: RGB, pattern: number, segments = 8) {
  it.loft(
    [
      { z: z0, rx: 0, ry: 0, cx: x, cy: y },
      { z: z0, rx: r0, ry: r0, cx: x, cy: y },
      { z: z1, rx: r1, ry: r1, cx: x, cy: y },
      { z: z1, rx: 0, ry: 0, cx: x, cy: y },
    ],
    color,
    pattern,
    segments,
  );
}

/** A turned shape from a list of (height, radius) points, closed top and bottom. */
function turned(it: ItemFrame, profile: [number, number][], color: RGB, pattern: number, segments = 16, x = 0, y = 0) {
  const rings: Ring[] = [{ z: profile[0][0], rx: 0, ry: 0, cx: x, cy: y }, ...profile.map(([z, r]) => ({ z, rx: r, ry: r, cx: x, cy: y })), { z: profile[profile.length - 1][0], rx: 0, ry: 0, cx: x, cy: y }];
  it.loft(rings, color, pattern, segments);
}

/** A lamp shade: an open drum from z0 (radius r0) to z1 (r1), seen from inside and out (the glow material draws both faces). */
function lampShade(it: ItemFrame, z0: number, z1: number, r0: number, r1: number, color: RGB, segments = 20) {
  it.loft(
    [
      { z: z0, rx: r0, ry: r0 },
      { z: z1, rx: r1, ry: r1 },
    ],
    color,
    PATTERN.fabric,
    segments,
  );
}

/** A small bulb inside a shade, so the light has a source when you look up into it. */
function bulb(it: ItemFrame, z: number, r: number) {
  turned(it, [[z - r, 0.2], [z - r * 0.6, r * 0.8], [z, r], [z + r * 0.6, r * 0.8], [z + r, 0.2]], hex("#fff6e0"), PATTERN.satin, 10);
}

/** A table lamp: a turned ceramic base on a brass neck, a linen drum shade (in `glow`). */
function tableLamp(it: ItemFrame, glow: ItemFrame, W: number, H: number, color: RGB) {
  const r = Math.min(W, 14) / 2;
  const baseTop = H * 0.52;
  turned(it, [[0, r * 0.45], [0.8, r * 0.5], [baseTop * 0.25, r * 0.62], [baseTop * 0.6, r * 0.55], [baseTop * 0.9, r * 0.28], [baseTop, r * 0.22]], color, PATTERN.ceramic, 18);
  post(it, 0, 0, baseTop, H * 0.72, 0.35, 0.35, BRASS, PATTERN.metal, 8);
  lampShade(glow, H * 0.55, H, r * 0.98, r * 0.72, LINEN);
  bulb(glow, H * 0.72, Math.min(1.4, r * 0.2));
}

/** A floor lamp: a weighted base, a turned post, a big drum shade (in `glow`). */
export function floorLamp(it: ItemFrame, glow: ItemFrame, W: number, D: number, color: RGB, pattern: number) {
  const r = Math.min(W, D) / 2;
  turned(it, [[0, r * 0.62], [0.6, r * 0.62], [1.4, r * 0.5], [2.2, r * 0.18]], BRONZE, PATTERN.metal, 18);
  // A turned post: thicker rings at the bottom and halfway up.
  turned(it, [[2.2, 0.75], [6, 0.9], [8, 1.2], [9.5, 0.7], [27, 0.6], [28.5, 1], [30, 0.6], [50, 0.5]], color, pattern, 10);
  post(it, 0, 0, 50, 56, 0.3, 0.3, BRASS, PATTERN.metal, 6);
  lampShade(glow, 47, 62, r * 0.95, r * 0.74, LINEN, 24);
  bulb(glow, 54, 1.4);
}

/** A pendant light: a ceiling canopy, a thin cord, a dome shade (in `glow`) at the bottom of its drop. */
function pendant(it: ItemFrame, glow: ItemFrame, W: number, H: number, color: RGB) {
  const r = W / 2;
  turned(it, [[H - 1, 2.5], [H, 2.5]], color, PATTERN.metal, 14);
  post(it, 0, 0, 9, H - 1, 0.15, 0.15, BRONZE, PATTERN.satin, 5);
  // The dome: metal outside, its lining glows.
  it.loft(
    [
      { z: 0, rx: r, ry: r },
      { z: 0.3, rx: r * 1.01, ry: r * 1.01 },
      { z: 4, rx: r * 0.86, ry: r * 0.86 },
      { z: 7.5, rx: r * 0.45, ry: r * 0.45 },
      { z: 9, rx: 1.2, ry: 1.2 },
      { z: 9.5, rx: 0, ry: 0 },
    ],
    color,
    PATTERN.metal,
    24,
  );
  lampShade(glow, 0.2, 4.1, r * 0.97, r * 0.83, LINEN, 24);
  bulb(glow, 3, 1.6);
}

/** Wall art: a thin frame, a white mat, and a print of a few soft color blocks (picked from the item's id). */
function wallArt(it: ItemFrame, W: number, D: number, H: number, frame: RGB, seed: string) {
  const y0 = -D / 2;
  const y1 = D / 2;
  const t = Math.min(1.25, W * 0.05, H * 0.05);
  it.box(-W / 2, W / 2, y0, y1, 0, t, frame, PATTERN.wood);
  it.box(-W / 2, W / 2, y0, y1, H - t, H, frame, PATTERN.wood);
  it.box(-W / 2, -W / 2 + t, y0, y1, t, H - t, frame, PATTERN.wood);
  it.box(W / 2 - t, W / 2, y0, y1, t, H - t, frame, PATTERN.wood);
  it.box(-W / 2 + t, W / 2 - t, y0, y0 + D * 0.5, t, H - t, MAT, PATTERN.paint);
  // The print, inside the mat.
  const m = Math.min(W, H) * 0.12;
  const x0 = -W / 2 + t + m;
  const x1 = W / 2 - t - m;
  const z0 = t + m;
  const z1 = H - t - m;
  const front = y0 + D * 0.5;
  const base = ART[Math.floor(rand(seed, 0) * ART.length)];
  it.box(x0, x1, front, front + 0.05, z0, z1, base, PATTERN.satin);
  const blocks = 3 + Math.floor(rand(seed, 1) * 3);
  for (let i = 0; i < blocks; i++) {
    const w = (x1 - x0) * (0.2 + rand(seed, i * 7 + 2) * 0.45);
    const h = (z1 - z0) * (0.15 + rand(seed, i * 7 + 3) * 0.4);
    const a = x0 + rand(seed, i * 7 + 4) * (x1 - x0 - w);
    const b = z0 + rand(seed, i * 7 + 5) * (z1 - z0 - h);
    const c = ART[Math.floor(rand(seed, i * 7 + 6) * ART.length)];
    it.box(a, a + w, front + 0.05, front + 0.08 + i * 0.01, b, b + h, c === base ? shade(c, 1.4) : c, PATTERN.satin);
  }
}

/** A soft square pillow standing up, x0..x1 wide, its back at y0. */
function pillow(it: ItemFrame, x0: number, x1: number, y0: number, z1: number, color: RGB) {
  const w = x1 - x0;
  const t = Math.min(5, w * 0.3);
  const rings: Ring[] = [0, 0.15, 0.5, 0.85, 1].map((k) => {
    const bulge = Math.sin(Math.PI * k);
    return { z: z1 - w + w * k, rx: (w / 2) * (0.8 + 0.2 * bulge), ry: (t / 2) * (0.35 + 0.65 * bulge), cx: (x0 + x1) / 2, cy: y0 + t / 2, power: 3 };
  });
  it.loft([{ ...rings[0], rx: 0, ry: 0 }, ...rings, { ...rings[rings.length - 1], rx: 0, ry: 0 }], color, PATTERN.fabric, 14);
}

/** Throw pillows along the item's width: square ones, the outer two in its color, an accent between. */
function throwPillows(it: ItemFrame, W: number, D: number, H: number, color: RGB) {
  const n = Math.max(1, Math.round(W / 20));
  const size = Math.min(H, (W / n) * 0.95);
  const accent = shade(color, lightness(color) > 0.45 ? 0.6 : 1.7);
  for (let i = 0; i < n; i++) {
    const cx = -W / 2 + (W / n) * (i + 0.5);
    const outer = i === 0 || i === n - 1;
    pillow(it, cx - size / 2, cx + size / 2, -D / 2, size, outer ? color : accent);
  }
}

/** Curtains: a rod with finials above the window, and a gathered panel pulled open at each side (folds as soft tubes). */
function curtains(it: ItemFrame, W: number, D: number, H: number, color: RGB) {
  const rodZ = H - 1;
  const y = -D / 2 + 1.2;
  it.box(-W / 2 - 2, W / 2 + 2, y - 0.4, y + 0.4, rodZ - 0.4, rodZ + 0.4, BRONZE, PATTERN.metal);
  for (const s of [-1, 1]) {
    post(it, s * (W / 2 + 2.6), y, rodZ - 1, rodZ + 1, 1, 1, BRONZE, PATTERN.metal, 10);
    // Brackets back to the wall.
    it.box(s * (W / 2 - 1) - 0.3, s * (W / 2 - 1) + 0.3, -D / 2, y, rodZ - 0.5, rodZ + 0.5, BRONZE, PATTERN.metal);
  }
  // Each panel covers its side's overhang and a little of the glass.
  const panel = Math.min(W / 2 - 4, 18);
  const fold = 3;
  const n = Math.max(3, Math.round(panel / fold));
  for (const s of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const x = s * (W / 2 - 1.5 - i * (panel / n));
      const r = 1.6 + (i % 2) * 0.35;
      const c = i % 2 ? shade(color, 0.93) : color;
      it.loft(
        [
          { z: 0, rx: 0, ry: 0, cx: x, cy: y + 1 },
          { z: 0, rx: r * 1.1, ry: r * 1.1, cx: x, cy: y + 1 },
          { z: rodZ - 3, rx: r * 0.85, ry: r * 0.85, cx: x, cy: y + 0.6 },
          { z: rodZ - 0.8, rx: r * 0.7, ry: r * 0.6, cx: x, cy: y },
          { z: rodZ - 0.8, rx: 0, ry: 0, cx: x, cy: y },
        ],
        c,
        PATTERN.fabric,
        8,
      );
    }
  }
}

/** Blinds raised partway: a headrail, slats down the top part of the window, a bottom rail. */
function blinds(it: ItemFrame, W: number, D: number, H: number, color: RGB) {
  const y0 = -D / 2;
  const y1 = D / 2;
  it.box(-W / 2, W / 2, y0, y1, H - 2, H, color, PATTERN.paint);
  const down = H * 0.42;
  const gap = 1.25;
  for (let z = H - 2 - gap; z > H - 2 - down; z -= gap) it.box(-W / 2 + 0.4, W / 2 - 0.4, y0 + 0.3, y1 - 0.3, z - 0.12, z, color, PATTERN.paint);
  it.box(-W / 2 + 0.2, W / 2 - 0.2, y0 + 0.2, y1 - 0.2, H - 2 - down - 0.8, H - 2 - down, color, PATTERN.paint);
  for (const x of [-W / 4, W / 4]) it.box(x - 0.08, x + 0.08, y1 - 0.4, y1 - 0.25, H - 2 - down, H - 2, shade(color, 0.85), PATTERN.satin);
}

/**
 * A decor add-on in detail (in `mb`, lamp shades in `glow`). Returns false
 * for kinds not drawn here.
 */
export function drawDecorDetail(mb: MeshBuilder, glow: MeshBuilder, f: Frame, a: AddOn, floorIn: number, color: RGB): boolean {
  if (!DETAILED_DECOR.has(a.kind)) return false;
  const base = floorIn + a.bottomIn;
  const it = new ItemFrame(mb, f, { x: a.x, y: a.y }, a.rotation ?? 0, base);
  const lit = new ItemFrame(glow, f, { x: a.x, y: a.y }, a.rotation ?? 0, base);
  const W = a.widthIn;
  const D = a.depthIn;
  const H = a.heightIn;
  switch (a.kind) {
    case "table-lamp":
      tableLamp(it, lit, W, H, color);
      break;
    case "pendant":
      pendant(it, lit, W, H, color);
      break;
    case "wall-art":
      wallArt(it, W, D, H, color, a.id);
      break;
    case "throw-pillows":
      throwPillows(it, W, D, H, color);
      break;
    case "curtains":
      curtains(it, W, D, H, color);
      break;
    case "blinds":
      blinds(it, W, D, H, color);
      break;
  }
  mb.pattern = 0;
  glow.pattern = 0;
  return true;
}

/** A pot (white glazed or terracotta) with soil, r wide at the rim, h tall. */
function pot(it: ItemFrame, r: number, h: number, color: RGB) {
  it.loft(
    [
      { z: 0, rx: 0, ry: 0 },
      { z: 0, rx: r * 0.72, ry: r * 0.72 },
      { z: h * 0.85, rx: r * 0.95, ry: r * 0.95 },
      { z: h * 0.86, rx: r, ry: r },
      { z: h, rx: r, ry: r },
      { z: h, rx: r * 0.9, ry: r * 0.9 },
      { z: h - 1.5, rx: r * 0.88, ry: r * 0.88 },
      { z: h - 1.5, rx: 0, ry: 0 },
    ],
    color,
    PATTERN.ceramic,
    18,
  );
  it.box(-r * 0.62, r * 0.62, -r * 0.62, r * 0.62, h - 1.6, h - 1.2, SOIL, PATTERN.satin);
}

/** One long flat leaf from its base up and out along `angle`, leaning `lean` (0 straight up). */
function bladeLeaf(it: ItemFrame, x: number, y: number, z: number, length: number, width: number, angle: number, lean: number, color: RGB) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const pts = 5;
  const at = (k: number) => {
    const t = k / pts;
    const out = Math.sin(lean) * length * t * t;
    return it.scene(x + dx * out, y + dy * out, z + Math.cos(lean) * length * t);
  };
  // Across the leaf: sideways to its lean.
  const sx = -dy;
  const sy = dx;
  for (let k = 0; k < pts; k++) {
    const w0 = width * Math.sin((Math.PI * (k + 0.3)) / (pts + 0.6)) * 0.5;
    const w1 = width * Math.sin((Math.PI * (k + 1.3)) / (pts + 0.6)) * 0.5;
    const a = at(k);
    const b = at(k + 1);
    const off = (p: number[], w: number, s: number): [number, number, number] => {
      const q = it.at(0, 0);
      const r = it.at(sx * w * s, sy * w * s);
      return [p[0] + (r.x - q.x) / 12, p[1], p[2] + (r.y - q.y) / 12];
    };
    const a0 = off(a, w0, -1);
    const a1 = off(a, w0, 1);
    const b0 = off(b, w1, -1);
    const b1 = off(b, w1, 1);
    const c = shade(color, 0.85 + 0.25 * (k / pts));
    it.mb.pattern = PATTERN.satin;
    it.mb.tri(a0, a1, b1, c);
    it.mb.tri(a0, b1, b0, c);
    it.mb.tri(a0, b1, a1, c);
    it.mb.tri(a0, b0, b1, c);
  }
}

/** A soft ball of leaves. */
function foliage(it: ItemFrame, x: number, y: number, z: number, r: number, color: RGB) {
  const rings: Ring[] = [0, 0.2, 0.42, 0.62, 0.8, 0.94, 1].map((k) => {
    const a = Math.PI * k;
    return { z: z - Math.cos(a) * r * 0.8, rx: Math.sin(a) * r, ry: Math.sin(a) * r * 0.9, cx: x, cy: y };
  });
  it.loft(rings, color, PATTERN.satin, 9);
}

/** A snake plant: upright blade leaves in a white pot. */
function snakePlant(it: ItemFrame, W: number, D: number, seed: string) {
  const r = Math.min(W, D) * 0.4;
  pot(it, r, 11, POT_WHITE);
  for (let i = 0; i < 9; i++) {
    const a = rand(seed, i) * Math.PI * 2;
    const out = rand(seed, i + 20) * r * 0.45;
    const len = 18 + rand(seed, i + 40) * 10;
    bladeLeaf(it, Math.cos(a) * out, Math.sin(a) * out, 10.5, len, 2.4 + rand(seed, i + 60), a, 0.08 + rand(seed, i + 80) * 0.18, shade(SNAKE, 0.85 + rand(seed, i + 90) * 0.3));
  }
}

/** An olive tree: a terracotta pot, a crooked trunk, a loose crown of small gray-green leaf clusters. */
function oliveTree(it: ItemFrame, W: number, D: number, seed: string) {
  const r = Math.min(W, D) * 0.3;
  pot(it, r, 16, TERRACOTTA);
  post(it, 0, 0, 15, 30, 1.3, 1, TRUNK, PATTERN.wood, 7);
  post(it, 0.8, 0.3, 29, 46, 1, 0.6, TRUNK, PATTERN.wood, 6);
  post(it, -0.6, 0.4, 38, 50, 0.7, 0.4, TRUNK, PATTERN.wood, 6);
  const half = Math.min(W, D) / 2;
  // Many small, loose clusters: olive leaves are fine and airy.
  for (let i = 0; i < 22; i++) {
    const a = rand(seed, i) * Math.PI * 2;
    const s = 2.6 + rand(seed, i + 30) * 2.4;
    const out = Math.sqrt(rand(seed, i + 9)) * (half - s);
    foliage(it, Math.cos(a) * out, Math.sin(a) * out, 46 + rand(seed, i + 20) * 26, s, shade(OLIVE, 0.75 + rand(seed, i + 40) * 0.5));
  }
}

/** A patterned rug: a dark border with a thin inner line, a field with a lattice of small diamonds and a center medallion. */
export function patternedRug(it: ItemFrame, W: number, D: number, main: RGB, seed: string) {
  const z1 = 0.5;
  const b = Math.min(W, D) * 0.07;
  const light = lightness(main) > 0.4;
  const edge = shade(main, light ? 0.55 : 1.8);
  const motif = shade(main, light ? 0.75 : 1.45);
  it.box(-W / 2 + b, W / 2 - b, -D / 2 + b, D / 2 - b, 0, z1, main, PATTERN.rug);
  it.box(-W / 2, W / 2, -D / 2, -D / 2 + b, 0, z1, edge, PATTERN.rug);
  it.box(-W / 2, W / 2, D / 2 - b, D / 2, 0, z1, edge, PATTERN.rug);
  it.box(-W / 2, -W / 2 + b, -D / 2 + b, D / 2 - b, 0, z1, edge, PATTERN.rug);
  it.box(W / 2 - b, W / 2, -D / 2 + b, D / 2 - b, 0, z1, edge, PATTERN.rug);
  // A thin line inside the border.
  const l = b * 1.35;
  const t = Math.max(0.6, b * 0.12);
  const top = z1 + 0.04;
  it.box(-W / 2 + l, W / 2 - l, -D / 2 + l, -D / 2 + l + t, z1, top, edge, PATTERN.rug);
  it.box(-W / 2 + l, W / 2 - l, D / 2 - l - t, D / 2 - l, z1, top, edge, PATTERN.rug);
  it.box(-W / 2 + l, -W / 2 + l + t, -D / 2 + l, D / 2 - l, z1, top, edge, PATTERN.rug);
  it.box(W / 2 - l - t, W / 2 - l, -D / 2 + l, D / 2 - l, z1, top, edge, PATTERN.rug);
  // The lattice: small diamonds on a grid about a foot apart, left clear round the medallion.
  const fx = W / 2 - l - 6;
  const fy = D / 2 - l - 6;
  const nx = Math.max(1, Math.round((fx * 2) / 14));
  const ny = Math.max(1, Math.round((fy * 2) / 14));
  const med = Math.min(W, D) * 0.18;
  const long = W >= D * 2;
  const s = 2.6;
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= ny; j++) {
      const x = -fx + (i * fx * 2) / nx;
      const y = -fy + (j * fy * 2) / ny;
      if (!long && Math.hypot(x / (med * 1.6), y / (med * 1.3)) < 1) continue;
      const d = new ItemFrame(it.mb, it.f, it.at(x, y), it.rotation + 45, it.floorIn);
      d.box(-s / 2, s / 2, -s / 2, s / 2, z1, top, motif, PATTERN.rug);
    }
  }
  if (!long) {
    // The medallion: a diamond in a ring.
    it.loft(
      [
        { z: z1, rx: 0, ry: 0, power: 2 },
        { z: z1, rx: med * 1.25, ry: med, power: 2 },
        { z: top, rx: med * 1.25, ry: med, power: 2 },
        { z: top, rx: 0, ry: 0, power: 2 },
      ],
      motif,
      PATTERN.rug,
      28,
    );
    const c = new ItemFrame(it.mb, it.f, it.at(0, 0), it.rotation + 45, it.floorIn);
    c.box(-med * 0.45, med * 0.45, -med * 0.45, med * 0.45, top, top + 0.03, edge, PATTERN.rug);
  }
  void seed;
}

/** Decor furniture kinds drawn here (plants, the floor lamp, rugs). */
export const DECOR_FURNITURE = new Set(["floor-lamp", "plant-snake", "plant-tree", "rug-large", "rug-small", "rug-runner"]);

/** A decor piece of furniture in detail (the floor lamp's shade in `glow`). Returns false for other kinds. */
export function drawDecorFurniture(mb: MeshBuilder, glow: MeshBuilder, f: Frame, item: FurnitureItem, floorIn: number, wood: { color: RGB; pattern: number }): boolean {
  if (!DECOR_FURNITURE.has(item.kind)) return false;
  const it = new ItemFrame(mb, f, { x: item.x, y: item.y }, item.rotation ?? 0, floorIn);
  const W = item.widthIn;
  const D = item.depthIn;
  const main = hex(item.color ?? "#cfcac0");
  switch (item.kind) {
    case "floor-lamp":
      floorLamp(it, new ItemFrame(glow, f, { x: item.x, y: item.y }, item.rotation ?? 0, floorIn), W, D, wood.color, wood.pattern);
      break;
    case "plant-snake":
      snakePlant(it, W, D, item.id);
      break;
    case "plant-tree":
      oliveTree(it, W, D, item.id);
      break;
    default:
      patternedRug(it, W, D, main, item.id);
  }
  mb.pattern = 0;
  glow.pattern = 0;
  return true;
}
