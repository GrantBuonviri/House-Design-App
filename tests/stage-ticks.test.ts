import { describe, expect, it } from "vitest";
import { nextStep, stagesDone } from "@/lib/stages";
import { house, RANCH } from "./samples";

describe("stage ticks", () => {
  it("a fresh house has nothing done and the first stage next", () => {
    const p = { ...house(RANCH), location: null, plot: null, brief: null, bubbles: {}, floorPlans: {} };
    expect(Object.values(stagesDone(p)).some(Boolean)).toBe(false);
    expect(nextStep(p)?.stage).toBe("setup");
  });
  it("moves the next line on as stages fill in", () => {
    const p = { ...house(RANCH), plot: null, floorPlans: {}, bubbles: {} };
    const d = stagesDone(p);
    expect(d.brief).toBe(true);
    expect(d.plan).toBe(false);
    expect(nextStep({ ...p, location: {} as never })?.stage).toBe("land");
    expect(nextStep({ ...p, location: {} as never, plot: {} as never })?.stage).toBe("bubbles");
  });
  it("is null once everything is started", () => {
    const base = house(RANCH);
    const fp = { rooms: [{} as never], walls: [], openings: [], stairs: [], fixtures: [], furniture: [{} as never] };
    const p = { ...base, location: {} as never, plot: {} as never, bubbles: { a: { bubbles: [{}] } as never }, floorPlans: { a: fp } };
    expect(nextStep(p)).toBeNull();
  });
});
