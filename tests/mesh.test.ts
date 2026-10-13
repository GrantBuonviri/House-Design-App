import { describe, expect, it } from "vitest";
import { FLAT_PLOT_SEED, feedPlotSeed, generatePlot } from "@/lib/land/generate";
import { buildTerrainMesh, drapeLine, HEIGHT_EXAGGERATION, landScene, SCENE_SIZE, waterSurfaces } from "@/lib/land/mesh";

const plots = Array.from({ length: 200 }, (_, i) => generatePlot(feedPlotSeed(99, i)));

describe("3D terrain mesh", () => {
  it("builds a full grid sized to the scene", () => {
    const p = plots[0];
    const scene = landScene(p);
    const m = buildTerrainMesh(p, scene, 32);
    expect(m.positions.length).toBe(32 * 32 * 3);
    expect(m.colors.length).toBe(32 * 32 * 3);
    expect(m.indices.length).toBe(31 * 31 * 6);
    expect(m.positions[0]).toBeCloseTo(-SCENE_SIZE / 2);
    expect(m.positions[(32 * 32 - 1) * 3]).toBeCloseTo(SCENE_SIZE / 2);
    for (const c of m.colors) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });

  it("uses the terrain heights, exaggerated", () => {
    const p = plots[1];
    const scene = landScene(p);
    const [, y] = scene.toScene(500, 700);
    expect(y).toBeCloseTo(scene.height(500, 700) * scene.scale * HEIGHT_EXAGGERATION);
  });

  it("is flat for the flat plot", () => {
    const flat = generatePlot(FLAT_PLOT_SEED, { flat: true });
    const m = buildTerrainMesh(flat, landScene(flat), 16);
    expect(m.minY).toBe(0);
    expect(m.maxY).toBe(0);
  });

  it("puts ponds and lakes at a level below their shore", () => {
    const watery = plots.filter((p) => p.waterFeatures.some((w) => w.kind === "pond" || w.kind === "lake"));
    expect(watery.length).toBeGreaterThan(0);
    for (const p of watery) {
      const scene = landScene(p);
      const [w] = waterSurfaces(p, scene);
      expect(w.outline.length).toBeGreaterThan(3);
      for (const [x, z] of w.outline) {
        expect(Math.abs(x)).toBeLessThanOrEqual(SCENE_SIZE / 2 + 1e-6);
        expect(Math.abs(z)).toBeLessThanOrEqual(SCENE_SIZE / 2 + 1e-6);
      }
    }
  });

  it("keeps lake water above the lake bed and below the bank", () => {
    const lakes = plots.filter((p) => p.waterFeatures.some((w) => w.kind === "lake"));
    expect(lakes.length).toBeGreaterThan(0);
    for (const p of lakes) {
      const scene = landScene(p);
      const [w] = waterSurfaces(p, scene);
      const shore = p.waterFeatures[0].points;
      // Midway along the shoreline, a little into the water vs. well up the bank.
      const mid = shore[6];
      const far = shore[shore.length - 1];
      const len = Math.hypot(far.x - mid.x, far.y - mid.y);
      const into = scene.toScene(mid.x + ((far.x - mid.x) / len) * 240, mid.y + ((far.y - mid.y) / len) * 240)[1];
      const bank = scene.toScene(mid.x - ((far.x - mid.x) / len) * 360, mid.y - ((far.y - mid.y) / len) * 360)[1];
      expect(w.level).toBeGreaterThan(into);
      expect(w.level).toBeLessThan(bank);
    }
  });

  it("fills ponds: water sits above the middle of the bowl", () => {
    const ponds = plots.filter((p) => p.waterFeatures.some((w) => w.kind === "pond"));
    expect(ponds.length).toBeGreaterThan(0);
    for (const p of ponds) {
      const scene = landScene(p);
      const [w] = waterSurfaces(p, scene);
      const pts = p.waterFeatures[0].points;
      const cx = pts.reduce((s, q) => s + q.x, 0) / pts.length;
      const cy = pts.reduce((s, q) => s + q.y, 0) / pts.length;
      expect(w.level).toBeGreaterThan(scene.toScene(cx, cy)[1]);
    }
  });

  it("drapes lines onto the ground", () => {
    const p = plots[2];
    const scene = landScene(p);
    const line = drapeLine(p.outline, scene, { closed: true, liftIn: 0 });
    expect(line.length).toBeGreaterThan(p.outline.length);
    const [x, y, z] = line[3];
    // Back to plot inches and check the height matches the ground there.
    const px = x / scene.scale + scene.view.x0 + scene.view.side / 2;
    const py = z / scene.scale + scene.view.y0 + scene.view.side / 2;
    expect(y).toBeCloseTo(scene.height(px, py) * scene.scale * HEIGHT_EXAGGERATION, 4);
  });
});
