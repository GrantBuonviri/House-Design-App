import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "fs";
import { House3D } from "@/lib/model/schema";
import { buildHouse, type HouseContext } from "@/lib/house3d/build";
import { siteFor } from "@/lib/house3d/site";
import { counterPatternOf, PATTERN } from "@/lib/house3d/finishes";
import { lookTables, MAX_PATTERNS, surfaceLook, SURFACE_LOOKS, TEXTURES } from "@/lib/house3d/looks";
import { averageLinear, drawTexture } from "@/lib/house3d/textureDraw";
import { roomEnvironment } from "@/lib/house3d/environment";
import { furnishLevel } from "@/lib/furnish/autoFurnish";
import { house, RANCH } from "./samples";
import type { Product } from "@/lib/model/schema";

describe("Pretty looks: textures and shine", () => {
  it("gives every pattern number a look, within the shader's table", () => {
    for (const id of Object.values(PATTERN)) {
      expect(SURFACE_LOOKS[id], `pattern ${id}`).toBeTruthy();
      expect(id).toBeLessThan(MAX_PATTERNS);
    }
    // Unknown numbers are plain matte.
    expect(surfaceLook(99)).toBe(SURFACE_LOOKS[PATTERN.none]);
  });

  it("matches shine to the surface: steel and mirrors are metal, stone and tile glossy, carpet and drywall matte", () => {
    expect(surfaceLook(PATTERN.metal).metalness).toBe(1);
    expect(surfaceLook(PATTERN.mirror).roughness).toBeLessThan(0.1);
    for (const p of [PATTERN.marble, PATTERN.granite, PATTERN.tile, PATTERN.ceramic]) expect(surfaceLook(p).roughness).toBeLessThan(0.3);
    for (const p of [PATTERN.carpet, PATTERN.drywall, PATTERN.fabric]) expect(surfaceLook(p).roughness).toBeGreaterThan(0.8);
  });

  it("has a photo for every texture, credited, or draws it in code", () => {
    const credits = existsSync("public/textures/CREDITS.md") ? readFileSync("public/textures/CREDITS.md", "utf8") : "";
    for (const t of TEXTURES) {
      if (existsSync(`public/textures/${t}.jpg`)) expect(credits, t).toContain(`${t}.jpg`);
      const px = drawTexture(t, 16);
      expect(px.length).toBe(16 * 16 * 4);
      const mean = averageLinear(px);
      expect(mean.every((c) => c > 0 && c <= 1)).toBe(true);
    }
  });

  it("builds the shader tables from the looks", () => {
    const t = lookTables();
    expect(t.slot[PATTERN.marble]).toBe(TEXTURES.indexOf("marble"));
    expect(t.slot[PATTERN.metal]).toBe(-1);
    expect(t.metal[PATTERN.metal]).toBe(1);
    expect(t.rough[PATTERN.none]).toBeCloseTo(0.9);
  });

  it("picks the counter's look from its pick", () => {
    const pick = (kind: string) => ({ kind }) as Product;
    expect(counterPatternOf(pick("granite"))).toBe(PATTERN.granite);
    expect(counterPatternOf(pick("butcher-block"))).toBe(PATTERN.butcherBlock);
    expect(counterPatternOf(pick("concrete-look"))).toBe(PATTERN.concrete);
    expect(counterPatternOf(pick("quartz"))).toBe(PATTERN.marble);
    expect(counterPatternOf(undefined)).toBe(PATTERN.marble);
  });

  it("makes a bright environment with window highlights for reflections", () => {
    const env = roomEnvironment(64);
    expect(env.length).toBe(64 * 32 * 4);
    expect(Math.max(...env)).toBeGreaterThan(2);
  });

  it("puts the surfaces on the furnished ranch: drywall walls and ceilings, stone counters, steel, fabric", () => {
    const p = house(RANCH);
    const floorPlans = Object.fromEntries(Object.entries(p.floorPlans).map(([id, pl]) => [id, furnishLevel(pl, 96, "full").plan]));
    const ctx: HouseContext = { levels: p.levels, basics: p.plan.basics, house3d: House3D.parse({}), site: siteFor(null, { x: 0, y: 0 }, floorPlans), frame: { ox: 0, oy: 0 } };
    const parts = buildHouse(floorPlans, ctx).parts;
    const has = (pred: (k: string) => boolean, pat: number) => parts.some((x) => pred(x.key) && x.mesh.patterns?.includes(pat));
    expect(has((k) => k.includes(":walls:inside"), PATTERN.drywall)).toBe(true);
    expect(has((k) => k.endsWith(":ceiling"), PATTERN.drywall)).toBe(true);
    expect(has((k) => k.includes(":f:"), PATTERN.marble)).toBe(true);
    expect(has((k) => k.includes(":f:"), PATTERN.metal)).toBe(true);
    expect(has((k) => k.includes(":f:"), PATTERN.cabinet)).toBe(true);
    expect(parts.some((x) => x.mesh.patterns?.includes(PATTERN.fabric))).toBe(true);
    // Pretty faucets shine like metal; Fast ones are left as they were.
    expect(parts.some((x) => x.key.includes(":fc:") && x.quality === "pretty" && x.mesh.patterns?.includes(PATTERN.metal))).toBe(true);
    expect(parts.some((x) => x.key.includes(":fc:") && x.quality === "fast" && x.mesh.patterns?.some((v) => v !== 0))).toBe(false);
  });
});
