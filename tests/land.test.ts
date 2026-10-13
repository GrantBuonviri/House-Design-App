import { describe, expect, it } from "vitest";
import { Plot } from "@/lib/model/schema";
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
import { createTerrain, elevationChange } from "@/lib/land/terrain";
import { plotImplications } from "@/lib/land/implications";
import { createRng } from "@/lib/land/random";
import { compassName, dayArc, sunPosition, SUMMER_SOLSTICE, WINTER_SOLSTICE } from "@/lib/land/sun";
import { pointInPolygon } from "@/lib/land/geometry";

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
    const s = sunPosition(SUMMER_SOLSTICE, 12);
    expect(s.azimuthDeg).toBeCloseTo(180, 0);
    expect(s.altitudeDeg).toBeCloseTo(69.8, 0);
  });

  it("is low at winter solar noon", () => {
    expect(sunPosition(WINTER_SOLSTICE, 12).altitudeDeg).toBeCloseTo(23, 0);
  });

  it("rises in the north-east in summer and south-east in winter", () => {
    const summer = dayArc(SUMMER_SOLSTICE);
    const winter = dayArc(WINTER_SOLSTICE);
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
