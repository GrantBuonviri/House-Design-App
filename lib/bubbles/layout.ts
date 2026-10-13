import type { Point } from "@/lib/model/schema";
import { createRng } from "@/lib/land/random";
import { radiusToward } from "./shapes";

/**
 * A small, deterministic force layout for bubbles. Each bubble is pulled
 * toward its anchor (where it wants to be), connected rooms are pulled
 * together until they touch, rooms to keep apart are pushed away, and
 * overlapping bubbles are separated. The same input always gives the same
 * drawing.
 */

export type LayoutNode = {
  id: string;
  rx: number;
  ry: number;
  rotation: number;
  /** Where the bubble would like to be. */
  anchor: Point;
  /** How strongly it's pulled there. 1 is normal. */
  anchorWeight: number;
  /** Where it starts. Defaults to the anchor plus a little jitter. */
  start?: Point;
  /** Pinned bubbles never move; the others make room around them. */
  pinned?: boolean;
};

export type LayoutLink = { a: string; b: string; strength: "must" | "nice" | "avoid" };

export type LayoutOptions = {
  iterations?: number;
  seed?: number;
  /** How much bubbles may overlap where they touch, as a share of their size. */
  overlap?: number;
};

const ANCHOR_PULL = 0.04;
const MUST_PULL = 0.12;
const NICE_PULL = 0.04;
const AVOID_PUSH = 0.06;

type Body = LayoutNode & { p: Point };

function gap(a: Body, b: Body): { d: number; ux: number; uy: number; reach: number } {
  let dx = b.p.x - a.p.x;
  let dy = b.p.y - a.p.y;
  let d = Math.hypot(dx, dy);
  if (d < 1e-6) {
    // Same spot: push apart along a fixed direction so results stay deterministic.
    dx = 1;
    dy = 0.3;
    d = 1e-6;
  }
  const ux = dx / Math.hypot(dx, dy);
  const uy = dy / Math.hypot(dx, dy);
  const reach = radiusToward(a, ux, uy) + radiusToward(b, -ux, -uy);
  return { d, ux, uy, reach };
}

/** How much of a shared push each bubble takes: all of it when the other is pinned. */
function shares(a: Body, b: Body): [number, number] {
  if (a.pinned) return [0, 1];
  if (b.pinned) return [1, 0];
  return [0.5, 0.5];
}

function move(body: Body, dx: number, dy: number) {
  if (body.pinned) return;
  body.p = { x: body.p.x + dx, y: body.p.y + dy };
}

/**
 * Push overlapping bubbles apart until none overlap by more than `overlap`.
 * A `strength` below 1 only pushes part of the way.
 */
function separate(bodies: Body[], overlap: number, strength = 1) {
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i];
      const b = bodies[j];
      if (a.pinned && b.pinned) continue;
      const { d, ux, uy, reach } = gap(a, b);
      const min = reach * (1 - overlap);
      if (d >= min) continue;
      const push = (min - d) * strength;
      const [wa, wb] = shares(a, b);
      move(a, -ux * push * wa, -uy * push * wa);
      move(b, ux * push * wb, uy * push * wb);
    }
  }
}

export function layout(nodes: LayoutNode[], links: LayoutLink[], opts: LayoutOptions = {}): Map<string, Point> {
  const iterations = opts.iterations ?? 360;
  const overlap = opts.overlap ?? 0.06;
  const rng = createRng(opts.seed ?? 7);
  const bodies: Body[] = nodes.map((n) => {
    const r = Math.min(n.rx, n.ry);
    const start = n.start ?? { x: n.anchor.x + rng.range(-0.5, 0.5) * r, y: n.anchor.y + rng.range(-0.5, 0.5) * r };
    return { ...n, p: { ...start } };
  });
  const byId = new Map(bodies.map((b) => [b.id, b]));
  const pairs = links
    .map((l) => ({ a: byId.get(l.a), b: byId.get(l.b), strength: l.strength }))
    .filter((l): l is { a: Body; b: Body; strength: LayoutLink["strength"] } => Boolean(l.a && l.b && l.a !== l.b));

  for (let t = 0; t < iterations; t++) {
    // Forces cool down over time so the drawing settles.
    const heat = 1 - (t / iterations) * 0.85;
    for (const b of bodies) {
      move(b, (b.anchor.x - b.p.x) * ANCHOR_PULL * b.anchorWeight * heat, (b.anchor.y - b.p.y) * ANCHOR_PULL * b.anchorWeight * heat);
    }
    for (const { a, b, strength } of pairs) {
      const { d, ux, uy, reach } = gap(a, b);
      let f = 0;
      if (strength === "must" && d > reach) f = (d - reach) * MUST_PULL;
      else if (strength === "nice" && d > reach * 1.25) f = (d - reach * 1.25) * NICE_PULL;
      else if (strength === "avoid" && d < reach * 2.2) f = -(reach * 2.2 - d) * AVOID_PUSH;
      if (f === 0) continue;
      f *= heat;
      const [wa, wb] = shares(a, b);
      move(a, ux * f * wa, uy * f * wa);
      move(b, -ux * f * wb, -uy * f * wb);
    }
    separate(bodies, overlap);
  }
  // A few more passes with no other forces, so nothing is left overlapping.
  for (let t = 0; t < 40; t++) separate(bodies, overlap);
  attachMustPairs(bodies, pairs, overlap);

  return new Map(bodies.map((b) => [b.id, { x: Math.round(b.p.x), y: Math.round(b.p.y) }]));
}

/** Whether two bubbles touch, give or take a little. */
function touching(a: Body, b: Body): boolean {
  const { d, reach } = gap(a, b);
  return d <= reach * 1.1;
}

/**
 * Rooms that must connect should touch. When other bubbles ended up between
 * them, move one of the pair against the other (the one with fewer rooms of
 * its own to stay next to goes first): into a free place if there is one,
 * or else push the rest aside. A move is kept only when it leaves more
 * pairs touching and nothing overlapping.
 */
function attachMustPairs(bodies: Body[], pairs: { a: Body; b: Body; strength: LayoutLink["strength"] }[], overlap: number) {
  const must = pairs.filter((p) => p.strength === "must");
  if (must.length === 0) return;
  const partners = (body: Body) => must.filter((p) => p.a === body || p.b === body).length;
  for (let round = 0; round < 3; round++) {
    let changed = false;
    for (const { a, b } of must) {
      if (touching(a, b)) continue;
      const order: [Body, Body][] = partners(a) < partners(b) || (partners(a) === partners(b) && a.anchorWeight <= b.anchorWeight) ? [[a, b], [b, a]] : [[b, a], [a, b]];
      for (const [mover, partner] of order) {
        if (mover.pinned) continue;
        if (tryAttach(bodies, must, mover, partner, overlap)) {
          changed = true;
          break;
        }
      }
    }
    if (!changed) break;
  }
}

function tryAttach(bodies: Body[], must: { a: Body; b: Body }[], mover: Body, partner: Body, overlap: number): boolean {
  const others = bodies.filter((x) => x !== mover);
  const home = mover.p;
  // Places against the partner, scored by how far they are from where the room wants to be.
  let bestFree: { p: Point; cost: number } | null = null;
  let bestAny: { p: Point; cost: number } | null = null;
  for (let k = 0; k < 72; k++) {
    const ang = (k / 72) * 2 * Math.PI;
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    const reach = radiusToward(partner, ux, uy) + radiusToward(mover, -ux, -uy);
    const p = { x: partner.p.x + ux * reach * (1 - overlap / 2), y: partner.p.y + uy * reach * (1 - overlap / 2) };
    const cost = Math.hypot(p.x - mover.anchor.x, p.y - mover.anchor.y) + Math.hypot(p.x - home.x, p.y - home.y);
    if (!bestAny || cost < bestAny.cost) bestAny = { p, cost };
    const free = others.every((o) => overlapAmount({ ...mover, ...p }, { ...o, ...o.p }) <= overlap);
    if (free && (!bestFree || cost < bestFree.cost)) bestFree = { p, cost };
  }
  // A free place is best, unless it's well out of the way: then first try making room where the room wants to be.
  const size = 2 * Math.max(mover.rx, mover.ry);
  const tries: { p: Point; push: boolean }[] = [];
  if (bestFree && bestAny && bestFree.cost <= bestAny.cost + size) tries.push({ p: bestFree.p, push: false });
  else {
    if (bestAny) tries.push({ p: bestAny.p, push: true });
    if (bestFree) tries.push({ p: bestFree.p, push: false });
  }
  const brokenBefore = brokenPairs(must);
  for (const t of tries) {
    const saved = bodies.map((x) => x.p);
    mover.p = t.p;
    if (t.push) {
      // Hold the pair still and let everything else make room, then settle.
      const pins = [mover.pinned, partner.pinned];
      mover.pinned = partner.pinned = true;
      for (let i = 0; i < 40; i++) separate(bodies, overlap);
      [mover.pinned, partner.pinned] = pins;
      for (let i = 0; i < 20; i++) separate(bodies, overlap);
    }
    if (brokenPairs(must) < brokenBefore && worstOverlap(bodies) <= overlap * 1.2) return true;
    bodies.forEach((x, i) => (x.p = saved[i]));
  }
  return false;
}

function brokenPairs(must: { a: Body; b: Body }[]): number {
  return must.filter(({ a, b }) => !touching(a, b)).length;
}

function worstOverlap(bodies: Body[]): number {
  let worst = 0;
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      if (bodies[i].pinned && bodies[j].pinned) continue;
      worst = Math.max(worst, overlapAmount({ ...bodies[i], ...bodies[i].p }, { ...bodies[j], ...bodies[j].p }));
    }
  }
  return worst;
}

/** How much two bubbles overlap, as a share of the distance they need. 0 means they don't. */
export function overlapAmount(
  a: { x: number; y: number; rx: number; ry: number; rotation: number },
  b: { x: number; y: number; rx: number; ry: number; rotation: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return 1;
  const reach = radiusToward(a, dx / d, dy / d) + radiusToward(b, -dx / d, -dy / d);
  return Math.max(0, (reach - d) / reach);
}

type Shape = { x: number; y: number; rx: number; ry: number; rotation: number };

/**
 * The nearest place to `start` where `b` fits without overlapping any of
 * `others` by more than `overlap`. Searches rings around the start point;
 * on the first ring with room, takes the place closest to `toward`.
 */
export function freeSpot(b: Shape, others: Shape[], start: Point, toward: Point = start, overlap = 0.06): Point {
  const fits = (p: Point) => others.every((o) => overlapAmount({ ...b, ...p }, o) <= overlap);
  if (fits(start)) return start;
  const step = Math.max(12, Math.min(b.rx, b.ry) / 3);
  for (let ring = 1; ring <= 200; ring++) {
    const r = ring * step;
    const count = Math.max(8, Math.round((2 * Math.PI * r) / step));
    let best: Point | null = null;
    for (let k = 0; k < count; k++) {
      const a = (k / count) * 2 * Math.PI;
      const p = { x: Math.round(start.x + Math.cos(a) * r), y: Math.round(start.y + Math.sin(a) * r) };
      if (fits(p) && (!best || Math.hypot(p.x - toward.x, p.y - toward.y) < Math.hypot(best.x - toward.x, best.y - toward.y))) best = p;
    }
    if (best) return best;
  }
  return start;
}
