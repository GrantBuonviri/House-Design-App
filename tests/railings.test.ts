import { describe, expect, it } from "vitest";
import { createProject, migrateProject } from "@/lib/model/project";
import { describeChange } from "@/lib/store/describe";
import { SCHEMA_VERSION, type FloorPlan, type PlanRoom, type PlanStairs, type PlanWall } from "@/lib/model/schema";
import { emptyPlan, moveMany } from "@/lib/plan/edit";
import { mirrorMany } from "@/lib/plan/arrange";
import { rectangle } from "@/lib/plan/geometry";
import { editRailing, edgeNames, keepRailingEdits, railingAt, railingsFor, autoRailings, resetRailings, stairEdges, type Railing } from "@/lib/plan/railings";
import { placedSteps, stairsDrawing, stairsFrame } from "@/lib/plan/stairs";
import { House3D } from "@/lib/model/schema";
import { levelsFor } from "@/lib/brief/levels";
import { defaultBasics } from "@/lib/plan/basics";
import { type HouseContext } from "@/lib/house3d/build";
import { levelHeights } from "@/lib/house3d/levels";
import { siteFor } from "@/lib/house3d/site";
import { openAllDoors, walkStep, walkWorld, type Walker, type WalkWorld } from "@/lib/house3d/walk";

const FT = 12;
const RISE = 121;
const room = (id: string, poly = rectangle(15 * FT, 15 * FT, 30 * FT, 30 * FT)): PlanRoom => ({ id, name: id, type: "living", polygon: poly });
const plan = (rooms: PlanRoom[], stairs: PlanStairs[] = [], walls: PlanWall[] = []): FloorPlan => ({ ...emptyPlan(), rooms, stairs, walls });
const stairs = (shape: PlanStairs["shape"], extra: Partial<PlanStairs> = {}): PlanStairs => ({ id: "s1", x: 15 * FT, y: 15 * FT, rotation: 0, widthIn: 40, shape, flip: false, toLevelId: "up", ...extra });
const riseOf = () => RISE;

function house(s: PlanStairs, walls: PlanWall[] = []) {
  return { main: plan([room("r1")], [s], walls), up: plan([room("r2")]) };
}
const edges = (rs: Railing[]) => rs.map((r) => `${r.edge}:${r.kind}`).sort();

/** A full-height loose wall along the plan line from a to b. */
const wall = (id: string, a: { x: number; y: number }, b: { x: number; y: number }): PlanWall => ({ id, a, b, thicknessIn: 4.5 }) as PlanWall;

describe("stair edges", () => {
  it("names each shape's edges, with the U middle", () => {
    const fr = (shape: PlanStairs["shape"]) => stairsFrame(stairs(shape), RISE);
    const names = (shape: PlanStairs["shape"]) => stairEdges(stairs(shape), RISE, fr(shape).treads, fr(shape).riserIn).map((e) => e.name);
    expect(names("straight")).toEqual(["bottom", "f1-left", "f1-right", "top"]);
    expect(names("l")).toEqual(["bottom", "f1-left", "f1-right", "join-1", "landing-outer-1", "landing-outer-2", "join-2", "f2-left", "f2-right", "top"]);
    expect(names("u")).toContain("middle");
    expect(names("u")).toEqual(expect.arrayContaining(["landing-left", "landing-far", "landing-right", "f2-left", "join-1", "join-2"]));
  });

  it("climbs along each flight from one riser up to the next floor", () => {
    const s = stairs("straight");
    const fr = stairsFrame(s, RISE);
    const left = stairEdges(s, RISE, fr.treads, fr.riserIn).find((e) => e.name === "f1-left")!;
    expect(left.za).toBeCloseTo(fr.riserIn);
    expect(left.zb).toBeCloseTo(RISE);
  });
});

describe("automatic railings", () => {
  it("puts guards on both open sides of straight stairs in the middle of a room, none across the bottom or top", () => {
    const p = house(stairs("straight"));
    const rs = railingsFor(p, "main", riseOf);
    expect(edges(rs)).toEqual(["f1-left:guard", "f1-right:guard"]);
    expect(rs.every((r) => r.heightIn === 34 && r.style === "wood" && r.auto)).toBe(true);
  });

  it("gives U stairs a guard down the middle and on the landing's open sides, but nothing at the joins", () => {
    const rs = railingsFor(house(stairs("u")), "main", riseOf);
    const names = edges(rs);
    expect(names).toContain("middle:guard");
    expect(names).toEqual(expect.arrayContaining(["f1-left:guard", "f2-left:guard", "landing-left:guard", "landing-far:guard", "landing-right:guard"]));
    expect(rs.some((r) => ["bottom", "top", "join-1", "join-2"].includes(r.edge))).toBe(false);
    const landing = rs.find((r) => r.edge === "landing-far")!;
    expect(landing.heightIn).toBe(36);
    // The middle guard follows the higher flight (the second one), but walking into it counts from the lower one.
    const mid = rs.find((r) => r.edge === "middle")!;
    expect(Math.min(mid.za, mid.zb)).toBeGreaterThan(Math.min(...mid.low!));
  });

  it("gives an L its landing's two outer sides", () => {
    const names = edges(railingsFor(house(stairs("l")), "main", riseOf));
    expect(names).toEqual(expect.arrayContaining(["landing-outer-1:guard", "landing-outer-2:guard", "f2-left:guard", "f2-right:guard"]));
  });

  it("puts a handrail, not a guard, on a side that runs along a wall", () => {
    const s = stairs("straight");
    const fp = stairsDrawing(s, RISE).footprint;
    const x0 = Math.min(...fp.map((p) => p.x));
    const ys = fp.map((p) => p.y);
    // A wall just west of the stairs' left side, its face against them.
    const p = house(s, [wall("w1", { x: x0 - 2.25, y: Math.min(...ys) - 12 }, { x: x0 - 2.25, y: Math.max(...ys) + 12 })]);
    const rs = railingsFor(p, "main", riseOf);
    expect(edges(rs)).toEqual(["f1-left:handrail", "f1-right:guard"]);
    const hr = rs.find((r) => r.kind === "handrail")!;
    expect(hr.heightIn).toBe(36);
    expect(hr.a.x).toBeCloseTo(x0 + 2.25);
  });

  it("splits a side with a wall along half of it into a handrail and a guard", () => {
    const s = stairs("straight");
    const fp = stairsDrawing(s, RISE).footprint;
    const x0 = Math.min(...fp.map((p) => p.x));
    const ys = fp.map((p) => p.y);
    const midY = (Math.min(...ys) + Math.max(...ys)) / 2;
    const p = house(s, [wall("w1", { x: x0 - 2.25, y: midY }, { x: x0 - 2.25, y: Math.max(...ys) + 12 })]);
    const left = railingsFor(p, "main", riseOf).filter((r) => r.edge === "f1-left");
    expect(left.map((r) => r.kind).sort()).toEqual(["guard", "handrail"]);
    expect(new Set(left.map((r) => r.key)).size).toBe(2);
  });

  it("works for flipped and turned stairs", () => {
    for (const extra of [{ flip: true }, { rotation: 90 }, { rotation: 225, flip: true }]) {
      const names = edges(railingsFor(house(stairs("u", extra)), "main", riseOf));
      expect(names).toContain("middle:guard");
      expect(names.length).toBe(6);
    }
  });

  it("guards the stairwell on the floor above, except the side you arrive across", () => {
    const p = house(stairs("straight"));
    const well = railingsFor(p, "up", riseOf);
    expect(well.map((r) => r.edge).sort()).toEqual(["well-1", "well-2", "well-4"]);
    expect(well.every((r) => r.kind === "guard" && r.heightIn === 36 && r.levelId === "up" && r.za === 0)).toBe(true);
    // Guards stand on the floor, just outside the hole.
    const fp = stairsDrawing(stairs("straight"), RISE).footprint;
    const y1 = Math.max(...fp.map((q) => q.y));
    expect(well.find((r) => r.edge === "well-1")!.a.y).toBeGreaterThan(y1);
  });

  it("stops a flight's guard at the floor above where that floor runs over it", () => {
    const rs = railingsFor(house(stairs("straight")), "main", riseOf);
    const g = rs.find((r) => r.edge === "f1-left")!;
    expect(g.maxTop).toBe(RISE);
    expect(railingAt(g, 1).top).toBe(RISE);
    expect(railingAt(g, 0).top).toBeCloseTo(g.za + 34);
  });

  it("leaves the stairwell open where stairs stacked above start over it", () => {
    const lower = stairs("straight");
    const upper = { ...stairs("straight"), id: "s2", toLevelId: "top" };
    const p = { main: plan([room("r1")], [lower]), up: plan([room("r2")], [upper]), top: plan([room("r3")]) };
    const well = railingsFor(p, "up", riseOf).filter((r) => r.stairsId === "s1");
    expect(well.map((r) => r.edge)).not.toContain("well-1");
  });
});

describe("changes to railings", () => {
  it("keeps a removed edge removed after the stairs move", () => {
    const s = editRailing(stairs("u"), "middle", { removed: true });
    const p = house(s);
    const moved = { ...p, main: moveMany(p.main, ["s1"], 24, -36) };
    const rs = railingsFor(moved, "main", riseOf);
    expect(rs.some((r) => r.edge === "middle")).toBe(false);
    expect(autoRailings(moved, "main", riseOf).some((r) => r.edge === "middle")).toBe(true);
  });

  it("applies kind and style changes, and can add a railing where there was none", () => {
    let s = editRailing(stairs("u"), "middle", { kind: "half-wall" });
    s = editRailing(s, "f1-left", { style: "metal" });
    const p = house(s);
    const rs = railingsFor(p, "main", riseOf);
    expect(rs.find((r) => r.edge === "middle")!.kind).toBe("half-wall");
    expect(rs.find((r) => r.edge === "middle")!.auto).toBe(false);
    expect(rs.find((r) => r.edge === "f1-left")!.style).toBe("metal");
    expect(rs.find((r) => r.edge === "f2-left")!.auto).toBe(true);
  });

  it("adds a railing on an edge that has none", () => {
    const s = stairs("straight");
    const fp = stairsDrawing(s, RISE).footprint;
    const y1 = Math.max(...fp.map((q) => q.y));
    // A wall upstairs along the stairwell's south side: no guard there.
    const p = { ...house(s), up: plan([room("r2")], [], [wall("w1", { x: 10 * FT, y: y1 + 2.25 }, { x: 20 * FT, y: y1 + 2.25 })]) };
    expect(railingsFor(p, "up", riseOf).some((r) => r.edge === "well-1")).toBe(false);
    const added = { ...p, main: { ...p.main, stairs: [editRailing(s, "well-1", { kind: "guard" })] } };
    expect(railingsFor(added, "up", riseOf).filter((r) => r.edge === "well-1").length).toBe(1);
  });

  it("puts everything back to automatic", () => {
    const s = resetRailings(editRailing(stairs("u"), "middle", { removed: true }));
    expect(s.railings).toBeUndefined();
    expect(editRailing(editRailing(stairs("u"), "middle", { removed: true }), "middle", null).railings).toBeUndefined();
  });

  it("drops changes for edges stairs of a new shape don't have", () => {
    const s = keepRailingEdits({ ...editRailing(editRailing(stairs("u"), "middle", { removed: true }), "f1-left", { style: "glass" }), shape: "straight" });
    expect(s.railings).toEqual([{ edge: "f1-left", style: "glass" }]);
    expect(edgeNames("straight")).toEqual(["bottom", "f1-left", "f1-right", "top", "well-1", "well-2", "well-3", "well-4"]);
  });

  it("swaps left and right changes on straight stairs flipped with the plan", () => {
    const s = editRailing(stairs("straight"), "f1-left", { removed: true });
    const p = house(s);
    const flipped = mirrorMany(p.main, ["s1"], "left-right");
    expect(flipped.stairs[0].railings).toEqual([{ edge: "f1-right", removed: true }]);
    const before = railingsFor(p, "main", riseOf).map((r) => r.a.x);
    const after = railingsFor({ ...p, main: flipped }, "main", riseOf).map((r) => r.a.x);
    // The guard that's left stays on the same side of the room (the east side, mirrored to the west).
    expect(before.length).toBe(1);
    expect(after.length).toBe(1);
    expect(Math.sign(after[0] - 15 * FT)).toBe(-Math.sign(before[0] - 15 * FT));
  });
});

describe("undo labels", () => {
  it("names railing changes", () => {
    const p = createProject("R");
    const a = { ...p, floorPlans: { "floor-1": plan([room("r1")], [stairs("u")]) } };
    const b = { ...p, floorPlans: { "floor-1": plan([room("r1")], [editRailing(stairs("u"), "middle", { removed: true })]) } };
    expect(describeChange(a, b)).toBe("remove a railing");
    expect(describeChange(b, a)).toBe("put a railing back to automatic");
  });
});

describe("saved data", () => {
  it("opens a version 25 project", () => {
    const p = createProject("Old");
    const v25 = JSON.parse(JSON.stringify({ ...p, schemaVersion: 25, floorPlans: { "floor-1": plan([room("r1")], [stairs("u")]) } }));
    const m = migrateProject(v25);
    expect(m.schemaVersion).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(26);
    expect(m.floorPlans["floor-1"].stairs[0].railings).toBeUndefined();
  });
});

describe("walking into railings", () => {
  const levels = levelsFor(2, 0);
  const basics = defaultBasics();
  const heights = levelHeights(levels, basics);
  const [lo, hi] = [...levels].sort((a, b) => heights[a.id].floorIn - heights[b.id].floorIn).map((l) => l.id);
  const rise = heights[hi].floorIn - heights[lo].floorIn;
  function world(s: PlanStairs) {
    const st = { ...s, toLevelId: hi };
    const plans = { [lo]: plan([room("r1")], [st]), [hi]: plan([room("r2")]) };
    const site = siteFor(null, { x: 0, y: 0 }, plans);
    const ctx: HouseContext = { levels, basics, house3d: House3D.parse({}), site, frame: { ox: 0, oy: 0 } };
    const w = walkWorld(plans, { ...ctx, heights });
    openAllDoors(w);
    return { w, fp: stairsDrawing(st, rise).footprint, steps: placedSteps(st, rise) };
  }
  const walk = (w: WalkWorld, me: Walker, secs: number) => {
    for (let t = 0; t < secs; t += 1 / 60) me = walkStep(w, me, { forward: 1, right: 0, fast: false }, 1 / 60);
    return me;
  };

  it("stops you stepping off the open side of a U flight, unless that railing is taken off", () => {
    for (const removed of [false, true]) {
      const s = removed ? editRailing(stairs("u"), "f1-left", { removed: true }) : stairs("u");
      const { w, fp, steps } = world(s);
      const x0 = Math.min(...fp.map((p) => p.x));
      const tread = steps[5];
      const c = { x: tread.outline.reduce((t, p) => t + p.x, 0) / 4, y: tread.outline.reduce((t, p) => t + p.y, 0) / 4 };
      const me = walk(w, { p: c, feet: tread.top, vz: 0, yaw: -Math.PI / 2, pitch: 0 }, 3);
      if (removed) {
        expect(me.feet).toBeLessThan(1);
        expect(me.p.x).toBeLessThan(x0);
      } else {
        expect(me.feet).toBeCloseTo(tread.top);
        expect(me.p.x).toBeGreaterThan(x0);
      }
    }
  });

  it("stops you walking into the stairwell from the floor above", () => {
    const { w, fp } = world(stairs("straight"));
    const y1 = Math.max(...fp.map((p) => p.y));
    const cx = (Math.min(...fp.map((p) => p.x)) + Math.max(...fp.map((p) => p.x))) / 2;
    const me = walk(w, { p: { x: cx, y: y1 + 48 }, feet: heights[hi].floorIn, vz: 0, yaw: 0, pitch: 0 }, 3);
    expect(me.feet).toBe(heights[hi].floorIn);
    expect(me.p.y).toBeGreaterThan(y1);
  });

  it("still lets you walk up onto the bottom step and off at the top", () => {
    const { w, fp } = world(stairs("straight"));
    const y1 = Math.max(...fp.map((p) => p.y));
    const y0 = Math.min(...fp.map((p) => p.y));
    const cx = (Math.min(...fp.map((p) => p.x)) + Math.max(...fp.map((p) => p.x))) / 2;
    const me = walk(w, { p: { x: cx, y: y1 + 36 }, feet: heights[lo].floorIn, vz: 0, yaw: 0, pitch: 0 }, 8);
    expect(me.p.y).toBeLessThan(y0);
    expect(me.feet).toBe(heights[hi].floorIn);
  });
});
