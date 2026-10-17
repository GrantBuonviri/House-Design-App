import { DEFAULT_LABELS } from "@/lib/plan/labels";
import { describe, expect, it } from "vitest";
import { DiscoveryAnswers, House3D, Project, SCHEMA_VERSION, WHOLE_HOUSE, type ChosenRoom, type Plot, type Selection } from "@/lib/model/schema";
import { createProject, migrateProject } from "@/lib/model/project";
import { generatePlot, FLAT_PLOT_SEED } from "@/lib/land/generate";
import { buildRuleBrief } from "@/lib/brief/rules";
import { levelsFor } from "@/lib/brief/levels";
import { suggestDiagrams } from "@/lib/bubbles/arrange";
import { defaultBasics } from "@/lib/plan/basics";
import { suggestPlans } from "@/lib/plan/suggest";
import { pointInPolygon } from "@/lib/plan/geometry";
import { areaKind } from "@/lib/plan/measure";
import { estimate, type Estimate } from "@/lib/cost/estimate";
import { measureRough } from "@/lib/cost/quantities";
import { rates as usRates, scaleRates } from "@/lib/cost/rates";

/** Boise is the default place, so its prices are the US-average ones times its cost level. */
const rates = () => scaleRates(usRates(), usRates().costLevelBase.index);
import { catalog } from "@/lib/catalog/catalog";
import { EXTERIOR_CATEGORIES, EXTERIOR_FILES, exteriorCatalog, exteriorProductsFor, parseExteriorCatalog, type ExteriorCategoryId } from "@/lib/catalog/exterior";
import { effectiveExterior, exteriorBoard, guessExterior, rankedExterior } from "@/lib/exterior/style";
import { exteriorPartsFor } from "@/lib/exterior/picks";
import { yardAmounts, yardLayout } from "@/lib/exterior/yard";
import { productTitle, setPick, toProduct } from "@/lib/interior/picks";
import { buildHouse, type HouseContext } from "@/lib/house3d/build";
import { exteriorLook } from "@/lib/house3d/exterior";
import { PATTERN } from "@/lib/house3d/finishes";
import { hex } from "@/lib/house3d/mesh";
import { lotOffsetFor, siteFor } from "@/lib/house3d/site";

const flat = generatePlot(FLAT_PLOT_SEED, { flat: true });
const chosen = (type: string, i = 0): ChosenRoom => ({ id: `${type}-${i}`, type, name: type, description: "" });
const TYPICAL = ["entry", "living", "kitchen", "dining", "primary-bedroom", "primary-bath", "primary-closet", "bedroom", "bedroom", "bathroom", "laundry", "garage", "porch", "patio", "deck"];

function suggestedHouse(plot: Plot = flat, types = TYPICAL): Project {
  const answers = DiscoveryAnswers.parse({ rooms: types.map((t, i) => chosen(t, i)), floorsAbove: 1, floorsBelow: 0 });
  const brief = buildRuleBrief({ answers, profile: { mustHaves: [], dislikes: [] }, plot });
  const levels = levelsFor(brief.floors, brief.floorsBelow);
  const bubbles = suggestDiagrams({ brief, plot, levels });
  const basics = defaultBasics();
  const plans = suggestPlans(bubbles, { brief, plot, levels, basics }).plans;
  return { ...createProject("Test"), plot, brief, levels, bubbles, floorPlans: plans, discovery: { ...createProject("x").discovery, answers }, plan: { basics, showSketch: false, labels: DEFAULT_LABELS, dismissed: [] } };
}

const house = suggestedHouse();
const withPicks = (p: Project, picks: [ExteriorCategoryId, string][], accentPlace?: "base" | "gables"): Project => {
  let selections: Selection[] = [];
  for (const [cat, id] of picks) selections = setPick(selections, WHOLE_HOUSE, cat, toProduct(exteriorCatalog().find((x) => x.id === id)!));
  return { ...p, exterior: { ...p.exterior, selections, ...(accentPlace ? { accentPlace } : {}) } };
};
const first = (cat: ExteriorCategoryId, kind?: string) => exteriorProductsFor(cat).find((p) => !kind || p.kind === kind)!;
const line = (e: Estimate, id: string) => e.categories.flatMap((c) => c.lines).find((l) => l.id === id);

describe("the exterior catalog", () => {
  it("loads, with a link, a price (listed or estimated) and a date on every product", () => {
    const all = exteriorCatalog();
    expect(all.length).toBeGreaterThanOrEqual(90);
    for (const p of all) {
      expect(p.url, p.id).toMatch(/^https:\/\//);
      expect(p.price, p.id).toBeGreaterThan(0);
      expect(["listed", "estimated"]).toContain(p.priceSource);
      expect(p.lastChecked, p.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("has products for every part of the outside, and ids no interior product uses", () => {
    for (const c of EXTERIOR_CATEGORIES) expect(exteriorProductsFor(c.id).length, c.id).toBeGreaterThan(0);
    const inside = new Set(catalog().map((p) => p.id));
    expect(() => parseExteriorCatalog(EXTERIOR_FILES, inside)).not.toThrow();
  });

  it("names the file and product when a file has a typo", () => {
    expect(() => parseExteriorCatalog({ siding: [{ name: "Bad board", id: "x" }] })).toThrow(/siding\.json, "Bad board"/);
  });
});

describe("exterior style", () => {
  it("guesses the outside from the interior style", () => {
    const g = guessExterior({ style: "modern-farmhouse", metal: "matte-black" });
    expect(g).toMatchObject({ style: "modern-farmhouse", siding: "batten", frames: "black", body: "light" });
    expect(guessExterior({})).toEqual({});
  });

  it("lets the user's answers win over guesses, and fills the rest from their chosen look", () => {
    const a = effectiveExterior({ style: "craftsman", siding: "brick" }, { style: "modern-farmhouse" });
    expect(a).toMatchObject({ style: "craftsman", siding: "brick", accent: "stone" });
  });

  it("puts board and batten siding, black windows and metal roofs first for a modern farmhouse", () => {
    const a = effectiveExterior({ style: "modern-farmhouse" }, {});
    expect(rankedExterior("siding", a)[0].kind).toBe("batten");
    expect(rankedExterior("windows", a)[0].tags).toContain("black");
    expect(rankedExterior("roofing", a)[0].kind).toBe("metal");
    expect(rankedExterior("accent", a)[0].kind).toBe("wood");
  });

  it("makes a mood board that shuffles", () => {
    const a = effectiveExterior({ style: "craftsman" }, {});
    const b0 = exteriorBoard(a, 0);
    const b1 = exteriorBoard(a, 1);
    expect(b0.palette.map((x) => x.label)).toEqual(["Siding", "Trim", "Roof", "Windows", "Front door"]);
    expect(b0.picks.length).toBeGreaterThan(5);
    expect(b1.picks.map((x) => x.product.id)).not.toEqual(b0.picks.map((x) => x.product.id));
  });

  it("only offers parts the house has", () => {
    const ids = exteriorPartsFor(house).map((c) => c.id);
    expect(ids).toContain("garage-doors");
    expect(ids).toContain("decking");
    const flatRoof = exteriorPartsFor({ ...house, house3d: House3D.parse({ roof: { style: "flat" } }) }).map((c) => c.id);
    expect(flatRoof).not.toContain("roofing");
    expect(exteriorPartsFor(createProject("Empty")).length).toBe(EXTERIOR_CATEGORIES.length);
  });
});

describe("the yard", () => {
  const y = yardLayout(house.floorPlans, house.levels, house.plan.basics, house.plot, lotOffsetFor(house))!;
  const rooms = Object.values(house.floorPlans).flatMap((pl) => pl.rooms);

  it("runs a driveway from the garage door to the road, and a walk from the front door to it", () => {
    expect(y.driveway.length).toBeGreaterThan(0);
    const roadEnd = y.driveway[y.driveway.length - 1].b;
    const offset = lotOffsetFor(house);
    // The flat plot's road side: the driveway ends on that edge of the lot.
    const edge = { N: 0, S: flat.depthIn, W: 0, E: flat.widthIn }[flat.roadSide];
    const at = flat.roadSide === "N" || flat.roadSide === "S" ? roadEnd.y + offset.y : roadEnd.x + offset.x;
    expect(Math.abs(at - edge)).toBeLessThan(2);
    expect(y.walk.length).toBeGreaterThan(0);
  });

  it("puts beds, shrubs, trees and lawn around the house, never inside it", () => {
    expect(y.beds.length).toBeGreaterThan(0);
    expect(y.shrubs.length).toBeGreaterThan(3);
    expect(y.trees.length).toBeGreaterThanOrEqual(2);
    const inside = (p: { x: number; y: number }) => rooms.some((r) => pointInPolygon(p, r.polygon));
    for (const p of [...y.shrubs, ...y.trees]) expect(inside(p)).toBe(false);
    const c = y.lawn.cell;
    for (const p of y.lawn.cells) expect(inside({ x: p.x + c / 2, y: p.y + c / 2 })).toBe(false);
    expect(y.lights.length).toBeGreaterThanOrEqual(3);
  });

  it("is what the cost estimate measures", () => {
    const q = estimate(house)!.quantities;
    const a = yardAmounts(y);
    expect(q.lawnSqft).toBeCloseTo(a.lawnSqft, 3);
    expect(q.walkSqft).toBeCloseTo(a.walkSqft, 3);
    expect(q.trees).toBe(a.trees);
    expect(q.driveSqft).toBeCloseTo(a.driveSqft, 3);
    // A typical yard near the house, not the whole lot.
    expect(q.lawnSqft).toBeGreaterThan(2000);
    expect(q.lawnSqft).toBeLessThan(15000);
  });

  it("has a typical yard in the rough estimate before there's a plan", () => {
    const p = { ...house, floorPlans: {} };
    const q = measureRough(p)!;
    expect(q.trees).toBe(4);
    expect(q.lawnSqft).toBeGreaterThan(1000);
    expect(q.walkSqft).toBeGreaterThan(0);
  });
});

describe("exterior picks in the cost", () => {
  const base = estimate(house)!;

  it("prices the yard and outdoor lights at mid-range before anything is picked", () => {
    for (const id of ["lawn", "planting-beds", "shrubs", "trees", "front-walk", "exterior-lights", "driveway"]) expect(line(base, id), id).toBeTruthy();
    expect(line(base, "accent")).toBeUndefined();
  });

  it("raises the roofing line for a metal roof, priced at the metal roof rate", () => {
    const e = estimate(withPicks(house, [["roofing", first("roofing", "metal").id]]))!;
    const r = line(e, "roof-shingle")!;
    expect(r.cost.likely).toBeGreaterThan(line(base, "roof-shingle")!.cost.likely * 1.5);
    expect(r.rate).toBe("roof-metal");
    expect(r.material).toBeCloseTo(r.cost.likely / r.qty, 5);
    expect(r.product).toContain(first("roofing", "metal").name);
  });

  it("takes a stone band out of the siding and prices it as stone", () => {
    const stone = first("accent", "stone");
    const e = estimate(withPicks(house, [["accent", stone.id]]))!;
    const siding = line(e, "siding")!;
    const accent = line(e, "accent")!;
    const q = e.quantities;
    expect(accent.qty).toBeCloseTo(q.baseWallLf * 3 * 0.9, 3);
    expect(siding.qty + accent.qty).toBeCloseTo(line(base, "siding")!.qty, 3);
    expect(accent.rate).toBe("stone-veneer");
    expect(accent.label).toMatch(/^Accent/);
  });

  it("puts a wood accent on the gables of a gable roof", () => {
    const wood = first("accent", "wood");
    const e = estimate(withPicks(house, [["accent", wood.id]]))!;
    expect(line(e, "accent")!.qty).toBeCloseTo(e.quantities.gableSqft, 3);
    const base2 = estimate(withPicks(house, [["accent", wood.id]], "base"))!;
    expect(line(base2, "accent")!.qty).toBeCloseTo(e.quantities.baseWallLf * 3 * 0.9, 3);
  });

  it("only counts siding paint on paintable siding", () => {
    const paint = first("siding-paint").id;
    const lap = first("siding", "lap").id;
    const brick = first("siding", "brick").id;
    const onLap = line(estimate(withPicks(house, [["siding", lap], ["siding-paint", paint]]))!, "siding")!;
    const onBrick = line(estimate(withPicks(house, [["siding", brick], ["siding-paint", paint]]))!, "siding")!;
    expect(onLap.product).toBe("2 picks");
    expect(onBrick.product).toBe(productTitle(first("siding", "brick")));
    expect(onBrick.rate).toBe("siding-brick");
  });

  it("prices windows per window and a gravel driveway at the gravel rate", () => {
    const win = first("windows");
    const e = estimate(withPicks(house, [["windows", win.id], ["driveway", first("driveway", "gravel").id]]))!;
    const w = line(e, "window")!;
    const r = rates().rates.window;
    const expected = w.qty * (r.material[1] * 0.15) + win.price! * (w.qty / 15);
    expect(w.cost.likely).toBeCloseTo(expected, 0);
    expect(line(e, "driveway")!.cost.likely).toBeLessThan(line(base, "driveway")!.cost.likely);
  });
});

describe("exterior picks in 3D", () => {
  const ctxFor = (p: Project): HouseContext => {
    const offset = lotOffsetFor(p);
    return { levels: p.levels, basics: p.plan.basics, house3d: p.house3d, site: siteFor(p.plot, offset, p.floorPlans), frame: { ox: 0, oy: 0 }, exterior: p.exterior };
  };
  const hasColor = (colors: Float32Array, c: [number, number, number]) => {
    for (let i = 0; i < colors.length; i += 3) if (Math.abs(colors[i] - c[0]) < 1e-4 && Math.abs(colors[i + 1] - c[1]) < 1e-4 && Math.abs(colors[i + 2] - c[2]) < 1e-4) return true;
    return false;
  };

  it("draws the siding, roof and stone band in their colors and patterns", () => {
    const siding = first("siding", "batten");
    const roof = first("roofing", "metal");
    const stone = first("accent", "stone");
    const p = withPicks(house, [["siding", siding.id], ["roofing", roof.id], ["accent", stone.id]]);
    const model = buildHouse(p.floorPlans, ctxFor(p));
    const walls = model.parts.filter((x) => x.layer === "walls" && x.wall === "outside");
    expect(walls.some((w) => hasColor(w.mesh.colors, hex(siding.color)))).toBe(true);
    expect(walls.some((w) => hasColor(w.mesh.colors, hex(stone.color)))).toBe(true);
    expect(walls.some((w) => w.mesh.patterns?.includes(PATTERN.batten))).toBe(true);
    expect(walls.some((w) => w.mesh.patterns?.includes(PATTERN.stone))).toBe(true);
    const roofs = model.parts.filter((x) => x.layer === "roof");
    expect(roofs.some((r) => hasColor(r.mesh.colors, hex(roof.color)) && r.mesh.patterns?.includes(PATTERN.seam))).toBe(true);
  });

  it("draws the yard, each piece aimable", () => {
    const model = buildHouse(house.floorPlans, ctxFor(house));
    const yard = model.parts.filter((x) => x.layer === "yard").map((x) => x.pick?.id);
    for (const id of ["driveway", "walk", "lawn", "beds", "shrubs", "trees", "lights"]) expect(yard, id).toContain(id);
  });

  it("keeps the plain look with nothing picked", () => {
    const look = exteriorLook(undefined);
    expect(look.accent).toBeNull();
    expect(look.siding.pattern).toBe(PATTERN.none);
    expect(look.lawn.pattern).toBe(PATTERN.grass);
  });

  it("uses the siding paint color on painted siding only", () => {
    const paint = first("siding-paint");
    const lap = withPicks(house, [["siding", first("siding", "lap").id], ["siding-paint", paint.id]]);
    expect(exteriorLook(lap.exterior).siding.color).toEqual(hex(paint.color));
    const brick = withPicks(house, [["siding", first("siding", "brick").id], ["siding-paint", paint.id]]);
    expect(exteriorLook(brick.exterior).siding.color).toEqual(hex(first("siding", "brick").color));
  });
});

describe("saved projects", () => {
  it("opens an older project with nothing picked outside", () => {
    const old = { ...createProject("Old"), schemaVersion: 8 } as unknown as Record<string, unknown>;
    delete (old as { exterior?: unknown }).exterior;
    const p = migrateProject(old);
    expect(p.schemaVersion).toBe(SCHEMA_VERSION);
    expect(p.exterior.selections).toEqual([]);
    expect(Project.parse(p).exterior.accentPlace).toBeUndefined();
  });

  it("counts only outdoor rooms the yard can see", () => {
    // Sanity: the test house has an outdoor deck and patio for the decking and patio picks.
    const types = Object.values(house.floorPlans).flatMap((pl) => pl.rooms.filter((r) => areaKind(r) === "outdoor").map((r) => r.type));
    expect(types).toContain("deck");
  });
});
