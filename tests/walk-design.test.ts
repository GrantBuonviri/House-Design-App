import { DEFAULT_LABELS } from "@/lib/plan/labels";
import { describe, expect, it } from "vitest";
import { House3D, WHOLE_HOUSE, type Fixture, type FloorPlan, type FurnitureItem, type Opening, type PlanRoom, type Project, type Selection } from "@/lib/model/schema";
import { createProject } from "@/lib/model/project";
import { generatePlot, FLAT_PLOT_SEED } from "@/lib/land/generate";
import { levelFor, MAIN_LEVEL_ID } from "@/lib/brief/levels";
import { defaultBasics, exteriorWallIn, INTERIOR_WALL_IN } from "@/lib/plan/basics";
import { rectangle } from "@/lib/plan/geometry";
import { moveMany, removeMany } from "@/lib/plan/edit";
import { edgeCompass, roomEdgeAt } from "@/lib/plan/walls";
import { checkPlacement, defaultFurnitureColor, FURNITURE, newFurniture, overlaps } from "@/lib/plan/furniture";
import { estimate, type Estimate } from "@/lib/cost/estimate";
import { catalog } from "@/lib/catalog/catalog";
import { pickFor, roomFinishes, setPick, setWallPick, toProduct, wallKey, wallPicks } from "@/lib/interior/picks";
import { aimAt, type AimPart } from "@/lib/interior/surfaces";
import { applyPick, currentPick, scopesFor, type FinishAim } from "@/lib/interior/scope";
import { roomLook } from "@/lib/house3d/finishes";
import { hex } from "@/lib/house3d/mesh";
import { buildHouse, type HouseContext } from "@/lib/house3d/build";
import { siteFor } from "@/lib/house3d/site";
import { levelHeights } from "@/lib/house3d/levels";
import { walkWorld } from "@/lib/house3d/walk";

const FT = 12;
const flat = generatePlot(FLAT_PLOT_SEED, { flat: true });
const basics = defaultBasics();
const L = MAIN_LEVEL_ID;

function room(id: string, x: number, y: number, w: number, h: number, type = "living"): PlanRoom {
  return { id, name: id.charAt(0).toUpperCase() + id.slice(1), type, polygon: rectangle(x + w / 2, y + h / 2, w, h) };
}
function plan(rooms: PlanRoom[], extra: Partial<FloorPlan> = {}): FloorPlan {
  return { rooms, walls: [], openings: [], stairs: [], fixtures: [], furniture: [], ...extra };
}
function project(pl: FloorPlan, selections: Selection[] = []): Project {
  const p = createProject("Test");
  return {
    ...p,
    plot: flat,
    levels: [levelFor(L)],
    floorPlans: { [L]: pl },
    plan: { basics, showSketch: false, labels: DEFAULT_LABELS },
    interior: { ...p.interior, selections },
  };
}
const line = (e: Estimate, id: string) => e.categories.flatMap((c) => c.lines).find((l) => l.id === id)!;
const paint = (n = 0) => catalog().filter((p) => p.category === "paint")[n];

// A living room (west) and kitchen (east) sharing a wall at x = 16 ft, and a bath north of the kitchen.
const living = room("living", 0, 0, 16 * FT, 14 * FT, "living");
const kitchen = room("kitchen", 16 * FT, 0, 14 * FT, 14 * FT, "kitchen");
const bath = room("bath", 16 * FT, -8 * FT, 10 * FT, 8 * FT, "bathroom");
const counter: Fixture = { id: "c1", kind: "counter", x: 23 * FT, y: 13 * FT, rotation: 180, widthIn: 96, depthIn: 25, roomId: "kitchen" };
const door: Opening = { id: "d1", kind: "door", style: "door-hinged", host: { roomId: "living", edge: 1 }, offsetIn: 7 * FT, widthIn: 32, side: 1, hinge: "start" } as Opening;
const window1: Opening = { id: "w1", kind: "window", style: "window", host: { roomId: "living", edge: 3 }, offsetIn: 7 * FT, widthIn: 36, side: 1, hinge: "start" } as Opening;
const house = plan([living, kitchen, bath], { fixtures: [counter], openings: [door, window1] });

const part = (layer: AimPart["layer"], pick?: AimPart["pick"], furnitureId?: string): AimPart => ({ layer, levelId: L, pick, furnitureId });
const up = { x: 0, y: 0, up: 1 };

describe("aiming in the walkthrough", () => {
  it("names floors and offers flooring, or tile in a bath", () => {
    const a = aimAt(house, part("floors", { kind: "room", id: "kitchen", levelId: L }), { p: { x: 20 * FT, y: 5 * FT }, heightIn: 0, normal: up }, basics);
    expect(a).toMatchObject({ kind: "finish", label: "Kitchen floor", categories: ["flooring"], room: { id: "kitchen" } });
    const b = aimAt(house, part("floors", { kind: "room", id: "bath", levelId: L }), { p: { x: 20 * FT, y: -4 * FT }, heightIn: 0, normal: up }, basics);
    expect(b).toMatchObject({ kind: "finish", categories: ["tile"] });
  });

  it("gives each side of a shared wall to the room it faces, with that wall's compass side", () => {
    const half = INTERIOR_WALL_IN / 2;
    // From the living room, looking east at the shared wall: its face points west (back at you).
    const fromLiving = aimAt(house, part("walls"), { p: { x: 16 * FT - half, y: 7 * FT }, heightIn: 50, normal: { x: -1, y: 0, up: 0 } }, basics);
    expect(fromLiving).toMatchObject({ kind: "finish", room: { id: "living" }, categories: ["paint", "trim"], wall: { label: "east wall" } });
    const fromKitchen = aimAt(house, part("walls"), { p: { x: 16 * FT + half, y: 7 * FT }, heightIn: 50, normal: { x: 1, y: 0, up: 0 } }, basics);
    expect(fromKitchen).toMatchObject({ kind: "finish", room: { id: "kitchen" }, wall: { label: "west wall" } });
    expect(fromLiving.kind === "finish" && fromKitchen.kind === "finish" && fromLiving.wall!.key).not.toBe(undefined);
  });

  it("offers exterior picks for the outside of the house: siding, windows, the roof and the yard", () => {
    const ext = exteriorWallIn(basics) / 2;
    const a = aimAt(house, part("walls"), { p: { x: -ext, y: 7 * FT }, heightIn: 50, normal: { x: -1, y: 0, up: 0 } }, basics);
    expect(a).toMatchObject({ kind: "outside", label: "Outside wall", categories: ["siding", "siding-paint", "accent", "trim-paint"] });
    const w = aimAt(house, part("openings", { kind: "opening", id: "w1", levelId: L }), { p: { x: 0, y: 7 * FT }, heightIn: 50, normal: { x: 1, y: 0, up: 0 } }, basics);
    expect(w).toMatchObject({ kind: "outside", label: "Window", categories: ["windows", "trim-paint"] });
    const roof = aimAt(house, part("roof"), { p: { x: 5 * FT, y: 5 * FT }, heightIn: 120, normal: { x: 0, y: 0.5, up: 0.85 } }, basics);
    expect(roof).toMatchObject({ kind: "outside", label: "Roof", categories: ["roofing", "gutters", "trim-paint"] });
    const gable = aimAt(house, part("roof"), { p: { x: 5 * FT, y: 5 * FT }, heightIn: 120, normal: { x: 1, y: 0, up: 0 } }, basics);
    expect(gable).toMatchObject({ kind: "outside", label: "Gable end" });
    const lawn = aimAt(house, part("yard", { kind: "yard", id: "lawn", levelId: L }), { p: { x: -20 * FT, y: 0 }, heightIn: 0, normal: up }, basics);
    expect(lawn).toMatchObject({ kind: "outside", label: "Lawn", categories: ["lawn", "trees", "shrubs"] });
  });

  it("offers interior doors for a door between rooms, and lights on the ceiling", () => {
    const d = aimAt(house, part("openings", { kind: "opening", id: "d1", levelId: L }), { p: { x: 16 * FT, y: 7 * FT }, heightIn: 40, normal: { x: 1, y: 0, up: 0 } }, basics);
    expect(d).toMatchObject({ kind: "finish", label: "Door", categories: ["interior-doors", "trim"] });
    const c = aimAt(house, part("ceilings"), { p: { x: 5 * FT, y: 5 * FT }, heightIn: 96, normal: { x: 0, y: 0, up: -1 } }, basics);
    expect(c).toMatchObject({ kind: "finish", label: "Living ceiling light", categories: ["lighting"] });
  });

  it("tells a counter top from the cabinets under it", () => {
    const pick = { kind: "fixture" as const, id: "c1", levelId: L };
    const top = aimAt(house, part("fixtures", pick), { p: { x: 23 * FT, y: 13 * FT }, heightIn: 36, normal: up }, basics);
    expect(top).toMatchObject({ kind: "finish", label: "Kitchen counter", categories: ["counters", "cabinets", "hardware"] });
    const side = aimAt(house, part("fixtures", pick), { p: { x: 23 * FT, y: 12 * FT }, heightIn: 20, normal: { x: 0, y: -1, up: 0 } }, basics);
    expect(side).toMatchObject({ kind: "finish", label: "Kitchen cabinets", categories: ["cabinets", "hardware", "counters"] });
  });

  it("finds furniture", () => {
    const sofa = newFurniture("sofa", { x: 8 * FT, y: 7 * FT }, 0, "#888888", "s1");
    const a = aimAt(plan([living], { furniture: [sofa] }), part("furniture", undefined, "s1"), { p: { x: 8 * FT, y: 7 * FT }, heightIn: 18, normal: up }, basics);
    expect(a).toEqual({ kind: "furniture", levelId: L, id: "s1", label: "Sofa" });
  });
});

describe("walls of a room", () => {
  it("finds the edge along a wall, and its compass side", () => {
    const e = roomEdgeAt(living.polygon, { x: 16 * FT - 2, y: 7 * FT }, 6, { x: -1, y: 0 });
    expect(e).not.toBeNull();
    expect(edgeCompass(living.polygon, e!)).toBe("east");
    // Near a corner, only the wall you're facing counts.
    const corner = roomEdgeAt(living.polygon, { x: 16 * FT - 2, y: 1 }, 6, { x: -1, y: 0 });
    expect(edgeCompass(living.polygon, corner!)).toBe("east");
  });
});

describe("picks from the walkthrough", () => {
  const aim = aimAt(house, part("walls"), { p: { x: 16 * FT - 2, y: 7 * FT }, heightIn: 50, normal: { x: -1, y: 0, up: 0 } }, basics) as FinishAim;

  it("puts paint on one wall, the room or the whole house", () => {
    const red = toProduct(paint(0));
    const blue = toProduct(paint(1));
    let s = applyPick(aim, "paint", "house", [], blue);
    s = applyPick(aim, "paint", "wall", s, red);
    expect(wallPicks(s, "living").get(aim.wall!.key)?.product.id).toBe(red.id);
    // The accent doesn't count as the room's paint.
    expect(pickFor(s, "living", "paint")).toBeUndefined();
    expect(roomFinishes(s, "living").get("paint")?.id).toBe(blue.id);
    expect(currentPick(aim, "paint", s)).toMatchObject({ from: "wall" });
    expect(scopesFor(aim, "paint", s)).toEqual({ scopes: ["wall", "room", "house"], start: "wall" });
    // Clearing the wall goes back to the whole-house paint.
    s = applyPick(aim, "paint", "wall", s, null);
    expect(currentPick(aim, "paint", s)).toMatchObject({ from: "house" });
  });

  it("only offers the whole house for trim and doors", () => {
    expect(scopesFor(aim, "trim", []).scopes).toEqual(["house"]);
  });

  it("colors only the accent wall in 3D", () => {
    const red = toProduct({ ...paint(0), color: "#aa0000" });
    const s = setWallPick([], "living", aim.wall!.key, red);
    const look = roomLook(s, living);
    expect(look.accents.get(aim.wall!.key)).toEqual(hex("#aa0000"));
    expect(look.wall).not.toEqual(hex("#aa0000"));
  });

  it("prices an accent wall at its share of the room's paint", () => {
    const cheap = toProduct({ ...paint(0), price: 20 });
    const dear = toProduct({ ...paint(0), id: "dear", price: 200 });
    const base = setPick([], WHOLE_HOUSE, "paint", cheap);
    const one = estimate(project(house, base))!;
    const accent = estimate(project(house, setWallPick(base, "living", aim.wall!.key, dear)))!;
    const whole = estimate(project(house, setPick(base, "living", "paint", dear)))!;
    const p1 = line(one, "interior-paint").cost.likely;
    const pa = line(accent, "interior-paint").cost.likely;
    const pw = line(whole, "interior-paint").cost.likely;
    // The east wall is 14 ft of the living room's 60 ft around.
    expect(pa).toBeGreaterThan(p1);
    expect((pa - p1) / (pw - p1)).toBeCloseTo(14 / 60, 2);
  });
});

describe("furniture", () => {
  const sofa = (x: number, y: number, rotation = 0, id = "s1"): FurnitureItem => newFurniture("sofa", { x, y }, rotation, "#888888", id);

  it("has sizes and colors from the style answers", () => {
    expect(FURNITURE.length).toBeGreaterThanOrEqual(15);
    for (const f of FURNITURE) expect(f.widthIn * f.depthIn).toBeGreaterThan(0);
    expect(defaultFurnitureColor("coffee-table", { wood: "dark-wood" })).toBe("#5a3b25");
    expect(defaultFurnitureColor("sofa", { colors: "bold" })).not.toBe(defaultFurnitureColor("sofa", { colors: "warm" }));
  });

  it("fits inside a room, but not through a wall, on a counter or on other furniture", () => {
    expect(checkPlacement(house, sofa(8 * FT, 5 * FT))).toMatchObject({ ok: true, roomId: "living" });
    expect(checkPlacement(house, sofa(15 * FT, 5 * FT))).toMatchObject({ ok: false, problem: expect.stringContaining("wall") });
    expect(checkPlacement(house, sofa(23 * FT, 11 * FT))).toMatchObject({ ok: false, problem: expect.stringContaining("counter") });
    expect(checkPlacement(house, sofa(-5 * FT, 5 * FT))).toMatchObject({ ok: false, problem: expect.stringContaining("inside a room") });
    // Not on top of other furniture, but over a rug is fine.
    const withSofa = { ...house, furniture: [sofa(8 * FT, 5 * FT, 0, "s0"), newFurniture("rug-large", { x: 8 * FT, y: 8 * FT }, 0, "#cccccc", "r1")] };
    expect(checkPlacement(withSofa, newFurniture("bookshelf", { x: 8 * FT, y: 5 * FT }, 0, "#888888", "b1"))).toMatchObject({ ok: false, problem: "It's on top of the sofa." });
    expect(checkPlacement(withSofa, newFurniture("coffee-table", { x: 8 * FT, y: 9 * FT }, 0, "#888888", "t1"))).toMatchObject({ ok: true });
  });

  it("warns when it's in front of a door, but rugs don't count", () => {
    const blocking = { ...sofa(14 * FT, 7 * FT, 90), widthIn: 60, depthIn: 30 };
    expect(checkPlacement(house, blocking).blocksDoors).toEqual(["d1"]);
    const rug = newFurniture("rug-small", { x: 11 * FT, y: 7 * FT }, 0, "#cccccc", "r1");
    expect(checkPlacement(house, rug)).toMatchObject({ ok: true, blocksDoors: [] });
  });

  it("tells overlapping outlines apart from ones side by side", () => {
    expect(overlaps(rectangle(0, 0, 10, 10), rectangle(5, 5, 10, 10))).toBe(true);
    expect(overlaps(rectangle(0, 0, 10, 10), rectangle(10, 0, 10, 10))).toBe(false);
    expect(overlaps(rectangle(0, 0, 10, 10, 45), rectangle(9, 9, 4, 4))).toBe(false);
  });

  it("moves with its room and stays when the room is deleted", () => {
    const pl = plan([living], { furniture: [{ ...sofa(8 * FT, 5 * FT), roomId: "living" }] });
    expect(moveMany(pl, ["living"], 24, 0).furniture[0].x).toBe(8 * FT + 24);
    const gone = removeMany(pl, ["living"]);
    expect(gone.furniture).toHaveLength(1);
    expect(gone.furniture[0].roomId).toBeUndefined();
    expect(removeMany(pl, ["s1"]).furniture).toHaveLength(0);
  });

  it("is drawn in 3D and stops you walking, except rugs", () => {
    const pl = plan([living], { furniture: [sofa(8 * FT, 5 * FT), newFurniture("rug-large", { x: 8 * FT, y: 8 * FT }, 0, "#cccccc", "r1")] });
    const p = project(pl);
    const levels = p.levels;
    const ctx: HouseContext = { levels, basics, house3d: House3D.parse({}), site: siteFor(flat, { x: 0, y: 0 }, p.floorPlans), frame: { ox: 0, oy: 0 } };
    const model = buildHouse(p.floorPlans, ctx);
    const parts = model.parts.filter((x) => x.layer === "furniture");
    expect(parts.map((x) => x.furnitureId).sort()).toEqual(["r1", "s1"]);
    expect(parts.every((x) => !x.pick)).toBe(true);
    const bare = walkWorld({ [L]: plan([living]) }, { ...ctx, heights: levelHeights(levels, basics) });
    const world = walkWorld(p.floorPlans, { ...ctx, heights: levelHeights(levels, basics) });
    // Four sides for the sofa, none for the rug.
    expect(world.blockers.length - bare.blockers.length).toBe(4);
  });
});

describe("saving", () => {
  it("keeps furniture and accent walls through a save", async () => {
    const { migrateProject } = await import("@/lib/model/project");
    const s = setWallPick([], "living", wallKey(1), toProduct(paint(0)));
    const p = project(plan([living], { furniture: [newFurniture("bed-queen", { x: 8 * FT, y: 7 * FT }, 0, "#888888", "b1")] }), s);
    const back = migrateProject(JSON.parse(JSON.stringify(p)));
    expect(back.floorPlans[L].furniture[0].kind).toBe("bed-queen");
    expect(back.interior.selections[0].wall).toBe("e1");
  });

  it("opens older projects with no furniture", async () => {
    const { migrateProject } = await import("@/lib/model/project");
    const old = JSON.parse(JSON.stringify(project(plan([living])))) as Record<string, unknown> & { floorPlans: Record<string, Record<string, unknown>> };
    old.schemaVersion = 7;
    delete old.floorPlans[L].furniture;
    expect(migrateProject(old).floorPlans[L].furniture).toEqual([]);
  });
});
