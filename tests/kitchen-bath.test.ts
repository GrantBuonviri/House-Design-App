import { describe, expect, it } from "vitest";
import { buildHouse, forQuality, type HouseContext, type Part } from "@/lib/house3d/build";
import { cabinetFronts, MAX_DOOR_IN } from "@/lib/house3d/cabinets3d";
import { counterCuts, DETAILED_KINDS, drawFixtureDetail, isFarmhouse, leftOver } from "@/lib/house3d/kitchenBath";
import { MeshBuilder } from "@/lib/house3d/mesh";
import { roomLook } from "@/lib/house3d/finishes";
import { siteFor } from "@/lib/house3d/site";
import { furnishLevel } from "@/lib/furnish/autoFurnish";
import type { Fixture, Product, Project } from "@/lib/model/schema";
import { house, RANCH } from "./samples";

const ctxFor = (p: Project): HouseContext => ({ levels: p.levels, basics: p.plan.basics, house3d: p.house3d, site: siteFor(p.plot, { x: 0, y: 0 }, p.floorPlans), frame: { ox: 0, oy: 0 }, exterior: p.exterior });
const tris = (parts: Part[]) => parts.reduce((n, p) => n + p.mesh.count, 0);
const count = (kind: Parameters<typeof cabinetFronts>[0], w: number, h: number, opts = {}) => {
  const fr = cabinetFronts(kind, w, h, opts);
  return { doors: fr.filter((x) => x.kind === "door").length, drawers: fr.filter((x) => x.kind === "drawer").length, panels: fr.filter((x) => x.kind === "panel").length, fr };
};

describe("cabinet fronts", () => {
  it("splits doors by width: one up to 24 inches, a pair above", () => {
    expect(count("upper", 18, 36).doors).toBe(1);
    expect(count("upper", 24, 36).doors).toBe(1);
    expect(count("upper", 30, 36).doors).toBe(2);
    expect(count("upper", 36, 36).doors).toBe(2);
    expect(count("base", 12, 34.5)).toMatchObject({ doors: 1, drawers: 1 });
    expect(count("base", 30, 34.5)).toMatchObject({ doors: 2, drawers: 1 });
    expect(count("base", 36, 34.5)).toMatchObject({ doors: 2, drawers: 2 });
    for (const w of [9, 15, 21, 24, 27, 33, 36]) for (const f of cabinetFronts("base", w, 34.5).filter((x) => x.kind === "door")) expect(f.x1 - f.x0).toBeLessThanOrEqual(MAX_DOOR_IN);
  });

  it("gives drawer bases a stack of drawers, and sink bases a false front (none under an apron sink)", () => {
    expect(count("drawer", 18, 34.5)).toMatchObject({ doors: 0, drawers: 4 });
    expect(count("sink", 36, 34.5)).toMatchObject({ doors: 2, drawers: 0, panels: 1 });
    const apron = count("sink", 36, 34.5, { apronIn: 10 });
    expect(apron.panels).toBe(0);
    expect(Math.max(...apron.fr.map((x) => x.z1))).toBeLessThanOrEqual(26);
  });

  it("puts drawer banks at the ends of a wide vanity", () => {
    expect(count("vanity", 60, 32)).toMatchObject({ doors: 2, drawers: 6 });
    expect(count("vanity", 36, 32)).toMatchObject({ doors: 2, drawers: 0 });
    expect(count("vanity", 24, 32)).toMatchObject({ doors: 1, drawers: 0 });
  });

  it("keeps every front inside its cabinet, over the toe kick on base cabinets", () => {
    for (const [kind, w, h] of [["base", 30, 34.5], ["drawer", 15, 34.5], ["vanity", 48, 32], ["upper", 33, 30], ["tall", 24, 84], ["pantry", 30, 84]] as const) {
      for (const f of cabinetFronts(kind, w, h)) {
        expect(f.x0).toBeGreaterThanOrEqual(-w / 2);
        expect(f.x1).toBeLessThanOrEqual(w / 2);
        expect(f.z1).toBeLessThanOrEqual(h);
        if (kind === "base" || kind === "drawer" || kind === "vanity") expect(f.z0).toBeGreaterThanOrEqual(4);
      }
    }
    expect(count("pantry", 30, 84).doors).toBe(4);
  });
});

describe("counters", () => {
  const counter: Fixture = { id: "c", kind: "counter", x: 0, y: 0, rotation: 90, widthIn: 120, depthIn: 25 };
  const at = (id: string, kind: string, along: number, widthIn: number): Fixture => ({ id, kind, x: 0, y: along, rotation: 90, widthIn, depthIn: 24 });

  it("leaves the range out of the top and the box, and the dishwasher only out of the box", () => {
    // Turned 90°, the counter's width runs along y.
    const cuts = counterCuts(counter, [counter, at("r", "range", -30, 30), at("d", "dishwasher", 20, 24)]);
    expect(cuts.top).toHaveLength(1);
    expect(cuts.box).toHaveLength(2);
    expect(leftOver(-60, 60, cuts.top).length).toBe(2);
    expect(leftOver(-60, 60, cuts.box).length).toBe(3);
  });

  it("uses an apron-front sink when the kitchen sink pick is a farmhouse sink", () => {
    const look = (name: string) => roomLook([{ id: "s", targetId: "k", category: "kitchen-sinks", product: { id: "p", name, color: "#f6f4ee" } as Product }], { id: "k", type: "kitchen" });
    expect(isFarmhouse({ kind: "sink", widthIn: 33 }, look("33 in. Farmhouse/Apron-Front Single Bowl White Fireclay Kitchen Sink"))).toBe(true);
    expect(isFarmhouse({ kind: "sink", widthIn: 33 }, look("Brookfield Drop-In Cast Iron 33 in. Double Bowl Kitchen Sink in White"))).toBe(false);
    expect(isFarmhouse({ kind: "sink", widthIn: 33 }, undefined)).toBe(false);
    expect(isFarmhouse({ kind: "prep-sink", widthIn: 15 }, look("Farmhouse prep sink"))).toBe(false);
  });

  it("draws every kitchen, bath and laundry kind in detail inside its own size", () => {
    for (const kind of DETAILED_KINDS) {
      const solid = new MeshBuilder();
      const glass = new MeshBuilder();
      const fx: Fixture = { id: "x", kind, x: 0, y: 0, rotation: 0, widthIn: 30, depthIn: 26 };
      expect(drawFixtureDetail(solid, glass, { ox: 0, oy: 0 }, fx, 0, undefined, { others: [fx], ceilingIn: 108 })).toBe(true);
      const m = solid.build();
      expect(m.count).toBeGreaterThan(20);
      // Within the footprint (a little proud for handles and the range hood's chimney), in feet.
      for (let i = 0; i < m.positions.length; i += 3) {
        expect(Math.abs(m.positions[i])).toBeLessThan((15 + 3) / 12);
        expect(Math.abs(m.positions[i + 2])).toBeLessThan((13 + 6) / 12);
      }
    }
    expect(drawFixtureDetail(new MeshBuilder(), new MeshBuilder(), { ox: 0, oy: 0 }, { id: "x", kind: "closet", x: 0, y: 0, rotation: 0, widthIn: 30, depthIn: 24 }, 0, undefined, { others: [], ceilingIn: 108 })).toBe(false);
  });
});

describe("the ranch kitchen and baths in 3D", () => {
  const p = house(RANCH);
  const plans = { ...p.floorPlans, "floor-1": furnishLevel(p.floorPlans["floor-1"], 108, "full").plan };
  const parts = buildHouse(plans, ctxFor(p)).parts;
  const pretty = forQuality(parts, "pretty");
  const fast = forQuality(parts, "fast");

  it("draws detailed copies with Pretty only, so Fast is what it was", () => {
    const detail = parts.filter((x) => x.key.includes(":fp:") || x.key.includes(":fpg:") || x.key.endsWith(":cabd"));
    expect(detail.length).toBeGreaterThan(10);
    expect(detail.every((x) => x.quality === "pretty")).toBe(true);
    expect(fast.some((x) => detail.includes(x))).toBe(false);
    // Each detailed fixture's plain copy is Fast only, and both can be clicked.
    for (const fx of plans["floor-1"].fixtures.filter((x) => DETAILED_KINDS.has(x.kind))) {
      const plain = parts.find((x) => x.key === `floor-1:f:${fx.id}`);
      const rich = parts.find((x) => x.key === `floor-1:fp:${fx.id}`);
      expect(plain?.quality).toBe("fast");
      expect(rich?.pick).toEqual(plain?.pick);
    }
    expect(parts.find((x) => x.key === "floor-1:cab")?.quality).toBe("fast");
  });

  it("keeps the triangle count reasonable", () => {
    const fixtures = (list: Part[]) => tris(list.filter((x) => x.layer === "fixtures"));
    expect(fixtures(pretty)).toBeGreaterThan(fixtures(fast) * 5);
    expect(fixtures(pretty)).toBeLessThan(60000);
  });
});
