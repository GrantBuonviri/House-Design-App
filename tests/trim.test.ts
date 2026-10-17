import { describe, expect, it } from "vitest";
import { buildHouse, forQuality, type HouseContext, type Part } from "@/lib/house3d/build";
import { CROWN, BASEBOARD, CROWN_ROOMS, drawLeafDetail, drawWallTrim, panelsOf, sweep } from "@/lib/house3d/trim";
import { MeshBuilder, hex } from "@/lib/house3d/mesh";
import { siteFor } from "@/lib/house3d/site";
import { openingGeometries } from "@/lib/plan/walls";
import type { Project } from "@/lib/model/schema";
import { house, RANCH } from "./samples";

const ctxFor = (p: Project): HouseContext => ({ levels: p.levels, basics: p.plan.basics, house3d: p.house3d, site: siteFor(p.plot, { x: 0, y: 0 }, p.floorPlans), frame: { ox: 0, oy: 0 }, exterior: p.exterior });
const tris = (parts: Part[]) => parts.reduce((n, p) => n + p.mesh.count, 0);

describe("room trim", () => {
  const p = house(RANCH);
  const model = buildHouse(p.floorPlans, ctxFor(p));
  const pretty = forQuality(model.parts, "pretty");
  const fast = forQuality(model.parts, "fast");

  it("is Pretty only, so Fast draws what it did before", () => {
    const trim = model.parts.filter((x) => x.key.includes(":trim:") || x.key.includes(":od:") || x.key.includes(":old:"));
    expect(trim.length).toBeGreaterThan(0);
    expect(trim.every((x) => x.quality === "pretty")).toBe(true);
    expect(fast.some((x) => trim.includes(x))).toBe(false);
    expect(tris(pretty)).toBeGreaterThan(tris(fast));
  });

  it("puts baseboards on inside and outside walls and hides them with the walls", () => {
    const boards = model.parts.filter((x) => x.key.includes(":trim:"));
    expect(boards.some((x) => x.wall === "inside")).toBe(true);
    expect(boards.some((x) => x.wall === "outside")).toBe(true);
    expect(boards.every((x) => x.layer === "walls")).toBe(true);
  });

  it("gives every door and window casing, and every hinged door panels and a handle", () => {
    const ogs = p.floorPlans && Object.values(p.floorPlans).flatMap((pl) => openingGeometries(pl));
    const casing = model.parts.filter((x) => x.key.includes(":od:"));
    const leaves = model.parts.filter((x) => x.key.includes(":old:"));
    expect(casing.length).toBeGreaterThanOrEqual(ogs.filter((o) => o.opening.kind !== "opening" && o.opening.style !== "door-garage").length - 2);
    expect(leaves.length).toBeGreaterThan(0);
    expect(leaves.every((x) => x.door && x.pick)).toBe(true);
  });

  it("sweeps the baseboard and crown profiles to their size", () => {
    const crown = new MeshBuilder();
    sweep(crown, { ox: 0, oy: 0 }, { x: 0, y: 0 }, { x: 120, y: 0 }, { x: 0, y: 1 }, 96, CROWN, hex("#ffffff"));
    const base = new MeshBuilder();
    sweep(base, { ox: 0, oy: 0 }, { x: 0, y: 0 }, { x: 120, y: 0 }, { x: 0, y: 1 }, 0, BASEBOARD, hex("#ffffff"));
    // Crown hangs under the ceiling (96") and stays within its 3.5"; the board stands on the floor, 5.25" tall, 0.8" proud.
    const range = (m: MeshBuilder, axis: 0 | 1 | 2) => {
      const pos = m.build().positions;
      let lo = Infinity, hi = -Infinity;
      for (let i = axis; i < pos.length; i += 3) { lo = Math.min(lo, pos[i]); hi = Math.max(hi, pos[i]); }
      return [lo, hi];
    };
    expect(range(crown, 1)[0]).toBeCloseTo((96 - 3.5) / 12, 3);
    expect(range(crown, 1)[1]).toBeCloseTo(96 / 12, 3);
    expect(range(base, 1)[0]).toBeCloseTo(0, 5);
    expect(range(base, 1)[1]).toBeCloseTo(5.25 / 12, 3);
    expect(range(base, 2)[1]).toBeCloseTo(0.8 / 12, 3);
  });

  it("stops the baseboard at a doorway and adds crown only where asked", () => {
    const f = { ox: 0, oy: 0 };
    const side = { a: { x: 0, y: 0 }, b: { x: 120, y: 0 }, thicknessIn: 4.5, sign: 1 as const, color: hex("#ffffff") };
    const xs = (m: MeshBuilder) => {
      const pos = m.build().positions;
      const out: number[] = [];
      for (let i = 0; i < pos.length; i += 3) out.push(pos[i] * 12);
      return out;
    };
    const solid = new MeshBuilder();
    drawWallTrim(solid, f, { ...side, doorways: [], crown: false }, 0, 96);
    const gap = new MeshBuilder();
    drawWallTrim(gap, f, { ...side, doorways: [[40, 70]], crown: false }, 0, 96);
    expect(xs(gap).some((x) => x > 40.5 && x < 69.5)).toBe(false);
    expect(xs(gap).some((x) => Math.abs(x - 40) < 0.01)).toBe(true);
    expect(xs(solid).some((x) => Math.abs(x - 40) < 0.01)).toBe(false);
    const crowned = new MeshBuilder();
    drawWallTrim(crowned, f, { ...side, doorways: [], crown: true }, 0, 96);
    expect(crowned.build().count).toBeGreaterThan(solid.build().count);
    expect(CROWN_ROOMS.has("living")).toBe(true);
    expect(CROWN_ROOMS.has("bathroom")).toBe(false);
  });

  it("paneled doors: two fields for a room door, six for a front door, handles on both faces", () => {
    expect(panelsOf("door-hinged")).toEqual({ cols: 1, rows: 2 });
    expect(panelsOf("door-entry")).toEqual({ cols: 2, rows: 3 });
    const room = new MeshBuilder();
    drawLeafDetail(room, { ox: 0, oy: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, 30, 1.75, 0.5, 79, "door-hinged", hex("#ffffff"));
    const front = new MeshBuilder();
    drawLeafDetail(front, { ox: 0, oy: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, 36, 1.75, 0.5, 79, "door-entry", hex("#ffffff"));
    expect(front.build().count).toBeGreaterThan(room.build().count);
    const handles = room.build();
    expect(handles.patterns && Array.from(handles.patterns).some((v) => v > 0)).toBe(true);
  });
});
