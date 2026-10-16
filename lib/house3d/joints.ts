import polygonClipping, { type Polygon } from "polygon-clipping";
import type { Point } from "@/lib/model/schema";
import { add, dist, dot, leftNormal, pointInPolygon, polygonArea, project, scale, sub, unit } from "@/lib/plan/geometry";
import { cleanRing, type Region } from "./footprint";

/**
 * Where walls meet, so their blocks fit together instead of overlapping (two
 * blocks drawing over the same spot flicker as the camera moves).
 *
 * Each wall's footprint starts as a strip along its line:
 * - Two walls at a corner are mitered: their faces meet on the corner's
 *   bisector, so the siding wraps the outside corner and each room's paint
 *   meets the next cleanly inside.
 * - Two walls in a straight line (a wall split where rooms change) butt end
 *   to end, and a slight bend, like a flattened curve's 5° steps, is a
 *   shallow miter, so the run comes out smooth.
 * - Anywhere else walls meet (a T, several walls at one spot, ends that
 *   nearly meet) each runs on past the joint by half its thickness.
 * - A free end stops where the wall stops.
 *
 * Then, from the most important wall down (outside walls, then thicker,
 * then longer), each footprint gives up whatever the walls before it
 * already cover. So at a T the through wall stays whole and the branch stops
 * at its face, and no two footprints ever overlap, however the plan's
 * corners line up.
 */

export type JointPiece = { a: Point; b: Point; thicknessIn: number; exterior: boolean };

/** How close two wall ends have to be to count as meeting. */
const MEET_IN = 1;

type End = { i: number; k: "a" | "b"; p: Point; d: Point };
type Corners = { left: Point; right: Point };

/**
 * Each wall's footprint (usually one shape; none when other walls cover it
 * all). `freeRunOn` stretches free ends (for a cap or foundation that
 * overhangs the wall's end).
 */
export function wallFootprints(pieces: JointPiece[], freeRunOn: (i: number) => number = () => 0): Region[][] {
  const geo = pieces.map((p) => {
    const len = dist(p.a, p.b);
    const u = len > 1e-9 ? unit(sub(p.b, p.a)) : { x: 1, y: 0 };
    return { len, u, n: leftNormal(u), h: p.thicknessIn / 2 };
  });
  const at = (i: number, P: Point): Corners => ({ left: add(P, scale(geo[i].n, geo[i].h)), right: add(P, scale(geo[i].n, -geo[i].h)) });
  const ends = pieces.map((p, i) => ({ a: at(i, p.a), b: at(i, p.b) }));

  const all: End[] = pieces.flatMap((p, i) => [
    { i, k: "a" as const, p: p.a, d: geo[i].u },
    { i, k: "b" as const, p: p.b, d: scale(geo[i].u, -1) },
  ]);
  const nodes: End[][] = [];
  for (const e of all) {
    if (geo[e.i].len < 0.01) continue;
    const node = nodes.find((n) => dist(n[0].p, e.p) < MEET_IN);
    if (node) node.push(e);
    else nodes.push([e]);
  }
  const runOn = (e: End, by: number) => {
    ends[e.i][e.k] = at(e.i, add(e.p, scale(e.d, -by)));
  };
  for (const node of nodes) {
    const P = node[0].p;
    // Another wall this end runs into partway along it.
    const into = pieces.some((q, j) => !node.some((e) => e.i === j) && geo[j].len > 0.01 && project(P, q.a, q.b).d < geo[j].h + MEET_IN);
    if (node.length === 1 && !into) {
      runOn(node[0], freeRunOn(node[0].i));
      continue;
    }
    if (node.length === 2 && !into && join(node[0], node[1])) continue;
    for (const e of node) runOn(e, geo[e.i].h);
  }

  // From the most important wall down, each gives up what the ones before it cover.
  const rank = (i: number) => (pieces[i].exterior ? 1e6 : 0) + pieces[i].thicknessIn * 1e3 + Math.min(geo[i].len, 999);
  const order = pieces.map((_, i) => i).sort((x, y) => rank(y) - rank(x) || x - y);
  const quads = pieces.map((_, i): Point[] => [ends[i].a.left, ends[i].b.left, ends[i].b.right, ends[i].a.right]);
  const boxOf = (q: Point[]) => [Math.min(...q.map((p) => p.x)), Math.min(...q.map((p) => p.y)), Math.max(...q.map((p) => p.x)), Math.max(...q.map((p) => p.y))];
  const boxes = quads.map(boxOf);
  const hits = (a: number[], b: number[]) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  const out: Region[][] = pieces.map(() => []);
  const done: number[] = [];
  for (const i of order) {
    if (geo[i].len < 0.01 || pieces[i].thicknessIn <= 0) continue;
    const before = done.filter((j) => hits(boxes[i], boxes[j]));
    done.push(i);
    const mine: Polygon = [ring(quads[i])];
    if (!before.length) {
      out[i] = [{ outline: quads[i], holes: [] }];
      continue;
    }
    try {
      out[i] = regions(polygonClipping.difference(mine, ...before.map((j): Polygon => [ring(quads[j])])));
    } catch {
      out[i] = [{ outline: quads[i], holes: [] }];
    }
  }
  return out;

  /** Join two ends that meet alone: end to end in a line, or mitered at a corner. False when they can't be (too sharp). */
  function join(x: End, y: End): boolean {
    const P = mid(x.p, y.p);
    const cross = x.d.x * y.d.y - x.d.y * y.d.x;
    if (Math.abs(cross) < 1e-4) {
      if (dot(x.d, y.d) > 0) return false; // Doubled back on itself.
      ends[x.i][x.k] = at(x.i, P);
      ends[y.i][y.k] = at(y.i, P);
      return true;
    }
    // The side of each wall that faces into the corner meets the other's; so do the outer sides.
    const sx = Math.sign(dot(geo[x.i].n, y.d)) || 1;
    const sy = Math.sign(dot(geo[y.i].n, x.d)) || 1;
    const side = (e: End, s: number) => ({ p: add(e.p, scale(geo[e.i].n, s * geo[e.i].h)), d: e.d });
    const inner = meet(side(x, sx), side(y, sy));
    const outer = meet(side(x, -sx), side(y, -sy));
    if (!inner || !outer) return false;
    const limit = 4 * Math.max(geo[x.i].h, geo[y.i].h) + 1;
    // The inner corner has to stay within both walls' lengths, the outer one near the joint.
    for (const e of [x, y]) {
      const tIn = dot(sub(inner, e.p), e.d);
      const tOut = dot(sub(outer, e.p), e.d);
      if (tIn > geo[e.i].len - 0.01 || tIn < -limit || tOut < -limit || tOut > geo[e.i].len - 0.01) return false;
    }
    const put = (e: End, s: number) => {
      ends[e.i][e.k] = s === 1 ? { left: inner, right: outer } : { left: outer, right: inner };
    };
    put(x, sx);
    put(y, sy);
    return true;
  }
}

/** The part of a wall's footprint between two distances along it (for the stretches between doors and windows). */
export function stretchOf(foot: Region[], piece: JointPiece, t0: number, t1: number): Region[] {
  if (!foot.length) return [];
  const len = dist(piece.a, piece.b);
  const u = unit(sub(piece.b, piece.a));
  const n = leftNormal(u);
  const far = piece.thicknessIn + 100;
  // Ends of the wall itself stretch past t = 0 and t = len (run-ons and miters), so open those sides up.
  const s0 = t0 < 0.01 ? -far : t0;
  const s1 = t1 > len - 0.01 ? len + far : t1;
  if (s0 <= -far && s1 >= len + far) return foot;
  const p = (t: number, s: number) => add(add(piece.a, scale(u, t)), scale(n, s));
  const strip: Polygon = [ring([p(s0, far), p(s1, far), p(s1, -far), p(s0, -far)])];
  try {
    return regions(polygonClipping.intersection(strip, ...foot.map((r) => [ring(r.outline), ...r.holes.map(ring)] as Polygon)));
  } catch {
    return foot;
  }
}

/** Which side of a wall an edge of its footprint is on: its left or right face, or an end (or a cut). */
export function faceOf(piece: JointPiece, p: Point, q: Point): "left" | "right" | "end" {
  const u = unit(sub(piece.b, piece.a));
  const n = leftNormal(u);
  const h = piece.thicknessIn / 2;
  const off = (x: Point) => dot(sub(x, piece.a), n);
  const [op, oq] = [off(p), off(q)];
  if (Math.abs(op - h) < 0.02 && Math.abs(oq - h) < 0.02) return "left";
  if (Math.abs(op + h) < 0.02 && Math.abs(oq + h) < 0.02) return "right";
  return "end";
}

const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const ring = (pts: Point[]): [number, number][] => [...pts.map((p) => [p.x, p.y] as [number, number]), [pts[0].x, pts[0].y]];
const unring = (r: [number, number][]): Point[] => r.slice(0, -1).map(([x, y]) => ({ x, y }));

function regions(mp: [number, number][][][]): Region[] {
  return mp
    .map((poly) => ({ outline: cleanRing(unring(poly[0]), 0.01), holes: poly.slice(1).map((h) => cleanRing(unring(h), 0.01)).filter((h) => h.length >= 3 && polygonArea(h) > 0.05) }))
    .filter((r) => r.outline.length >= 3 && polygonArea(r.outline) > 0.05);
}

/** Where two lines (a point and a direction each) cross, or null when they're parallel. */
function meet(l1: { p: Point; d: Point }, l2: { p: Point; d: Point }): Point | null {
  const den = l1.d.x * l2.d.y - l1.d.y * l2.d.x;
  if (Math.abs(den) < 1e-9) return null;
  const w = sub(l2.p, l1.p);
  const t = (w.x * l2.d.y - w.y * l2.d.x) / den;
  return add(l1.p, scale(l1.d, t));
}

/**
 * Which other wall's footprint an edge of wall `i`'s footprint is up against
 * (-1 for none). A face there is inside the walls, and drawing it would
 * flicker along the seam where it meets the wall faces.
 */
export function against(feet: Region[][], i: number, p: Point, q: Point): number {
  const L = dist(p, q);
  if (L < 1e-6) return -1;
  const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  // Just outside this footprint, across the edge (either way: whichever side isn't this wall).
  const n = leftNormal(unit(sub(q, p)));
  for (const s of [1, -1]) {
    const x = add(m, scale(n, s * 0.05));
    if (feet[i].some((r) => inside(x, r))) continue;
    for (let j = 0; j < feet.length; j++) if (j !== i && feet[j].some((r) => inside(x, r))) return j;
    return -1;
  }
  return -1;
}

function inside(p: Point, r: Region): boolean {
  return pointInPolygon(p, r.outline) && !r.holes.some((h) => pointInPolygon(p, h));
}
