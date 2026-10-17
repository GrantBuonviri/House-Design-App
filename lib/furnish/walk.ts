import type { FloorPlan, Opening, Point, WallHeight } from "@/lib/model/schema";
import { add, collinearOverlap, round1, scale, sub } from "@/lib/plan/geometry";
import { openingHeight, openingType } from "@/lib/plan/catalog";
import { clampOffset, HALF_WALL_IN, hostSegment, nearestHost, openingGeometry, sameHost, type HostSegment, type OpeningGeometry } from "@/lib/plan/walls";
import { newPlanId } from "@/lib/plan/edit";
import { snapPoint, snapTargets } from "@/lib/plan/snap";
import { splitRoom } from "@/lib/plan/partitions";
import { catalogEntry } from "./catalog";
import { placeCheck, placeItem, removeItem, roomAt, snapToWall, type LayerItem } from "./layer";
import { ghostAt, type Ghost } from "./stage";
import type { ClosetSize } from "./closets";

/**
 * Furnish in the walkthrough: what's under the dot, where a carried item
 * lands from where you look (on the floor, backed onto a wall, or flat on the
 * wall you aim at), doors and windows put on or slid along the aimed wall,
 * and walls drawn from one floor spot to another. Pure, so it can be tested
 * without a 3D view.
 */

/** Where the dot landed: a plan point, its height above the floor, and which way the surface faces (plan x and y, and up). */
export type WalkHit = { p: Point; heightIn: number; normal: { x: number; y: number; up: number } };

/** Where you're looking: the floor spot under the dot, and the wall it's on (if it's on one). */
export type WalkSpot = { floor: Point; wall?: { p: Point; n: Point } };

/** How far a few inches off an item still counts as aiming at it (outlets and switches are small, so they get more). */
const TOL_IN = 2;
const SMALL_TOL_IN = 4;

/**
 * The placed item under the dot: the smallest one whose box (its outline,
 * from its bottom to its top) holds the spot, so a sink in a counter wins
 * over the counter. Ceiling lights and alarms count when you look up at
 * the ceiling right under them.
 */
export function itemAt(items: LayerItem[], hit: WalkHit): LayerItem | null {
  let best: LayerItem | null = null;
  let bestArea = Infinity;
  for (const it of items) {
    const small = it.kind === "device";
    const tol = small ? SMALL_TOL_IN : TOL_IN;
    const d = sub(hit.p, { x: it.x, y: it.y });
    const r = (-it.rotation * Math.PI) / 180;
    const lx = d.x * Math.cos(r) - d.y * Math.sin(r);
    const ly = d.x * Math.sin(r) + d.y * Math.cos(r);
    if (Math.abs(lx) > it.widthIn / 2 + tol || Math.abs(ly) > Math.max(it.depthIn, 1) / 2 + tol) continue;
    const up = it.mount === "ceiling" ? hit.normal.up < -0.7 : hit.heightIn >= it.bottomIn - tol && hit.heightIn <= it.bottomIn + it.heightIn + tol;
    if (!up) continue;
    const area = it.widthIn * Math.max(it.depthIn, 1);
    if (area < bestArea) {
      best = it;
      bestArea = area;
    }
  }
  return best;
}

/** The spot to use for an item: wall-hung things go by the wall you aim at, everything else by the floor. */
const cursorFor = (mount: string, spot: WalkSpot): Point => (mount === "wall" && spot.wall ? add(spot.wall.p, scale(spot.wall.n, 2)) : spot.floor);

/** Highest and lowest a wall-hung item can be lifted to on this floor. */
export function clampLift(bottomIn: number, heightIn: number, ceilingIn: number): number {
  return round1(Math.max(0, Math.min(ceilingIn - heightIn, bottomIn)));
}

/**
 * Where a new catalog item would land from where you're looking, turned a
 * further `turn` degrees. Wall-hung items sit at their catalog height plus
 * `lift` inches (the scroll wheel). Null for doors, windows and walls (they
 * have their own placers below).
 */
export function walkGhost(plan: FloorPlan, entryId: string, spot: WalkSpot, turn: number, items: LayerItem[], ceilingIn = 96, lift = 0, closetSize?: ClosetSize): Ghost | null {
  const e = catalogEntry(entryId);
  if (!e) return null;
  const g = ghostAt(plan, entryId, cursorFor(e.mount, spot), turn, items, ceilingIn, closetSize);
  if (!g || e.mount !== "wall" || !lift) return g;
  const bottomIn = clampLift(g.bottomIn + lift, g.heightIn, ceilingIn);
  return { ...g, bottomIn, check: placeCheck(plan, { ...g, bottomIn }, items) };
}

/** Whether an item's height off the floor can be changed (outlets and switches stay at their code height). */
export const liftable = (item: Pick<LayerItem, "kind" | "mount">) => item.mount === "wall" && (item.kind === "addon" || item.kind === "cabinet");

/**
 * Where an item being carried would land: backed onto a wall that's close
 * (or flat on the aimed wall, for wall-hung ones), turned `turn` degrees
 * from that, and whether it fits there (it's left out of `items`).
 */
export function walkMove(plan: FloorPlan, item: LayerItem, spot: WalkSpot, turn: number, items: LayerItem[], ceilingIn = 96, lift = 0): Ghost {
  const cursor = cursorFor(item.mount, spot);
  const snap = item.mount === "ceiling" ? null : snapToWall(plan, cursor, { widthIn: item.widthIn, depthIn: item.depthIn, mount: item.mount }, 12);
  const at = snap ?? { x: round1(cursor.x), y: round1(cursor.y), rotation: item.rotation };
  const rotation = (((at.rotation + turn) % 360) + 360) % 360;
  const bottomIn = liftable(item) ? clampLift(item.bottomIn + lift, item.heightIn, ceilingIn) : item.bottomIn;
  const moved = { ...item, x: at.x, y: at.y, rotation, bottomIn };
  const check = placeCheck(plan, moved, items.filter((i) => i.id !== item.id));
  return { entryId: item.entryId, x: at.x, y: at.y, rotation, widthIn: item.widthIn, depthIn: item.depthIn, heightIn: item.heightIn, bottomIn, check };
}

/**
 * Carry an item to another floor: it's taken off `from` and put down on `to`
 * where the ghost is, in one step. Fixtures keep their faucet changes,
 * furniture and built-ins their color; a ceiling-hung built-in hangs from the
 * new floor's ceiling (`ceilingIn`). An app-placed cabinet or outlet is hidden
 * on its old floor, as removing it would, and becomes a hand-placed one here.
 */
export function carryToFloor(from: FloorPlan, to: FloorPlan, item: LayerItem, g: Ghost, ceilingIn = 96): { from: FloorPlan; to: FloorPlan; id: string | null } {
  if (!g.check.ok) return { from, to, id: null };
  const at = { x: round1(g.x), y: round1(g.y), rotation: g.rotation };
  const roomId = roomAt(to, at)?.id;
  const placed = <T extends { roomId?: string }>(x: T): T => {
    const { roomId: _r, ...rest } = x;
    void _r;
    return { ...rest, ...at, ...(roomId ? { roomId } : {}) } as unknown as T;
  };
  const left = removeItem(from, item);
  switch (item.kind) {
    case "fixture": {
      const f = from.fixtures.find((x) => x.id === item.id);
      if (!f) return { from, to, id: null };
      return { from: left, to: { ...to, fixtures: [...to.fixtures, placed(f)] }, id: f.id };
    }
    case "furniture": {
      const f = from.furniture.find((x) => x.id === item.id);
      if (!f) return { from, to, id: null };
      return { from: left, to: { ...to, furniture: [...to.furniture, placed(f)] }, id: f.id };
    }
    case "addon": {
      const a = (from.addOns ?? []).find((x) => x.id === item.id);
      if (!a) return { from, to, id: null };
      const bottomIn = item.mount === "ceiling" ? Math.max(0, ceilingIn - a.heightIn) : g.bottomIn;
      return { from: left, to: { ...to, addOns: [...(to.addOns ?? []), { ...placed(a), bottomIn }] }, id: a.id };
    }
    default: {
      // Cabinets and outlets: a hand-placed one on the new floor, the same size.
      const out = placeItem(to, item.entryId, at, { rotation: at.rotation, widthIn: item.widthIn, depthIn: item.depthIn, heightIn: item.heightIn, bottomIn: g.bottomIn, ceilingIn });
      return out.id ? { from: left, to: out.plan, id: out.id } : { from, to, id: null };
    }
  }
}

// ---------- Doors and windows ----------

/** How close to a wall the dot must be to put a door or window on it. */
const OPENING_REACH_IN = 30;

/** Wall kept between a new door or window and one already there, for framing. */
const OPENING_GAP_IN = 4;

/** The other doors and windows along a wall, as stretches of inches along it (any wall on the same line counts). */
function takenAlong(plan: FloorPlan, seg: HostSegment, skipId?: string): { t0: number; t1: number; o: Opening }[] {
  const out: { t0: number; t1: number; o: Opening }[] = [];
  for (const o of plan.openings) {
    if (o.id === skipId) continue;
    if (seg.bulge) {
      // On a curve, offsets are inches along it: only openings on this same wall count.
      if (sameHost(o.host, seg.host)) out.push({ t0: o.offsetIn - o.widthIn / 2, t1: o.offsetIn + o.widthIn / 2, o });
      continue;
    }
    const g = openingGeometry(plan, o);
    const span = g && collinearOverlap(seg.a, seg.b, g.a, g.b, 4);
    if (span) out.push({ t0: span[0], t1: span[1], o });
  }
  return out;
}

const blocking = (taken: { t0: number; t1: number; o: Opening }[], t: number, widthIn: number) =>
  taken.find((s) => Math.min(s.t1, t + widthIn / 2) - Math.max(s.t0, t - widthIn / 2) > 1)?.o ?? null;

/** The door or window already where `o` would go on its wall, if any (`o` itself left out). */
export function openingInTheWay(plan: FloorPlan, o: Opening): Opening | null {
  const seg = hostSegment(plan, o.host);
  return seg ? blocking(takenAlong(plan, seg, o.id), o.offsetIn, o.widthIn) : null;
}

/**
 * A new door or window of `style` on the wall at `p` (null when no wall is
 * near). Aimed at another door or window, it slides to the nearest free
 * stretch of that wall it fits in; with none, it stays where aimed and
 * `openingInTheWay` names what's there.
 */
export function openingOnWall(plan: FloorPlan, p: Point, style: string, doorHeightIn?: number): Opening | null {
  const near = nearestHost(plan, p, OPENING_REACH_IN);
  if (!near) return null;
  const t = openingType(style);
  const widthIn = t.widths[0];
  const len = near.seg.length;
  const want = clampOffset(near.t, widthIn, len);
  const taken = takenAlong(plan, near.seg);
  let at = want;
  if (blocking(taken, want, widthIn)) {
    const tries = taken
      .flatMap((s) => [s.t0 - widthIn / 2 - OPENING_GAP_IN, s.t1 + widthIn / 2 + OPENING_GAP_IN])
      .filter((x) => x >= widthIn / 2 && x <= len - widthIn / 2 && !blocking(taken, x, widthIn))
      .sort((a, b) => Math.abs(a - want) - Math.abs(b - want));
    if (tries.length) at = tries[0];
  }
  return {
    id: newPlanId("o"),
    host: near.seg.host,
    offsetIn: round1(at),
    kind: t.kind,
    style: t.id,
    widthIn,
    heightIn: openingHeight(t.id, doorHeightIn),
    ...(t.sillIn !== undefined ? { sillIn: t.sillIn } : {}),
    side: near.side,
    hinge: "start",
  };
}

/** A door or window slid along its own wall so its middle is as near `p` as it can be. Null when `p` isn't by that wall. */
export function slideOpening(plan: FloorPlan, id: string, p: Point): Opening | null {
  const o = plan.openings.find((x) => x.id === id);
  if (!o) return null;
  const near = nearestHost({ ...plan, openings: [] }, p, OPENING_REACH_IN * 2);
  if (!near || JSON.stringify(near.seg.host) !== JSON.stringify(o.host)) return null;
  return { ...o, offsetIn: round1(clampOffset(near.t, o.widthIn, near.seg.length)) };
}

/** Where a door or window would be drawn, for its ghost. */
export function openingShape(plan: FloorPlan, o: Opening): OpeningGeometry | null {
  return openingGeometry({ ...plan, openings: [...plan.openings.filter((x) => x.id !== o.id), o] }, o);
}

/** Put a door or window into the plan (replacing the one with the same id). */
export function withOpening(plan: FloorPlan, o: Opening): FloorPlan {
  const has = plan.openings.some((x) => x.id === o.id);
  return { ...plan, openings: has ? plan.openings.map((x) => (x.id === o.id ? o : x)) : [...plan.openings, o] };
}

// ---------- Walls ----------

/** A spot for a wall's end, snapped onto a corner or a wall within about a foot. */
export function wallPoint(plan: FloorPlan, p: Point): Point {
  const s = snapPoint(p, snapTargets(plan), 12, false);
  return s.on ? { x: round1(s.p.x), y: round1(s.p.y) } : { x: Math.round(p.x), y: Math.round(p.y) };
}

/**
 * Add a wall from `a` to `b`, as the Furnish page's Wall tool does: a full
 * wall from one side of a room to the other splits the room in two; any other
 * is a loose wall (full, half, or half with a cap). Null when it's too short.
 */
export function addWall(plan: FloorPlan, a: Point, b: Point, height: WallHeight): { plan: FloorPlan; split: boolean; wallId?: string } | null {
  if (Math.hypot(b.x - a.x, b.y - a.y) < 12) return null;
  if (height === "full") {
    const split = splitRoom(plan, [a, b]);
    if (split) return { plan: split.plan, split: true };
  }
  const w = { id: newPlanId("w"), a, b, thicknessIn: 4.5, ...(height !== "full" ? { height } : {}) };
  return { plan: { ...plan, walls: [...plan.walls, w] }, split: false, wallId: w.id };
}

/** How tall a wall of this kind stands, for its ghost. */
export const wallHeightIn = (height: WallHeight, ceilingIn: number) => (height === "full" ? ceilingIn : Math.min(HALF_WALL_IN, ceilingIn));
