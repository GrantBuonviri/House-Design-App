import { describe, expect, it } from "vitest";
import { buildCustomPlot, newCustomLand, rectOutline } from "@/lib/land/custom";
import { generatePlot } from "@/lib/land/generate";
import { edgeLengths, landDrawing, sizeNote } from "@/lib/bubbles/land";
import { lotAsPlot, siteLayout } from "@/lib/plans/lot";
import { house, onRealLot, RANCH } from "./samples";

describe("land overlay lot measurements", () => {
  it("measures a rectangle's four edges and sizes it in feet and acres", () => {
    const o = rectOutline(117, 99);
    expect(edgeLengths(o).map((e) => e.text)).toEqual(["117'", "99'", "117'", "99'"]);
    expect(sizeNote(o)).toBe("117' × 99' · 0.27 acre");
  });

  it("points each label out of the lot", () => {
    const o = rectOutline(100, 80);
    const [top, right, bottom, left] = edgeLengths(o);
    expect(top.out.y).toBeLessThan(0);
    expect(right.out.x).toBeGreaterThan(0);
    expect(bottom.out.y).toBeGreaterThan(0);
    expect(left.out.x).toBeLessThan(0);
  });

  it("skips edges under 15 ft", () => {
    const o = [{ x: 0, y: 0 }, { x: 1200, y: 0 }, { x: 1200, y: 100 }, { x: 1100, y: 1200 }, { x: 0, y: 1200 }];
    // The 100-inch edge (8 ft) is skipped; the rest stay.
    expect(edgeLengths(o)).toHaveLength(4);
    expect(edgeLengths(o).every((e) => e.feet >= 15)).toBe(true);
  });

  it("says 'acres' above one acre", () => {
    expect(sizeNote(rectOutline(300, 200))).toBe("300' × 200' · 1.38 acres");
  });

  it("works for a made-up plot and a custom plot", () => {
    const made = landDrawing(generatePlot(7));
    expect(made.edges.length).toBeGreaterThan(2);
    expect(made.sizeNote).toMatch(/^[\d.]+' × [\d.]+' · \d+\.\d\d acres?$/);
    const custom = landDrawing(buildCustomPlot(newCustomLand("Test")));
    expect(custom.edges.length).toBe(4);
    expect(custom.sizeNote).toContain("acre");
  });

  it("measures a real lot drawn through lotAsPlot", () => {
    const p = onRealLot(house(RANCH));
    const lp = lotAsPlot(siteLayout(p)!, p.plot);
    expect(lp.offset).toEqual({ x: 0, y: 0 });
    const d = landDrawing({ ...lp.plot, isFlat: true });
    expect(d.edges.map((e) => e.text).sort()).toEqual(["100'", "100'", "150'", "150'"]);
    expect(d.sizeNote).toBe("150' × 100' · 0.34 acre");
    expect(d.contours).toEqual([]);
    expect(d.downhill).toBeNull();
  });
});
