import { describe, expect, it } from "vitest";
import { PlanLabels } from "@/lib/model/schema";
import { DEFAULT_LABELS, labelOn } from "@/lib/plan/labels";

describe("overhang label settings", () => {
  it("parse with defaults, matching DEFAULT_LABELS", () => {
    const l = PlanLabels.parse({});
    expect(l).toEqual(DEFAULT_LABELS);
    expect(l.aboveOutlines && l.aboveShading && l.aboveText && l.overhangShading && l.overhangText).toBe(true);
    expect(l.overhangColor).toBe("red");
    expect(l.overhangStrength).toBe("normal");
  });
  it("loads old label settings without the new fields", () => {
    const l = PlanLabels.parse({ hideAll: false, roomNames: false, textSize: 1.25 });
    expect(l.roomNames).toBe(false);
    expect(l.aboveOutlines).toBe(true);
  });
  it("hide all (L) hides the hangs-past notes, not the stripes switch", () => {
    const l = { ...DEFAULT_LABELS, hideAll: true };
    expect(labelOn(l, "overhangText")).toBe(false);
    expect(labelOn(l, "aboveText")).toBe(false);
    expect(l.overhangShading).toBe(true);
    expect(labelOn({ ...DEFAULT_LABELS, aboveText: false }, "aboveText")).toBe(false);
    expect(labelOn(DEFAULT_LABELS, "overhangText")).toBe(true);
  });
});
