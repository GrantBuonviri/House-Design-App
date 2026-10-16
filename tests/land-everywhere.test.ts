import { describe, expect, it } from "vitest";
import type { CustomLand, Point, Project } from "@/lib/model/schema";
import { buildCustomPlot, newCustomLand, rectOutline } from "@/lib/land/custom";
import { generatePlot } from "@/lib/land/generate";
import { landUnder, nearestAccess } from "@/lib/land/onLot";
import { landDrawing } from "@/lib/bubbles/land";
import { planWarnings } from "@/lib/plan/checks";
import { yardLayout } from "@/lib/exterior/yard";
import { lotOffsetFor, planBounds, siteFor } from "@/lib/house3d/site";
import { buildLandFeatures } from "@/lib/house3d/yard";
import { roadLinesIn3D } from "@/lib/house3d/terrain";
import { estimate } from "@/lib/cost/estimate";
import { lotFromCustomLand, siteLayout } from "@/lib/plans/lot";
import { house, RANCH } from "./samples";

const FT = 12;

/** Designer settings: a 150 x 200 ft lot, gentle and smooth, street along the bottom. */
function land(patch: Partial<CustomLand> = {}): CustomLand {
  return { ...newCustomLand("Test land"), slope: { percent: 2, downhillDeg: 180 }, rolls: "smooth", ...patch };
}

const ranch = house(RANCH);

/** The ranch on designed land, the house in the middle of the lot. */
function onLand(settings: CustomLand): Project {
  return { ...ranch, plot: buildCustomPlot(settings), sketch: { ...ranch.sketch, lotOffset: null } };
}

/** The middle of the house's main floor, in plot inches. */
function houseMiddle(p: Project): Point {
  const bb = planBounds(p.floorPlans, true)!;
  const o = lotOffsetFor(p);
  return { x: (bb.x0 + bb.x1) / 2 + o.x, y: (bb.y0 + bb.y1) / 2 + o.y };
}

const warningsOf = (p: Project) => planWarnings(p.floorPlans, { levels: p.levels, brief: p.brief, basics: p.plan.basics, land: { plot: p.plot, offset: lotOffsetFor(p) } }).map((w) => w.text);

describe("flow sketch land overlay on designed land", () => {
  it("draws every road along its real edge, with the main road labeled", () => {
    const s = land();
    s.roads = [...s.roads, { id: "side", edge: 1, kind: "side", widthFt: 26 }];
    const plot = buildCustomPlot(s);
    const d = landDrawing(plot);
    expect(d.roads.length).toBe(2);
    expect(d.road?.text).toBe("Main road");
    expect(d.road?.a.y).toBe(plot.depthIn);
    expect(d.road?.b.y).toBe(plot.depthIn);
    const side = d.roads.find((r) => !r.main)!;
    expect(side.text).toBe("Side street");
    expect(side.a.x).toBe(plot.widthIn);
    // The label sits outside the lot, past the edge.
    expect(side.label.x).toBeGreaterThan(plot.widthIn);
  });

  it("adds rocks, trees and lanes", () => {
    const plot = buildCustomPlot(
      land({
        features: [
          { id: "r", kind: "rock", at: { x: 400, y: 400 }, sizeFt: 10 },
          { id: "t", kind: "tree", at: { x: 900, y: 600 }, sizeFt: 30 },
        ],
        lanes: [{ id: "l", points: [{ x: 0, y: 1200 }, { x: 1800, y: 1200 }], widthFt: 14 }],
      }),
    );
    const d = landDrawing(plot);
    expect(d.rocks).toEqual([{ at: { x: 400, y: 400 }, size: 120 }]);
    expect(d.trees).toEqual([{ at: { x: 900, y: 600 }, size: 360 }]);
    expect(d.lanes[0].width).toBe(14 * FT);
  });

  it("keeps a made-up plot's single road as before", () => {
    const d = landDrawing(generatePlot(3));
    expect(d.roads.length).toBe(1);
    expect(d.roads[0].text).toBe("Road");
  });
});

describe("floor plan warnings about the land", () => {
  it("warns when the house sits on a rock", () => {
    const at = houseMiddle(onLand(land()));
    const p = onLand(land({ features: [{ id: "r", kind: "rock", at, sizeFt: 8 }] }));
    expect(warningsOf(p).some((t) => t.includes("sits on the big rock"))).toBe(true);
    expect(warningsOf(onLand(land())).some((t) => t.includes("rock"))).toBe(false);
  });

  it("warns about a pond under the house, a river beside it, and the lot line", () => {
    const at = houseMiddle(onLand(land()));
    const pond = [{ x: at.x - 200, y: at.y - 200 }, { x: at.x + 200, y: at.y - 200 }, { x: at.x + 200, y: at.y + 200 }, { x: at.x - 200, y: at.y + 200 }];
    expect(warningsOf(onLand(land({ water: [{ kind: "pond", points: pond }] }))).some((t) => t.includes("in the pond"))).toBe(true);

    const bb = planBounds(ranch.floorPlans, true)!;
    const o = lotOffsetFor(onLand(land()));
    const east = bb.x1 + o.x + 50 * FT;
    const river = [{ x: east, y: 0 }, { x: east, y: 200 * FT }];
    const near = warningsOf(onLand(land({ water: [{ kind: "river", points: river }] })));
    expect(near.some((t) => t.includes("from the river, on its bank"))).toBe(true);

    // A lot narrower than the house.
    const tiny = onLand(land({ outline: rectOutline(30, 200) }));
    expect(warningsOf(tiny).some((t) => t.includes("past the lot line"))).toBe(true);
  });

  it("finds nothing on open land", () => {
    expect(landUnder(onLand(land()).plot!, [])).toEqual([]);
    expect(warningsOf(onLand(land())).some((t) => /rock|pond|river|lot line|wash/.test(t))).toBe(false);
  });
});

describe("driveway to the nearest road or lane", () => {
  it("meets the main road's real edge on a turned lot", () => {
    // North points right on the drawing: the street drawn at the bottom is on the east.
    const plot = buildCustomPlot(land({ northDeg: 90 }));
    expect(plot.roadSide).toBe("E");
    const a = nearestAccess(plot, { x: plot.widthIn / 2, y: plot.depthIn / 2 });
    expect(a.kind).toBe("road");
    expect(Math.abs(a.at.x - plot.widthIn)).toBeLessThan(1);
  });

  it("uses a lane through the land when it's closer than the road", () => {
    const base = onLand(land());
    const mid = houseMiddle(base);
    const bb = planBounds(ranch.floorPlans, true)!;
    const o = lotOffsetFor(base);
    const laneY = bb.y0 + o.y - 30 * FT; // behind the house (north), the road is south
    const p = onLand(land({ lanes: [{ id: "l", points: [{ x: 0, y: laneY }, { x: 150 * FT, y: laneY }], widthFt: 14 }] }));
    const a = nearestAccess(p.plot!, { x: mid.x, y: bb.y0 + o.y });
    expect(a.kind).toBe("lane");
    expect(a.at.y).toBeCloseTo(laneY + 7 * FT, 0);

    const y = yardLayout(p.floorPlans, p.levels, p.plan.basics, p.plot, lotOffsetFor(p))!;
    const end = y.driveway[y.driveway.length - 1].b;
    const endPlot = { x: end.x + o.x, y: end.y + o.y };
    const toLane = Math.abs(endPlot.y - (laneY + 7 * FT));
    const toRoad = Math.abs(endPlot.y - p.plot!.depthIn);
    expect(Math.min(toLane, toRoad)).toBeLessThan(2);
  });

  it("keeps made-up plots on their road side", () => {
    const plot = generatePlot(5);
    const a = nearestAccess(plot, { x: 100, y: 100 });
    const edge = { N: Math.min(...plot.outline.map((q) => q.y)), S: Math.max(...plot.outline.map((q) => q.y)), W: Math.min(...plot.outline.map((q) => q.x)), E: Math.max(...plot.outline.map((q) => q.x)) }[plot.roadSide];
    expect(plot.roadSide === "N" || plot.roadSide === "S" ? a.at.y : a.at.x).toBe(edge);
  });
});

describe("3D land and cost", () => {
  it("builds rocks and trees from the land, and roads along the real edges", () => {
    const p = onLand(land({ features: [{ id: "r", kind: "rock", at: { x: 300, y: 300 }, sizeFt: 10 }, { id: "t", kind: "tree", at: { x: 1500, y: 300 }, sizeFt: 25 }] }));
    const site = siteFor(p.plot, lotOffsetFor(p), p.floorPlans);
    const parts = buildLandFeatures(site, { ox: 0, oy: 0 });
    expect(parts.map((x) => x.key).sort()).toEqual(["land:rocks", "land:trees"]);
    expect(parts.every((x) => x.mesh.count > 0)).toBe(true);
    expect(buildLandFeatures(siteFor(generatePlot(2), { x: 0, y: 0 }, p.floorPlans), { ox: 0, oy: 0 })).toEqual([]);
    const lines = roadLinesIn3D(p.plot!);
    expect(lines.length).toBe(1);
    // Just past the south edge.
    expect(lines[0][0].y).toBeGreaterThan(p.plot!.depthIn);
  });

  it("prices rock removal only when the house sits on a rock", () => {
    const at = houseMiddle(onLand(land()));
    const onRock = estimate(onLand(land({ features: [{ id: "r", kind: "rock", at, sizeFt: 10 }] })))!;
    const linesOf = (e: typeof onRock) => e.categories.flatMap((c) => c.lines);
    const line = linesOf(onRock).find((l) => l.id === "rock-removal");
    expect(line).toBeTruthy();
    expect(line!.qty).toBeGreaterThan(5);
    const clear = estimate(onLand(land({ features: [{ id: "r", kind: "rock", at: { x: 60, y: 60 }, sizeFt: 4 }] })))!;
    expect(linesOf(clear).some((l) => l.id === "rock-removal")).toBe(false);
  });
});

describe("PDF site plan and My real lot", () => {
  it("names the lot lines from the main road, with a side street", () => {
    const s = land({ northDeg: 90 });
    s.roads = [...s.roads, { id: "side", edge: 1, kind: "side", widthFt: 26 }];
    const site = siteLayout(onLand(s))!;
    const front = site.lines.filter((l) => l.side === "front");
    expect(front.length).toBe(1);
    expect(front[0].street).toBe(true);
    expect(front[0].lengthFt).toBeCloseTo(150, 1);
    const sideStreet = site.lines.find((l) => l.street && l.side !== "front")!;
    expect(sideStreet.side).toBe("right");
    expect(site.lines.find((l) => l.side === "rear")!.street).toBe(false);
  });

  it("copies a four-sided designed lot into My real lot", () => {
    const got = lotFromCustomLand(buildCustomPlot(land({ northDeg: 90 })));
    expect("lot" in got).toBe(true);
    if (!("lot" in got)) return;
    expect(got.lot).toMatchObject({ shape: "rectangle", frontFt: 150, rearFt: 150, leftFt: 200, rightFt: 200, streetSide: "E", sideStreet: "none" });

    // A lot that narrows toward the back, front and rear still parallel.
    const trap = buildCustomPlot(land({ outline: [{ x: 300, y: 0 }, { x: 1500, y: 0 }, { x: 1800, y: 2400 }, { x: 0, y: 2400 }] }));
    const t = lotFromCustomLand(trap);
    expect("lot" in t && t.lot).toMatchObject({ shape: "four-sides", frontFt: 150, rearFt: 100 });
    if ("lot" in t) expect(t.lot.leftFt).toBeCloseTo(t.lot.rightFt, 2);
  });

  it("explains when the designed lot can't be copied", () => {
    const five = buildCustomPlot(land({ outline: [{ x: 0, y: 0 }, { x: 900, y: -300 }, { x: 1800, y: 0 }, { x: 1800, y: 2400 }, { x: 0, y: 2400 }], roads: [{ id: "m", edge: 3, kind: "main", widthFt: 26 }] }));
    const a = lotFromCustomLand(five);
    expect("problem" in a && a.problem).toMatch(/5 sides/);
    const skew = buildCustomPlot(land({ outline: [{ x: 0, y: 0 }, { x: 1800, y: 300 }, { x: 1800, y: 2400 }, { x: 0, y: 2400 }] }));
    const b = lotFromCustomLand(skew);
    expect("problem" in b && b.problem).toMatch(/parallel/);
    expect("problem" in lotFromCustomLand(generatePlot(1))).toBe(true);
  });
});
