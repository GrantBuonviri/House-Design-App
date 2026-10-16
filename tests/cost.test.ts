import { DEFAULT_LABELS } from "@/lib/plan/labels";
import { describe, expect, it } from "vitest";
import { DiscoveryAnswers, House3D, Project, type ChosenRoom, type FloorPlan, type Opening, type PlanRoom, type Plot } from "@/lib/model/schema";
import { createProject, migrateProject } from "@/lib/model/project";
import { generatePlot, FLAT_PLOT_SEED } from "@/lib/land/generate";
import { buildRuleBrief } from "@/lib/brief/rules";
import { levelFor, levelsFor, MAIN_LEVEL_ID } from "@/lib/brief/levels";
import { suggestDiagrams } from "@/lib/bubbles/arrange";
import { defaultBasics } from "@/lib/plan/basics";
import { suggestPlans } from "@/lib/plan/suggest";
import { rectangle } from "@/lib/plan/geometry";
import { measurePlan, measureRoof, measureRough } from "@/lib/cost/quantities";
import { estimate, permitFee, type Estimate } from "@/lib/cost/estimate";
import { parseRates, rates, RATE_IDS } from "@/lib/cost/rates";
import raw from "@/lib/cost/data/cost-rates.json";

const FT = 12;
const flat = generatePlot(FLAT_PLOT_SEED, { flat: true });

function room(id: string, x: number, y: number, w: number, h: number, type = "living"): PlanRoom {
  return { id, name: id, type, polygon: rectangle(x + w / 2, y + h / 2, w, h) };
}
function plan(rooms: PlanRoom[], extra: Partial<FloorPlan> = {}): FloorPlan {
  return { rooms, walls: [], openings: [], stairs: [], fixtures: [], furniture: [], ...extra };
}
const ROOF = House3D.parse({}).roof;

function project(plans: Record<string, FloorPlan>, extra: Partial<Project> = {}): Project {
  const levels = extra.levels ?? [levelFor(MAIN_LEVEL_ID)];
  return { ...createProject("Test"), plot: flat, levels, floorPlans: plans, plan: { basics: defaultBasics(), showSketch: false, labels: DEFAULT_LABELS }, ...extra };
}

const cat = (e: Estimate, id: string) => e.categories.find((c) => c.id === id)!.cost.likely;
const line = (e: Estimate, id: string) => e.categories.flatMap((c) => c.lines).filter((l) => l.id === id);

/** A plain 50 x 40 ft box: 2,000 sq ft on one floor. */
const box = () => ({ [MAIN_LEVEL_ID]: plan([room("a", 0, 0, 50 * FT, 40 * FT)]) });

const chosen = (type: string, levelId?: string, i = 0): ChosenRoom => ({ id: `${type}-${i}`, type, name: type, description: "", levelId });

function suggestedHouse(plot: Plot, types: string[], above = 1, below = 0) {
  const answers = DiscoveryAnswers.parse({ rooms: types.map((t, i) => chosen(t, undefined, i)), floorsAbove: above, floorsBelow: below });
  const brief = buildRuleBrief({ answers, profile: { mustHaves: [], dislikes: [] }, plot });
  const levels = levelsFor(brief.floors, brief.floorsBelow);
  const bubbles = suggestDiagrams({ brief, plot, levels });
  const basics = defaultBasics();
  const plans = suggestPlans(bubbles, { brief, plot, levels, basics }).plans;
  return { ...createProject("Test"), plot, brief, levels, bubbles, floorPlans: plans, discovery: { answers }, plan: { basics, showSketch: false, labels: DEFAULT_LABELS } };
}

const TYPICAL = ["entry", "living", "kitchen", "dining", "primary-bedroom", "primary-bath", "primary-closet", "bedroom", "bedroom", "bathroom", "laundry", "garage", "porch"];

describe("the rates file", () => {
  it("has every rate the estimate needs, each [low, likely, high] in order", () => {
    const file = parseRates(raw);
    for (const id of RATE_IDS) expect(file.rates[id], id).toBeTruthy();
  });

  it("rejects a rate whose low is above its likely", () => {
    const broken = structuredClone(raw) as { rates: Record<string, { material: number[] }> };
    broken.rates.slab.material = [9, 5, 10];
    expect(() => parseRates(broken)).toThrow();
  });

  it("works out the permit fee from the building value", () => {
    const p = rates().permit;
    expect(permitFee(300_000, p)).toBeGreaterThan(0);
    expect(permitFee(600_000, p)).toBeGreaterThan(permitFee(300_000, p));
  });
});

describe("measuring the house", () => {
  it("measures a simple box: floor area, outside walls, roof", () => {
    const q = measurePlan(project(box()))!;
    expect(q.source).toBe("plan");
    expect(q.livingSqft).toBeCloseTo(2000, 0);
    // 180 ft of outside wall, 9 ft ceiling plus the floor structure.
    expect(q.extWallSqft).toBeGreaterThan(180 * 9);
    expect(q.extWallSqft).toBeLessThan(180 * 10.5);
    // A 6 in 12 roof with 16 in overhangs is bigger than the floor.
    expect(q.roofSqft).toBeGreaterThan(2000 * 1.1);
    expect(q.roofSqft).toBeLessThan(2000 * 1.5);
    expect(q.slabSqft).toBeCloseTo(2000, 0);
    expect(q.footingLf).toBeCloseTo(181, -1);
  });

  it("counts the garage, porches and decks apart from living space", () => {
    const q = measurePlan(
      project({ [MAIN_LEVEL_ID]: plan([room("a", 0, 0, 40 * FT, 30 * FT), room("g", 40 * FT, 0, 24 * FT, 24 * FT, "garage"), room("p", 0, 30 * FT, 20 * FT, 8 * FT, "porch"), room("d", 0, -12 * FT, 16 * FT, 12 * FT, "deck")]) }),
    )!;
    expect(q.livingSqft).toBeCloseTo(1200, 0);
    expect(q.garageSqft).toBeCloseTo(576, 0);
    expect(q.garageSlabSqft).toBeCloseTo(576, 0);
    expect(q.porchSqft).toBeCloseTo(160, 0);
    expect(q.deckSqft).toBeCloseTo(192, 0);
    expect(q.slabSqft).toBeCloseTo(1200, 0);
  });

  it("adds posts, footings and a beam under a room held up on posts", () => {
    const levels = levelsFor(2, 0);
    const plans = (overhang?: PlanRoom["overhang"]) => ({ "floor-1": plan([room("a", 0, 0, 30 * FT, 20 * FT)]), "floor-2": plan([{ ...room("b", 0, 0, 20 * FT, 26 * FT), overhang }]) });
    const q = measurePlan(project(plans("posts"), { levels }))!;
    // A 20' beam along the outer edge plus the two 6' sides, posts at the corners and every 8'.
    expect(q.overhangBeamLf).toBeCloseTo(32, 0);
    expect(q.overhangPosts).toBe(4);
    const e = estimate(project(plans("posts"), { levels }))!;
    expect(line(e, "overhang-post")[0].cost.likely).toBeGreaterThan(0);
    expect(line(e, "overhang-beam")[0].cost.likely).toBeGreaterThan(0);
    expect(measurePlan(project(plans(), { levels }))!.overhangPosts).toBe(0);
    expect(line(estimate(project(plans(), { levels }))!, "overhang-post")).toEqual([]);
  });

  it("frames the upper floor and roofs only the top", () => {
    const levels = levelsFor(2, 0);
    const q = measurePlan(project({ "floor-1": plan([room("a", 0, 0, 40 * FT, 30 * FT)]), "floor-2": plan([room("b", 0, 0, 40 * FT, 30 * FT)]) }, { levels }))!;
    expect(q.livingSqft).toBeCloseTo(2400, 0);
    expect(q.floorFramingSqft).toBeCloseTo(1200, -1);
    expect(q.floorsAbove).toBe(2);
    expect(q.atticSqft).toBeCloseTo(1200, -1);
    expect(q.roofSqft).toBeLessThan(1200 * 1.5);
  });

  it("digs and waterproofs a basement", () => {
    const levels = levelsFor(1, 1);
    const q = measurePlan(project({ "floor-1": plan([room("a", 0, 0, 40 * FT, 30 * FT)]), "basement-1": plan([room("b", 0, 0, 40 * FT, 30 * FT)]) }, { levels }))!;
    expect(q.floorsBelow).toBe(1);
    expect(q.basementSlabSqft).toBeCloseTo(1200, -1);
    expect(q.basementWallSqft).toBeGreaterThan(140 * 8);
    expect(q.waterproofSqft).toBeGreaterThan(140 * 7);
    expect(q.excavationCuyd).toBeGreaterThan(300);
    // The main floor sits on the basement: framed, not a slab.
    expect(q.slabSqft).toBe(0);
    expect(q.floorFramingSqft).toBeCloseTo(1200, -1);
  });

  it("measures a hip roof with hips, and a gable with none on a plain box", () => {
    const plans = box();
    const levels = [levelFor(MAIN_LEVEL_ID)];
    const hip = measureRoof(plans, levels, defaultBasics(), { ...ROOF, style: "hip" });
    const gable = measureRoof(plans, levels, defaultBasics(), { ...ROOF, style: "gable" });
    expect(hip.hipValleyLf).toBeGreaterThan(50);
    expect(gable.hipValleyLf).toBe(0);
    expect(gable.gableSqft).toBeGreaterThan(100);
    const steep = measureRoof(plans, levels, defaultBasics(), { ...ROOF, pitch: 12 });
    expect(steep.roofSqft).toBeGreaterThan(gable.roofSqft * 1.2);
  });

  it("keeps the roof a sensible size on an odd-shaped house (the roof maker once sent a corner off to infinity)", () => {
    const q = measurePlan(suggestedHouse(generatePlot(7), [...TYPICAL, "office"], 1, 1))!;
    expect(q.roofSqft).toBeGreaterThan(q.livingSqft);
    expect(q.roofSqft).toBeLessThan((q.livingSqft + q.garageSqft + q.porchSqft) * 2);
    expect(q.hipValleyLf).toBeLessThan(q.eaveLf * 3);
  });

  it("counts windows and doors from the plan", () => {
    const openings: Opening[] = [
      { id: "w", host: { roomId: "a", edge: 0 }, offsetIn: 120, kind: "window", style: "window", widthIn: 36, heightIn: 60, sillIn: 30, side: 1, hinge: "start" },
      { id: "d", host: { roomId: "a", edge: 2 }, offsetIn: 120, kind: "door", style: "door-entry", widthIn: 36, heightIn: 80, side: 1, hinge: "start" },
      { id: "i", host: { roomId: "a", edge: 1 }, offsetIn: 60, kind: "door", style: "door-hinged", widthIn: 32, heightIn: 80, side: 1, hinge: "start" },
    ];
    const q = measurePlan(project({ [MAIN_LEVEL_ID]: plan([room("a", 0, 0, 20 * FT, 12 * FT), room("b", 20 * FT, 0, 12 * FT, 12 * FT, "bedroom")], { openings }) }))!;
    expect(q.windowSqft).toBeCloseTo(15, 0);
    expect(q.windows).toBe(1);
    expect(q.entryDoors).toBe(1);
    expect(q.interiorDoors).toBe(1);
  });

  it("uses typical fixtures for bathrooms and kitchens with nothing placed", () => {
    const q = measurePlan(project({ [MAIN_LEVEL_ID]: plan([room("k", 0, 0, 15 * FT, 14 * FT, "kitchen"), room("b", 15 * FT, 0, 8 * FT, 10 * FT, "bathroom")]) }))!;
    expect(q.toilets).toBe(1);
    expect(q.showers).toBe(1);
    expect(q.kitchens).toBe(1);
    expect(q.cabinetLf).toBeGreaterThan(10);
    expect(q.waterHeaters).toBe(1);
  });

  it("makes a rough measure from the Rooms page before there's a floor plan", () => {
    const answers = DiscoveryAnswers.parse({ rooms: TYPICAL.map((t, i) => chosen(t, undefined, i)) });
    const p = { ...createProject("Rough"), plot: flat, discovery: { answers } };
    expect(measurePlan(p)).toBeNull();
    const q = measureRough(p)!;
    expect(q.source).toBe("rough");
    expect(q.livingSqft).toBeGreaterThan(1300);
    expect(q.garageSqft).toBeGreaterThan(0);
    expect(q.toilets).toBe(2);
  });
});

describe("the estimate", () => {
  it("is null with nothing to measure", () => {
    expect(estimate(createProject("Empty"))).toBeNull();
  });

  it("adds up, with land at $0 and low ≤ likely ≤ high everywhere", () => {
    const e = estimate(project(box()))!;
    expect(e.land).toBe(0);
    const sum = e.categories.reduce((s, c) => s + c.cost.likely, 0);
    expect(e.total.likely).toBeCloseTo(sum, 0);
    // The total's range is narrower than adding up every low and every high.
    expect(e.total.low).toBeGreaterThan(e.categories.reduce((s, c) => s + c.cost.low, 0));
    expect(e.total.high).toBeLessThan(e.categories.reduce((s, c) => s + c.cost.high, 0));
    expect(e.total.low).toBeLessThan(e.total.likely);
    for (const c of e.categories) {
      expect(c.cost.low, c.id).toBeLessThanOrEqual(c.cost.likely + 0.01);
      expect(c.cost.likely, c.id).toBeLessThanOrEqual(c.cost.high + 0.01);
    }
    expect(e.categories).toHaveLength(16);
  });

  it("lands near published Boise cost per square foot for a typical one-story house", () => {
    // The published figures leave out contingency and landscaping, so compare without them.
    const target = rates().calibration.costPerSqft;
    const LANDSCAPING = ["front-walk", "lawn", "planting-beds", "shrubs", "trees"];
    for (const types of [TYPICAL, [...TYPICAL, "office", "bedroom", "family", "half-bath"]]) {
      const e = estimate(suggestedHouse(flat, types))!;
      const yard = e.categories.flatMap((c) => c.lines).filter((l) => LANDSCAPING.includes(l.id)).reduce((s, l) => s + l.cost.likely, 0);
      expect(yard).toBeGreaterThan(0);
      const perSqft = (e.total.likely - cat(e, "contingency") - yard) / e.quantities.livingSqft;
      expect(perSqft).toBeGreaterThan(target[0]);
      expect(perSqft).toBeLessThan(target[2]);
    }
  });

  it("costs more on a steep plot with poor drainage than on flat ground", () => {
    const p = project(box());
    const steep: Plot = { ...flat, isFlat: false, slope: { percent: 12, downhillDeg: 180 }, drainage: { rating: "poor", reason: "clay" } };
    const a = estimate(p)!;
    const b = estimate({ ...p, plot: steep })!;
    expect(cat(b, "site")).toBeGreaterThan(cat(a, "site"));
    expect(line(b, "drainage-major")).toHaveLength(1);
    expect(b.drivers.some((d) => /drainage/i.test(d.text))).toBe(true);
  });

  it("swaps city hookups for a well and septic", () => {
    const p = project(box());
    const city = estimate(p)!;
    const well = estimate({ ...p, cost: { utilities: "well-septic" } })!;
    expect(line(city, "sewer-connection")).toHaveLength(1);
    expect(line(well, "sewer-connection")).toHaveLength(0);
    expect(line(well, "septic")).toHaveLength(1);
    expect(well.drivers.some((d) => /well/i.test(d.text))).toBe(true);
  });

  it("costs more as the house grows and the roof gets steeper", () => {
    const small = estimate(project(box()))!;
    const big = estimate(project({ [MAIN_LEVEL_ID]: plan([room("a", 0, 0, 60 * FT, 45 * FT)]) }))!;
    expect(big.total.likely).toBeGreaterThan(small.total.likely);
    const steep = estimate({ ...project(box()), house3d: { roof: { ...ROOF, pitch: 12 } } })!;
    expect(cat(steep, "roofing")).toBeGreaterThan(cat(small, "roofing"));
  });

  it("replaces an allowance with a picked product", () => {
    const p = project({ [MAIN_LEVEL_ID]: plan([room("a", 0, 0, 50 * FT, 40 * FT)]) });
    const base = estimate(p)!;
    const product = { name: "Test plank", brand: "Shaw", url: "https://shawfloors.com/x", price: 20, unit: "sqft" as const, priceSource: "listed" as const, lastChecked: "2026-10-14" };
    const picked = estimate({ ...p, interior: { answers: {}, moodBoard: [], shuffle: 0, selections: [{ id: "s", targetId: "a", category: "flooring", product }] } })!;
    const l = line(picked, "flooring")[0];
    expect(l.product).toBe("Shaw Test plank");
    expect(cat(picked, "interior")).toBeGreaterThan(cat(base, "interior"));
  });

  it("gives a rough estimate from the Rooms page", () => {
    const answers = DiscoveryAnswers.parse({ rooms: TYPICAL.map((t, i) => chosen(t, undefined, i)) });
    const e = estimate({ ...createProject("Rough"), plot: flat, discovery: { answers } })!;
    expect(e.source).toBe("rough");
    expect(e.total.likely).toBeGreaterThan(200_000);
  });
});

describe("saving", () => {
  it("opens older projects with city water and sewer", () => {
    const older = { ...createProject("Old"), schemaVersion: 5 } as Record<string, unknown>;
    delete older.cost;
    expect(migrateProject(older).cost).toEqual({ utilities: "city" });
  });
});
