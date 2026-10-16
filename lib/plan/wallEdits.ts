import type { FloorPlan, Opening, PlanRoom, PlanWall, Point } from "@/lib/model/schema";
import { cross, dist, dot, edgesOf, round1, roundPoint, sub, unit } from "./geometry";
import { arcBetween, bulgeOf, isCurved, leftBulge, pointOnArc, pointOnEdge, projectOnEdge, roomEdgeArc, roomEdgeLength, subBulge, wallArc, wallLength, type Arc } from "./arcs";
import { insertGluedCorner, newPlanId, reshapeRoom } from "./edit";
import { hostSegment } from "./walls";
import { pruneOpenWalls } from "./openWalls";

/**
 * Splitting a wall into pieces and combining pieces back into one wall, for
 * room walls (a corner added or taken away) and loose walls (one PlanWall
 * becomes several, or several become one). Doors and windows stay where they
 * are on the wall; any that no longer fit are taken out and named in `note`.
 */

export type WallEdit = { plan: FloorPlan; note: string | null } | { why: string };

/** Ends closer than this (inches) count as the same spot. */
const SAME_IN = 1;
/** Walls within this angle (degrees) count as one straight line. */
const IN_LINE_DEG = 1;
/** A split leaves pieces at least this long (inches). */
const MIN_PIECE_IN = 6;

const roomName = (r: PlanRoom | undefined) => r?.name || "Another room";

// ---------- Doors and windows ----------

/** Where an opening's middle is on the plan. */
function openingAt(plan: FloorPlan, o: Opening): Point | null {
  const seg = hostSegment(plan, o.host);
  return seg ? pointOnEdge(seg.a, seg.b, seg.bulge ?? 0, o.offsetIn) : null;
}

/**
 * After an edit, take out doors and windows wider than the wall they're now
 * on, and say what happened to any that went or had to slide over.
 */
function settle(before: FloorPlan, after: FloorPlan): { plan: FloorPlan; note: string | null } {
  const gone: Opening[] = [];
  let slid = 0;
  const openings = after.openings.filter((o) => {
    const seg = hostSegment(after, o.host);
    if (!seg || seg.length + 0.01 < o.widthIn) {
      gone.push(o);
      return false;
    }
    const was = before.openings.find((x) => x.id === o.id);
    const p0 = was && openingAt(before, was);
    const p1 = openingAt(after, o);
    if (p0 && p1 && dist(p0, p1) > SAME_IN) slid++;
    return true;
  });
  const plan = gone.length ? { ...after, openings } : after;
  const what = (n: number, one: string) => (n === 1 ? one : `${n} doors and windows`);
  const notes: string[] = [];
  if (gone.length) notes.push(`Took out ${what(gone.length, gone[0].kind === "window" ? "a window" : "a door")} that no longer fit. Undo brings it back.`);
  if (slid) notes.push(`${slid === 1 ? "A door or window" : `${slid} doors and windows`} slid over to stay on ${slid === 1 ? "its wall" : "their walls"}.`);
  return { plan, note: notes.length ? notes.join(" ") : null };
}

// ---------- Room walls ----------

/** Points `pieces - 1` equal steps along a room edge (along the curve when it's curved). */
function equalPoints(a: Point, b: Point, bulge: number, length: number, pieces: number): Point[] {
  return Array.from({ length: pieces - 1 }, (_, k) => pointOnEdge(a, b, bulge, (length * (k + 1)) / pieces));
}

function edgeOf(plan: FloorPlan, roomId: string, edge: number) {
  const room = plan.rooms.find((r) => r.id === roomId);
  if (!room || edge < 0 || edge >= room.polygon.length) return null;
  const a = room.polygon[edge];
  const b = room.polygon[(edge + 1) % room.polygon.length];
  return { room, a, b, bulge: leftBulge(room, edge), length: roomEdgeLength(room, edge) };
}

/**
 * "Split wall here": a corner on a room's wall at the spot nearest `at`, on
 * the same line or curve. A wall another room shares gets the same corner on
 * its side too.
 */
export function splitEdge(plan: FloorPlan, roomId: string, edge: number, at: Point): WallEdit {
  const e = edgeOf(plan, roomId, edge);
  if (!e) return { why: "There's no wall here." };
  const pr = projectOnEdge(at, e.a, e.b, e.bulge);
  if (pr.t < MIN_PIECE_IN || pr.t > e.length - MIN_PIECE_IN) return { why: "Too close to the end of the wall to split here." };
  return settle(plan, insertGluedCorner(plan, roomId, edge, pr.point).plan);
}

/** "Split into equal pieces": 2, 3 or 4 pieces of the same length along the wall. */
export function splitEdgeEqual(plan: FloorPlan, roomId: string, edge: number, pieces: number): WallEdit {
  const e = edgeOf(plan, roomId, edge);
  if (!e) return { why: "There's no wall here." };
  if (e.length / pieces < MIN_PIECE_IN) return { why: "This wall is too short to split that many times." };
  let next = plan;
  // From the far end back, so the edge being split keeps its number.
  for (const p of equalPoints(e.a, e.b, e.bulge, e.length, pieces).reverse()) next = insertGluedCorner(next, roomId, edge, p).plan;
  return settle(plan, next);
}

type Merge = { kind: "line" | "circle" | "angle"; polygon: Point[]; bulges: number[] | undefined } | { why: string };

/** One room's outline with corner i taken out, and how the two walls it joined became one. */
function mergeCorner(room: PlanRoom, i: number): Merge {
  const n = room.polygon.length;
  if (n <= 3) return { why: "Rooms keep at least three corners." };
  const prev = (i - 1 + n) % n;
  const p0 = room.polygon[prev];
  const p = room.polygon[i];
  const p1 = room.polygon[(i + 1) % n];
  const b0 = bulgeOf(room, prev);
  const b1 = bulgeOf(room, i);
  let kind: "line" | "circle" | "angle" = "angle";
  let merged = 0;
  if (!isCurved(b0) && !isCurved(b1)) {
    const u = unit(sub(p, p0));
    const v = unit(sub(p1, p));
    if (dot(u, v) > 0 && Math.abs(cross(u, v)) <= Math.sin((IN_LINE_DEG * Math.PI) / 180)) kind = "line";
  } else if (isCurved(b0) && isCurved(b1) && Math.sign(b0) === Math.sign(b1)) {
    const c0 = roomEdgeArc(room, prev)!;
    const c1 = roomEdgeArc(room, i)!;
    if (sameCircle(c0, c1)) {
      const r = (c0.radius + c1.radius) / 2;
      const phi = (c0.length + c1.length) / r;
      if (phi > Math.PI + 0.02) return { why: "Together these walls would curve past a half circle." };
      kind = "circle";
      merged = Math.sign(b0) * r * (1 - Math.cos(phi / 2));
    }
  }
  const polygon = room.polygon.filter((_, k) => k !== i);
  let bulges: number[] | undefined;
  if (room.bulges) {
    bulges = Array.from({ length: n }, (_, k) => bulgeOf(room, k)).filter((_, k) => k !== i);
    // The merged wall is edge `prev`, one lower when corner 0 went.
    bulges[i === 0 ? n - 2 : prev] = round1(merged);
  }
  return { kind, polygon, bulges };
}

const sameCircle = (a: Pick<Arc, "center" | "radius">, b: Pick<Arc, "center" | "radius">) =>
  dist(a.center, b.center) <= SAME_IN && Math.abs(a.radius - b.radius) <= SAME_IN;

/** Other rooms whose wall meets this spot: a corner there, or an edge running through it. */
function roomsMeeting(plan: FloorPlan, roomId: string, p: Point): PlanRoom[] {
  return plan.rooms.filter(
    (r) => r.id !== roomId && (r.polygon.some((q) => dist(q, p) <= SAME_IN) || edgesOf(r.polygon).some((e) => projectOnEdge(p, e.a, e.b, leftBulge(r, e.i)).d <= SAME_IN)),
  );
}

/**
 * "Combine walls": take out the corner between two walls of a room. In line,
 * or on the same circle, they become one wall in the same place, and rooms on
 * the other side with a corner at the same spot lose theirs too. At an angle
 * they become one straight wall from end to end (the room changes shape),
 * which is refused when another room's wall meets that corner.
 */
export function combineAt(plan: FloorPlan, roomId: string, corner: number): WallEdit {
  const room = plan.rooms.find((r) => r.id === roomId);
  if (!room || !room.polygon[corner]) return { why: "There's no corner here." };
  const m = mergeCorner(room, corner);
  if ("why" in m) return m;
  const p = room.polygon[corner];
  if (m.kind === "angle") {
    const other = roomsMeeting(plan, roomId, p)[0];
    if (other) return { why: `${roomName(other)} shares this corner. Hold Option and drag it apart first, or combine from the other room.` };
    if (plan.walls.some((w) => dist(w.a, p) <= SAME_IN || dist(w.b, p) <= SAME_IN)) return { why: "A wall drawn on its own meets this corner. Move it first." };
  }
  let next = reshapeRoom(plan, roomId, m.polygon, m.bulges ?? []);
  if (m.kind !== "angle") {
    // A split shared wall combines on both sides.
    for (const r of plan.rooms) {
      if (r.id === roomId) continue;
      const k = r.polygon.findIndex((q) => dist(q, p) <= SAME_IN);
      if (k < 0) continue;
      const theirs = mergeCorner(r, k);
      if (!("why" in theirs) && theirs.kind !== "angle") next = reshapeRoom(next, r.id, theirs.polygon, theirs.bulges ?? []);
    }
  }
  return settle(plan, m.kind === "angle" ? pruneOpenWalls(next) : next);
}

/**
 * Two picked walls of one room that meet: the corner between them, for
 * "Combine walls" on a two-wall pick. Null when they don't meet.
 */
export function cornerBetween(plan: FloorPlan, roomId: string, e1: number, e2: number): number | null {
  const room = plan.rooms.find((r) => r.id === roomId);
  if (!room) return null;
  const n = room.polygon.length;
  if ((e1 + 1) % n === e2) return e2;
  if ((e2 + 1) % n === e1) return e1;
  return null;
}

// ---------- Loose walls ----------

/** A loose wall cut at these distances along it (in order), as pieces of the same line or circle. */
function cutWall(plan: FloorPlan, w: PlanWall, cuts: number[]): FloorPlan {
  const arc = wallArc(w);
  const L = wallLength(w);
  const at = (s: number) => roundPoint(arc ? pointOnArc(arc, s) : pointOnEdge(w.a, w.b, 0, s));
  const stops = [0, ...cuts, L];
  const ends = stops.map((s, k) => (k === 0 ? w.a : k === stops.length - 1 ? w.b : at(s)));
  const pieces: PlanWall[] = stops.slice(1).map((_, k) => {
    const { bulge: _b, ...rest } = w;
    void _b;
    const piece: PlanWall = { ...rest, id: k === 0 ? w.id : newPlanId("w"), a: ends[k], b: ends[k + 1] };
    if (!arc) return piece;
    const bow = round1(subBulge(arc, ends[k], ends[k + 1]));
    return isCurved(bow) ? { ...piece, bulge: bow } : piece;
  });
  const openings = plan.openings.map((o) => {
    if (!("wallId" in o.host) || o.host.wallId !== w.id) return o;
    let k = stops.findIndex((s, j) => j > 0 && o.offsetIn <= s);
    if (k < 1) k = stops.length - 1;
    return { ...o, host: { wallId: pieces[k - 1].id }, offsetIn: round1(clampInto(o.offsetIn - stops[k - 1], o.widthIn, stops[k] - stops[k - 1])) };
  });
  const i = plan.walls.findIndex((x) => x.id === w.id);
  return { ...plan, walls: [...plan.walls.slice(0, i), ...pieces, ...plan.walls.slice(i + 1)], openings };
}

const clampInto = (offset: number, width: number, length: number) => (length <= width ? length / 2 : Math.min(length - width / 2, Math.max(width / 2, offset)));

/** "Split wall here" on a loose wall: two walls joined end to end, same thickness and height. */
export function splitWall(plan: FloorPlan, wallId: string, at: Point): WallEdit {
  const w = plan.walls.find((x) => x.id === wallId);
  if (!w) return { why: "There's no wall here." };
  const L = wallLength(w);
  const t = projectOnEdge(at, w.a, w.b, w.bulge ?? 0).t;
  if (t < MIN_PIECE_IN || t > L - MIN_PIECE_IN) return { why: "Too close to the end of the wall to split here." };
  return settle(plan, cutWall(plan, w, [t]));
}

/** "Split into equal pieces" on a loose wall. */
export function splitWallEqual(plan: FloorPlan, wallId: string, pieces: number): WallEdit {
  const w = plan.walls.find((x) => x.id === wallId);
  if (!w) return { why: "There's no wall here." };
  const L = wallLength(w);
  if (L / pieces < MIN_PIECE_IN) return { why: "This wall is too short to split that many times." };
  return settle(plan, cutWall(plan, w, Array.from({ length: pieces - 1 }, (_, k) => (L * (k + 1)) / pieces)));
}

/**
 * "Combine walls" for two loose walls that share an end: one wall from the
 * far end of the first to the far end of the second. In line or on the same
 * circle it's the same wall; at an angle it's a straight one.
 */
export function combineWalls(plan: FloorPlan, wallIds: string[]): WallEdit {
  const ws = wallIds.map((id) => plan.walls.find((w) => w.id === id)).filter((w): w is PlanWall => !!w);
  if (ws.length !== 2) return { why: "Pick two walls that meet end to end." };
  const [w1, w2] = ws;
  // Each wall's two ends, the shared one second for w1 and first for w2.
  const pairs: [Point, Point, Point, Point][] = [
    [w1.a, w1.b, w2.a, w2.b],
    [w1.a, w1.b, w2.b, w2.a],
    [w1.b, w1.a, w2.a, w2.b],
    [w1.b, w1.a, w2.b, w2.a],
  ];
  const hit = pairs.find(([, j1, j2]) => dist(j1, j2) <= SAME_IN);
  if (!hit) return { why: "These walls don't meet end to end." };
  if ((w1.height ?? "full") !== (w2.height ?? "full")) return { why: "These walls are different heights." };
  const [far1, joint, , far2] = hit;
  if (plan.walls.some((w) => w.id !== w1.id && w.id !== w2.id && (dist(w.a, joint) <= SAME_IN || dist(w.b, joint) <= SAME_IN))) return { why: "Another wall meets these here." };
  // Bulges to the left walking far1 → joint → far2.
  const rev1 = dist(w1.a, far1) > SAME_IN;
  const rev2 = dist(w2.a, joint) > SAME_IN;
  const bow1 = (w1.bulge ?? 0) * (rev1 ? -1 : 1);
  const bow2 = (w2.bulge ?? 0) * (rev2 ? -1 : 1);
  const L1 = wallLength(w1);
  const L2 = wallLength(w2);
  let kind: "line" | "circle" | "angle" = "angle";
  let bulge = 0;
  if (!isCurved(bow1) && !isCurved(bow2)) {
    const u = unit(sub(joint, far1));
    const v = unit(sub(far2, joint));
    if (dot(u, v) > 0 && Math.abs(cross(u, v)) <= Math.sin((IN_LINE_DEG * Math.PI) / 180)) kind = "line";
  } else if (isCurved(bow1) && isCurved(bow2) && Math.sign(bow1) === Math.sign(bow2)) {
    const c1 = arcBetween(far1, joint, bow1)!;
    const c2 = arcBetween(joint, far2, bow2)!;
    if (sameCircle(c1, c2)) {
      const r = (c1.radius + c2.radius) / 2;
      const phi = (L1 + L2) / r;
      if (phi > Math.PI + 0.02) return { why: "Together these walls would curve past a half circle." };
      kind = "circle";
      bulge = round1(Math.sign(bow1) * r * (1 - Math.cos(phi / 2)));
    }
  }
  const { bulge: _b, ...rest } = w1;
  void _b;
  const one: PlanWall = { ...rest, a: far1, b: far2, ...(isCurved(bulge) ? { bulge } : {}) };
  const after = { ...plan, walls: plan.walls.filter((w) => w.id !== w2.id).map((w) => (w.id === w1.id ? one : w)) };
  const L = wallLength(one);
  const u = unit(sub(far2, far1));
  const openings = plan.openings.map((o) => {
    if (!("wallId" in o.host) || (o.host.wallId !== w1.id && o.host.wallId !== w2.id)) return o;
    const w = o.host.wallId === w1.id ? w1 : w2;
    // It stays on the same spot of the plan, measured along the new wall.
    const offsetIn = projectOnEdge(openingAt(plan, o)!, far1, far2, one.bulge ?? 0).t;
    // Its side and hinge follow the new wall's direction.
    const flip = kind === "angle" ? dot(unit(sub(w.b, w.a)), u) < 0 : w === w1 ? rev1 : rev2;
    const turned = flip ? { side: (o.side === 1 ? -1 : 1) as 1 | -1, hinge: o.hinge === "start" ? ("end" as const) : ("start" as const) } : {};
    return { ...o, ...turned, host: { wallId: w1.id }, offsetIn: round1(clampInto(offsetIn, o.widthIn, L)) };
  });
  return settle(plan, { ...after, openings });
}
