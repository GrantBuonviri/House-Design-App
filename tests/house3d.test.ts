import { describe, expect, it } from "vitest";
import { DiscoveryAnswers, House3D, type ChosenRoom, type FloorPlan, type Opening, type PlanRoom, type Point } from "@/lib/model/schema";
import { createProject, migrateProject } from "@/lib/model/project";
import { generatePlot, FLAT_PLOT_SEED } from "@/lib/land/generate";
import { buildRuleBrief } from "@/lib/brief/rules";
import { levelFor, levelsFor, MAIN_LEVEL_ID } from "@/lib/brief/levels";
import { suggestDiagrams } from "@/lib/bubbles/arrange";
import { defaultBasics, FLOOR_STRUCTURE_IN } from "@/lib/plan/basics";
import { suggestPlans } from "@/lib/plan/suggest";
import { stairsDrawing, stepsFor } from "@/lib/plan/stairs";
import { pointInPolygon, polygonArea, rectangle } from "@/lib/plan/geometry";
import { buildHouse, buildLevel, buildRoofs, dugOut, type HouseContext } from "@/lib/house3d/build";
import { dragPlan } from "@/lib/house3d/drag";
import { floorFootprint, joinRooms, offsetRing, roofFootprint, subtractRegions } from "@/lib/house3d/footprint";
import { levelHeights } from "@/lib/house3d/levels";
import { IN_PER_UNIT, type MeshData } from "@/lib/house3d/mesh";
import { openingSpan } from "@/lib/house3d/openings";
import { roofShape } from "@/lib/house3d/roof";
import { FLOOR_ABOVE_GRADE_IN, lotOffsetFor, planBounds, siteFor } from "@/lib/house3d/site";
import { stairSteps } from "@/lib/house3d/stairs";
import { groundMesh } from "@/lib/house3d/terrain";
import { openingGeometry } from "@/lib/plan/walls";

const FT = 12;

function room(id: string, x: number, y: number, w: number, h: number, type = "living"): PlanRoom {
  return { id, name: id, type, polygon: rectangle(x + w / 2, y + h / 2, w, h) };
}
function plan(rooms: PlanRoom[], extra: Partial<FloorPlan> = {}): FloorPlan {
  return { rooms, walls: [], openings: [], stairs: [], fixtures: [], furniture: [], ...extra };
}
const ROOF: House3D["roof"] = House3D.parse({}).roof;

function ctx(levels = [levelFor(MAIN_LEVEL_ID)], plans: Record<string, FloorPlan> = {}, roof = ROOF): HouseContext {
  return { levels, basics: defaultBasics(), house3d: { roof }, site: siteFor(null, { x: 0, y: 0 }, plans), frame: { ox: 0, oy: 0 } };
}

/** Highest and lowest y (scene feet) of some meshes. */
function yRange(meshes: MeshData[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const m of meshes) {
    for (let i = 1; i < m.positions.length; i += 3) {
      lo = Math.min(lo, m.positions[i]);
      hi = Math.max(hi, m.positions[i]);
    }
  }
  return [lo, hi];
}

describe("floor heights", () => {
  it("stacks floors on the ceiling plus the floor structure, the same rise the stairs climb", () => {
    const h = levelHeights(levelsFor(2, 1), defaultBasics());
    expect(h["floor-1"].floorIn).toBe(0);
    expect(h["floor-2"].floorIn).toBe(108 + FLOOR_STRUCTURE_IN);
    expect(h["basement-1"].floorIn).toBe(-(96 + FLOOR_STRUCTURE_IN));
  });

  it("follows the ceiling heights picked in the plan basics", () => {
    const basics = { ...defaultBasics(), ceilings: { "floor-1": 120 } };
    expect(levelHeights(levelsFor(2, 0), basics)["floor-2"].floorIn).toBe(120 + FLOOR_STRUCTURE_IN);
  });
});

describe("the house outline", () => {
  it("joins rooms that share walls into one outline, and leaves porches out", () => {
    const p = plan([room("a", 0, 0, 20 * FT, 12 * FT), room("b", 20 * FT, 0, 10 * FT, 12 * FT), room("p", 0, 12 * FT, 10 * FT, 6 * FT, "porch")]);
    const out = floorFootprint(p);
    expect(out).toHaveLength(1);
    expect(polygonArea(out[0].outline)).toBeCloseTo(30 * FT * 12 * FT, -2);
    // The roof covers the porch too.
    expect(polygonArea(roofFootprint(p)[0].outline)).toBeCloseTo((30 * 12 + 10 * 6) * FT * FT, -2);
  });

  it("treats rooms less than an inch apart as touching", () => {
    const out = joinRooms([rectangle(60, 60, 120, 120), rectangle(180.8, 60, 120, 120)]);
    expect(out).toHaveLength(1);
    expect(out[0].holes).toHaveLength(0);
  });

  it("grows an outline evenly", () => {
    const sq = rectangle(50, 50, 100, 100);
    const grown = offsetRing(sq, 10);
    expect(polygonArea(grown)).toBeCloseTo(120 * 120, 3);
  });

  it("takes one floor away from another", () => {
    const left = subtractRegions(joinRooms([rectangle(100, 50, 200, 100)]), joinRooms([rectangle(50, 50, 100, 100)]));
    expect(polygonArea(left[0].outline)).toBeCloseTo(100 * 100, -1);
  });
});

describe("roofs", () => {
  const box = joinRooms([rectangle(20 * FT, 12 * FT, 40 * FT, 24 * FT)])[0];
  const wall = 6.5;

  it("makes a hip roof whose ridge sits where the slopes meet", () => {
    const r = roofShape(box, 108, wall, { ...ROOF, style: "hip", pitch: 6 });
    const top = Math.max(...r.tris.flatMap((t) => t.h));
    // Half the width to the outside of the walls, at 6 in 12.
    expect(top).toBeCloseTo(108 + (12 * FT + wall / 2) * 0.5, 3);
    expect(r.walls).toHaveLength(0);
    expect(r.fellBack).toBe(false);
  });

  it("turns the narrow ends into gable walls for a gable roof", () => {
    const r = roofShape(box, 108, wall, { ...ROOF, style: "gable", pitch: 6 });
    expect(r.walls).toHaveLength(2);
    // Each gable is a triangle in line with the end wall, from the top of the wall to the ridge.
    for (const w of r.walls) {
      expect(w.p).toHaveLength(3);
      expect(Math.abs(w.out.x)).toBeCloseTo(1, 5);
      expect(Math.max(...w.h)).toBeCloseTo(108 + (12 * FT + wall / 2) * 0.5, 3);
    }
    // The roof runs past the gable ends by the overhang.
    const xs = r.tris.flatMap((t) => t.p.map((p) => p.x));
    expect(Math.max(...xs)).toBeCloseTo(40 * FT + wall / 2 + ROOF.overhangIn, 3);
  });

  it("puts gables on both wings of an L-shaped house", () => {
    const L = joinRooms([rectangle(20 * FT, 12 * FT, 40 * FT, 24 * FT), rectangle(12 * FT, 36 * FT, 24 * FT, 24 * FT)])[0];
    const r = roofShape(L, 108, wall, { ...ROOF, style: "gable" });
    expect(r.walls.length).toBe(2);
  });

  it("raises a shed roof from the side it slopes down to", () => {
    const r = roofShape(box, 108, wall, { ...ROOF, style: "shed", pitch: 3, shedDown: "S" });
    const top = Math.max(...r.tris.flatMap((t) => t.h));
    expect(top).toBeCloseTo(108 + (24 * FT + wall) * 0.25 + ROOF.overhangIn * 0.25, 3);
    // Siding fills in under the high side.
    expect(r.walls.length).toBeGreaterThan(0);
  });

  it("lays a flat roof just above the walls", () => {
    const r = roofShape(box, 108, wall, { ...ROOF, style: "flat" });
    expect(new Set(r.tris.flatMap((t) => t.h))).toEqual(new Set([118]));
  });

  it("covers only what the floor above doesn't", () => {
    const levels = levelsFor(2, 0);
    const plans = { "floor-1": plan([room("a", 0, 0, 40 * FT, 24 * FT)]), "floor-2": plan([room("b", 0, 0, 20 * FT, 24 * FT)]) };
    const c = { ...ctx(levels, plans), heights: levelHeights(levels, defaultBasics()) };
    const roofs = buildRoofs(plans, c);
    expect(roofs.parts.some((p) => p.levelId === "floor-1")).toBe(true);
    expect(roofs.parts.some((p) => p.levelId === "floor-2")).toBe(true);
    // The main floor's roof stays over the uncovered half (x from 20 ft on, give or take the overhang).
    const main = roofs.parts.filter((p) => p.levelId === "floor-1" && p.key.endsWith(":roof"));
    const xs = main.flatMap((p) => Array.from(p.mesh.positions).filter((_, i) => i % 3 === 0));
    expect(Math.min(...xs)).toBeGreaterThan(20 - 2);
  });
});

describe("walls, doors and windows", () => {
  const windowOn = (roomId: string): Opening => ({ id: "w", host: { roomId, edge: 0 }, offsetIn: 60, kind: "window", style: "window", widthIn: 36, heightIn: 60, sillIn: 30, side: 1, hinge: "start" });

  it("puts walls up to the ceiling", () => {
    const p = plan([room("a", 0, 0, 20 * FT, 12 * FT)]);
    const parts = buildHouse({ "floor-1": p }, ctx()).parts;
    const walls = parts.filter((x) => x.layer === "walls").map((x) => x.mesh);
    expect(yRange(walls)).toEqual([0, 108 / IN_PER_UNIT]);
  });

  it("runs outside walls up to the floor above, so there's no gap at the floor structure", () => {
    const levels = levelsFor(2, 0);
    const plans = { "floor-1": plan([room("a", 0, 0, 20 * FT, 12 * FT)]), "floor-2": plan([room("b", 0, 0, 20 * FT, 12 * FT)]) };
    const c = { ...ctx(levels, plans), heights: levelHeights(levels, defaultBasics()) };
    const walls = buildLevel(plans, levels[0], c).filter((x) => x.layer === "walls");
    expect(yRange(walls.map((w) => w.mesh))[1]).toBeCloseTo((108 + FLOOR_STRUCTURE_IN) / IN_PER_UNIT, 5);
  });

  it("cuts a window into the wall and frames it", () => {
    const p = plan([room("a", 0, 0, 20 * FT, 12 * FT)]);
    const without = buildHouse({ "floor-1": p }, ctx()).parts;
    const withW = buildHouse({ "floor-1": { ...p, openings: [windowOn("a")] } }, ctx()).parts;
    const count = (parts: typeof without) => parts.filter((x) => x.layer === "walls").reduce((s, x) => s + x.mesh.count, 0);
    // The wall gets split into more pieces around the window.
    expect(count(withW)).toBeGreaterThan(count(without));
    const win = withW.filter((x) => x.pick?.kind === "opening");
    expect(win.some((x) => x.glass)).toBe(true);
    expect(win.every((x) => x.pick!.id === "w")).toBe(true);
    const og = openingGeometry(p, windowOn("a"))!;
    expect(openingSpan(og, 108)).toEqual({ bottom: 30, top: 90 });
  });

  it("can be clicked: rooms, doors, stairs and fixtures each know what they are", () => {
    const p = plan([room("a", 0, 0, 20 * FT, 12 * FT)], {
      fixtures: [{ id: "f", kind: "toilet", x: 40, y: 40, rotation: 0, widthIn: 20, depthIn: 28, roomId: "a" }],
    });
    const parts = buildHouse({ "floor-1": p }, ctx()).parts;
    expect(parts.find((x) => x.pick?.kind === "room")?.pick).toEqual({ kind: "room", id: "a", levelId: "floor-1" });
    expect(parts.find((x) => x.pick?.kind === "fixture")?.pick?.id).toBe("f");
  });
});

describe("stairs", () => {
  it("climbs the whole rise in equal steps, with a landing on L-shaped stairs", () => {
    const rise = 108 + FLOOR_STRUCTURE_IN;
    const { treads, riserIn } = stepsFor(rise);
    const straight = stairSteps("straight", 40, treads, riserIn);
    expect(straight).toHaveLength(treads);
    expect(straight[straight.length - 1].top + riserIn).toBeCloseTo(rise, 5);
    const l = stairSteps("l", 40, treads, riserIn);
    expect(l).toHaveLength(treads);
    expect(l[l.length - 1].top + riserIn).toBeCloseTo(rise, 5);
  });

  it("covers the same ground as the plan drawing", () => {
    const s = { x: 0, y: 0, rotation: 90, widthIn: 40, shape: "u" as const, flip: false };
    const rise = 121;
    const { treads, riserIn } = stepsFor(rise);
    const area = stairSteps("u", 40, treads, riserIn).reduce((sum, st) => sum + polygonArea(st.outline), 0);
    expect(area).toBeCloseTo(polygonArea(stairsDrawing(s, rise).footprint), 0);
  });

  it("cuts a stairwell into the floor above", () => {
    const levels = levelsFor(2, 0);
    const stairs = { id: "s", x: 60, y: 80, rotation: 0, widthIn: 40, shape: "straight" as const, flip: false, toLevelId: "floor-2" };
    const plans = { "floor-1": plan([room("a", 0, 0, 20 * FT, 16 * FT)], { stairs: [stairs] }), "floor-2": plan([room("b", 0, 0, 20 * FT, 16 * FT)]) };
    const c = { ...ctx(levels, plans), heights: levelHeights(levels, defaultBasics()) };
    const floor = buildLevel(plans, levels[1], c).find((x) => x.pick?.kind === "room")!;
    const solid = buildLevel({ ...plans, "floor-1": { ...plans["floor-1"], stairs: [] } }, levels[1], c).find((x) => x.pick?.kind === "room")!;
    // The hole adds edges (more triangles) and takes away floor.
    expect(floor.mesh.count).toBeGreaterThan(solid.mesh.count);
  });
});

// ---------- On the land ----------

const chosen = (type: string, levelId?: string, i = 0): ChosenRoom => ({ id: `${type}-${i}`, type, name: type, description: "", levelId });

function houseOn(seed: number | "flat", types: [string, string?][], above: number, below: number) {
  const plot = seed === "flat" ? generatePlot(FLAT_PLOT_SEED, { flat: true }) : generatePlot(seed);
  const answers = DiscoveryAnswers.parse({ rooms: types.map(([t, l], i) => chosen(t, l, i)), floorsAbove: above, floorsBelow: below });
  const brief = buildRuleBrief({ answers, profile: { mustHaves: [], dislikes: [] }, plot });
  const levels = levelsFor(brief.floors, brief.floorsBelow);
  const bubbles = suggestDiagrams({ brief, plot, levels });
  const basics = defaultBasics();
  const plans = suggestPlans(bubbles, { brief, plot, levels, basics }).plans;
  const p = { ...createProject("Test"), plot, brief, levels, bubbles, floorPlans: plans };
  const site = siteFor(plot, lotOffsetFor(p), plans);
  const c: HouseContext = { levels, basics, house3d: { roof: ROOF }, site, frame: { ox: 0, oy: 0 } };
  return { p, plans, site, c, levels };
}

/** The steepest plot among the first few seeds, for a walkout. */
const SLOPED = (() => {
  let best = { seed: 1, pct: 0 };
  for (let s = 1; s < 40; s++) {
    const pct = generatePlot(s).slope.percent;
    if (pct > best.pct && pct < 14) best = { seed: s, pct };
  }
  return best.seed;
})();

describe("the house on the land", () => {
  const TYPES: [string, string?][] = [["entry"], ["kitchen"], ["living"], ["bedroom"], ["bathroom"], ["garage"], ["media", "basement-1"], ["bedroom", "basement-1"]];

  it("sets the main floor just above the highest ground under it", () => {
    const { plans, site } = houseOn(SLOPED, TYPES, 1, 1);
    const main = plans["floor-1"].rooms.filter((r) => r.type !== "deck").flatMap((r) => r.polygon);
    const highest = Math.max(...main.map(site.groundAt));
    expect(highest).toBeLessThanOrEqual(-FLOOR_ABOVE_GRADE_IN + 0.01);
    expect(highest).toBeGreaterThan(-FLOOR_ABOVE_GRADE_IN - 24);
  });

  it("runs the foundation down below the ground on a slope", () => {
    const { plans, c, site } = houseOn(SLOPED, TYPES, 1, 0);
    const parts = buildHouse(plans, c).parts.filter((x) => x.layer === "foundation");
    expect(parts.length).toBeGreaterThan(0);
    const lowestGround = Math.min(...plans["floor-1"].rooms.flatMap((r) => r.polygon).map(site.groundAt));
    expect(yRange(parts.map((x) => x.mesh))[0]).toBeLessThan(lowestGround / IN_PER_UNIT);
  });

  it("digs the ground out where the basement is, and nowhere on a house without one", () => {
    const withB = houseOn(SLOPED, TYPES, 1, 1);
    const heights = levelHeights(withB.levels, defaultBasics());
    const holes = dugOut(withB.plans, { ...withB.c, heights });
    expect(holes.length).toBeGreaterThan(0);
    const g = groundMesh(withB.site, withB.c.frame, { house: planBounds(withB.plans), holes });
    // No ground triangle has its middle inside the basement.
    const inside = (i: number) => {
      const at = (k: number) => ({ x: g.positions[k * 3] * IN_PER_UNIT, y: g.positions[k * 3 + 2] * IN_PER_UNIT });
      const [a, b, cc] = [at(g.indices[i]), at(g.indices[i + 1]), at(g.indices[i + 2])];
      const mid: Point = { x: (a.x + b.x + cc.x) / 3, y: (a.y + b.y + cc.y) / 3 };
      const plot = { x: mid.x + 0, y: mid.y + 0 };
      return withB.plans["basement-1"].rooms.some((r) => pointInPolygon(plot, offsetRing(r.polygon, -2)));
    };
    for (let i = 0; i < g.indices.length; i += 3) expect(inside(i)).toBe(false);

    const without = houseOn("flat", TYPES.slice(0, 6), 1, 0);
    expect(dugOut(without.plans, { ...without.c, heights: levelHeights(without.levels, defaultBasics()) })).toHaveLength(0);
  });

  it("builds a whole suggested house without falling back to a flat roof", () => {
    const { plans, c } = houseOn(SLOPED, [...TYPES, ["primary-bedroom", "floor-2"], ["primary-bath", "floor-2"]], 2, 1);
    const m = buildHouse(plans, c);
    expect(m.roofFellBack).toBe(false);
    expect(m.parts.filter((x) => x.layer === "roof").length).toBeGreaterThan(0);
    expect(m.bounds).not.toBeNull();
    for (const part of m.parts) expect(part.mesh.positions.every(Number.isFinite)).toBe(true);
  });
});

describe("dragging in 3D", () => {
  const base = plan([room("a", 0, 0, 10 * FT, 10 * FT), room("b", 12 * FT, 0, 10 * FT, 10 * FT)]);

  it("moves a room and snaps it against its neighbor", () => {
    // Dragged 1' 9" to the right: close enough (within 6") to butt up against room b.
    const moved = dragPlan(base, "room", ["a"], { x: 60, y: 60 }, { x: 60 + 21, y: 60 }, true);
    const a = moved.rooms.find((r) => r.id === "a")!;
    expect(Math.max(...a.polygon.map((p) => p.x))).toBe(12 * FT);
  });

  it("slides a window along its wall", () => {
    const withWindow: FloorPlan = {
      ...base,
      openings: [{ id: "w", host: { roomId: "a", edge: 0 }, offsetIn: 30, kind: "window", style: "window", widthIn: 36, heightIn: 60, sillIn: 30, side: 1, hinge: "start" }],
    };
    const moved = dragPlan(withWindow, "opening", ["w"], { x: 30, y: 0 }, { x: 70, y: 4 }, true);
    expect(moved.openings[0].offsetIn).toBe(70);
  });
});

describe("saving", () => {
  it("opens older projects with the default roof", () => {
    const p = createProject("Old");
    const older = { ...p, schemaVersion: 4 } as Record<string, unknown>;
    delete older.house3d;
    const migrated = migrateProject(older);
    expect(migrated.house3d.roof).toEqual({ style: "gable", pitch: 6, overhangIn: 16, shedDown: "S" });
  });
});
