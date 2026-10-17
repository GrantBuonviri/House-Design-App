import { describe, expect, it } from "vitest";
import { type CustomLand, Plot } from "@/lib/model/schema";
import { addGround, buildingSpotGrade, clearGround, contourSegments, landContours, moveGround, setGroundAmount, setGroundRadius, stampGround, GROUND_RADIUS_MAX_FT, GROUND_RADIUS_MIN_FT, HEIGHT_MAX_FT } from "@/lib/land/groundTools";
import { buildCustomPlot, landFrame, newCustomLand, plotRoadEdges, rectOutline, scaleOutlineToAcres } from "@/lib/land/custom";
import {
  ACRE_SQ_IN,
  FLAT_PLOT_SEED,
  describeSlope,
  feedPlotSeed,
  generatePlot,
  plotAcres,
  polygonArea,
  regeneratePlot,
} from "@/lib/land/generate";
import { STEEPER_MAX, createTerrain, elevationChange, localSlopePercent } from "@/lib/land/terrain";
import { plotImplications } from "@/lib/land/implications";
import { createRng } from "@/lib/land/random";
import { compassName, dayArc, sunPosition, SUMMER_SOLSTICE, WINTER_SOLSTICE } from "@/lib/land/sun";
import { pointInPolygon } from "@/lib/land/geometry";
import { DEFAULT_PLACE } from "@/lib/location/current";

const seeds = Array.from({ length: 300 }, (_, i) => feedPlotSeed(12345, i));

describe("seeded random", () => {
  it("repeats exactly for the same seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    expect(Array.from({ length: 5 }, a.next)).toEqual(Array.from({ length: 5 }, b.next));
  });
});

describe("generatePlot", () => {
  it("regenerates an identical plot from its seed", () => {
    for (const s of seeds.slice(0, 20)) {
      const p = generatePlot(s);
      expect(regeneratePlot(p)).toEqual(p);
      expect(JSON.parse(JSON.stringify(p))).toEqual(p);
    }
  });

  it("gives different plots for different seeds", () => {
    const names = new Set(seeds.slice(0, 50).map((s) => JSON.stringify(generatePlot(s))));
    expect(names.size).toBe(50);
  });

  it("always passes the project schema with sensible values", () => {
    for (const s of seeds) {
      const p = generatePlot(s);
      expect(Plot.safeParse(p).success).toBe(true);
      expect(p.isFlat).toBe(false);
      expect(p.slope.percent).toBeGreaterThanOrEqual(0.5);
      expect(p.slope.percent).toBeLessThanOrEqual(25);
      expect(p.outline.length).toBeGreaterThanOrEqual(4);
      const acres = plotAcres(p);
      expect(acres).toBeGreaterThan(0.15);
      expect(acres).toBeLessThan(6.5);
      expect(p.drainage.reason.length).toBeGreaterThan(5);
      // Outline stays inside its bounding box.
      for (const pt of p.outline) {
        expect(pt.x).toBeGreaterThanOrEqual(0);
        expect(pt.x).toBeLessThanOrEqual(p.widthIn);
        expect(pt.y).toBeGreaterThanOrEqual(0);
        expect(pt.y).toBeLessThanOrEqual(p.depthIn);
      }
    }
  });

  it("produces every drainage rating, water feature and shape across many plots", () => {
    const plots = seeds.map((s) => generatePlot(s));
    expect(new Set(plots.map((p) => p.drainage.rating))).toEqual(new Set(["good", "fair", "poor"]));
    expect(new Set(plots.flatMap((p) => p.waterFeatures.map((w) => w.kind)))).toEqual(
      new Set(["creek", "pond", "lake", "wash"]),
    );
    expect(new Set(plots.map((p) => p.shape))).toEqual(new Set(["rectangle", "wide", "deep", "corner", "irregular"]));
  });

  it("clips one corner on corner lots", () => {
    const p = seeds.map((s) => generatePlot(s)).find((x) => x.shape === "corner")!;
    expect(p.outline).toHaveLength(5);
    expect(polygonArea(p.outline)).toBeLessThan(p.widthIn * p.depthIn);
  });
});

describe("flat plot", () => {
  const flat = generatePlot(FLAT_PLOT_SEED, { flat: true });

  it("is one level acre with good drainage and no water", () => {
    expect(flat.isFlat).toBe(true);
    expect(flat.slope.percent).toBe(0);
    expect(plotAcres(flat)).toBeCloseTo(1, 2);
    expect(flat.drainage.rating).toBe("good");
    expect(flat.waterFeatures).toEqual([]);
    expect(describeSlope(flat)).toBe("Flat");
    expect(createTerrain(flat)(1000, 500)).toBe(0);
    expect(regeneratePlot(flat)).toEqual(flat);
  });

  it("never shares a seed with the feed", () => {
    expect(seeds).not.toContain(FLAT_PLOT_SEED);
  });

  it("suggests a slab foundation", () => {
    expect(plotImplications(flat).foundation.type).toBe("slab");
  });
});

describe("terrain", () => {
  it("falls in the downhill direction by about the stated grade", () => {
    const p = { ...generatePlot(seeds[3]), waterFeatures: [] };
    const sloped = { ...p, slope: { percent: 10, downhillDeg: 180 } };
    const h = createTerrain(sloped);
    // 100 ft south should be ~10 ft lower, give or take the rolling noise.
    const drop = h(p.widthIn / 2, p.depthIn / 2 - 600) - h(p.widthIn / 2, p.depthIn / 2 + 600);
    expect(drop).toBeGreaterThan(120 - 100);
    expect(drop).toBeLessThan(120 + 100);
  });

  it("is deterministic", () => {
    const p = generatePlot(seeds[7]);
    expect(createTerrain(p)(321, 654)).toBe(createTerrain(regeneratePlot(p))(321, 654));
  });

  it("dips where a creek runs", () => {
    const p = seeds.map((s) => generatePlot(s)).find((x) => x.waterFeatures[0]?.kind === "creek")!;
    const noCreek = createTerrain({ ...p, waterFeatures: [] });
    const withCreek = createTerrain(p);
    const mid = p.waterFeatures[0].points[7];
    expect(withCreek(mid.x, mid.y)).toBeLessThan(noCreek(mid.x, mid.y) - 30);
  });

  it("reports more elevation change on steeper plots", () => {
    const p = { ...generatePlot(seeds[1]), waterFeatures: [] };
    const gentle = elevationChange({ ...p, slope: { ...p.slope, percent: 2 } });
    const steep = elevationChange({ ...p, slope: { ...p.slope, percent: 20 } });
    expect(steep).toBeGreaterThan(gentle);
  });

  it("puts lake water outside most of the plot", () => {
    const p = seeds.map((s) => generatePlot(s)).find((x) => x.waterFeatures[0]?.kind === "lake")!;
    expect(pointInPolygon({ x: p.widthIn / 2, y: p.depthIn / 2 }, p.waterFeatures[0].points)).toBe(false);
  });
});

describe("sun in Boise", () => {
  it("is due south and high at summer solar noon", () => {
    const s = sunPosition(SUMMER_SOLSTICE, 12, DEFAULT_PLACE.latitudeDeg);
    expect(s.azimuthDeg).toBeCloseTo(180, 0);
    expect(s.altitudeDeg).toBeCloseTo(69.8, 0);
  });

  it("is low at winter solar noon", () => {
    expect(sunPosition(WINTER_SOLSTICE, 12, DEFAULT_PLACE.latitudeDeg).altitudeDeg).toBeCloseTo(23, 0);
  });

  it("rises in the north-east in summer and south-east in winter", () => {
    const summer = dayArc(SUMMER_SOLSTICE, DEFAULT_PLACE.latitudeDeg);
    const winter = dayArc(WINTER_SOLSTICE, DEFAULT_PLACE.latitudeDeg);
    expect(summer.sunrise.azimuthDeg).toBeGreaterThan(50);
    expect(summer.sunrise.azimuthDeg).toBeLessThan(60);
    expect(winter.sunrise.azimuthDeg).toBeGreaterThan(120);
    expect(winter.sunrise.azimuthDeg).toBeLessThan(130);
    expect(summer.sunset.azimuthDeg).toBeCloseTo(360 - summer.sunrise.azimuthDeg, 0);
    expect(summer.daylightHours).toBeGreaterThan(15);
    expect(winter.daylightHours).toBeLessThan(9.5);
  });

  it("names compass directions", () => {
    expect(compassName(0)).toBe("north");
    expect(compassName(135)).toBe("south-east");
    expect(compassName(359)).toBe("north");
  });
});

describe("plot implications", () => {
  const base = { ...generatePlot(seeds[0]), waterFeatures: [] as Plot["waterFeatures"] };
  const at = (percent: number, facing = 180) =>
    plotImplications({ ...base, slope: { percent, downhillDeg: facing }, facingDeg: facing });

  it("picks the foundation from the slope", () => {
    expect(at(1).foundation.type).toBe("slab");
    expect(at(5).foundation.type).toBe("crawlspace");
    expect(at(10).foundation.type).toBe("walkout");
    expect(at(20).foundation.type).toBe("stepped");
    expect(at(10, 90).foundation.note).toContain("east");
  });

  it("rates sun by which way the land faces", () => {
    expect(at(8, 180).sun.rating).toBe("excellent");
    expect(at(8, 135).sun.rating).toBe("good");
    expect(at(8, 0).sun.rating).toBe("limited");
  });

  it("flags drainage work", () => {
    expect(plotImplications({ ...base, drainage: { rating: "poor", reason: "x" } }).drainageWork).toBe("major");
    expect(plotImplications({ ...base, drainage: { rating: "good", reason: "x" } }).drainageWork).toBe("none");
  });

  it("sizes plots in acres", () => {
    expect(plotAcres({ ...base, outline: [{ x: 0, y: 0 }, { x: Math.sqrt(ACRE_SQ_IN), y: 0 }, { x: Math.sqrt(ACRE_SQ_IN), y: Math.sqrt(ACRE_SQ_IN) }, { x: 0, y: Math.sqrt(ACRE_SQ_IN) }] })).toBeCloseTo(1);
  });
});

describe("custom land", () => {
  const base = (over: Partial<CustomLand> = {}): CustomLand => ({ ...newCustomLand("Test land"), seed: 4242, ...over });

  it("builds a valid plot from designer settings", () => {
    const s = base();
    const plot = buildCustomPlot(s);
    expect(Plot.parse(plot)).toEqual(plot);
    expect(plot.source).toBe("custom");
    expect(plot.custom).toEqual(s);
    expect(plot.widthIn).toBe(150 * 12);
    expect(plot.depthIn).toBe(200 * 12);
    expect(plot.roadSide).toBe("S");
    expect(plot.slope.downhillDeg).toBe(180);
    expect(plot.soilNote).toMatch(/Silty loam/);
    expect(plotAcres(plot)).toBeCloseTo((150 * 200) / 43560, 3);
  });

  it("turns the drawing by the north arrow", () => {
    // North arrow pointing left: the street drawn at the bottom is on the west.
    const left = buildCustomPlot(base({ northDeg: 270 }));
    expect(left.roadSide).toBe("W");
    expect(left.widthIn).toBe(200 * 12);
    expect(left.depthIn).toBe(150 * 12);
    expect(left.slope.downhillDeg).toBe(270);
    // North arrow pointing right: the bottom is east.
    const right = buildCustomPlot(base({ northDeg: 90 }));
    expect(right.roadSide).toBe("E");
    expect(right.facingDeg).toBe(90);
    // Everything stays inside the lot's box, origin at the north-west.
    for (const p of right.outline) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
    }
  });

  it("turns features, lanes and ground shapes with the lot", () => {
    // A rock drawn near the bottom-left corner, north arrow pointing right.
    const s = base({
      northDeg: 90,
      features: [{ id: "r", kind: "rock", at: { x: 10 * 12, y: 190 * 12 }, sizeFt: 8 }],
      ground: [{ id: "h", kind: "hill", at: { x: 75 * 12, y: 20 * 12 }, radiusFt: 30, amount: 6 }],
      lanes: [{ id: "l", widthFt: 14, points: [{ x: 0, y: 100 * 12 }, { x: 150 * 12, y: 100 * 12 }] }],
    });
    const plot = buildCustomPlot(s);
    // Bottom of the drawing is east, left is south: the rock is in the south-east.
    expect(plot.features[0].at.x).toBeGreaterThan(plot.widthIn * 0.8);
    expect(plot.features[0].at.y).toBeGreaterThan(plot.depthIn * 0.8);
    expect(plotImplications(plot).notes.some((n) => /Big rock near the south-east corner/.test(n))).toBe(true);
    // The hill was drawn near the top (west), the lane runs north-south.
    expect(plot.ground[0].at.x).toBeLessThan(plot.widthIn * 0.2);
    expect(plot.lanes[0].points[0].x).toBe(plot.lanes[0].points[1].x);
  });

  it("picks the main road for roadSide and notes a corner lot", () => {
    const s = base({
      roads: [
        { id: "a", edge: 1, kind: "side", widthFt: 26 },
        { id: "b", edge: 2, kind: "main", widthFt: 26 },
      ],
    });
    const plot = buildCustomPlot(s);
    expect(plot.roadSide).toBe("S");
    const edges = plotRoadEdges(plot);
    expect(edges.map((e) => e.side)).toEqual(["E", "S"]);
    expect(plotImplications(plot).notes.some((n) => /Corner lot: a side street on the east/.test(n))).toBe(true);
  });

  it("gives made-up plots one main road on their road side", () => {
    for (const s of seeds.slice(0, 20)) {
      const plot = generatePlot(s);
      const edges = plotRoadEdges(plot);
      expect(edges).toHaveLength(1);
      expect(edges[0].side).toBe(plot.roadSide);
    }
  });

  it("scales an outline to acres and keeps its proportions", () => {
    const o = scaleOutlineToAcres(rectOutline(100, 200), 2);
    expect(polygonArea(o) / ACRE_SQ_IN).toBeCloseTo(2, 6);
    expect(o[2].y / o[2].x).toBeCloseTo(2, 6);
  });

  it("rates drainage from the soil and water picked", () => {
    const dry = buildCustomPlot(base({ soil: "Sandy loam", slope: { percent: 5, downhillDeg: 180 } }));
    expect(dry.drainage.rating).toBe("good");
    const wet = buildCustomPlot(
      base({ soil: "Heavy clay", slope: { percent: 0.5, downhillDeg: 180 }, water: [{ kind: "river", points: [{ x: 0, y: 0 }, { x: 1800, y: 2400 }] }] }),
    );
    expect(wet.drainage.rating).toBe("poor");
  });
});

describe("custom terrain", () => {
  const flatLand = (over: Partial<CustomLand> = {}) =>
    buildCustomPlot({ ...newCustomLand(), seed: 99, rolls: "smooth", slope: { percent: 0, downhillDeg: 180 }, ...over });
  const mid = { x: 75 * 12, y: 100 * 12 };

  it("is a true even slope when smooth", () => {
    const plot = buildCustomPlot({ ...newCustomLand(), seed: 7, rolls: "smooth", slope: { percent: 10, downhillDeg: 180 } });
    const h = createTerrain(plot);
    // 10% grade falling south: 10 ft lower over 100 ft.
    expect(h(mid.x, 50 * 12) - h(mid.x, 150 * 12)).toBeCloseTo(120, 3);
    expect(h(20 * 12, 80 * 12)).toBeCloseTo(h(130 * 12, 80 * 12), 6);
  });

  it("raises hills, lowers dips and mounds rocks", () => {
    const hill = createTerrain(flatLand({ ground: [{ id: "h", kind: "hill", at: mid, radiusFt: 40, amount: 10 }] }));
    expect(hill(mid.x, mid.y)).toBeCloseTo(120, 3);
    expect(hill(mid.x + 50 * 12, mid.y)).toBeCloseTo(0, 6);
    const dip = createTerrain(flatLand({ ground: [{ id: "d", kind: "dip", at: mid, radiusFt: 40, amount: 5 }] }));
    expect(dip(mid.x, mid.y)).toBeCloseTo(-60, 3);
    const rock = createTerrain(flatLand({ features: [{ id: "r", kind: "rock", at: mid, sizeFt: 10 }] }));
    expect(rock(mid.x, mid.y)).toBeCloseTo(36, 3);
  });

  it("carves a river wider and deeper than a creek", () => {
    const line = [{ x: 0, y: mid.y }, { x: 150 * 12, y: mid.y }];
    const river = createTerrain(flatLand({ water: [{ kind: "river", points: line }] }));
    const creek = createTerrain(flatLand({ water: [{ kind: "creek", points: line }] }));
    expect(river(mid.x, mid.y)).toBeLessThan(creek(mid.x, mid.y));
    expect(river(mid.x, mid.y + 25 * 12)).toBeLessThan(creek(mid.x, mid.y + 25 * 12) - 12);
  });

  it("makes a steeper patch steeper and a flatter patch level", () => {
    const slope = { percent: 8, downhillDeg: 180 };
    const plain = buildCustomPlot({ ...newCustomLand(), seed: 5, rolls: "smooth", slope });
    expect(localSlopePercent(plain, mid)).toBeCloseTo(8, 1);
    const steep = buildCustomPlot({ ...plain.custom!, ground: [{ id: "s", kind: "steeper", at: mid, radiusFt: 40, amount: 1 }] });
    expect(localSlopePercent(steep, mid, 10 * 12)).toBeCloseTo(8 * STEEPER_MAX, 0);
    expect(localSlopePercent(steep, { x: mid.x, y: 20 * 12 })).toBeCloseTo(8, 1);
    const pad = buildCustomPlot({ ...plain.custom!, ground: [{ id: "f", kind: "flatter", at: mid, radiusFt: 60, amount: 1 }] });
    expect(localSlopePercent(pad, mid)).toBeLessThan(0.5);
    // The foundation follows the level pad, and says why.
    const imp = plotImplications(pad);
    expect(imp.foundation.type).toBe("slab");
    expect(imp.notes[0]).toMatch(/building spot is flatter/);
    expect(plotImplications(plain).foundation.type).toBe("walkout");
  });

  it("grades a lane level across its width", () => {
    const plot = buildCustomPlot({
      ...newCustomLand(),
      seed: 3,
      slope: { percent: 12, downhillDeg: 90 },
      lanes: [{ id: "l", widthFt: 16, points: [{ x: 0, y: mid.y }, { x: 150 * 12, y: mid.y }] }],
    });
    const h = createTerrain(plot);
    // The lane runs east-west, downhill to the east: level across (north-south), still falling along it.
    expect(h(mid.x, mid.y - 6 * 12)).toBeCloseTo(h(mid.x, mid.y + 6 * 12), 6);
    expect(h(mid.x + 20 * 12, mid.y)).toBeLessThan(h(mid.x, mid.y));
  });

  it("leaves made-up plots exactly as they were", () => {
    for (const s of seeds.slice(0, 10)) {
      const plot = generatePlot(s);
      expect(plot.source).toBe("made-up");
      expect(plot.features).toEqual([]);
      expect(plot.ground).toEqual([]);
      expect(plot.rolls).toBe("gentle");
    }
  });
});

describe("ground tools", () => {
  const base = (): CustomLand => ({
    ...newCustomLand("t1"),
    slope: { percent: 6, downhillDeg: 180 },
    rolls: "smooth",
  });

  it("adds, moves, resizes and clears shapes with limits", () => {
    let l = addGround(base(), "hill", { x: 1000, y: 1000 }, 50, 6);
    expect(l.ground).toHaveLength(1);
    l = moveGround(l, 0, { x: 1200.4, y: 900 });
    expect(l.ground[0].at).toEqual({ x: 1200, y: 900 });
    expect(setGroundRadius(l, 0, 5000).ground[0].radiusFt).toBe(GROUND_RADIUS_MAX_FT);
    expect(setGroundRadius(l, 0, 1).ground[0].radiusFt).toBe(GROUND_RADIUS_MIN_FT);
    expect(setGroundAmount(l, 0, 99).ground[0].amount).toBe(HEIGHT_MAX_FT);
    const f = addGround(base(), "flatter", { x: 0, y: 0 }, 40, 1);
    expect(setGroundAmount(f, 0, 7).ground[0].amount).toBe(1);
    expect(clearGround(l).ground).toEqual([]);
  });

  it("brush strokes stamp along the drag and skip repeats", () => {
    const one = stampGround(base(), "steeper", { x: 0, y: 0 }, 30, 0.6);
    expect(one.ground).toHaveLength(1);
    expect(stampGround(one, "steeper", { x: 0, y: 0 }, 30, 0.6).ground).toHaveLength(1);
    const line = stampGround(one, "steeper", { x: 1800, y: 0 }, 30, 0.6, { x: 0, y: 0 });
    // 150 ft at one stamp per half radius (15 ft)
    expect(line.ground.length).toBeGreaterThan(8);
  });

  it("a flatter brush gives a level building pad, shown by the building spot grade", () => {
    const rect = newCustomLand("t2");
    const land: CustomLand = { ...rect, slope: { percent: 8, downhillDeg: 180 }, rolls: "smooth" };
    const before = buildingSpotGrade(buildCustomPlot(land));
    const mid = { x: (Math.min(...land.outline.map((p) => p.x)) + Math.max(...land.outline.map((p) => p.x))) / 2, y: (Math.min(...land.outline.map((p) => p.y)) + Math.max(...land.outline.map((p) => p.y))) / 2 };
    const flat = stampGround(land, "flatter", mid, 80, 1);
    const after = buildingSpotGrade(buildCustomPlot(flat));
    expect(before).toBeGreaterThan(6);
    expect(after).toBeLessThan(2);
  });

  it("contour lines follow a hill and stay inside the lot", () => {
    const land = addGround({ ...base(), slope: { percent: 0, downhillDeg: 0 } }, "hill", { x: 1200, y: 1200 }, 60, 10);
    const { segments, stepFt } = landContours(land, buildCustomPlot(land));
    expect(stepFt).toBeGreaterThan(0);
    expect(segments.length).toBeGreaterThan(20);
    for (const s of segments) expect(pointInPolygon({ x: (s[0] + s[2]) / 2, y: (s[1] + s[3]) / 2 }, land.outline)).toBe(true);
    expect(landContours(base(), buildCustomPlot({ ...base(), slope: { percent: 0, downhillDeg: 0 } })).segments).toEqual([]);
  });

  it("contourSegments crosses a simple slope once per level", () => {
    const segs = contourSegments((x) => x, { x0: 0, y0: 0, x1: 10, y1: 10 }, 10, 10, [4.5]);
    expect(segs).toHaveLength(10);
    for (const s of segs) expect(s[0]).toBeCloseTo(4.5);
  });

  it("the designer frame round-trips", () => {
    const land = { ...newCustomLand("t3"), northDeg: 37 };
    const fr = landFrame(land);
    const p = { x: 500, y: 700 };
    const back = fr.toDesigner(fr.toPlot(p));
    expect(back.x).toBeCloseTo(p.x);
    expect(back.y).toBeCloseTo(p.y);
  });
});
