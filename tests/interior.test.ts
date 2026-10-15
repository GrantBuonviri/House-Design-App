import { describe, expect, it } from "vitest";
import { House3D, SCHEMA_VERSION, WHOLE_HOUSE, type FloorPlan, type PlanRoom, type Project, type Selection } from "@/lib/model/schema";
import { createProject, migrateProject } from "@/lib/model/project";
import { generatePlot, FLAT_PLOT_SEED } from "@/lib/land/generate";
import { levelFor, MAIN_LEVEL_ID } from "@/lib/brief/levels";
import { defaultBasics } from "@/lib/plan/basics";
import { rectangle } from "@/lib/plan/geometry";
import { estimate, type Estimate } from "@/lib/cost/estimate";
import { rates } from "@/lib/cost/rates";
import { catalog, parseCatalog, type CatalogProduct } from "@/lib/catalog/catalog";
import { INTERIOR_CATEGORIES, interiorCategory } from "@/lib/catalog/categories";
import { categoriesFor, effectivePick, interiorRooms, setPick, toProduct } from "@/lib/interior/picks";
import { effectiveAnswers, guessAnswers, moodBoard, ranked } from "@/lib/interior/style";
import { PATTERN, roomLook } from "@/lib/house3d/finishes";
import { COLORS } from "@/lib/house3d/colors";
import { hex } from "@/lib/house3d/mesh";
import { buildHouse, type HouseContext } from "@/lib/house3d/build";
import { siteFor } from "@/lib/house3d/site";
import { levelHeights } from "@/lib/house3d/levels";

const FT = 12;
const flat = generatePlot(FLAT_PLOT_SEED, { flat: true });

function room(id: string, x: number, y: number, w: number, h: number, type = "living"): PlanRoom {
  return { id, name: id, type, polygon: rectangle(x + w / 2, y + h / 2, w, h) };
}
function plan(rooms: PlanRoom[]): FloorPlan {
  return { rooms, walls: [], openings: [], stairs: [], fixtures: [], furniture: [] };
}
function project(rooms: PlanRoom[], selections: Selection[] = []): Project {
  const p = createProject("Test");
  return {
    ...p,
    plot: flat,
    levels: [levelFor(MAIN_LEVEL_ID)],
    floorPlans: { [MAIN_LEVEL_ID]: plan(rooms) },
    plan: { basics: defaultBasics(), showSketch: false, showDims: true },
    interior: { ...p.interior, selections },
  };
}

const line = (e: Estimate, id: string) => e.categories.flatMap((c) => c.lines).find((l) => l.id === id)!;

function product(over: Partial<CatalogProduct> & Pick<CatalogProduct, "id" | "category">): CatalogProduct {
  return {
    name: over.id,
    brand: "Test",
    url: "https://example.com/p",
    price: 10,
    unit: "sqft",
    priceSource: "listed",
    lastChecked: "2026-10-15",
    kind: "wood",
    styles: ["modern"],
    tags: ["neutral"],
    color: "#aa8866",
    pattern: "plank",
    ...over,
  };
}

/** A living room and a bedroom, each 20 x 20 ft. */
const twoRooms = () => [room("living", 0, 0, 20 * FT, 20 * FT), room("bed", 20 * FT, 0, 20 * FT, 20 * FT, "bedroom")];

describe("the catalog", () => {
  it("passes its check, with a link, a price and a date on every product", () => {
    const all = catalog();
    for (const p of all) {
      expect(p.url, p.id).toMatch(/^https:\/\//);
      expect(p.price, p.id).toBeGreaterThan(0);
      expect(p.lastChecked, p.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(interiorCategory(p.category), p.id).toBeTruthy();
    }
  });

  it("has products in every category", () => {
    for (const c of INTERIOR_CATEGORIES) expect(catalog().filter((p) => p.category === c.id).length, c.id).toBeGreaterThan(0);
  });

  it("names the file and product when something's wrong", () => {
    expect(() => parseCatalog({ flooring: [{ id: "x", name: "Bad oak", brand: "B", url: "not a link" }] })).toThrow(/flooring\.json, "Bad oak"/);
    const ok = { id: "dup", name: "A", brand: "B", url: "https://x.com", price: 1, unit: "sqft", priceSource: "listed", lastChecked: "2026-10-15", kind: "wood", styles: ["modern"], tags: [], color: "#ffffff", pattern: "solid" };
    expect(() => parseCatalog({ flooring: [ok, ok] })).toThrow(/used twice/);
  });
});

describe("style matching", () => {
  const list = [
    product({ id: "farm-oak", category: "flooring", styles: ["modern-farmhouse"], tags: ["warm", "light-wood"] }),
    product({ id: "sleek-gray", category: "flooring", styles: ["modern"], tags: ["cool"] }),
    product({ id: "berber", category: "flooring", kind: "carpet", pattern: "carpet", styles: ["modern-farmhouse"], tags: ["warm"] }),
  ];

  it("puts farmhouse products first for farmhouse answers", () => {
    expect(ranked("flooring", { style: "modern-farmhouse", colors: "warm" }, undefined, list)[0].id).toBe("farm-oak");
    expect(ranked("flooring", { style: "modern", colors: "cool" }, undefined, list)[0].id).toBe("sleek-gray");
  });

  it("offers carpet first in bedrooms when carpet is wanted, and not elsewhere", () => {
    const a = { style: "modern-farmhouse", carpet: "yes" };
    expect(ranked("flooring", a, "bedroom", list)[0].id).toBe("berber");
    expect(ranked("flooring", a, "living", list)[0].id).toBe("farm-oak");
  });

  it("guesses answers from the Rooms page's feel, and the user's answers win", () => {
    expect(guessAnswers("A cozy modern farmhouse with lots of light")).toMatchObject({ style: "modern-farmhouse", colors: "warm" });
    expect(guessAnswers("A cozy modern farmhouse").style2).toBeUndefined();
    expect(guessAnswers("Sleek and modern").style).toBe("modern");
    expect(effectiveAnswers({ style: "industrial" }, "cozy farmhouse").style).toBe("industrial");
  });

  it("makes a mood board, and shuffling changes it", () => {
    const a = { style: "modern-farmhouse" };
    const b0 = moodBoard(a, 0);
    expect(b0.picks.length).toBeGreaterThan(3);
    expect(b0.palette.length).toBeGreaterThan(2);
    expect(moodBoard(a, 1).picks.map((p) => p.id)).not.toEqual(b0.picks.map((p) => p.id));
  });
});

describe("picking", () => {
  it("lists the plan's rooms (not garages or porches) and the categories that fit each", () => {
    const p = project([...twoRooms(), room("g", 0, 20 * FT, 24 * FT, 24 * FT, "garage"), room("k", 40 * FT, 0, 14 * FT, 14 * FT, "kitchen")]);
    const rooms = interiorRooms(p);
    expect(rooms.map((r) => r.id)).toEqual(["living", "bed", "k"]);
    expect(categoriesFor(rooms[2]).map((c) => c.id)).toContain("cabinets");
    expect(categoriesFor(rooms[1]).map((c) => c.id)).not.toContain("toilets");
    expect(categoriesFor().length).toBe(INTERIOR_CATEGORIES.length);
  });

  it("uses a room's own pick, else the whole house's", () => {
    const oak = toProduct(product({ id: "oak", category: "flooring" }));
    const carpet = toProduct(product({ id: "carpet", category: "flooring" }));
    let s = setPick([], WHOLE_HOUSE, "flooring", oak);
    s = setPick(s, "bed", "flooring", carpet);
    expect(effectivePick(s, "living", "flooring")).toMatchObject({ own: false, pick: { product: { id: "oak" } } });
    expect(effectivePick(s, "bed", "flooring")).toMatchObject({ own: true, pick: { product: { id: "carpet" } } });
    s = setPick(s, "bed", "flooring", null);
    expect(effectivePick(s, "bed", "flooring")?.pick.product.id).toBe("oak");
  });
});

describe("cost with picks", () => {
  const floorRate = rates().rates.flooring;
  const oak = toProduct(product({ id: "oak", category: "flooring", price: 12 }));

  it("prices a pick for one room only on that room's floor", () => {
    const base = line(estimate(project(twoRooms()))!, "flooring");
    const picked = line(estimate(project(twoRooms(), setPick([], "living", "flooring", oak)))!, "flooring");
    const living = base.qty / 2;
    const expected = base.cost.likely + living * (12 - floorRate.material[1]);
    expect(picked.cost.likely).toBeCloseTo(expected, 0);
    expect(picked.product).toContain("mid-range elsewhere");
  });

  it("prices a whole-house pick everywhere, and a room's own pick wins there", () => {
    const base = line(estimate(project(twoRooms()))!, "flooring");
    const house = line(estimate(project(twoRooms(), setPick([], WHOLE_HOUSE, "flooring", oak)))!, "flooring");
    expect(house.cost.likely).toBeCloseTo(base.qty * (12 + floorRate.labor[1]), 0);
    expect(house.product).toBe("Test oak");
    const cheap = toProduct(product({ id: "cheap", category: "flooring", price: 2 }));
    const both = line(estimate(project(twoRooms(), setPick(setPick([], WHOLE_HOUSE, "flooring", oak), "bed", "flooring", cheap)))!, "flooring");
    expect(both.cost.likely).toBeCloseTo((base.qty / 2) * (12 + 2 + 2 * floorRate.labor[1]), 0);
  });

  it("turns paint per gallon into the per sq ft line, keeping primer and ceilings", () => {
    const paint = toProduct(product({ id: "white", category: "paint", unit: "gallon", price: 80, pattern: "solid", kind: "wall" }));
    const base = line(estimate(project(twoRooms()))!, "interior-paint");
    const picked = line(estimate(project(twoRooms(), setPick([], WHOLE_HOUSE, "paint", paint)))!, "interior-paint");
    const r = rates().rates["interior-paint"];
    const perSqft = r.material[1] * 0.4 + 80 * 0.02 + r.labor[1];
    expect(picked.cost.likely).toBeCloseTo(base.qty * perSqft, 0);
  });

  it("adds part of a line for a part pick: a fridge in the appliance package", () => {
    const k = [room("k", 0, 0, 14 * FT, 14 * FT, "kitchen")];
    const fridge = toProduct(product({ id: "fridge", category: "fridges", unit: "each", price: 2500, kind: "fridge", pattern: "metal" }));
    const base = line(estimate(project(k))!, "appliance-package");
    const picked = line(estimate(project(k, setPick([], WHOLE_HOUSE, "fridges", fridge)))!, "appliance-package");
    const r = rates().rates["appliance-package"];
    expect(picked.cost.likely - base.cost.likely).toBeCloseTo(2500 - r.material[1] * 0.38, 0);
  });

  it("has light fixture and cabinet hardware lines", () => {
    const e = estimate(project([...twoRooms(), room("k", 40 * FT, 0, 14 * FT, 14 * FT, "kitchen")]))!;
    expect(line(e, "lighting-fixtures").qty).toBeGreaterThanOrEqual(5);
    expect(line(e, "cabinet-hardware").qty).toBeGreaterThan(10);
  });
});

describe("finishes in 3D", () => {
  it("colors a room's floor and walls with its picks, with a floor pattern", () => {
    const tile = toProduct(product({ id: "t", category: "tile", kind: "floor", pattern: "tile", color: "#334455" }));
    const paint = toProduct(product({ id: "p", category: "paint", kind: "wall", pattern: "solid", color: "#ccddee" }));
    const s = setPick(setPick([], "bath", "tile", tile), WHOLE_HOUSE, "paint", paint);
    const look = roomLook(s, { id: "bath", type: "bathroom" });
    expect(look.floor).toEqual(hex("#334455"));
    expect(look.floorPattern).toBe(PATTERN.tile);
    expect(look.wall).toEqual(hex("#ccddee"));
    // Nothing picked: the plain finishes.
    expect(roomLook([], { id: "x", type: "living" })).toMatchObject({ floor: COLORS.wood, floorPattern: PATTERN.plank, wall: COLORS.drywall });
  });

  it("builds the house with the picked floor pattern on the floor's top", () => {
    const p = project(twoRooms(), setPick([], WHOLE_HOUSE, "flooring", toProduct(product({ id: "c", category: "flooring", pattern: "carpet", color: "#808080" }))));
    const ctx: HouseContext = {
      levels: p.levels,
      basics: p.plan.basics,
      house3d: House3D.parse({}),
      site: siteFor(null, { x: 0, y: 0 }, p.floorPlans),
      frame: { ox: 0, oy: 0 },
      interior: p.interior.selections,
    };
    expect(levelHeights(p.levels, p.plan.basics)).toBeTruthy();
    const floor = buildHouse(p.floorPlans, ctx).parts.find((x) => x.key.endsWith(":r:living"))!;
    expect(floor.mesh.patterns).toBeTruthy();
    expect([...floor.mesh.patterns!]).toContain(PATTERN.carpet);
    // The underside (the ceiling below) has no pattern.
    expect([...floor.mesh.patterns!]).toContain(0);
  });
});

describe("saving", () => {
  it("opens older projects with nothing picked", () => {
    const older = { ...createProject("Old"), schemaVersion: 6 } as Record<string, unknown>;
    older.interior = { answers: {}, moodBoard: [], selections: [] };
    const p = migrateProject(older);
    expect(p.schemaVersion).toBe(SCHEMA_VERSION);
    expect(p.interior).toEqual({ answers: {}, moodBoard: [], shuffle: 0, selections: [] });
  });
});
