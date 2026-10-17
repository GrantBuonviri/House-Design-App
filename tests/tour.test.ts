import { describe, expect, it } from "vitest";
import { TOUR } from "@/lib/tour/steps";
import { STAGE_INFO } from "@/lib/stages";

describe("guided tour", () => {
  it("has one numbered step per stage, in the stage bar's order", () => {
    const numbered = TOUR.filter((s) => /^\d+\./.test(s.title));
    expect(numbered.map((s) => s.stage)).toEqual(STAGE_INFO.map((s) => s.id));
    expect(numbered.map((s) => s.title)).toEqual(STAGE_INFO.map((s, i) => `${i + 1}. ${s.label}`));
  });

  it("counts the stages right", () => {
    const words = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"];
    expect(TOUR.find((s) => s.target === "stages")!.title).toContain(words[STAGE_INFO.length]);
  });
});

describe("help cards and mini tours", () => {
  it("starts the tour at the step for the page you're on", async () => {
    const { tourStartFor } = await import("@/lib/tour/help");
    expect(TOUR[tourStartFor("plan")].title).toMatch(/^5\./);
    expect(TOUR[tourStartFor("interior")].title).toMatch(/^6\./);
  });

  it("has a card for every page but the floor plan, and mini tours pointing at real things", async () => {
    const { PAGE_HELP, MINI_TOURS } = await import("@/lib/tour/help");
    expect(Object.keys(PAGE_HELP).sort()).toEqual(["brief", "bubbles", "furnish", "land", "setup"]);
    const targets = new Set(TOUR.map((s) => s.target));
    for (const t of MINI_TOURS) for (const s of t.steps) expect(targets.has(s.target)).toBe(true);
  });
});
