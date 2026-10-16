import type { FloorPlan, Opening, PlanBasics, Point } from "@/lib/model/schema";
import { exteriorWallIn } from "@/lib/plan/basics";
import { planOf, type Plans } from "@/lib/plan/edit";
import { add, cross, pointInPolygon, scale, sub } from "@/lib/plan/geometry";
import { areaKind } from "@/lib/plan/measure";
import { openingGeometry, wallPieces, type OpeningGeometry } from "@/lib/plan/walls";
import { compassName } from "@/lib/land/sun";
import { hostPiece, type HouseContext } from "./build";
import type { LevelHeights } from "./levels";
import { toScene, type Vec3 } from "./mesh";
import { openingSpan } from "./openings";
import { EYE_IN } from "./walk";
import { flatPlan, flatPlans } from "@/lib/plan/flatten";

/**
 * Where to stand to preview a window: inside the room a few steps back,
 * looking out through it, and outside on the ground, looking back at it on
 * the outside wall. Windows and sliding glass doors in outside walls can be
 * previewed; anything on an inside wall has no outside to see.
 */

/** A camera spot in the scene (feet, x east, y up, z south), looking at `target`. */
export type Shot = { eye: Vec3; target: Vec3 };

export type WindowViews = {
  levelId: string;
  opening: Opening;
  og: OpeningGeometry;
  /** Points out of the house, along the plan. */
  out: Point;
  /** The thickness of the wall it's in. */
  wallIn: number;
  /** The bottom and top of the window, inches above the main floor. */
  z0: number;
  z1: number;
  /** The room it's in, and which way it looks ("south-west"). */
  roomName: string | null;
  facing: string;
  inside: Shot;
  outside: Shot;
};

/** How far back from the window to stand inside, at most. */
export const INSIDE_BACK_IN = 72;
/** How far out from the wall to stand outside, for a window on the main floor. */
export const OUTSIDE_OUT_IN = 240;

const isGlass = (o: Opening) => o.kind === "window" || o.style === "door-slider";

/** The window's place on its wall, if it's a window (or sliding glass door) in an outside wall. */
function onOutsideWall(plan: FloorPlan, opening: Opening, exteriorIn: number) {
  if (!isGlass(opening)) return null;
  const og = openingGeometry(plan, opening);
  if (!og) return null;
  const piece = hostPiece(wallPieces(plan, exteriorIn), og);
  if (!piece || !piece.exterior || piece.open) return null;
  return { og, piece };
}

/** Whether a door or window can be previewed: a window or sliding glass door in an outside wall. */
export function canPreview(plan: FloorPlan, opening: Opening, basics: PlanBasics | null): boolean {
  plan = flatPlan(plan);
  opening = plan.openings.find((o) => o.id === opening.id) ?? opening;
  return onOutsideWall(plan, opening, exteriorWallIn(basics)) !== null;
}

const indoorRooms = (plan: FloorPlan) => plan.rooms.filter((r) => areaKind(r) !== "outdoor");

/** How far along a ray from `o` in direction `d` (a unit vector) until it crosses one of the segments, or Infinity. */
export function rayToSegments(o: Point, d: Point, segs: { a: Point; b: Point }[], from = 0): number {
  let best = Infinity;
  for (const s of segs) {
    const e = sub(s.b, s.a);
    const den = cross(d, e);
    if (Math.abs(den) < 1e-9) continue;
    const w = sub(s.a, o);
    const t = cross(w, e) / den;
    const u = cross(w, d) / den;
    if (t > from && u >= -1e-6 && u <= 1 + 1e-6 && t < best) best = t;
  }
  return best;
}

export function windowViews(plans: Plans, ctx: HouseContext & { heights: LevelHeights }, levelId: string, openingId: string): WindowViews | null {
  plans = flatPlans(plans);
  const plan = planOf(plans, levelId);
  const opening = plan.openings.find((o) => o.id === openingId);
  const h = ctx.heights[levelId];
  if (!opening || !h) return null;
  const exteriorIn = exteriorWallIn(ctx.basics);
  const found = onOutsideWall(plan, opening, exteriorIn);
  if (!found) return null;
  const { og, piece } = found;
  const wallIn = piece.thicknessIn;
  const f = ctx.frame;

  // Which side is outside: the side with no indoor room on it.
  const rooms = indoorRooms(plan);
  const probe = wallIn / 2 + 6;
  const indoorAt = (p: Point) => rooms.some((r) => pointInPolygon(p, r.polygon));
  const plus = indoorAt(add(og.center, scale(og.n, probe)));
  const minus = indoorAt(add(og.center, scale(og.n, -probe)));
  let out = og.n;
  if (plus && !minus) out = scale(og.n, -1);
  else if (plus === minus && "roomId" in opening.host) {
    const host = plan.rooms.find((r) => "roomId" in opening.host && r.id === opening.host.roomId);
    if (host && areaKind(host) !== "outdoor" && pointInPolygon(add(og.center, scale(og.n, probe)), host.polygon)) out = scale(og.n, -1);
  }
  const inward = scale(out, -1);
  const room = rooms.find((r) => pointInPolygon(add(og.center, scale(inward, probe)), r.polygon));

  const { bottom, top } = openingSpan(og, h.ceilingIn);
  const z0 = h.floorIn + bottom;
  const z1 = h.floorIn + top;
  const mid = (z0 + z1) / 2;
  const target = toScene(f, og.center, mid);

  // Inside: a few steps back into the room, but never through the wall behind.
  const pieces = wallPieces(plan, exteriorIn).filter((p) => !p.open);
  const behind = rayToSegments(og.center, inward, pieces, wallIn / 2 + 1);
  const depth = Number.isFinite(behind) ? behind : INSIDE_BACK_IN * 2;
  const back = depth >= INSIDE_BACK_IN + 18 ? INSIDE_BACK_IN : Math.max(Math.min(depth - 18, INSIDE_BACK_IN), depth / 2);
  const eyeIn = h.floorIn + Math.min(EYE_IN, h.ceilingIn - 8);
  const inside: Shot = { eye: toScene(f, add(og.center, scale(inward, back)), eyeIn), target };

  // Outside: out on the ground, further back for upper floors, and short of any other part of the house
  // at eye height (an upper floor hanging out over the ground doesn't count).
  const want = OUTSIDE_OUT_IN + Math.max(0, h.floorIn) * 0.6;
  const eyeZ = ctx.site.groundAt(add(og.center, scale(out, want))) + EYE_IN;
  const walls = ctx.levels.flatMap((l) => {
    const lh = ctx.heights[l.id];
    if (!lh || eyeZ < lh.floorIn - 12 || eyeZ > lh.floorIn + lh.ceilingIn) return [];
    return wallPieces(planOf(plans, l.id), exteriorIn).filter((p) => !p.open);
  });
  const hit = rayToSegments(og.center, out, walls, wallIn / 2 + 1);
  const dist = Math.max(48, Math.min(want, hit - 30));
  const spot = add(og.center, scale(out, dist));
  let stand = ctx.site.groundAt(spot);
  // On a porch or deck, stand on its floor rather than the ground under it.
  for (const l of ctx.levels) {
    const lh = ctx.heights[l.id];
    if (!lh || lh.floorIn <= stand || lh.floorIn > h.floorIn + 1) continue;
    const pl = plans[l.id];
    if (pl?.rooms.some((r) => areaKind(r) === "outdoor" && pointInPolygon(spot, r.polygon))) stand = lh.floorIn;
  }
  const outside: Shot = { eye: toScene(f, spot, stand + EYE_IN), target };

  const facingDeg = (Math.atan2(out.x, -out.y) * 180) / Math.PI;
  return { levelId, opening, og, out, wallIn, z0, z1, roomName: room?.name ?? null, facing: compassName(facingDeg), inside, outside };
}
