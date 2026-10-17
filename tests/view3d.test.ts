import { describe, expect, it } from "vitest";
import { House3D, type FloorPlan, type Opening, type PlanRoom, type Point } from "@/lib/model/schema";
import { levelFor, MAIN_LEVEL_ID } from "@/lib/brief/levels";
import { defaultBasics, exteriorWallIn, INTERIOR_WALL_IN } from "@/lib/plan/basics";
import { rectangle } from "@/lib/plan/geometry";
import { buildHouse, FOOTPRINT_IN, type HouseContext, type Part } from "@/lib/house3d/build";
import { isLookingDown, LOOK_DOWN_DEG, orbitOf, orbitPosition, TOP_PHI, topViewOrbit, tweenOrbit } from "@/lib/house3d/camera";
import { siteFor } from "@/lib/house3d/site";
import { IN_PER_UNIT, type MeshData } from "@/lib/house3d/mesh";

const FT = 12;

function room(id: string, polygon: Point[]): PlanRoom {
  return { id, name: id, type: "living", polygon };
}
function plan(rooms: PlanRoom[], extra: Partial<FloorPlan> = {}): FloorPlan {
  return { rooms, walls: [], openings: [], stairs: [], fixtures: [], furniture: [], ...extra };
}
function ctx(): HouseContext {
  return { levels: [levelFor(MAIN_LEVEL_ID)], basics: defaultBasics(), house3d: House3D.parse({}), site: siteFor(null, { x: 0, y: 0 }, {}), frame: { ox: 0, oy: 0 } };
}

/** The top faces of some meshes (flat triangles facing up), in plan inches. */
function tops(meshes: MeshData[]): Point[][] {
  const out: Point[][] = [];
  for (const m of meshes) {
    for (let t = 0; t < m.count; t++) {
      if (m.normals[t * 9 + 1] < 0.99) continue;
      const tri: Point[] = [];
      for (let v = 0; v < 3; v++) tri.push({ x: m.positions[t * 9 + v * 3] * IN_PER_UNIT, y: m.positions[t * 9 + v * 3 + 2] * IN_PER_UNIT });
      out.push(tri);
    }
  }
  return out;
}

function inTriangle(p: Point, [a, b, c]: Point[]): boolean {
  const s = (p1: Point, p2: Point, p3: Point) => (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
  const d1 = s(p, a, b);
  const d2 = s(p, b, c);
  const d3 = s(p, c, a);
  const neg = d1 < -1e-6 || d2 < -1e-6 || d3 < -1e-6;
  const pos = d1 > 1e-6 || d2 > 1e-6 || d3 > 1e-6;
  return !(neg && pos);
}
const covered = (tris: Point[][], p: Point) => tris.some((t) => inTriangle(p, t));

const door = (roomId: string, edge: number, offsetIn: number): Opening => ({
  id: "d",
  host: { roomId, edge },
  offsetIn,
  kind: "door",
  style: "door-hinged",
  widthIn: 32,
  heightIn: 80,
  side: 1,
  hinge: "start",
});
const windowOn = (roomId: string, edge: number, offsetIn: number): Opening => ({
  id: "w",
  host: { roomId, edge },
  offsetIn,
  kind: "window",
  style: "window",
  widthIn: 36,
  heightIn: 48,
  sillIn: 30,
  side: 1,
  hinge: "start",
});

// Two rooms side by side, sharing the wall at x = 20 ft. Edge 1 of room a is that shared wall; edge 0 is its north wall (outside).
const A = room("a", rectangle(10 * FT, 6 * FT, 20 * FT, 12 * FT));
const B = room("b", rectangle(30 * FT, 6 * FT, 20 * FT, 12 * FT));
const twoRooms = plan([A, B], { openings: [door("a", 1, 6 * FT), windowOn("a", 0, 5 * FT)] });
const parts = buildHouse({ [MAIN_LEVEL_ID]: twoRooms }, ctx()).parts;
const of = (layer: Part["layer"], wall?: Part["wall"]) => parts.filter((p) => !p.quality && p.layer === layer && (wall === undefined || p.wall === wall));

describe("wall groups for hiding walls in 3D", () => {
  it("splits each floor's walls into an outside group and an inside group", () => {
    expect(of("walls", "outside")).toHaveLength(1);
    expect(of("walls", "inside")).toHaveLength(1);
    expect(of("walls").every((p) => p.wall)).toBe(true);
  });

  it("ties doors and windows to the wall they're in, glass included", () => {
    const win = parts.filter((p) => p.pick?.id === "w");
    const dr = parts.filter((p) => p.pick?.id === "d");
    expect(win.length).toBeGreaterThan(0);
    expect(win.some((p) => p.glass)).toBe(true);
    expect(win.every((p) => p.wall === "outside")).toBe(true);
    expect(dr.length).toBeGreaterThan(0);
    expect(dr.every((p) => p.wall === "inside")).toBe(true);
  });

  it("leaves floors, fixtures and the foundation out of the wall groups, so they always show", () => {
    for (const layer of ["floors", "foundation"] as const) {
      expect(of(layer).length).toBeGreaterThan(0);
      expect(of(layer).every((p) => !p.wall)).toBe(true);
    }
  });

  it("keeps the walls out of the click list (only what can be picked has a pick)", () => {
    expect(of("walls").every((p) => !p.pick)).toBe(true);
    expect(of("footprints").every((p) => !p.pick)).toBe(true);
  });
});

describe("wall footprint strips", () => {
  const outside = tops(of("footprints", "outside").map((p) => p.mesh));
  const inside = tops(of("footprints", "inside").map((p) => p.mesh));
  const ext = exteriorWallIn(defaultBasics());

  it("lie flat on the floor, a little thick so they show", () => {
    for (const p of of("footprints")) {
      for (let i = 1; i < p.mesh.positions.length; i += 3) {
        const y = p.mesh.positions[i] * IN_PER_UNIT;
        expect(y).toBeGreaterThanOrEqual(-1e-6);
        expect(y).toBeLessThanOrEqual(FOOTPRINT_IN + 1e-6);
      }
    }
  });

  it("are as wide as the wall is thick", () => {
    // North wall, away from the window: covered just inside its thickness, not beyond.
    expect(covered(outside, { x: 15 * FT, y: ext / 2 - 0.2 })).toBe(true);
    expect(covered(outside, { x: 15 * FT, y: -ext / 2 + 0.2 })).toBe(true);
    expect(covered(outside, { x: 15 * FT, y: ext / 2 + 0.5 })).toBe(false);
    expect(covered(inside, { x: 20 * FT + INTERIOR_WALL_IN / 2 - 0.2, y: 2 * FT })).toBe(true);
    expect(covered(inside, { x: 20 * FT + INTERIOR_WALL_IN / 2 + 0.5, y: 2 * FT })).toBe(false);
  });

  it("leave a gap at a doorway but not under a window", () => {
    expect(covered(inside, { x: 20 * FT, y: 6 * FT })).toBe(false);
    expect(covered(inside, { x: 20 * FT, y: 6 * FT - 20 })).toBe(true);
    expect(covered(outside, { x: 5 * FT, y: 0 })).toBe(true);
  });

  it("join cleanly at the corners, outer edge included", () => {
    for (const c of [
      { x: 0, y: 0 },
      { x: 40 * FT, y: 12 * FT },
    ])
      for (const d of [
        { x: -1, y: -1 },
        { x: 1, y: 1 },
      ])
        expect(covered(outside, { x: c.x + (d.x * ext) / 2 - d.x * 0.2, y: c.y + (d.y * ext) / 2 - d.y * 0.2 })).toBe(true);
    // Where the inside wall meets the outside wall.
    expect(covered([...outside, ...inside], { x: 20 * FT, y: 0.5 })).toBe(true);
  });

  it("follow walls at any angle, through every corner", () => {
    const poly = [
      { x: 0, y: 0 },
      { x: 18 * FT, y: 4 * FT },
      { x: 14 * FT, y: 16 * FT },
      { x: -3 * FT, y: 11 * FT },
    ];
    const angled = buildHouse({ [MAIN_LEVEL_ID]: plan([room("q", poly)]) }, ctx()).parts;
    const t = tops(angled.filter((p) => p.layer === "footprints").map((p) => p.mesh));
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length];
      expect(covered(t, a)).toBe(true);
      expect(covered(t, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })).toBe(true);
    });
    // The middle of the room is floor, not strip.
    expect(covered(t, { x: 8 * FT, y: 8 * FT })).toBe(false);
  });
});

describe("the 3D camera", () => {
  it("counts as looking down within about 10 degrees of straight down", () => {
    expect(isLookingDown(TOP_PHI)).toBe(true);
    expect(isLookingDown(((LOOK_DOWN_DEG - 1) * Math.PI) / 180)).toBe(true);
    expect(isLookingDown(((LOOK_DOWN_DEG + 1) * Math.PI) / 180)).toBe(false);
  });

  it("puts the Top view straight over the house's middle, a hair south so north stays at the top", () => {
    const o = topViewOrbit([10, 4, -5], 60, 40);
    expect(o.target).toEqual([10, 0, -5]);
    const [x, y, z] = orbitPosition(o);
    expect(x).toBeCloseTo(10, 6);
    expect(y).toBeGreaterThan(60);
    // Just south of the target (z points south): looking toward north, so north is "up" on screen.
    expect(z).toBeGreaterThan(-5);
    expect(z + 5).toBeLessThan(0.1);
  });

  it("glides to the Top view the short way round, ending exactly there", () => {
    const from = orbitOf([50, 30, -40], [0, 0, 0]);
    const to = topViewOrbit([0, 0, 0], 40, 40);
    expect(tweenOrbit(from, to, 0)).toEqual(from);
    const end = tweenOrbit(from, to, 1);
    expect(end.phi).toBeCloseTo(to.phi, 9);
    expect(end.radius).toBeCloseTo(to.radius, 9);
    expect(Math.cos(end.theta)).toBeCloseTo(1, 9);
    // Never turns more than half way round.
    for (let t = 0; t <= 1; t += 0.1) expect(Math.abs(tweenOrbit(from, to, t).theta - from.theta)).toBeLessThanOrEqual(Math.PI + 1e-9);
    // From the far side (theta near ±180°) it doesn't swing through the long way.
    const behind = { ...from, theta: Math.PI - 0.1 };
    expect(Math.abs(tweenOrbit(behind, to, 1).theta - behind.theta)).toBeLessThanOrEqual(Math.PI);
  });

  it("reads back the same orbit from a camera position", () => {
    const o = { radius: 80, phi: 0.7, theta: -2.1, target: [3, 1, 4] as [number, number, number] };
    const back = orbitOf(orbitPosition(o), o.target);
    expect(back.radius).toBeCloseTo(80, 9);
    expect(back.phi).toBeCloseTo(0.7, 9);
    expect(back.theta).toBeCloseTo(-2.1, 9);
  });
});
