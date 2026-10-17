import type { TextureName } from "./looks";

/**
 * Textures drawn in code, for any surface without a photo in
 * public/textures: wood grain, marble veins, plaster, fabric weave, carpet,
 * granite specks and so on, from noise that wraps so the texture tiles.
 * Returns RGBA bytes (sRGB), `size` by `size`, top row first.
 */

/** A hash for a lattice point, 0 to 1. */
function hash(x: number, y: number, seed: number) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Smooth noise on a grid of `cells` across, wrapping at the edges. */
function noise(u: number, v: number, cells: number, seed: number) {
  const x = u * cells;
  const y = v * cells;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const w = (i: number) => ((i % cells) + cells) % cells;
  const a = hash(w(x0), w(y0), seed);
  const b = hash(w(x0 + 1), w(y0), seed);
  const c = hash(w(x0), w(y0 + 1), seed);
  const d = hash(w(x0 + 1), w(y0 + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Layers of noise, finer and fainter, 0 to 1. */
function fbm(u: number, v: number, cells: number, seed: number, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(u, v, cells << o, seed + o);
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

type Shade = (u: number, v: number) => [number, number, number];

const mix = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const TAU = Math.PI * 2;

const SHADES: Record<TextureName, Shade> = {
  plaster: (u, v) => {
    const n = 0.92 + 0.08 * fbm(u, v, 8, 1, 5);
    return [235 * n, 232 * n, 226 * n];
  },
  "wood-grain": (u, v) => {
    // Long grain along u, wavering, with darker late-wood lines.
    const warp = fbm(u, v, 4, 2) * 3;
    const lines = 0.5 + 0.5 * Math.sin((v * 24 + warp) * TAU);
    const t = Math.pow(lines, 6) * 0.35 + fbm(u, v, 16, 3) * 0.15;
    return mix([196, 150, 102], [120, 80, 48], t);
  },
  "wood-floor": (u, v) => {
    const row = Math.floor(v * 8);
    const board = Math.floor(u * 2 + hash(row, 0, 4) * 2);
    const seam = (v * 8) % 1 < 0.04 || (u * 2 + hash(row, 0, 4) * 2) % 1 < 0.008;
    const tone = 0.85 + 0.25 * hash(row, board, 5);
    const g = SHADES["wood-grain"](u, v * 0.5 + row * 0.13);
    const k = seam ? 0.55 : tone;
    return [g[0] * k, g[1] * k, g[2] * k];
  },
  marble: (u, v) => {
    const w = fbm(u, v, 3, 6, 5);
    const vein = Math.abs(Math.sin((u + v + w * 2.2) * TAU * 2));
    const dark = Math.pow(1 - vein, 14);
    const base = 238 - 12 * fbm(u, v, 6, 7);
    return mix([base, base, base - 3], [120, 118, 116], dark * 0.8);
  },
  granite: (u, v) => {
    const s = hash(Math.floor(u * 400), Math.floor(v * 400), 8);
    const m = fbm(u, v, 12, 9);
    const c = s > 0.82 ? 40 : s < 0.1 ? 235 : 120 + 80 * m;
    return [c, c * 0.98, c * 0.96];
  },
  tile: (u, v) => {
    const f = (x: number) => (x * 4) % 1;
    const grout = Math.min(f(u), 1 - f(u), f(v), 1 - f(v)) < 0.015;
    if (grout) return [180, 178, 172];
    const n = 0.95 + 0.06 * hash(Math.floor(u * 4), Math.floor(v * 4), 10) + 0.03 * fbm(u, v, 16, 11);
    return [228 * n, 225 * n, 218 * n];
  },
  carpet: (u, v) => {
    const n = 0.75 + 0.25 * hash(Math.floor(u * 512), Math.floor(v * 512), 12) * 0.6 + 0.25 * fbm(u, v, 32, 13);
    return [205 * n, 196 * n, 182 * n];
  },
  fabric: (u, v) => {
    const a = 0.5 + 0.5 * Math.sin(u * TAU * 64);
    const b = 0.5 + 0.5 * Math.sin(v * TAU * 64);
    const weave = (Math.floor(u * 64) + Math.floor(v * 64)) % 2 ? a : b;
    const n = 0.82 + 0.12 * weave + 0.08 * fbm(u, v, 16, 14);
    return [200 * n, 196 * n, 188 * n];
  },
  leather: (u, v) => {
    const n = fbm(u, v, 24, 15, 3);
    const crease = Math.pow(Math.abs(n - 0.5) * 2, 0.3);
    const c = 0.8 + 0.2 * crease;
    return [150 * c, 100 * c, 70 * c];
  },
  concrete: (u, v) => {
    const n = 0.85 + 0.15 * fbm(u, v, 6, 16, 5);
    const pit = hash(Math.floor(u * 300), Math.floor(v * 300), 17) > 0.985 ? 0.7 : 1;
    const c = 178 * n * pit;
    return [c, c * 0.99, c * 0.96];
  },
  stucco: (u, v) => {
    const n = 0.85 + 0.15 * fbm(u, v, 32, 18, 3);
    return [226 * n, 220 * n, 208 * n];
  },
  brick: (u, v) => {
    const rows = 12;
    const row = Math.floor(v * rows);
    const x = u * 4 + (row % 2) * 0.5;
    const mortar = (v * rows) % 1 < 0.14 || x % 1 < 0.04;
    if (mortar) return [170, 166, 158];
    const t = 0.8 + 0.3 * hash(Math.floor(x), row, 19) + 0.1 * fbm(u, v, 32, 20);
    return [150 * t, 70 * t, 52 * t];
  },
  stone: (u, v) => {
    const n = fbm(u, v, 6, 21, 5);
    const c = 120 + 90 * n;
    return [c, c * 0.96, c * 0.9];
  },
  shingles: (u, v) => {
    const rows = 10;
    const row = Math.floor(v * rows);
    const x = u * 3 + hash(row, 0, 22);
    const line = (v * rows) % 1 < 0.08 || x % 1 < 0.02;
    const t = (line ? 0.6 : 0.85 + 0.25 * hash(Math.floor(x), row, 23)) * (0.9 + 0.2 * hash(Math.floor(u * 256), Math.floor(v * 256), 24));
    return [90 * t, 92 * t, 96 * t];
  },
  grass: (u, v) => {
    const n = fbm(u, v, 16, 25, 5);
    const blade = hash(Math.floor(u * 256), Math.floor(v * 256), 26);
    const t = 0.6 + 0.5 * n + 0.2 * blade;
    return [70 * t, 120 * t, 50 * t];
  },
  mulch: (u, v) => {
    const t = 0.5 + 0.6 * fbm(u, v, 48, 27, 3);
    return [110 * t, 72 * t, 46 * t];
  },
  rug: (u, v) => {
    // Diamonds in two colors with a border-like band, and a woven fuzz.
    const d = Math.abs(((u * 4) % 1) - 0.5) + Math.abs(((v * 4) % 1) - 0.5);
    const n = 0.88 + 0.12 * hash(Math.floor(u * 512), Math.floor(v * 512), 29);
    const c: [number, number, number] = d < 0.25 ? [60, 80, 130] : d < 0.32 ? [200, 170, 120] : [225, 215, 195];
    return [c[0] * n, c[1] * n, c[2] * n];
  },
  "metal-seam": (u, v) => {
    const f = (u * 6) % 1;
    const shade = f < 0.03 ? 1.25 : f < 0.06 ? 0.75 : 1;
    const n = 0.96 + 0.04 * fbm(u, v, 8, 30);
    return [180 * shade * n, 184 * shade * n, 186 * shade * n];
  },
  siding: (u, v) => {
    const f = (v * 8) % 1;
    const shade = f < 0.12 ? 0.7 + 2.5 * f : 1;
    const g = 0.94 + 0.06 * fbm(u * 0.2, v, 8, 28);
    return [232 * shade * g, 228 * shade * g, 220 * shade * g];
  },
};

export function drawTexture(name: TextureName, size: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  const shade = SHADES[name];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const c = shade(x / size, y / size);
      const i = (y * size + x) * 4;
      out[i] = clamp01(c[0] / 255) * 255;
      out[i + 1] = clamp01(c[1] / 255) * 255;
      out[i + 2] = clamp01(c[2] / 255) * 255;
      out[i + 3] = 255;
    }
  return out;
}

/** The average color of RGBA sRGB bytes, in linear light (what the shader divides by, so the picked color shows through). */
export function averageLinear(rgba: Uint8ClampedArray | Uint8Array): [number, number, number] {
  const sum = [0, 0, 0];
  let n = 0;
  // Every 7th pixel is plenty for an average.
  for (let i = 0; i < rgba.length; i += 28) {
    for (let c = 0; c < 3; c++) sum[c] += Math.pow(rgba[i + c] / 255, 2.2);
    n++;
  }
  return [sum[0] / n, sum[1] / n, sum[2] / n];
}
