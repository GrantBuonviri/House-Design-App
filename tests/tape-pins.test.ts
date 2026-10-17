import { describe, expect, it } from "vitest";
import { createProject, migrateProject } from "@/lib/model/project";
import { SCHEMA_VERSION, type FloorPlan } from "@/lib/model/schema";
import { addPin, pinAt, removePin } from "@/lib/plan/pins";

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
