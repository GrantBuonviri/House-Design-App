import type { CustomLand } from "@/lib/model/schema";
import { describe, expect, it } from "vitest";
import { buildCustomPlot, newCustomLand } from "@/lib/land/custom";
import {
  addFeature,
  addLake,
  addLane,
  addPond,
  addRoad,
  addTreesAlong,
  addWater,
  flowsUphill,
  lakeShape,
  movePoint,
  removePick,
  removePoint,
  removeRoad,
  setMainRoad,
  setFeatureSize,
} from "@/lib/land/featureTools";
import { featureSpots, landScene, ribbonMesh, roadStrips } from "@/lib/land/mesh";

describe("designer feature tools", () => {
  it("adds and removes water, rocks, trees and lanes", () => {
    let land = newCustomLand();
    land = addWater(land, "river", [{ x: 100, y: 100 }, { x: 900, y: 1200 }]);
    land = addPond(land, { x: 600, y: 600 }, 30);
    land = addFeature(land, "rock", { x: 300, y: 300 }, 8);
    land = addLane(land, [{ x: 0, y: 0 }, { x: 500, y: 500 }], 14);
    expect(land.water.map((w) => w.kind)).toEqual(["river", "pond"]);
    expect(land.water[1].points).toHaveLength(10);
    expect(land.lanes[0].widthFt).toBe(14);
    land = removePick(land, { type: "water", index: 0 });
    expect(land.water).toHaveLength(1);
    land = removePick(land, { type: "feature", index: 0 });
    expect(land.features).toHaveLength(0);
  });

  it("clamps rock size to 3 to 20 ft", () => {
    const land = addFeature(newCustomLand(), "rock", { x: 0, y: 0 }, 8);
    expect(setFeatureSize(land, 0, 50).features[0].sizeFt).toBe(20);
    expect(setFeatureSize(land, 0, 1).features[0].sizeFt).toBe(3);
  });

  it("paints a row of trees along a Shift-drag, spaced by size", () => {
    const land = addTreesAlong(newCustomLand(), { x: 0, y: 0 }, { x: 12 * 100, y: 0 }, 20);
    expect(land.features.length).toBeGreaterThanOrEqual(5);
    expect(land.features.every((f) => f.kind === "tree" && f.sizeFt === 20)).toBe(true);
    expect(addTreesAlong(newCustomLand(), null, { x: 5, y: 5 }, 12).features).toHaveLength(1);
  });

  it("puts a lake beyond a side of the lot, outside the lot", () => {
    const land = newCustomLand();
    const shape = lakeShape(land.outline, 0);
    expect(shape).toHaveLength(6);
    expect(shape.slice(4).every((p) => p.y < 0)).toBe(true); // top side: the lake is above the lot
    expect(addLake(land, 0).water[0].kind).toBe("lake");
  });

  it("makes the first road the main street and keeps one main street", () => {
    let land: CustomLand = { ...newCustomLand(), roads: [] };
    land = addRoad(land, 2);
    land = addRoad(land, 1);
    land = addRoad(land, 1);
    expect(land.roads.map((r) => [r.edge, r.kind])).toEqual([[1, "side"], [2, "main"]]);
    land = removeRoad(land, 1); // the main street goes
    expect(land.roads).toHaveLength(1);
    expect(land.roads[0].kind).toBe("main");
    land = addRoad(land, 3);
    land = setMainRoad(land, 1);
    expect(land.roads.filter((r) => r.kind === "main")).toHaveLength(1);
  });

  it("moves and removes points but keeps paths at two points", () => {
    let land = addWater(newCustomLand(), "creek", [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }]);
    land = movePoint(land, { type: "water", index: 0 }, 1, { x: 100.4, y: 50.2 });
    expect(land.water[0].points[1]).toEqual({ x: 100, y: 50 });
    land = removePoint(land, { type: "water", index: 0 }, 1);
    land = removePoint(land, { type: "water", index: 0 }, 0);
    expect(land.water[0].points).toHaveLength(2);
  });

  it("warns when water would run uphill", () => {
    const land = { ...newCustomLand(), slope: { percent: 5, downhillDeg: 180 } }; // downhill is the bottom of the screen
    const down = [{ x: 0, y: 0 }, { x: 0, y: 2400 }];
    expect(flowsUphill(land, down)).toBe(false);
    expect(flowsUphill(land, [...down].reverse())).toBe(true);
    expect(flowsUphill({ ...land, slope: { percent: 0, downhillDeg: 180 } }, [...down].reverse())).toBe(false);
  });
});

describe("land 3D data", () => {
  const land = addFeature(addLane(newCustomLand(), [{ x: 200, y: 200 }, { x: 1400, y: 1800 }], 14), "tree", { x: 600, y: 600 }, 22);
  const plot = buildCustomPlot(land);
  const scene = landScene(plot);

  it("lays a ribbon along a path, two vertices per step", () => {
    const r = ribbonMesh(plot.lanes[0].points, 14 * 12, scene)!;
    expect(r.positions.length / 6).toBeGreaterThan(5);
    expect(r.indices.length).toBe((r.positions.length / 6 - 1) * 6);
  });

  it("draws the road along its real edge, outside the lot", () => {
    const [road] = roadStrips(plot);
    expect(road.main).toBe(true);
    // The street is the bottom side of the drawing; with north up it is the south edge.
    expect(road.points[0].y).toBeGreaterThan(plot.depthIn);
    expect(road.widthIn).toBe(26 * 12);
  });

  it("follows a turned lot: north pointing right puts the street on the east", () => {
    const turnedPlot = buildCustomPlot({ ...land, northDeg: 90 });
    const turned = roadStrips(turnedPlot)[0];
    expect(turnedPlot.roadSide).toBe("E");
    expect(turned.points[0].x).toBeGreaterThan(turnedPlot.widthIn);
  });

  it("puts rocks and trees on the ground in scene units", () => {
    const [spot] = featureSpots(plot, scene);
    expect(spot.kind).toBe("tree");
    expect(spot.radius).toBeCloseTo((22 * 12 * scene.scale) / 2, 6);
  });
});
