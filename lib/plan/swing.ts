import polygonClipping from "polygon-clipping";
import type { FloorPlan, Opening, PlanRoom, Point } from "@/lib/model/schema";
import { fixtureType, openingType } from "./catalog";
import { add, pointInPolygon, polygonArea, polygonsOverlap, rectangle, scale } from "./geometry";
import { openingGeometry, type OpeningGeometry } from "./walls";

/**
 * Where a hinged door swings: the quarter circle its leaf sweeps, and whether
 * that sweep runs into another door's swing, a fixture or cabinet, the
 * stairs, a closet or a wall.
 */

/** Things on the floor a door's swing shouldn't hit, beyond what the plan itself holds (fixtures, rooms, other doors). */
export type SwingExtras = {
  /** Stair outlines on this floor. */
  stairs?: Point[][];
  /** Cabinet outlines (the kitchen layout), with what to call them. */
  cabinets?: { outline: Point[]; label: string }[];
};

export type SwingCheck = {
  ok: boolean;
  hits: string[];
  /** Ids of the other doors whose swings it runs into. */
  doors: string[];
};

const STEPS = 12;
/** Less overlap than this (sq in) is a brush, not a clash. */
const CLASH_SQ_IN = 30;

/** The quarter circles a swinging door's leaves sweep (two for a double door), or none for other doors. */
export function swingArcs(g: OpeningGeometry): Point[][] {
  const o = g.opening;
  if (o.kind !== "door" || !openingType(o.style).swings) return [];
  const sv = o.side ?? 1;
  const leaf = (hinge: Point, toward: 1 | -1, r: number) => {
    const pts: Point[] = [hinge];
    for (let k = 0; k <= STEPS; k++) {
      const a = (k / STEPS) * (Math.PI / 2);
      pts.push(add(hinge, add(scale(g.u, toward * r * Math.cos(a)), scale(g.n, sv * r * Math.sin(a)))));
    }
    return pts;
  };
  if (openingType(o.style).double) return [leaf(g.a, 1, o.widthIn / 2), leaf(g.b, -1, o.widthIn / 2)];
  return [(o.hinge ?? "start") === "start" ? leaf(g.a, 1, o.widthIn) : leaf(g.b, -1, o.widthIn)];
}

/** The room a door swings into (null for outside). */
export function swingRoom(plan: FloorPlan, g: OpeningGeometry): PlanRoom | null {
  const p = add(g.center, scale(g.n, (g.opening.side ?? 1) * 8));
  return plan.rooms.find((r) => pointInPolygon(p, r.polygon)) ?? null;
}

const ring = (poly: Point[]): [number, number][][] => [[...poly.map((v): [number, number] => [v.x, v.y]), [poly[0].x, poly[0].y]]];

/** How much of a swing pokes out of the room it swings into (sq in). */
function outsideArea(arc: Point[], room: PlanRoom): number {
  return polygonClipping.difference(ring(arc), ring(room.polygon)).reduce((t, poly) => t + polygonArea(poly[0].slice(0, -1).map(([x, y]) => ({ x, y }))), 0);
}

const hitBy = (arcs: Point[][], outline: Point[]) => arcs.some((a) => polygonsOverlap(a, outline, 1));

/**
 * Whether a door can swing open without hitting anything: other doors'
 * swings, fixtures and cabinets, the stairs, closets, or the far wall of a
 * room too shallow for it. `hits` names what's in the way, plainly ("the
 * vanity", "another door's swing").
 */
export function swingClear(plan: FloorPlan, o: Opening, extras: SwingExtras = {}): SwingCheck {
  const g = openingGeometry(plan, o);
  if (!g) return { ok: true, hits: [], doors: [] };
  const arcs = swingArcs(g);
  if (!arcs.length) return { ok: true, hits: [], doors: [] };
  const hits: string[] = [];
  const doors: string[] = [];
  const add_ = (what: string) => {
    if (!hits.includes(what)) hits.push(what);
  };
  const into = swingRoom(plan, g);
  if (into && arcs.some((a) => outsideArea(a, into) > CLASH_SQ_IN)) add_("the wall");
  for (const other of plan.openings) {
    if (other.id === o.id) continue;
    const og = openingGeometry(plan, other);
    const theirs = og ? swingArcs(og) : [];
    if (theirs.some((t) => arcs.some((a) => polygonsOverlap(a, t, 1)))) {
      add_("another door's swing");
      doors.push(other.id);
    }
  }
  const struck: Point[][] = [];
  for (const f of plan.fixtures) {
    const outline = rectangle(f.x, f.y, f.widthIn, f.depthIn, f.rotation ?? 0);
    if (!hitBy(arcs, outline)) continue;
    add_(`the ${fixtureType(f.kind).label.toLowerCase()}`);
    struck.push(outline);
  }
  // A cabinet under a fixture already named (the vanity's box, the counter's base) isn't named again.
  for (const c of extras.cabinets ?? []) if (hitBy(arcs, c.outline) && !struck.some((f) => polygonsOverlap(f, c.outline, 1))) add_(c.label);
  if ((extras.stairs ?? []).some((s) => hitBy(arcs, s))) add_("the stairs");
  // A closet next door (not the one this door opens into).
  for (const r of plan.rooms) {
    if (r.id === into?.id || (r.type !== "closet" && r.type !== "primary-closet")) continue;
    if (hitBy(arcs, r.polygon)) add_(`the closet (${r.name})`);
  }
  return { ok: hits.length === 0, hits, doors };
}

/** "the vanity", "the vanity and the stairs", "the vanity, the stairs and the wall". */
export function listHits(hits: string[]): string {
  return hits.length <= 1 ? (hits[0] ?? "") : `${hits.slice(0, -1).join(", ")} and ${hits[hits.length - 1]}`;
}

/** The same door hung from its other side. */
export const flipHinge = (o: Opening): Opening => ({ ...o, hinge: o.hinge === "end" ? "start" : "end" });
/** The same door swinging into the room on its other side. */
export const flipSide = (o: Opening): Opening => ({ ...o, side: o.side === -1 ? 1 : -1 });

/**
 * "Flip the swing": the door hung from its other side, or swinging into the
 * other room, whichever opens clear first (hinge first, then side, then
 * both). With nothing clear, just the hinge flipped.
 */
export function flipSwing(plan: FloorPlan, id: string, extras: SwingExtras = {}): FloorPlan {
  const o = plan.openings.find((x) => x.id === id);
  if (!o) return plan;
  const withDoor = (d: Opening) => ({ ...plan, openings: plan.openings.map((x) => (x.id === id ? d : x)) });
  const tries = [flipHinge(o), flipSide(o), flipSide(flipHinge(o))];
  const ok = tries.find((d) => swingClear(withDoor(d), d, extras).ok);
  return withDoor(ok ?? tries[0]);
}

/** "Switch to a pocket door": same spot and width, sliding into the wall instead of swinging. */
export function toPocketDoor(plan: FloorPlan, id: string): FloorPlan {
  return { ...plan, openings: plan.openings.map((o) => (o.id === id ? { ...o, style: "door-pocket", kind: "door" as const } : o)) };
}
