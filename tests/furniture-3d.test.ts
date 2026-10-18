import { describe, expect, it } from "vitest";
import { buildHouse, forQuality, type HouseContext, type Part } from "@/lib/house3d/build";
import { DETAILED_FURNITURE, drawerGrid, drawFurnitureDetail, seatCushions, shelfHeights, SHELF_GAP_IN } from "@/lib/house3d/furniture3d";
import { IN_PER_UNIT, MeshBuilder } from "@/lib/house3d/mesh";
import { drawFurniture } from "@/lib/house3d/fixtures";
import { siteFor } from "@/lib/house3d/site";
import { furnishLevel } from "@/lib/furnish/autoFurnish";
import { FURNITURE, newFurniture } from "@/lib/plan/furniture";
import type { FurnitureItem, Project } from "@/lib/model/schema";
import { house, RANCH } from "./samples";

const ctxFor = (p: Project): HouseContext => ({ levels: p.levels, basics: p.plan.basics, house3d: p.house3d, site: siteFor(p.plot, { x: 0, y: 0 }, p.floorPlans), frame: { ox: 0, oy: 0 }, exterior: p.exterior });
const tris = (parts: Part[]) => parts.reduce((n, p) => n + p.mesh.count, 0);
const drawn = (item: FurnitureItem) => {
  const mb = new MeshBuilder();
  const ok = drawFurnitureDetail(mb, { ox: 0, oy: 0 }, item, 0);
  return { ok, mesh: mb.build() };
};
const piece = (kind: string, extra: Partial<FurnitureItem> = {}): FurnitureItem => ({ ...newFurniture(kind, { x: 0, y: 0 }, 0, "#8a99a6", `t-${kind}`), ...extra });

describe("smart stretching", () => {
  it("gives a longer sofa more seat cushions", () => {
    expect(seatCushions(22)).toBe(1);
    expect(seatCushions(48)).toBe(2);
    expect(seatCushions(72)).toBe(3);
    expect(seatCushions(110)).toBe(4);
    // The drawn sofa grows with it: a 10 ft sofa has more triangles than the 7 ft one.
    expect(drawn(piece("sofa", { widthIn: 120 })).mesh.count).toBeGreaterThan(drawn(piece("sofa")).mesh.count);
  });

  it("gives a taller bookcase more shelves, about a foot apart", () => {
    const short = shelfHeights(36);
    const tall = shelfHeights(84);
    expect(tall.length).toBeGreaterThan(short.length);
    for (const s of [short, tall, shelfHeights(72)]) {
      for (let i = 1; i < s.length; i++) expect(Math.abs(s[i] - s[i - 1] - SHELF_GAP_IN)).toBeLessThan(4);
    }
  });

  it("splits wider dressers into more drawer columns", () => {
    expect(drawerGrid(22, 20).columns).toBe(1);
    expect(drawerGrid(60, 28)).toMatchObject({ columns: 2, rows: 4 });
    expect(drawerGrid(72, 28).columns).toBe(3);
  });
});

describe("detailed furniture", () => {
  it("draws every furniture type in detail, inside its plain copy's space", () => {
    for (const t of FURNITURE) {
      expect(DETAILED_FURNITURE.has(t.id)).toBe(true);
      const item = piece(t.id);
      const { ok, mesh } = drawn(item);
      expect(ok).toBe(true);
      expect(mesh.count).toBeGreaterThan(20);
      expect(mesh.count).toBeLessThan(8000);
      // The saved size, or the Fast boxes where they reach past it (chairs pulled out round the dining table).
      const plain = new MeshBuilder();
      drawFurniture(plain, { ox: 0, oy: 0 }, item, 0);
      const reach = (m: Float32Array, k: number) => Math.max(...Array.from(m).filter((_, i) => i % 3 === k).map((v) => Math.abs(v * IN_PER_UNIT)));
      const fast = plain.build().positions;
      expect(reach(mesh.positions, 0)).toBeLessThanOrEqual(Math.max(item.widthIn / 2, reach(fast, 0)) + 1.5);
      expect(reach(mesh.positions, 2)).toBeLessThanOrEqual(Math.max(item.depthIn / 2, reach(fast, 2)) + 1.5);
      expect(Math.min(...Array.from(mesh.positions).filter((_, i) => i % 3 === 1))).toBeGreaterThanOrEqual(-0.001);
    }
  });

  it("is repeatable: the same piece draws the same books and leaves", () => {
    for (const kind of ["bookshelf", "plant"]) expect(Array.from(drawn(piece(kind)).mesh.positions)).toEqual(Array.from(drawn(piece(kind)).mesh.positions));
  });

  it("uses leather for cognac leather pieces and fabric for the rest", () => {
    const patterns = (item: FurnitureItem) => new Set(Array.from(drawn(item).mesh.patterns ?? []));
    expect(patterns(piece("sofa", { color: "#9a5b3c" })).has(24)).toBe(true);
    expect(patterns(piece("sofa")).has(24)).toBe(false);
    expect(patterns(piece("sofa")).has(23)).toBe(true);
  });
});

describe("the ranch furnished Full in 3D", () => {
  const p = house(RANCH);
  const plans = { ...p.floorPlans, "floor-1": furnishLevel(p.floorPlans["floor-1"], 108, "full").plan };
  const parts = buildHouse(plans, ctxFor(p)).parts;
  const pretty = forQuality(parts, "pretty");
  const fast = forQuality(parts, "fast");

  it("draws detailed furniture with Pretty only, each piece still pickable by its id", () => {
    const furniture = plans["floor-1"].furniture;
    expect(furniture.length).toBeGreaterThan(5);
    for (const item of furniture) {
      const plain = parts.find((x) => x.key === `floor-1:fu:${item.id}`);
      const rich = parts.find((x) => x.key === `floor-1:fup:${item.id}`);
      expect(plain?.quality).toBe("fast");
      expect(rich?.quality).toBe("pretty");
      expect(rich?.furnitureId).toBe(item.id);
      expect(rich?.layer).toBe("furniture");
    }
    expect(fast.some((x) => x.key.includes(":fup:") || x.key.includes(":aop:"))).toBe(false);
  });

  it("draws closets with a shelf and a round rod in Pretty", () => {
    const closets = plans["floor-1"].fixtures.filter((x) => x.kind === "closet");
    expect(closets.length).toBeGreaterThan(0);
    for (const c of closets) {
      expect(parts.find((x) => x.key === `floor-1:f:${c.id}`)?.quality).toBe("fast");
      expect(parts.find((x) => x.key === `floor-1:fp:${c.id}`)?.quality).toBe("pretty");
    }
  });

  it("keeps the furniture's triangle count reasonable", () => {
    const furniture = (list: Part[]) => tris(list.filter((x) => x.layer === "furniture"));
    expect(furniture(pretty)).toBeGreaterThan(furniture(fast) * 5);
    expect(furniture(pretty)).toBeLessThan(80000);
  });
});
