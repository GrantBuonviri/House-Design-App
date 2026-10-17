import { describe, expect, it } from "vitest";
import { House3D, type FloorPlan, type PlanRoom, type PlanStairs, type Point } from "@/lib/model/schema";
import { levelsFor } from "@/lib/brief/levels";
import { defaultBasics } from "@/lib/plan/basics";
import { add, boundsOf, rectangle, scale, sub } from "@/lib/plan/geometry";
import { placedSteps, stairsCut, stairsDrawing, stackedHeadroom } from "@/lib/plan/stairs";
import { polygonArea, pointInPolygon } from "@/lib/plan/geometry";
import { makeStairsU, planWarnings } from "@/lib/plan/checks";
import { buildHouse, type HouseContext } from "@/lib/house3d/build";
import { levelHeights, type LevelHeights } from "@/lib/house3d/levels";
import { siteFor } from "@/lib/house3d/site";
import { HEAD_IN, headroomAt, openAllDoors, walkStep, walkWorld, yawToward, type Walker, type WalkWorld } from "@/lib/house3d/walk";

/** Stairs stacked in the same spot on every floor: climb from the lowest floor to the top and back down. */

const FT = 12;
const room = (id: string): PlanRoom => ({ id, name: id, type: "living", polygon: rectangle(15 * FT, 15 * FT, 30 * FT, 30 * FT) });
const plan = (rooms: PlanRoom[], stairs: PlanStairs[] = []): FloorPlan => ({ rooms, walls: [], openings: [], stairs, fixtures: [], furniture: [] });

function stackedHouse(above: number, below: number, shape: PlanStairs["shape"], turn = (i: number) => 0 * i) {
  const levels = levelsFor(above, below);
  const basics = defaultBasics();
  const heights = levelHeights(levels, basics);
  const ids = [...levels].sort((a, b) => heights[a.id].floorIn - heights[b.id].floorIn).map((l) => l.id);
  const plans: Record<string, FloorPlan> = {};
  const flights: { s: PlanStairs; rise: number; floorIn: number }[] = [];
  ids.forEach((id, i) => {
    const to = ids[i + 1];
    const s: PlanStairs | null = to ? { id: `s-${id}`, x: 15 * FT, y: 15 * FT, rotation: turn(i), widthIn: 40, shape, flip: false, toLevelId: to } : null;
    plans[id] = plan([room(`r-${id}`)], s ? [s] : []);
    if (s) flights.push({ s, rise: heights[to].floorIn - heights[id].floorIn, floorIn: heights[id].floorIn });
  });
  const site = siteFor(null, { x: 0, y: 0 }, plans);
  const ctx: HouseContext = { levels, basics, house3d: House3D.parse({}), site, frame: { ox: 0, oy: 0 } };
  const w = walkWorld(plans, { ...ctx, heights });
  openAllDoors(w);
  return { w, heights: heights as LevelHeights, ids, flights, plans, levels, ctx };
}

/** Walk toward each point in turn, as a person following the stairs would. */
function follow(w: WalkWorld, me: Walker, path: Point[], track: number[]): Walker {
  for (const target of path) {
    for (let t = 0; t < 8; t += 1 / 60) {
      if (Math.hypot(target.x - me.p.x, target.y - me.p.y) < 3) break;
      me = walkStep(w, { ...me, yaw: yawToward(me.p, target) }, { forward: 1, right: 0, fast: false }, 1 / 60);
      track.push(me.feet);
    }
  }
  return me;
}

const dirOf = (a: Point, b: Point) => {
  const d = sub(b, a);
  return scale(d, 1 / Math.hypot(d.x, d.y));
};

/** The walking line of a flight with a lead-in and a lead-out on the floors at each end. */
function upPath(f: { s: PlanStairs; rise: number }): Point[] {
  const arrow = stairsDrawing(f.s, f.rise).arrow;
  const n = arrow.length;
  const before = add(arrow[0], scale(dirOf(arrow[1], arrow[0]), 20));
  const after = add(arrow[n - 1], scale(dirOf(arrow[n - 2], arrow[n - 1]), 20));
  return [before, ...arrow, after];
}

/** From the top of one flight to the bottom of the next, around the east side of all the stairs. */
function between(from: Point, to: Point, flights: { s: PlanStairs; rise: number }[]): Point[] {
  const b = boundsOf(flights.flatMap((f) => stairsDrawing(f.s, f.rise).footprint))!;
  const east = b.x1 + 30;
  return [{ x: east, y: from.y }, { x: east, y: to.y }, to];
}

describe.each(["straight", "l", "u"] as const)("stacked %s stairs", (shape) => {
  it.each([
    [2, 1],
    [3, 1],
  ])("climbs all %i+%i floors and comes back down", (above, below) => {
    const { w, heights, ids, flights } = stackedHouse(above, below, shape);
    const up = flights.map(upPath);
    const track: number[] = [];
    let me: Walker = { p: up[0][0], feet: heights[ids[0]].floorIn, vz: 0, yaw: 0, pitch: 0 };
    for (let i = 0; i < flights.length; i++) {
      if (i > 0) me = follow(w, me, between(me.p, up[i][0], flights), track);
      me = follow(w, me, up[i].slice(1), track);
      expect(me.feet, `on top of flight ${i + 1}`).toBeCloseTo(heights[ids[i + 1]].floorIn, 3);
    }
    for (let i = flights.length - 1; i >= 0; i--) {
      const down = [...up[i]].reverse();
      if (i < flights.length - 1) me = follow(w, me, between(me.p, down[0], flights), track);
      me = follow(w, me, down.slice(1), track);
      expect(me.feet, `at the bottom of flight ${i + 1}`).toBeCloseTo(heights[ids[i]].floorIn, 3);
    }
    // Never fell through to a floor below or popped up a whole floor.
    for (let k = 1; k < track.length; k++) expect(Math.abs(track[k] - track[k - 1])).toBeLessThan(24);
  });
});

describe("stairs you walk under", () => {
  it("bumps your head on the underside of a U-shaped landing instead of walking under it", () => {
    const { w, flights } = stackedHouse(2, 0, "u");
    const steps = placedSteps(flights[0].s, flights[0].rise, true);
    const landing = steps.find((st) => polygonArea(st.outline) > 40 * 40 * 1.5)!;
    const lb = boundsOf(landing.outline)!;
    // On the floor north of the landing, walking south under it.
    let me: Walker = { p: { x: (lb.x0 + lb.x1) / 2, y: lb.y0 - 30 }, feet: 0, vz: 0, yaw: Math.PI, pitch: 0 };
    for (let t = 0; t < 3; t += 1 / 60) me = walkStep(w, me, { forward: 1, right: 0, fast: false }, 1 / 60);
    expect(me.feet).toBe(0);
    expect(me.p.y).toBeLessThan(lb.y0);
    expect(headroomAt(w, { x: me.p.x, y: lb.y0 + 5 }, 0)).toBeLessThan(HEAD_IN);
  });

  it("leaves the stacked flights open underneath, with the overhead flight a full floor up", () => {
    const { w, heights, ids } = stackedHouse(2, 1, "u");
    // Standing on the basement stairs, the main floor's stairs overhead are well clear.
    const low = w.surfaces.filter((s) => s.under !== undefined && s.z < heights[ids[1]].floorIn);
    for (const s of low) {
      const c = { x: s.region.outline.reduce((t, p) => t + p.x, 0) / 4, y: s.region.outline.reduce((t, p) => t + p.y, 0) / 4 };
      expect(headroomAt(w, c, s.z)).toBeGreaterThan(80);
    }
  });
});

describe("stairs in 3D", () => {
  it("boxes in the bottom flight on the lowest floor, and leaves stacked stairs open below", () => {
    const { plans, levels, ctx, flights, heights, ids } = stackedHouse(2, 1, "u");
    const parts = buildHouse(plans, ctx).parts.filter((p) => p.layer === "stairs" && p.pick?.kind === "stairs");
    const vertsNear = (levelId: string, z: number, region: Point[]) => {
      const m = parts.find((p) => p.levelId === levelId)!.mesh.positions;
      let n = 0;
      for (let i = 0; i < m.length; i += 3) {
        const p = { x: m[i] * FT, y: m[i + 2] * FT };
        if (Math.abs(m[i + 1] * FT - z) < 0.5 && pointInPolygon(p, region)) n++;
      }
      return n;
    };
    expect(levels.length).toBe(3);
    // Basement stairs: the bottom flight reaches the floor all along.
    const bFirst = placedSteps(flights[0].s, flights[0].rise, true);
    const n1 = bFirst.findIndex((st) => polygonArea(st.outline) > 40 * 40 * 1.5);
    const flight = bFirst.slice(0, n1).flatMap((st) => st.outline);
    const fb = boundsOf(flight)!;
    const mid = [{ x: fb.x0, y: fb.y0 }, { x: fb.x1, y: fb.y0 }, { x: fb.x1, y: fb.y1 }, { x: fb.x0, y: fb.y1 }];
    const shrink = (o: Point[], k = 1.01) => {
      const c = { x: o.reduce((t, p) => t + p.x, 0) / o.length, y: o.reduce((t, p) => t + p.y, 0) / o.length };
      return o.map((p) => ({ x: c.x + (p.x - c.x) * k, y: c.y + (p.y - c.y) * k }));
    };
    expect(vertsNear(ids[0], heights[ids[0]].floorIn, shrink(mid))).toBeGreaterThanOrEqual(4);
    // Main floor stairs sit over the basement's: nothing comes down to the main floor except at the bottom step.
    const main = placedSteps(flights[1].s, flights[1].rise);
    const upper = main.slice(Math.floor(main.length / 2)).map((st) => st.outline);
    for (const o of upper) expect(vertsNear(ids[1], heights[ids[1]].floorIn, shrink(o, 0.95))).toBe(0);
  });
});

describe("headroom over stacked stairs", () => {
  it("is a full floor for stairs stacked the same way, and warns when the upper flight turns back over the lower one", () => {
    const { plans, levels, flights } = stackedHouse(3, 0, "straight", (i) => (i === 1 ? 180 : 0));
    const room = stackedHeadroom(flights[0].s, flights[0].rise, flights[1].s, flights[1].rise);
    expect(room).toBeLessThan(80);
    const warn = planWarnings(plans, { levels, brief: null, basics: defaultBasics() }).find((x) => x.id.includes(":headroom:"));
    expect(warn?.text).toMatch(/Not enough headroom over the stairs from Main floor/);
    expect(warn?.stairsU).toBeTruthy();
    // "Make these U-shaped" fixes it.
    const fixed = makeStairsU(plans, warn!.stairsU!);
    expect(Object.values(fixed).flatMap((p) => p.stairs).every((s) => s.shape === "u")).toBe(true);
    expect(planWarnings(fixed, { levels, brief: null, basics: defaultBasics() }).some((x) => x.id.includes(":headroom:"))).toBe(false);
  });

  it("doesn't warn for stairs stacked in the same spot the same way", () => {
    for (const shape of ["straight", "l", "u"] as const) {
      const { plans, levels } = stackedHouse(3, 1, shape);
      expect(planWarnings(plans, { levels, brief: null, basics: defaultBasics() }).filter((x) => x.id.includes(":headroom:"))).toEqual([]);
    }
  });
});

describe("the plan's cut line", () => {
  it.each(["straight", "l", "u"] as const)("splits %s stairs into UP below the cut and DN above it", (shape) => {
    const s = { x: 0, y: 0, rotation: 90, widthIn: 40, shape, flip: false };
    const cut = stairsCut(s, 121);
    const d = stairsDrawing(s, 121);
    const area = (ps: Point[][]) => ps.reduce((t, p) => t + polygonArea(p), 0);
    expect(area(cut.below) + area(cut.above)).toBeCloseTo(polygonArea(d.footprint), 0);
    expect(area(cut.below)).toBeGreaterThan(0);
    expect(area(cut.above)).toBeGreaterThan(area(cut.below));
    // UP starts at the bottom step, DN at the top one.
    expect(Math.hypot(cut.up[0].x - d.arrow[0].x, cut.up[0].y - d.arrow[0].y)).toBeLessThan(1);
    const top = d.arrow[d.arrow.length - 1];
    expect(Math.hypot(cut.down[0].x - top.x, cut.down[0].y - top.y)).toBeLessThan(1);
  });
});

describe("stacked stairs at odd angles", () => {
  // These pairs made polygon-clipping throw "Unable to complete output ring" (Show alternatives crashed on a plan like this).
  const pairs: [Partial<PlanStairs>, Partial<PlanStairs>][] = [
    [{ x: 156.4, y: 22.1, rotation: 45, widthIn: 36, shape: "straight", flip: false }, { x: 156.5, y: 32.1, rotation: 90, widthIn: 36, shape: "l", flip: true }],
    [{ x: -10, y: 5.4, rotation: 45, widthIn: 40, shape: "u", flip: false }, { x: -9.9, y: 45.5, rotation: 270, widthIn: 40, shape: "u", flip: false }],
    [{ x: -7.7, y: 50.5, rotation: 45, widthIn: 38, shape: "l", flip: true }, { x: -7.7, y: 50.5, rotation: 270, widthIn: 38, shape: "u", flip: false }],
  ];
  it("measures headroom instead of crashing", () => {
    for (const [a, b] of pairs) {
      const room = stackedHeadroom(a as PlanStairs, 108, b as PlanStairs, 108);
      expect(Number.isFinite(room)).toBe(true);
    }
  });
});
