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
