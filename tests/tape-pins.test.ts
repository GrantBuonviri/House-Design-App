import { describe, expect, it } from "vitest";
import { createProject, migrateProject } from "@/lib/model/project";
import { SCHEMA_VERSION, type FloorPlan } from "@/lib/model/schema";
import { addPin, pinAt, removePin } from "@/lib/plan/pins";
import { pinMeasurement, pinScreenDistance, pinUnderDot } from "@/lib/house3d/tape";

const empty: FloorPlan = { rooms: [], walls: [], openings: [], stairs: [], fixtures: [], furniture: [] };
const pin = { id: "p1", a: { x: 0, y: 0 }, b: { x: 100, y: 0 } };

describe("2D tape pins", () => {
  it("adds and deletes a pin without touching the rest of the plan", () => {
    const one = addPin(empty, pin);
    expect(one.pins).toEqual([pin]);
    expect(empty.pins).toBeUndefined();
    const none = removePin(one, "p1");
    expect(none.pins).toBeUndefined();
  });
  it("hits near the line and misses far from it", () => {
    const plan = addPin(empty, pin);
    expect(pinAt(plan, { x: 50, y: 5 }, 8)?.id).toBe("p1");
    expect(pinAt(plan, { x: 50, y: 20 }, 8)).toBeNull();
    expect(pinAt(plan, { x: 140, y: 0 }, 8)).toBeNull();
    expect(pinAt(empty, { x: 50, y: 0 }, 8)).toBeNull();
  });
  it("picks the nearest of two pins", () => {
    const plan = addPin(addPin(empty, pin), { id: "p2", a: { x: 0, y: 6 }, b: { x: 100, y: 6 } });
    expect(pinAt(plan, { x: 50, y: 5 }, 8)?.id).toBe("p2");
  });
});

describe("saved data with pins", () => {
  it("loads a v32 project with no pins", () => {
    const old = { ...createProject("Old"), schemaVersion: 32 };
    const m = migrateProject(JSON.parse(JSON.stringify(old)));
    expect(m.schemaVersion).toBe(SCHEMA_VERSION);
    expect(m.house3d.walkPins).toEqual([]);
  });
});

describe("walkthrough pins", () => {
  // Eye at the origin looking east (+x), level.
  const view = { eye: { x: 0, y: 0, z: 60 }, dir: { x: 1, y: 0, z: 0 }, fovDeg: 70, width: 1000, height: 600 };
  const ahead = { id: "w1", a: { x: 200, y: -30, z: 60 }, b: { x: 200, y: 30, z: 60 } };
  it("points at a pin across the middle of the screen", () => {
    expect(pinUnderDot([ahead], view)?.id).toBe("w1");
  });
  it("misses a pin well off to the side or high up", () => {
    const side = { id: "w2", a: { x: 200, y: 150, z: 60 }, b: { x: 200, y: 200, z: 60 } };
    const high = { id: "w3", a: { x: 200, y: -30, z: 160 }, b: { x: 200, y: 30, z: 160 } };
    expect(pinUnderDot([side, high], view)).toBeNull();
  });
  it("ignores a pin behind you and a pin behind a wall", () => {
    const behind = { id: "w4", a: { x: -200, y: -30, z: 60 }, b: { x: -200, y: 30, z: 60 } };
    expect(pinScreenDistance(behind, view)).toBe(Infinity);
    expect(pinUnderDot([ahead], view, () => true)).toBeNull();
  });
  it("still counts a pin that runs from in front to behind you", () => {
    const through = { id: "w5", a: { x: 300, y: 0, z: 60 }, b: { x: -300, y: 0, z: 60 } };
    expect(pinUnderDot([through], view)?.id).toBe("w5");
  });
  it("picks the nearest of two", () => {
    const near = { id: "n", a: { x: 200, y: -30, z: 62 }, b: { x: 200, y: 30, z: 62 } };
    expect(pinUnderDot([ahead, near], view)?.id).toBe("w1");
  });
  it("pinning moves a measurement out of the tape's list; keeping clear leaves pins", () => {
    const done = [{ a: { x: 0, y: 0, z: 0 }, b: { x: 10, y: 0, z: 0 } }, { a: { x: 0, y: 0, z: 0 }, b: { x: 20, y: 0, z: 0 } }];
    const r = pinMeasurement(done, [], "p9");
    expect(r.done).toHaveLength(1);
    expect(r.pins.map((p) => p.id)).toEqual(["p9"]);
    expect(r.pins[0].b.x).toBe(20);
    expect(pinMeasurement([], r.pins, "x").pins).toBe(r.pins);
  });
});
