import { describe, expect, it } from "vitest";
import { createProject, migrateRaw } from "@/lib/model/project";
import { PlanBasics, SCHEMA_VERSION } from "@/lib/model/schema";

describe("inside door style removed", () => {
  it("drops doorStyle from a v33 save and keeps the other basics", () => {
    const old = JSON.parse(JSON.stringify({ ...createProject("Old"), schemaVersion: 33 }));
    old.plan.basics = { ...PlanBasics.parse({}), doorStyle: "glass", doorHeightIn: 96 };
    const m = migrateRaw(old) as { schemaVersion: number; plan: { basics: Record<string, unknown> } };
    expect(m.schemaVersion).toBe(SCHEMA_VERSION);
    expect("doorStyle" in m.plan.basics).toBe(false);
    expect(m.plan.basics.doorHeightIn).toBe(96);
  });
  it("loads a v33 save that never answered the basics", () => {
    const old = JSON.parse(JSON.stringify({ ...createProject("Old"), schemaVersion: 33 }));
    expect((migrateRaw(old) as { plan: { basics: unknown } }).plan.basics).toBeNull();
  });
});
