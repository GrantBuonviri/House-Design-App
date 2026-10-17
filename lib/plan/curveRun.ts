import type { FloorPlan, Opening, PlanRoom, Point } from "@/lib/model/schema";
import { arcBetween, bulgeOf, isCurved, pointOnArc, pointOnEdge, projectOnArc, subBulge, withBulges, type Arc } from "./arcs";
import { bendInfo, maxBow, sharedEdges, type BendTarget } from "./bend";
import { cross, dist, leftNormal, project, round1, roundPoint, signedArea, sub, unit } from "./geometry";
import { keepOpeningsInPlace } from "./edit";
import { clampOffset, hostSegment } from "./walls";
import { HALL_CURVE_NOTE, isStairHall } from "./locks";

/**
 * Curving several walls together: walls that meet end to end (sides of one
 * room, sides of rooms next to each other, or loose walls) bend as one
 * circle from the first end to the last. The corners between them stay
 * corners and move onto the circle, each at the same share of the length it
 * had before, so every wall keeps its doors and windows. Pure functions.
 */

/** One wall of a run, in run order: `rev` when the run walks it from its b end to its a end. */
export type RunPiece = { target: BendTarget; from: Point; to: Point; rev: boolean };
export type Run = { pieces: RunPiece[]; a: Point; b: Point };
export type RunEdit = { plan: FloorPlan } | { why: string };

/** Ends closer than this (inches) count as the same spot. */
const SAME_IN = 1;

const sameTarget = (x: BendTarget, y: BendTarget) =>
  "roomId" in x && "roomId" in y ? x.roomId === y.roomId && x.edge === y.edge : "wallId" in x && "wallId" in y && x.wallId === y.wallId;

/**
 * The picked walls as one run, in order from one end to the other, or why
 * they aren't one. Two sides of a wall two rooms share count once.
 */
export function runOf(plan: FloorPlan, targets: BendTarget[]): Run | { why: string } {
  const segs: { target: BendTarget; a: Point; b: Point }[] = [];
  if (targets.some((t) => "roomId" in t && (isStairHall(plan, t.roomId) || sharedEdges(plan, t.roomId, t.edge).some((s) => isStairHall(plan, s.roomId))))) return { why: HALL_CURVE_NOTE };
  for (const t of targets) {
    const info = bendInfo(plan, t);
    if (!info) return { why: "These walls don't meet end to end." };
    const same = segs.some((s) => (dist(s.a, info.a) <= SAME_IN && dist(s.b, info.b) <= SAME_IN) || (dist(s.a, info.b) <= SAME_IN && dist(s.b, info.a) <= SAME_IN));
    if (!same && !segs.some((s) => sameTarget(s.target, t))) segs.push({ target: t, a: info.a, b: info.b });
  }
  if (segs.length < 2) return { why: "Pick two or more walls that meet end to end." };
  // Group the ends into spots, and count how many picked walls reach each one.
  const spots: Point[] = [];
  const spotOf = (p: Point) => {
    const k = spots.findIndex((q) => dist(q, p) <= SAME_IN);
    if (k >= 0) return k;
    spots.push(p);
    return spots.length - 1;
  };
  const ends = segs.map((s) => [spotOf(s.a), spotOf(s.b)] as const);
  const count = spots.map((_, k) => ends.filter(([i, j]) => i === k || j === k).length);
  if (count.some((n) => n > 2)) return { why: "These walls branch. Pick walls that run on from one to the next." };
  const loose = count.flatMap((n, k) => (n === 1 ? [k] : []));
  if (!loose.length) return { why: "These walls go all the way around. Leave one out." };
  if (loose.length !== 2) return { why: "These walls don't meet end to end." };
  const pieces: RunPiece[] = [];
  const used = new Set<number>();
  let at = loose[0];
  while (pieces.length < segs.length) {
    const k = ends.findIndex(([i, j], n) => !used.has(n) && (i === at || j === at));
    if (k < 0) return { why: "These walls don't meet end to end." };
    used.add(k);
    const rev = ends[k][0] !== at;
    const s = segs[k];
    pieces.push({ target: s.target, from: rev ? s.b : s.a, to: rev ? s.a : s.b, rev });
    at = rev ? ends[k][0] : ends[k][1];
  }
  return { pieces, a: pieces[0].from, b: pieces[pieces.length - 1].to };
}

export const isRun = (r: Run | { why: string }): r is Run => "pieces" in r;

const lengthOf = (plan: FloorPlan, t: BendTarget) => bendInfo(plan, t)?.length ?? 0;

/** Where each corner between the pieces sits, as a share (0 to 1) of the whole run's length along the walls. */
export function sharesOf(plan: FloorPlan, run: Run): number[] {
  const lengths = run.pieces.map((p) => lengthOf(plan, p.target));
  const total = lengths.reduce((a, b) => a + b, 0) || 1;
  let sum = 0;
  return lengths.slice(0, -1).map((l) => (sum += l) / total);
}

/** A piece's bow to the left as the run walks it. */
function pieceLeft(plan: FloorPlan, p: RunPiece): number {
  const info = bendInfo(plan, p.target);
  return info ? (p.rev ? -info.left : info.left) : 0;
}

/** Which way is "out" for the run, as a left bow: out of the first room the run belongs to, or left for loose walls. */
function outward(plan: FloorPlan, run: Run): 1 | -1 {
  const first = run.pieces.find((p) => "roomId" in p.target);
  if (!first) return 1;
  const info = bendInfo(plan, first.target)!;
  return (first.rev ? -info.out : info.out) as 1 | -1;
}

const corners = (run: Run) => run.pieces.slice(0, -1).map((p) => p.to);

/** How far a point is from the curve from a to b bowing `left` (the whole circle, or the whole line). */
function offCurve(a: Point, b: Point, left: number, p: Point): number {
  const arc = arcBetween(a, b, left);
  if (!arc) return Math.abs(cross(sub(b, a), sub(p, a))) / Math.max(dist(a, b), 1e-9);
  return Math.abs(dist(p, arc.center) - arc.radius);
}

/** The bow whose curve passes closest to the corners between the pieces. */
function fitBow(run: Run): number {
  const chord = dist(run.a, run.b);
  const max = maxBow(chord);
  const mid = corners(run);
  const cost = (left: number) => mid.reduce((s, p) => s + offCurve(run.a, run.b, left, p) ** 2, 0);
  // Coarse look along every bow, then narrow in on the best.
  const N = 200;
  let best = 0;
  let bestCost = Infinity;
  for (let k = 0; k <= N; k++) {
    const left = -max + (2 * max * k) / N;
    const c = cost(left);
    if (c < bestCost) [best, bestCost] = [left, c];
  }
  let lo = Math.max(-max, best - (2 * max) / N);
  let hi = Math.min(max, best + (2 * max) / N);
  for (let k = 0; k < 60; k++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (cost(m1) <= cost(m2)) hi = m2;
    else lo = m1;
  }
  return (lo + hi) / 2;
}

/**
 * What "Curve together" starts with: the circle through the corners (for two
 * walls, the circle through both ends and the corner, so nothing moves), and
 * for a run that's already straight a gentle bow out of the room. The shares
 * put each corner where it already sits on that curve.
 */
export function startBow(plan: FloorPlan, run: Run): { left: number; shares: number[] } {
  const chord = dist(run.a, run.b);
  const straight = corners(run).every((p) => project(p, run.a, run.b).d <= 0.5);
  const left = straight ? (outward(plan, run) * chord) / 8 : fitBow(run);
  const arc = arcBetween(run.a, run.b, left);
  const shares = arc ? corners(run).map((p) => projectOnArc(p, arc).t / arc.length) : corners(run).map((p) => project(p, run.a, run.b).t / chord);
  // Keep the corners in order and apart; if the fit muddles them, fall back to the shares of length.
  const ordered = shares.every((s, k) => s > 0.01 && s < 0.99 && (k === 0 || s > shares[k - 1] + 0.01));
  return { left: round1(left), shares: ordered && !straight ? shares : sharesOf(plan, run) };
}

/** The run as it stands: how far it bows, its radius and length, and whether its walls are already one curve. */
export function runInfo(plan: FloorPlan, run: Run): { chord: number; left: number; radius: number | null; length: number; together: boolean; middle: Point } {
  const chord = dist(run.a, run.b);
  const left = fitBow(run);
  const arc = arcBetween(run.a, run.b, left);
  const length = run.pieces.reduce((s, p) => s + lengthOf(plan, p.target), 0);
  const onIt = corners(run).every((p) => offCurve(run.a, run.b, left, p) <= SAME_IN);
  const bowsMatch = run.pieces.every((p) => {
    const want = arc ? subBulge(arc, p.from, p.to) : 0;
    return Math.abs(want - pieceLeft(plan, p)) <= SAME_IN;
  });
  const middle = arc ? pointOnArc(arc, arc.length / 2) : pointOnEdge(run.a, run.b, 0, chord / 2);
  return { chord, left: onIt && bowsMatch ? left : 0, radius: onIt && bowsMatch && arc ? arc.radius : null, length, together: onIt && bowsMatch, middle };
}

const outOf = (poly: Point[]) => (signedArea(poly) >= 0 ? 1 : -1);

function segmentsCross(p1: Point, p2: Point, q1: Point, q2: Point): boolean {
  const d1 = cross(sub(p2, p1), sub(q1, p1));
  const d2 = cross(sub(p2, p1), sub(q2, p1));
  const d3 = cross(sub(q2, q1), sub(p1, q1));
  const d4 = cross(sub(q2, q1), sub(p2, q1));
  return d1 * d2 < -1e-6 && d3 * d4 < -1e-6;
}

/** A room whose corners now run the other way round, or whose sides cross. */
function turnedInsideOut(before: PlanRoom, after: PlanRoom): boolean {
  if (outOf(before.polygon) !== outOf(after.polygon) || Math.abs(signedArea(after.polygon)) < 1) return true;
  const n = after.polygon.length;
  for (let i = 0; i < n; i++)
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsCross(after.polygon[i], after.polygon[(i + 1) % n], after.polygon[j], after.polygon[(j + 1) % n])) return true;
    }
  return false;
}

/**
 * Bend a run into one curve from its first end to its last, bowing `left`
 * inches (to the left walking the run; 0 makes it straight). Each corner
 * between pieces moves onto the curve at its share of the length (`shares`,
 * from `sharesOf` unless given), and each piece takes its stretch of the
 * curve. Rooms and loose walls with a corner at a moved spot move with it,
 * and the other side of a shared wall bends with it, unless `alone`.
 */
export function curveRun(plan: FloorPlan, run: Run, left: number, opts: { alone?: boolean; shares?: number[] } = {}): RunEdit {
  const chord = dist(run.a, run.b);
  if (chord < 12) return { why: "The two ends of these walls are too close together to curve." };
  if (Math.abs(left) > maxBow(chord) + 0.05) return { why: "That would bow past a half circle." };
  const shares = opts.shares ?? sharesOf(plan, run);
  const arc: Arc | null = arcBetween(run.a, run.b, left);
  const total = arc ? arc.length : chord;
  const along = (share: number) => roundPoint(arc ? pointOnArc(arc, share * total) : pointOnEdge(run.a, run.b, 0, share * total));
  const was = corners(run);
  const now = shares.map(along);
  const mine = new Set(run.pieces.map((p) => ("roomId" in p.target ? p.target.roomId : p.target.wallId)));
  const moves = (owner: string) => !opts.alone || mine.has(owner);
  const moved = (q: Point, owner: string): Point => {
    if (!moves(owner)) return q;
    const k = was.findIndex((w) => dist(w, q) <= SAME_IN);
    return k >= 0 ? now[k] : q;
  };
  let next: FloorPlan = {
    ...plan,
    rooms: plan.rooms.map((r) => {
      const polygon = r.polygon.map((q) => moved(q, r.id));
      return polygon.some((q, k) => q !== r.polygon[k]) ? { ...r, polygon } : r;
    }),
    walls: plan.walls.map((w) => {
      const a = moved(w.a, w.id);
      const b = moved(w.b, w.id);
      return a !== w.a || b !== w.b ? { ...w, a, b } : w;
    }),
  };
  // Each piece's bow, and the same on the other side of a shared wall.
  const ends = [run.a, ...now, run.b];
  const touched: BendTarget[] = [];
  const stored = new Map<string, Map<number, number>>();
  const put = (roomId: string, edge: number, value: number) => {
    if (!stored.has(roomId)) stored.set(roomId, new Map());
    stored.get(roomId)!.set(edge, value);
    touched.push({ roomId, edge });
  };
  const wallBows = new Map<string, number>();
  run.pieces.forEach((p, k) => {
    const bow = arc ? subBulge(arc, ends[k], ends[k + 1]) : 0;
    const own = p.rev ? -bow : bow; // To the left of the wall's own a→b.
    if ("wallId" in p.target) {
      wallBows.set(p.target.wallId, own);
      touched.push(p.target);
      return;
    }
    const room = next.rooms.find((r) => r.id === (p.target as { roomId: string }).roomId)!;
    put(room.id, p.target.edge, own * outOf(room.polygon));
    if (opts.alone) return;
    for (const s of sharedEdges(next, room.id, p.target.edge)) {
      const other = next.rooms.find((r) => r.id === s.roomId)!;
      put(s.roomId, s.edge, (s.flip ? -own : own) * outOf(other.polygon));
    }
  });
  const tidy = (n: number) => (isCurved(n) ? round1(n) : 0);
  next = {
    ...next,
    rooms: next.rooms.map((r) => {
      const set = stored.get(r.id);
      if (!set) return r;
      return withBulges(r, Array.from({ length: r.polygon.length }, (_, k) => (set.has(k) ? tidy(set.get(k)!) : bulgeOf(r, k))));
    }),
    walls: next.walls.map((w) => {
      if (!wallBows.has(w.id)) return w;
      const { bulge: _b, ...rest } = w;
      void _b;
      const bow = tidy(wallBows.get(w.id)!);
      return bow ? { ...rest, bulge: bow } : rest;
    }),
  };
  for (const r of next.rooms) {
    const before = plan.rooms.find((x) => x.id === r.id);
    if (before && before !== r && before.polygon !== r.polygon && turnedInsideOut(before, r)) return { why: `That would turn ${r.name || "a room"} inside out.` };
  }
  return { plan: inProportion(plan, keepOpeningsInPlace(plan, next), touched) };
}

/** "Make straight": the run's walls as straight pieces from end to end, corners on the line at their share of the length. */
export const straightenRun = (plan: FloorPlan, run: Run, alone = false): RunEdit => curveRun(plan, run, 0, { alone });

/** "Curve together": the starting bow (see `startBow`). */
export function curveTogether(plan: FloorPlan, run: Run, alone = false): RunEdit {
  const start = startBow(plan, run);
  return curveRun(plan, run, start.left, { alone, shares: start.shares });
}

/** Bend a run to a typed radius, keeping the side it bows to (a straight run bows out of its room). */
export function runToRadius(plan: FloorPlan, run: Run, radius: number): RunEdit {
  const info = runInfo(plan, run);
  const half = info.chord / 2;
  if (radius < half - 0.05) return { why: `The radius can't be smaller than half the distance between the ends (${round1(half)}").` };
  const r = Math.max(radius, half);
  const depth = r - Math.sqrt(Math.max(0, r * r - half * half));
  return curveRun(plan, run, (info.left ? Math.sign(info.left) : outward(plan, run)) * depth);
}

/** Bend a run to a typed bow depth, keeping the side it bows to. */
export function runToDepth(plan: FloorPlan, run: Run, depth: number): RunEdit {
  const info = runInfo(plan, run);
  return curveRun(plan, run, (info.left ? Math.sign(info.left) : outward(plan, run)) * Math.abs(depth));
}

/** Where the run's diamond goes, and which way to pull it: the middle of the curve (or line). */
export function runHandle(plan: FloorPlan, run: Run): { at: Point; normal: Point } {
  return { at: runInfo(plan, run).middle, normal: leftNormal(unit(sub(run.b, run.a))) };
}

/** Doors and windows on the run's walls keep their place in proportion along the wall. */
function inProportion(before: FloorPlan, plan: FloorPlan, hosts: BendTarget[]): FloorPlan {
  const openings = plan.openings.map((o): Opening => {
    if (!hosts.some((h) => sameTarget(h, o.host as BendTarget))) return o;
    const was = hostSegment(before, o.host);
    const now = hostSegment(plan, o.host);
    const orig = before.openings.find((x) => x.id === o.id) ?? o;
    if (!was || !now) return o;
    return { ...o, offsetIn: round1(clampOffset((orig.offsetIn / was.length) * now.length, o.widthIn, now.length)) };
  });
  return { ...plan, openings };
}
