import { describe, expect, it } from "vitest";
import { newCustomLand, buildCustomPlot } from "@/lib/land/custom";
import {
  acresOf,
  boxFeet,
  insertCorner,
  offsetKeepingHouse,
  plotOrigin,
  removeCorner,
  resizeBox,
  resizeToAcres,
  setSideLength,
  sideLengthFt,
  snapAngle,
  snapCorner,
} from "@/lib/land/designer";
import { createProject } from "@/lib/model/project";

describe("land designer helpers", () => {
  it("snaps a dragged corner to 45° and whole feet, or any angle with Shift", () => {
    const prev = { x: 0, y: 0 };
    const s = snapCorner(prev, { x: 1210, y: 90 }, false);
    expect(s.y).toBe(0);
    expect(s.x % 12).toBe(0);
    const diag = snapCorner(prev, { x: 600, y: 580 }, false);
    expect(diag.x).toBe(diag.y);
    expect(snapCorner(prev, { x: 150, y: 100 }, true)).toEqual({ x: 156, y: 96 });
  });

  it("snaps angles every 15° unless free", () => {
    expect(snapAngle(97, false)).toBe(90);
    expect(snapAngle(97.4, true)).toBe(97);
    expect(snapAngle(-10, false)).toBe(345);
    expect(snapAngle(358, false)).toBe(0);
  });

  it("resizes by width and depth, and by acres keeping proportions", () => {
    const land = newCustomLand();
    const r = resizeBox(land, 100, 300);
    expect(boxFeet(r.outline)).toEqual({ widthFt: 100, depthFt: 300 });
    const a = resizeToAcres(land, 2);
    expect(acresOf(a.outline)).toBeCloseTo(2, 3);
    const b = boxFeet(a.outline);
    expect(b.widthFt / b.depthFt).toBeCloseTo(150 / 200, 3);
  });

  it("adds a corner on a side and keeps the road on both halves", () => {
    const land = newCustomLand(); // street on side 2
    const more = insertCorner(land, 2);
    expect(more.outline).toHaveLength(5);
    expect(more.roads.map((r) => r.edge).sort()).toEqual([2, 3]);
    const plot = buildCustomPlot(more);
    expect(plot.outline).toHaveLength(5);
  });

  it("removes a corner, joins roads, and never goes below three", () => {
    const land = insertCorner(newCustomLand(), 2);
    const back = removeCorner(land, 3);
    expect(back.outline).toHaveLength(4);
    expect(back.roads).toHaveLength(1);
    expect(back.roads[0].edge).toBe(2);
    let tri = removeCorner(newCustomLand(), 1);
    expect(tri.outline).toHaveLength(3);
    tri = removeCorner(tri, 0);
    expect(tri.outline).toHaveLength(3);
    // Removing the first corner joins the last and first sides.
    const first = removeCorner(newCustomLand(), 0);
    expect(first.roads.every((r) => r.edge < first.outline.length)).toBe(true);
  });

  it("types a side length by moving its far corner", () => {
    const land = newCustomLand();
    const r = setSideLength(land, 0, 120);
    expect(sideLengthFt(r.outline, 0)).toBeCloseTo(120, 5);
    expect(sideLengthFt(r.outline, 1)).not.toBe(sideLengthFt(land.outline, 1));
  });

  it("keeps the house in place on the drawing when the lot origin moves", () => {
    const project = { ...createProject("t"), plot: buildCustomPlot(newCustomLand()) };
    const before = newCustomLand();
    const after = { ...before, outline: before.outline.map((p, i) => (i === 0 ? { x: p.x + 240, y: p.y + 120 } : p)) };
    expect(plotOrigin(after)).toEqual({ x: 0, y: 0 });
    const turned = { ...before, northDeg: 90 };
    const o = offsetKeepingHouse(project, before, turned);
    expect(Number.isFinite(o.x) && Number.isFinite(o.y)).toBe(true);
  });

  it("builds a plot that follows the north turn after a shape edit", () => {
    const land = { ...newCustomLand(), northDeg: 90 };
    const plot = buildCustomPlot(insertCorner(land, 1));
    expect(plot.roadSide).toBe("E"); // north points right on screen, so the bottom faces east
  });
});
