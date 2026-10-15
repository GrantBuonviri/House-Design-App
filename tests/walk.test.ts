import { describe, expect, it } from "vitest";
import { House3D, type FloorPlan, type Opening, type PlanRoom, type Point } from "@/lib/model/schema";
import { levelFor, levelsFor, MAIN_LEVEL_ID } from "@/lib/brief/levels";
import { defaultBasics } from "@/lib/plan/basics";
import { boundsOf, dist, pointInPolygon, rectangle } from "@/lib/plan/geometry";
import { stairsDrawing } from "@/lib/plan/stairs";
import type { HouseContext } from "@/lib/house3d/build";
import { levelHeights } from "@/lib/house3d/levels";
import { siteFor } from "@/lib/house3d/site";
import { BODY_RADIUS_IN, standOn, walkStep, walkWorld, whereAmI, yawToward, type Walker, type WalkWorld } from "@/lib/house3d/walk";

const FT = 12;

function room(id: string, x: number, y: number, w: number, h: number, type = "living"): PlanRoom {
  return { id, name: id, type, polygon: rectangle(x + w / 2, y + h / 2, w, h) };
}
function plan(rooms: PlanRoom[], extra: Partial<FloorPlan> = {}): FloorPlan {
  return { rooms, walls: [], openings: [], stairs: [], fixtures: [], furniture: [], ...extra };
}
function door(id: string, roomId: string, edge: number, offsetIn: number, style = "door-hinged", kind: Opening["kind"] = "door"): Opening {
  return { id, host: { roomId, edge }, offsetIn, kind, style, widthIn: 36, heightIn: kind === "window" ? 48 : 80, side: 1, hinge: "start" };
}

function world(plans: Record<string, FloorPlan>, levels = [levelFor(MAIN_LEVEL_ID)], ground?: (p: Point) => number): WalkWorld {
  const flat = siteFor(null, { x: 0, y: 0 }, plans);
  const site = ground ? { ...flat, groundAt: ground } : flat;
  const ctx: HouseContext = { levels, basics: defaultBasics(), house3d: House3D.parse({}), site, frame: { ox: 0, oy: 0 } };
  return walkWorld(plans, { ...ctx, heights: levelHeights(levels, ctx.basics) });
}

/** Walk straight ahead for some seconds. */
function walk(w: WalkWorld, from: Walker, seconds: number, forward = 1): Walker {
  let me = from;
  for (let t = 0; t < seconds; t += 1 / 60) me = walkStep(w, me, { forward, right: 0, fast: false }, 1 / 60);
  return me;
}
const at = (x: number, y: number, yaw: number, feet = 0): Walker => ({ p: { x, y }, feet, vz: 0, yaw, pitch: 0 });
const NORTH = 0;
const SOUTH = Math.PI;
const EAST = Math.PI / 2;

// Two rooms side by side, 12 ft deep, sharing a wall at x = 15 ft.
const twoRooms = (openings: Opening[] = []) => plan([room("a", 0, 0, 15 * FT, 12 * FT), room("b", 15 * FT, 0, 15 * FT, 12 * FT)], { openings });

describe("walking through the house", () => {
  it("stops at a wall instead of going through it", () => {
    const w = world({ [MAIN_LEVEL_ID]: twoRooms() });
    const me = walk(w, at(7 * FT, 6 * FT, EAST), 5);
    expect(me.p.x).toBeLessThan(15 * FT - BODY_RADIUS_IN);
    expect(me.p.x).toBeGreaterThan(15 * FT - BODY_RADIUS_IN - 6);
  });

  it("slides along a wall when walking into it at an angle", () => {
    const w = world({ [MAIN_LEVEL_ID]: twoRooms() });
    const me = walk(w, at(7 * FT, 6 * FT, EAST - 0.5), 4);
    expect(me.p.x).toBeLessThan(15 * FT - BODY_RADIUS_IN + 0.5);
    expect(me.p.y).toBeLessThan(3 * FT); // kept moving north along it
  });

  it("goes through a doorway", () => {
    // Room a's edge 1 runs down its east side, from y = 0 to 12 ft.
    const w = world({ [MAIN_LEVEL_ID]: twoRooms([door("d", "a", 1, 6 * FT)]) });
    const me = walk(w, at(7 * FT, 6 * FT, EAST), 5);
    expect(me.p.x).toBeGreaterThan(20 * FT);
    expect(whereAmI(w, { [MAIN_LEVEL_ID]: twoRooms() }, me).roomName).toBe("b");
  });

  it("doesn't go through a window or a closed garage door", () => {
    for (const o of [door("w", "a", 1, 6 * FT, "window", "window"), door("g", "a", 1, 6 * FT, "door-garage")]) {
      const w = world({ [MAIN_LEVEL_ID]: twoRooms([o]) });
      expect(walk(w, at(7 * FT, 6 * FT, EAST), 5).p.x).toBeLessThan(15 * FT);
    }
  });

  it("bumps into a kitchen island but walks into a shower", () => {
    const island = { id: "i", kind: "island", x: 7 * FT, y: 3 * FT, rotation: 0, widthIn: 72, depthIn: 36 };
    const shower = { id: "s", kind: "shower", x: 7 * FT, y: 3 * FT, rotation: 0, widthIn: 60, depthIn: 36 };
    const run = (fx: typeof island) => walk(world({ [MAIN_LEVEL_ID]: plan([room("a", 0, 0, 15 * FT, 12 * FT)], { fixtures: [fx] }) }), at(7 * FT, 10 * FT, NORTH), 2);
    expect(run(island).p.y).toBeGreaterThan(3 * FT + 18);
    expect(run(shower).p.y).toBeLessThan(3 * FT + 18);
  });

  it("climbs the stairs to the floor above and stands on it", () => {
    const levels = levelsFor(2, 0);
    const stairs = { id: "s", x: 10 * FT, y: 14 * FT, rotation: 0, widthIn: 40, shape: "straight" as const, flip: false, toLevelId: "floor-2" };
    const plans = { "floor-1": plan([room("a", 0, 0, 20 * FT, 24 * FT)], { stairs: [stairs] }), "floor-2": plan([room("b", 0, 0, 20 * FT, 24 * FT)]) };
    const w = world(plans, levels);
    const top = levelHeights(levels, defaultBasics())["floor-2"].floorIn;
    const fp = boundsOf(stairsDrawing(stairs, top).footprint)!;
    // Start just south of the bottom step and walk north up the flight and onto the landing floor.
    let me = walk(w, at(10 * FT, fp.y1 + 12, NORTH), 1.5);
    expect(me.feet).toBeGreaterThan(0);
    expect(me.feet).toBeLessThan(top);
    me = walk(w, me, 6);
    expect(me.feet).toBe(top);
    expect(me.p.y).toBeLessThan(fp.y0);
    expect(whereAmI(w, plans, me).levelName).toBe(levels[1].name);
    // And back down.
    me = walk(w, { ...me, yaw: SOUTH }, 8);
    expect(me.feet).toBe(0);
  });

  it("can't climb a ledge taller than a step", () => {
    const w = world({ [MAIN_LEVEL_ID]: plan([room("a", 0, 0, 15 * FT, 12 * FT)], { openings: [door("d", "a", 2, 7 * FT)] }) });
    // Pretend the ground is 3 ft down.
    const low: WalkWorld = { ...w, groundAt: () => -36 };
    const me = walk(low, at(7 * FT, 16 * FT, NORTH, -36), 4);
    expect(me.p.y).toBeGreaterThan(12 * FT);
    // At the usual 8 inches, it's one step up through the door.
    const ok = walk(w, at(7 * FT, 16 * FT, NORTH, w.groundAt({ x: 7 * FT, y: 16 * FT })), 4);
    expect(ok.p.y).toBeLessThan(12 * FT);
    expect(ok.feet).toBe(0);
  });

  it("walks up front steps where the ground drops away from the door", () => {
    const p = plan([room("a", 0, 0, 15 * FT, 12 * FT)], { openings: [door("d", "a", 2, 7 * FT, "door-entry")] });
    const w = world({ [MAIN_LEVEL_ID]: p }, undefined, (q) => (q.y > 12 * FT ? -40 - (q.y - 12 * FT) / 10 : -8));
    expect(w.start.feet).toBeLessThan(-40);
    const me = walk(w, { ...w.start, vz: 0, pitch: 0 }, 6);
    expect(me.feet).toBe(0);
    expect(me.p.y).toBeLessThan(12 * FT);
  });

  it("falls to the ground walking off a deck", () => {
    const p = plan([room("a", 0, 0, 15 * FT, 12 * FT), room("deck", 0, 12 * FT, 15 * FT, 8 * FT, "deck")]);
    const w = world({ [MAIN_LEVEL_ID]: p });
    const me = walk(w, at(7 * FT, 15 * FT, SOUTH), 3);
    expect(me.p.y).toBeGreaterThan(20 * FT);
    expect(me.feet).toBeCloseTo(w.groundAt(me.p), 5);
  });

  it("starts outside the front door, facing it", () => {
    const front = door("f", "a", 2, 7 * FT, "door-entry");
    const p = plan([room("a", 0, 0, 15 * FT, 12 * FT), room("b", 15 * FT, 0, 15 * FT, 12 * FT)], { openings: [door("back", "b", 0, 7 * FT), front] });
    const w = world({ [MAIN_LEVEL_ID]: p });
    const doorAt = { x: 15 * FT - 7 * FT, y: 12 * FT };
    expect(w.start.p.y).toBeGreaterThan(12 * FT + 48);
    expect(dist(w.start.p, doorAt)).toBeLessThan(10 * FT);
    expect(w.start.yaw).toBeCloseTo(yawToward(w.start.p, doorAt), 5);
    expect(w.start.feet).toBeCloseTo(w.groundAt(w.start.p), 5);
  });

  it("starts past the porch when the front door opens onto one", () => {
    const p = plan([room("a", 0, 0, 15 * FT, 12 * FT), room("porch", 0, 12 * FT, 15 * FT, 6 * FT, "porch")], { openings: [door("f", "a", 2, 7 * FT, "door-entry")] });
    const w = world({ [MAIN_LEVEL_ID]: p });
    expect(w.start.p.y).toBeGreaterThan(18 * FT);
  });

  it("has a spot inside every room to jump to, even an L-shaped one", () => {
    const L: PlanRoom = { id: "l", name: "L", type: "living", polygon: [{ x: 0, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 60 }, { x: 60, y: 60 }, { x: 60, y: 240 }, { x: 0, y: 240 }] };
    const w = world({ [MAIN_LEVEL_ID]: plan([L]) });
    const stop = w.rooms.find((r) => r.id === "l")!;
    expect(pointInPolygon(stop.spot.p, L.polygon)).toBe(true);
    expect(standOn(w, stop.spot.p, 24)).toBe(0);
  });
});
