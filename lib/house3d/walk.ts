import type { FloorPlan, Level, Point } from "@/lib/model/schema";
import { MAIN_LEVEL_ID } from "@/lib/brief/levels";
import { exteriorWallIn } from "@/lib/plan/basics";
import { planOf, type Plans } from "@/lib/plan/edit";
import { add, boundsOf, dist, polygonArea, polygonCenter, pointInPolygon, project, rectangle, scale, sub } from "@/lib/plan/geometry";
import { areaKind } from "@/lib/plan/measure";
import { stairsDrawing, stairsFrame } from "@/lib/plan/stairs";
import { openingGeometries, solidWalls, wallPieces, wallTopIn } from "@/lib/plan/walls";
import type { HouseContext } from "./build";
import { cutHoles, type Region } from "./footprint";
import type { LevelHeights } from "./levels";
import { entrySteps } from "./entry";
import { fixtureSpan } from "./fixtures";
import { furnitureHeight, furnitureOutline, furnitureType } from "@/lib/plan/furniture";
import { stairSteps } from "./stairs";
import { flatPlans } from "@/lib/plan/flatten";

/**
 * Walking through the house in first person. Pure data and math, so it can
 * be tested: the walls you bump into, the floors, stairs and ground you
 * stand on, where you start, and one step of moving.
 *
 * Everything is in plan inches (x east, y south) and heights in inches above
 * the main floor, like the rest of lib/house3d.
 */

/** Eye height above the floor (about 5' 4"). */
export const EYE_IN = 64;
/** How close you can get to a wall. */
export const BODY_RADIUS_IN = 10;
/** The biggest step up you take without noticing (a stair, a porch step, a curb). */
export const STEP_UP_IN = 24;
/** Walls below this height above your feet don't stop you (you'd step over them). */
const KNEE_IN = 6;
/** Anything starting this far above your feet is overhead (a door header, the floor above). */
const CHEST_IN = 40;
export const WALK_IN_PER_S = 54;
export const FAST = 2.2;
const GRAVITY_IN_PER_S2 = 386;

/** A wall (or the side of a fixture) as a thick line you can't pass. */
export type Blocker = { a: Point; b: Point; half: number; z0: number; z1: number };
/** Somewhere you can stand. */
export type Surface = {
  region: Region;
  z: number;
  /** A room on the lowest floors, with the foundation around it: the ground underneath is out of reach. */
  onFoundation?: boolean;
};

export type Spot = { p: Point; feet: number; yaw: number };
export type RoomStop = { id: string; name: string; levelId: string; levelName: string; spot: Spot };

export type WalkWorld = {
  blockers: Blocker[];
  surfaces: Surface[];
  groundAt: (p: Point) => number;
  /** You can't walk further out than this. */
  limits: { x0: number; y0: number; x1: number; y1: number };
  start: Spot;
  rooms: RoomStop[];
  levels: { id: string; name: string; floorIn: number }[];
};

export type Walker = { p: Point; feet: number; vz: number; yaw: number; pitch: number };

/** Doors you can walk through: all but the (closed) garage door. Windows stay solid. */
const walkable = (style: string, kind: string) => kind === "opening" || (kind === "door" && style !== "door-garage");

const inRegion = (p: Point, r: Region) => pointInPolygon(p, r.outline) && !r.holes.some((h) => pointInPolygon(p, h));

/** Which way you face (degrees clockwise from north, in radians) to look from `from` toward `to`. */
export const yawToward = (from: Point, to: Point) => Math.atan2(to.x - from.x, -(to.y - from.y));
/** The direction you walk at a heading: north is up the page (y down). */
export const heading = (yaw: number): Point => ({ x: Math.sin(yaw), y: -Math.cos(yaw) });

export function walkWorld(plans: Plans, ctx: HouseContext & { heights: LevelHeights }): WalkWorld {
  plans = flatPlans(plans);
  const { heights, site } = ctx;
  const exteriorIn = exteriorWallIn(ctx.basics);
  const blockers: Blocker[] = [];
  const surfaces: Surface[] = [];
  const rooms: RoomStop[] = [];
  const levels = ctx.levels
    .filter((l) => heights[l.id] && (plans[l.id]?.rooms.length ?? 0) > 0)
    .sort((a, b) => heights[a.id].floorIn - heights[b.id].floorIn);

  for (const level of levels) {
    const plan = planOf(plans, level.id);
    const { floorIn, ceilingIn } = heights[level.id];
    const above = levels.find((l) => heights[l.id].floorIn > floorIn);
    const top = above ? heights[above.id].floorIn : floorIn + ceilingIn;

    // Walls, with gaps at doors and openings.
    const ogs = openingGeometries(plan).filter((g) => walkable(g.opening.style, g.opening.kind));
    for (const w of solidWalls(wallPieces(plan, exteriorIn), ogs)) {
      if (w.open || w.thicknessIn <= 0) continue;
      // A half wall still stops you walking through it, but only stands 42" tall.
      blockers.push({ a: w.a, b: w.b, half: w.thicknessIn / 2, z0: floorIn, z1: w.piece.height ? floorIn + wallTopIn(w.piece, ceilingIn) : top });
    }
    // Counters, tubs, the fridge and so on.
    for (const fx of plan.fixtures) {
      const span = fixtureSpan(fx.kind);
      const box = rectangle(fx.x, fx.y, fx.widthIn, fx.depthIn, fx.rotation);
      box.forEach((a, i) => blockers.push({ a, b: box[(i + 1) % 4], half: 0.5, z0: floorIn + span.z0, z1: floorIn + span.z1 }));
    }
    // Furniture (rugs you walk over).
    for (const item of plan.furniture) {
      if (furnitureType(item.kind)?.flat) continue;
      const box = furnitureOutline(item);
      box.forEach((a, i) => blockers.push({ a, b: box[(i + 1) % 4], half: 0.5, z0: floorIn, z1: floorIn + furnitureHeight(item.kind) }));
    }

    // Floors, with a hole where stairs come up from below.
    const holes: Point[][] = [];
    for (const other of levels) {
      for (const s of plans[other.id]?.stairs ?? []) {
        if (s.toLevelId === level.id) holes.push(stairsDrawing(s, floorIn - heights[other.id].floorIn).footprint);
      }
    }
    for (const r of plan.rooms) for (const region of cutHoles(r.polygon, holes)) surfaces.push({ region, z: floorIn, onFoundation: floorIn <= 1 });

    // Each step of the stairs is something to stand on.
    for (const s of plan.stairs) {
      const to = s.toLevelId && heights[s.toLevelId];
      const rise = to ? to.floorIn - floorIn : ceilingIn + 13;
      if (rise <= 12) continue;
      const fr = stairsFrame(s, rise);
      for (const step of stairSteps(s.shape, s.widthIn, fr.treads, fr.riserIn)) {
        surfaces.push({ region: { outline: step.outline.map(fr.place), holes: [] }, z: floorIn + step.top });
      }
    }

    // Steps down from outside doors and porches.
    for (const st of entrySteps(plan, floorIn, exteriorIn, site.groundAt)) surfaces.push({ region: { outline: st.outline, holes: [] }, z: st.top });

    // Rooms you can jump to.
    for (const r of plan.rooms) {
      const p = insidePoint(r.polygon);
      rooms.push({ id: r.id, name: r.name, levelId: level.id, levelName: level.name, spot: { p, feet: floorIn, yaw: 0 } });
    }
  }

  const all = levels.flatMap((l) => plans[l.id].rooms.flatMap((r) => r.polygon));
  const house = boundsOf(all) ?? { x0: -600, y0: -600, x1: 600, y1: 600 };
  const lot = site.plot ? boundsOf(site.plot.outline.map((q) => sub(q, site.offset))) : null;
  const margin = 50 * 12;
  const limits = {
    x0: Math.min(house.x0, lot?.x0 ?? Infinity) - margin,
    y0: Math.min(house.y0, lot?.y0 ?? Infinity) - margin,
    x1: Math.max(house.x1, lot?.x1 ?? -Infinity) + margin,
    y1: Math.max(house.y1, lot?.y1 ?? -Infinity) + margin,
  };

  const world: WalkWorld = {
    blockers,
    surfaces,
    groundAt: site.groundAt,
    limits,
    start: { p: { x: (house.x0 + house.x1) / 2, y: house.y1 + 120 }, feet: 0, yaw: 0 },
    rooms,
    levels: levels.map((l) => ({ id: l.id, name: l.name, floorIn: heights[l.id].floorIn })),
  };
  world.start = frontDoorSpot(world, plans, levels, heights) ?? outsideSpot(world, house);
  for (const r of world.rooms) r.spot = settle(world, r.spot);
  return world;
}

/** A point well inside a room: its middle, or the inside point nearest to it for odd shapes. */
export function insidePoint(poly: Point[]): Point {
  const c = polygonCenter(poly);
  const deep = (p: Point) => pointInPolygon(p, poly) && poly.every((a, i) => project(p, a, poly[(i + 1) % poly.length]).d > BODY_RADIUS_IN + 6);
  if (deep(c)) return c;
  const bb = boundsOf(poly)!;
  let best: Point | null = null;
  const step = Math.max(6, Math.min(bb.x1 - bb.x0, bb.y1 - bb.y0) / 12);
  for (let x = bb.x0; x <= bb.x1; x += step) {
    for (let y = bb.y0; y <= bb.y1; y += step) {
      const p = { x, y };
      if (deep(p) && (!best || dist(p, c) < dist(best, c))) best = p;
    }
  }
  return best ?? c;
}

/** Outside the front door, facing it. */
function frontDoorSpot(world: WalkWorld, plans: Plans, levels: Level[], heights: LevelHeights): Spot | null {
  const main = levels.find((l) => l.id === MAIN_LEVEL_ID) ?? levels.find((l) => heights[l.id].floorIn >= 0) ?? levels[0];
  if (!main) return null;
  const plan: FloorPlan = plans[main.id];
  const indoor = plan.rooms.filter((r) => areaKind(r) !== "outdoor").map((r) => r.polygon);
  const floorIn = heights[main.id].floorIn;
  const doors = openingGeometries(plan)
    .filter((g) => g.opening.kind === "door" && g.opening.style !== "door-garage")
    .map((g) => {
      // Which side of the wall is outside the house?
      const probe = (s: number) => add(g.center, scale(g.n, s * 24));
      const outSide = !indoor.some((poly) => pointInPolygon(probe(1), poly)) ? 1 : !indoor.some((poly) => pointInPolygon(probe(-1), poly)) ? -1 : 0;
      return { g, outSide, entry: g.opening.style === "door-entry" ? 0 : 1 };
    })
    .filter((d) => d.outSide !== 0)
    .sort((a, b) => a.entry - b.entry || b.g.opening.widthIn - a.g.opening.widthIn);
  const d = doors[0];
  if (!d) return null;
  // Out past any porch or front steps, then a few more feet.
  const out = (t: number) => add(d.g.center, scale(d.g.n, d.outSide * t));
  const onHouse = (q: Point) => world.surfaces.some((s) => s.z >= floorIn - 6 * 12 && s.z <= floorIn && inRegion(q, s.region));
  let t = 12;
  for (let clear = 0; t < 40 * 12 && clear < 48; t += 12) clear = onHouse(out(t)) ? 0 : clear + 12;
  const p = out(Math.max(72, t));
  return settle(world, { p, feet: floorIn, yaw: yawToward(p, d.g.center) });
}

function outsideSpot(world: WalkWorld, house: { x0: number; y0: number; x1: number; y1: number }): Spot {
  const p = { x: (house.x0 + house.x1) / 2, y: house.y1 + 120 };
  return settle(world, { p, feet: 0, yaw: 0 });
}

/** Put a spot on the floor or ground under it, clear of walls. */
function settle(world: WalkWorld, s: Spot): Spot {
  const p = pushOut(world, s.p, s.feet);
  const feet = standOn(world, p, s.feet + STEP_UP_IN) ?? world.groundAt(p);
  return { ...s, p, feet };
}

/** The height of what you'd stand on here: the highest floor, step or ground no more than `reach` up. */
export function standOn(world: WalkWorld, p: Point, reach: number): number | null {
  let best: number | null = null;
  let underHouse = false;
  for (const s of world.surfaces) {
    const inside = (s.z <= reach && (best === null || s.z > best)) || (s.onFoundation && !underHouse) ? inRegion(p, s.region) : false;
    if (!inside) continue;
    if (s.z <= reach && (best === null || s.z > best)) best = s.z;
    if (s.onFoundation) underHouse = true;
  }
  const g = world.groundAt(p);
  if (!underHouse && g <= reach && (best === null || g > best)) best = g;
  return best;
}

/** Slide out of any wall you're touching. */
export function pushOut(world: WalkWorld, p: Point, feet: number): Point {
  let q = p;
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (const b of world.blockers) {
      if (b.z1 <= feet + KNEE_IN || b.z0 >= feet + CHEST_IN) continue;
      const pr = project(q, b.a, b.b);
      const need = b.half + BODY_RADIUS_IN;
      if (pr.d >= need) continue;
      let away = sub(q, pr.point);
      if (Math.hypot(away.x, away.y) < 1e-6) {
        // Right on the line: step off it to the left of the wall.
        const d = sub(b.b, b.a);
        away = { x: d.y, y: -d.x };
      }
      const len = Math.hypot(away.x, away.y);
      q = add(pr.point, scale(away, need / len));
      moved = true;
    }
    if (!moved) break;
  }
  return q;
}

/** Which way the keys say to go, in the walker's own terms (forward and right, each -1 to 1). */
export type MoveInput = { forward: number; right: number; fast: boolean };

/** Move for `dt` seconds: walk, bump into walls, climb steps, fall off edges. */
export function walkStep(world: WalkWorld, w: Walker, input: MoveInput, dt: number): Walker {
  dt = Math.min(dt, 0.05);
  const f = heading(w.yaw);
  const r = { x: -f.y, y: f.x };
  let dir = add(scale(f, input.forward), scale(r, input.right));
  const len = Math.hypot(dir.x, dir.y);
  if (len > 1) dir = scale(dir, 1 / len);
  const speed = WALK_IN_PER_S * (input.fast ? FAST : 1);
  const move = scale(dir, speed * dt);

  let p = w.p;
  // Try the whole move, then each half of it alone, so you slide along a ledge instead of sticking.
  for (const m of [move, { x: move.x, y: 0 }, { x: 0, y: move.y }]) {
    if (Math.abs(m.x) < 1e-9 && Math.abs(m.y) < 1e-9) continue;
    const next = pushOut(world, add(w.p, m), w.feet);
    const { limits: L } = world;
    if (next.x < L.x0 || next.x > L.x1 || next.y < L.y0 || next.y > L.y1) continue;
    if (standOn(world, next, w.feet + STEP_UP_IN) === null) continue; // a ledge too high to step up
    p = next;
    break;
  }
  if (p === w.p) p = pushOut(world, w.p, w.feet);

  const ground = standOn(world, p, w.feet + STEP_UP_IN) ?? w.feet;
  let feet = w.feet;
  let vz = w.vz;
  if (ground >= feet) {
    feet = ground;
    vz = 0;
  } else {
    vz -= GRAVITY_IN_PER_S2 * dt;
    feet = Math.max(ground, feet + vz * dt);
    if (feet === ground) vz = 0;
  }
  return { ...w, p, feet, vz };
}

/** The floor and room you're in, for the label on screen. */
export function whereAmI(world: WalkWorld, plans: Plans, w: Walker): { levelName: string; roomName: string } {
  plans = flatPlans(plans);
  const lv = [...world.levels].reverse().find((l) => l.floorIn <= w.feet + STEP_UP_IN) ?? world.levels[0];
  if (!lv) return { levelName: "", roomName: "Outside" };
  const plan = planOf(plans, lv.id);
  // Smallest room first, so a closet inside a bedroom reads as the closet.
  const room = [...plan.rooms].sort((a, b) => polygonArea(a.polygon) - polygonArea(b.polygon)).find((r) => pointInPolygon(w.p, r.polygon));
  return { levelName: lv.name, roomName: room ? room.name : "Outside" };
}
