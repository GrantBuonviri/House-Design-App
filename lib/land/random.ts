/** Small seeded random helpers. The same seed always gives the same sequence. */

export type Rng = {
  /** Uniform number in [0, 1). */
  next: () => number;
  range: (min: number, max: number) => number;
  int: (min: number, maxInclusive: number) => number;
  chance: (p: number) => boolean;
  pick: <T>(items: readonly T[]) => T;
  /** Pick using relative weights. */
  weighted: <T>(items: readonly (readonly [T, number])[]) => T;
};

/** mulberry32: fast, good-enough 32-bit generator. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)],
    weighted: (items) => {
      const total = items.reduce((s, [, w]) => s + w, 0);
      let r = next() * total;
      for (const [item, w] of items) {
        r -= w;
        if (r < 0) return item;
      }
      return items[items.length - 1][0];
    },
  };
  return rng;
}

/** Mix two integers into a new 32-bit seed (used to derive feed seeds). */
export function hashSeeds(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x45d9f3b);
  h ^= h >>> 13;
  return h >>> 0;
}

/**
 * Seeded 2D value noise with smooth interpolation, returning roughly [-1, 1].
 * Good enough for gentle rolling ground.
 */
export function createNoise2D(seed: number): (x: number, y: number) => number {
  const rng = createRng(seed);
  const size = 256;
  const values = new Float32Array(size);
  const perm = new Uint8Array(size * 2);
  for (let i = 0; i < size; i++) {
    values[i] = rng.next() * 2 - 1;
    perm[i] = i;
  }
  for (let i = size - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < size; i++) perm[size + i] = perm[i];

  const lattice = (ix: number, iy: number) => values[perm[(ix & 255) + perm[iy & 255]]];
  const fade = (t: number) => t * t * (3 - 2 * t);

  return (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = fade(x - ix);
    const fy = fade(y - iy);
    const a = lattice(ix, iy);
    const b = lattice(ix + 1, iy);
    const c = lattice(ix, iy + 1);
    const d = lattice(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}
