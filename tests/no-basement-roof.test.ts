import { describe, expect, it } from "vitest";
import { House3D, type FloorPlan, type PlanRoom } from "@/lib/model/schema";
import { levelsFor } from "@/lib/brief/levels";
import { defaultBasics } from "@/lib/plan/basics";
import { rectangle } from "@/lib/plan/geometry";
import { buildRoofs, dugOut, type HouseContext } from "@/lib/house3d/build";
import { isBelowGround, levelHeights } from "@/lib/house3d/levels";
import { siteFor } from "@/lib/house3d/site";
import { measureRoof } from "@/lib/cost/measureRoof";
import { houseScene } from "@/lib/plans/scene";
import { pointInPolygon } from "@/lib/plan/geometry";
import { house, RANCH } from "./samples";

const FT = 12;
const room = (id: string, x: number, y: number, w: number, h: number): PlanRoom => ({ id, name: id, type: "living", polygon: rectangle(x + w / 2, y + h / 2, w, h) });
const plan = (rooms: PlanRoom[]): FloorPlan => ({ rooms, walls: [], openings: [], stairs: [], fixtures: [], furniture: [] });
const ROOF = House3D.parse({}).roof;

/** A 30 x 24 ft main floor over a 40 x 24 ft basement: the basement reaches 10 ft out to the east. */
const levels = levelsFor(1, 1);
const plans = { "floor-1": plan([room("main", 0, 0, 30 * FT, 24 * FT)]), "basement-1": plan([room("base", 0, 0, 40 * FT, 24 * FT)]) };
const heights = levelHeights(levels, defaultBasics());
const ctx: HouseContext & { heights: typeof heights } = { levels, basics: defaultBasics(), house3d: { ...House3D.parse({}), roof: ROOF }, site: siteFor(null, { x: 0, y: 0 }, plans), frame: { ox: 0, oy: 0 }, heights };

describe("no roof on below-ground floors", () => {
  it("knows which floors are below ground", () => {
    expect(levels.filter((l) => isBelowGround(l, heights)).map((l) => l.id)).toEqual(["basement-1"]);
  });

  it("roofs the main floor but not the basement that reaches past it", () => {
    const { parts } = buildRoofs(plans, ctx);
    expect(parts.some((p) => p.levelId === "basement-1")).toBe(false);
    expect(parts.some((p) => p.levelId === "floor-1")).toBe(true);
  });

  it("digs the ground out only under the house, so grass covers the part that reaches out", () => {
    const holes = dugOut(plans, ctx);
    expect(holes.length).toBeGreaterThan(0);
    const inHole = (x: number, y: number) => holes.some((h) => pointInPolygon({ x, y }, h));
    expect(inHole(10 * FT, 12 * FT)).toBe(true);
    expect(inHole(35 * FT, 12 * FT)).toBe(false);
  });

  it("charges no flat roof for the basement", () => {
    const withBase = measureRoof(plans, levels, defaultBasics(), ROOF);
    const without = measureRoof({ "floor-1": plans["floor-1"] }, levelsFor(1, 0), defaultBasics(), ROOF);
    expect(withBase.flatSqft).toBe(0);
    expect(withBase.roofSqft).toBeCloseTo(without.roofSqft, 3);
    expect(withBase.eaveLf).toBeCloseTo(without.eaveLf, 3);
  });

  it("leaves it off the PDF drawings too", () => {
    const p = house(RANCH, 1, 1);
    const sc = houseScene(p);
    expect(sc.roofs.length).toBeGreaterThan(0);
    expect(sc.roofs.some((r) => r.levelId.startsWith("basement"))).toBe(false);
  });
});
