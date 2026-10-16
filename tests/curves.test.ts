import { describe, expect, it } from "vitest";
import { House3D, type FloorPlan, type Opening, type PlanRoom, type Point } from "@/lib/model/schema";
import { createProject, migrateProject } from "@/lib/model/project";
import { generatePlot, FLAT_PLOT_SEED } from "@/lib/land/generate";
import { levelFor, MAIN_LEVEL_ID } from "@/lib/brief/levels";
import { defaultBasics } from "@/lib/plan/basics";
import { DEFAULT_LABELS } from "@/lib/plan/labels";
import { dist, polygonArea, rectangle } from "@/lib/plan/geometry";
import { arcBetween, pointOnArc, projectOnArc, roomArea, roomEdgeArc, roomEdgeLength, wallLength } from "@/lib/plan/arcs";
import { flatPlan, flatPlans, flatProject, sourceEdge } from "@/lib/plan/flatten";
import { roomSqft } from "@/lib/plan/measure";
import { insertCorner, removeCorner, reshapeRoom, setEdgeLength } from "@/lib/plan/edit";
import { mirrorMany } from "@/lib/plan/arrange";
import { wallPieces } from "@/lib/plan/walls";
import { buildHouse, buildRoofs, type HouseContext } from "@/lib/house3d/build";
import { levelHeights } from "@/lib/house3d/levels";
import { siteFor } from "@/lib/house3d/site";
import { measurePlan } from "@/lib/cost/quantities";
import { buildSet } from "@/lib/plans/build";
import { codeReport } from "@/lib/codes/rules";

const FT = 12;
const flat = generatePlot(FLAT_PLOT_SEED, { flat: true });

function room(id: string, x: number, y: number, w: number, h: number, extra: Partial<PlanRoom> = {}): PlanRoom {
  return { id, name: id, type: "living", polygon: rectangle(x + w / 2, y + h / 2, w, h), ...extra };
}
function plan(rooms: PlanRoom[], extra: Partial<FloorPlan> = {}): FloorPlan {
  return { rooms, walls: [], openings: [], stairs: [], fixtures: [], furniture: [], ...extra };
}

/** A round room: four corners on a circle, each edge a quarter circle bowing out. */
function roundRoom(id: string, c: Point, r: number, curved = true): PlanRoom {
  const polygon = [
    { x: c.x, y: c.y - r },
    { x: c.x + r, y: c.y },
    { x: c.x, y: c.y + r },
    { x: c.x - r, y: c.y },
  ];
  const bow = r * (1 - Math.cos(Math.PI / 4));
  return { id, name: id, type: "living", polygon, ...(curved ? { bulges: [bow, bow, bow, bow] } : {}) };
}

/** Which edge of a rectangle from rectangle() runs along x = `x`. */
function edgeAtX(r: PlanRoom, x: number): number {
  return r.polygon.findIndex((p, i) => {
    const q = r.polygon[(i + 1) % r.polygon.length];
    return Math.abs(p.x - x) < 0.01 && Math.abs(q.x - x) < 0.01;
  });
}

/** Two 10' rooms side by side whose shared wall bows 2' into the right-hand one. */
function sharedCurve(): { plan: FloorPlan; a: PlanRoom; b: PlanRoom; ea: number; eb: number } {
  const a0 = room("a", 0, 0, 120, 120);
  const b0 = room("b", 120, 0, 120, 120);
  const ea = edgeAtX(a0, 120);
  const eb = edgeAtX(b0, 120);
  const a = { ...a0, bulges: a0.polygon.map((_, i) => (i === ea ? 24 : 0)) };
  const b = { ...b0, bulges: b0.polygon.map((_, i) => (i === eb ? -24 : 0)) };
  return { plan: plan([a, b]), a, b, ea, eb };
}

function project(plans: Record<string, FloorPlan>) {
  return { ...createProject("Curves"), plot: flat, levels: [levelFor(MAIN_LEVEL_ID)], floorPlans: plans, plan: { basics: defaultBasics(), showSketch: false, labels: DEFAULT_LABELS } };
}

function ctx(plans: Record<string, FloorPlan>): HouseContext {
  return { levels: [levelFor(MAIN_LEVEL_ID)], basics: defaultBasics(), house3d: { roof: House3D.parse({}).roof }, site: siteFor(null, { x: 0, y: 0 }, plans), frame: { ox: 0, oy: 0 } };
}

describe("arc math", () => {
  it("works out a half circle from its ends and bow", () => {
    const arc = arcBetween({ x: 0, y: 0 }, { x: 120, y: 0 }, 60)!;
    expect(arc.radius).toBeCloseTo(60, 6);
    expect(arc.center.x).toBeCloseTo(60, 6);
    expect(arc.center.y).toBeCloseTo(0, 6);
    expect(arc.length).toBeCloseTo(Math.PI * 60, 6);
    // Bowing left of east is north (y is south).
    const mid = pointOnArc(arc, arc.length / 2);
    expect(mid.x).toBeCloseTo(60, 6);
    expect(mid.y).toBeCloseTo(-60, 6);
    expect(pointOnArc(arc, arc.length).x).toBeCloseTo(120, 6);
  });

  it("gives the same circle read from either end", () => {
    const p = { x: 13, y: 7 };
    const q = { x: 140, y: 61 };
    const one = arcBetween(p, q, 30)!;
    const other = arcBetween(q, p, -30)!;
    expect(one.center).toEqual(other.center);
    expect(one.radius).toBe(other.radius);
  });

  it("finds the nearest point on a curve", () => {
    const arc = arcBetween({ x: 0, y: 0 }, { x: 120, y: 0 }, 60)!;
    const near = projectOnArc({ x: 60, y: -80 }, arc);
    expect(near.d).toBeCloseTo(20, 6);
    expect(near.t).toBeCloseTo(arc.length / 2, 6);
  });

  it("is straight when there's no bow", () => {
    expect(arcBetween({ x: 0, y: 0 }, { x: 120, y: 0 }, 0)).toBeNull();
    expect(wallLength({ a: { x: 0, y: 0 }, b: { x: 120, y: 0 } })).toBe(120);
  });
});

describe("curved rooms", () => {
  it("measures a round room's true area and wall length", () => {
    const r = roundRoom("round", { x: 0, y: 0 }, 10 * FT);
    expect(roomArea(r)).toBeCloseTo(Math.PI * 120 * 120, 3);
    expect(roomSqft(r)).toBe(Math.round(Math.PI * 100));
    expect(roomEdgeLength(r, 0)).toBeCloseTo((Math.PI * 2 * 120) / 4, 6);
  });

  it("bows out of the room whichever way the corners run", () => {
    const r = roundRoom("round", { x: 0, y: 0 }, 120);
    const reversed = { ...r, polygon: [...r.polygon].reverse(), bulges: r.bulges };
    expect(roomArea(reversed)).toBeCloseTo(Math.PI * 120 * 120, 3);
    const inward = { ...r, bulges: r.bulges!.map((b) => -b) };
    expect(roomArea(inward)).toBeLessThan(polygonArea(r.polygon));
  });
});

describe("flattening", () => {
  it("leaves a plan without curves alone", () => {
    const p = plan([room("a", 0, 0, 120, 120)]);
    expect(flatPlan(p)).toBe(p);
    const plans = { [MAIN_LEVEL_ID]: p };
    expect(flatPlans(plans)).toBe(plans);
  });

  it("turns a curve into short straight pieces on the circle", () => {
    const r = roundRoom("round", { x: 0, y: 0 }, 120);
    const f = flatPlan(plan([r])).rooms[0];
    expect(f.bulges).toBeUndefined();
    expect(f.polygon.length).toBeGreaterThan(60);
    for (const p of f.polygon) expect(Math.hypot(p.x, p.y)).toBeCloseTo(120, 1);
    expect(sourceEdge(f, f.polygon.length - 1)).toBe(3);
  });

  it("makes a shared curved wall one wall between the two rooms", () => {
    const { plan: p, a } = sharedCurve();
    const arc = roomEdgeArc(a, edgeAtX(a, 120))!;
    const pieces = wallPieces(flatPlan(p), 6);
    const inside = pieces.filter((w) => !w.exterior);
    const along = inside.reduce((s, w) => s + dist(w.a, w.b), 0);
    // The pieces follow the curve (each piece is a chord, a hair shorter than the arc).
    expect(along).toBeGreaterThan(arc.length * 0.995);
    expect(along).toBeLessThan(arc.length * 1.001);
    for (const w of inside) expect(projectOnArc(w.a, arc).d).toBeLessThan(0.05);
    // No outside wall along the shared curve.
    for (const w of pieces.filter((x) => x.exterior)) expect(projectOnArc({ x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 }, arc).d).toBeGreaterThan(1);
  });

  it("sets a window on a curve in as a flat unit, keeping its id", () => {
    const { plan: p, a, b, ea } = sharedCurve();
    const length = roomEdgeLength(a, ea);
    const win: Opening = { id: "w1", host: { roomId: "a", edge: ea }, offsetIn: length / 2, kind: "window", style: "window", widthIn: 36, heightIn: 48, side: 1, hinge: "start" };
    const f = flatPlan({ ...p, openings: [win] });
    const o = f.openings[0];
    expect(o.id).toBe("w1");
    const fa = f.rooms.find((r) => r.id === "a")!;
    const host = o.host as { roomId: string; edge: number };
    const pa = fa.polygon[host.edge];
    const pb = fa.polygon[(host.edge + 1) % fa.polygon.length];
    expect(dist(pa, pb)).toBeCloseTo(40, 0);
    expect(o.offsetIn).toBeCloseTo(20, 0);
    // The other room breaks its side of the wall at the same two points.
    const fb = f.rooms.find((r) => r.id === "b")!;
    const has = (q: Point) => fb.polygon.some((x) => dist(x, q) < 0.02);
    expect(has(pa) && has(pb)).toBe(true);
    void b;
  });

  it("splits a curved loose wall into pieces and moves its door onto one", () => {
    const wall = { id: "w", a: { x: 0, y: 0 }, b: { x: 120, y: 0 }, thicknessIn: 4.5, bulge: 20 };
    const door: Opening = { id: "d", host: { wallId: "w" }, offsetIn: wallLength(wall) / 2, kind: "door", style: "door-hinged", widthIn: 32, heightIn: 80, side: 1, hinge: "start" };
    const f = flatPlan(plan([], { walls: [wall], openings: [door] }));
    expect(f.walls.length).toBeGreaterThan(3);
    expect(f.walls.every((w) => w.bulge === undefined)).toBe(true);
    const host = (f.openings[0].host as { wallId: string }).wallId;
    const piece = f.walls.find((w) => w.id === host)!;
    expect(dist(piece.a, piece.b)).toBeCloseTo(36, 0);
  });

  it("flattens a whole project once, and only when something curves", () => {
    const p = project({ [MAIN_LEVEL_ID]: plan([room("a", 0, 0, 120, 120)]) });
    expect(flatProject(p)).toBe(p);
    const c = project({ [MAIN_LEVEL_ID]: plan([roundRoom("r", { x: 0, y: 0 }, 120)]) });
    expect(flatProject(c)).not.toBe(c);
    expect(flatProject(c)).toBe(flatProject(c));
  });
});

describe("editing keeps curves with their walls", () => {
  const base = () => plan([roundRoom("r", { x: 0, y: 0 }, 120)]);

  it("splits a curved edge into two curves on the same circle", () => {
    const before = base();
    const r = before.rooms[0];
    const next = insertCorner(before, "r", 0, { x: 60, y: -60 }).rooms[0];
    expect(next.polygon.length).toBe(5);
    // Corners and bows are saved to a tenth of an inch, so the area moves a hair.
    expect(Math.abs(roomArea(next) / roomArea(r) - 1)).toBeLessThan(0.001);
    for (const p of next.polygon) expect(Math.hypot(p.x, p.y)).toBeCloseTo(120, 0);
  });

  it("straightens the wall left when a corner goes", () => {
    const next = removeCorner(base(), "r", 1).rooms[0];
    expect(next.polygon.length).toBe(3);
    expect(next.bulges![0]).toBe(0);
    expect(next.bulges![1]).not.toBe(0);
  });

  it("keeps bulges with their edges when corners are reordered", () => {
    const sq = room("s", 0, 0, 120, 120);
    const e = edgeAtX(sq, 120);
    const curved = plan([{ ...sq, bulges: sq.polygon.map((_, i) => (i === e ? 30 : 0)) }]);
    const area = roomArea(curved.rooms[0]);
    const reshaped = reshapeRoom(curved, "s", [...sq.polygon].reverse()).rooms[0];
    expect(roomArea(reshaped)).toBeCloseTo(area, 3);
    const mirrored = mirrorMany(curved, ["s"], "left-right").rooms[0];
    expect(roomArea(mirrored)).toBeCloseTo(area, 3);
    // The curve moved to the left side, still bowing out.
    const me = edgeAtX(mirrored, 0);
    expect(mirrored.bulges![me]).toBe(30);
  });

  it("stretches a curved edge to a length along the curve", () => {
    const sq = room("s", 0, 0, 120, 120);
    const e = edgeAtX(sq, 120);
    const curved = plan([{ ...sq, bulges: sq.polygon.map((_, i) => (i === e ? 20 : 0)) }]);
    const next = setEdgeLength(curved, "s", e, 180).rooms[0];
    expect(roomEdgeLength(next, e)).toBeCloseTo(180, 0);
  });
});

describe("the rest of the app on a curved house", () => {
  const plans = { [MAIN_LEVEL_ID]: plan([roundRoom("round", { x: 0, y: 0 }, 15 * FT)]) };

  it("builds walls and a sloped roof in 3D", () => {
    const c = ctx(plans);
    const model = buildHouse(plans, c);
    expect(model.parts.length).toBeGreaterThan(0);
    expect(model.roofFellBack).toBe(false);
    const roofs = buildRoofs(plans, { ...c, heights: levelHeights(c.levels, c.basics) });
    expect(roofs.fellBack).toBe(false);
    expect(roofs.parts.length).toBeGreaterThan(0);
  });

  it("counts the true length of curved outside walls in the cost", () => {
    const straight = { [MAIN_LEVEL_ID]: plan([roundRoom("round", { x: 0, y: 0 }, 15 * FT, false)]) };
    const curved = measurePlan(project(plans))!;
    const flatWalls = measurePlan(project(straight))!;
    const ratio = (2 * Math.PI * 180) / (4 * Math.SQRT2 * 180);
    expect(curved.extWallSqft / flatWalls.extWallSqft).toBeCloseTo(ratio, 1);
  });

  it("draws the PDF set and runs the code checks", () => {
    const p = project(plans);
    const set = buildSet(p);
    expect(set.some((s) => s.number === "A-101")).toBe(true);
    expect(() => codeReport(p)).not.toThrow();
  });
});

describe("saved data", () => {
  it("opens a version 19 project with every wall straight", () => {
    const p = project({ [MAIN_LEVEL_ID]: plan([room("a", 0, 0, 120, 120)]) });
    const old = JSON.parse(JSON.stringify({ ...p, schemaVersion: 19 }));
    const m = migrateProject(old);
    expect(m.schemaVersion).toBe(20);
    expect(m.floorPlans[MAIN_LEVEL_ID].rooms[0].bulges).toBeUndefined();
  });

  it("keeps curves through saving and opening", () => {
    const p = project({ [MAIN_LEVEL_ID]: plan([roundRoom("r", { x: 0, y: 0 }, 120)], { walls: [{ id: "w", a: { x: 0, y: 0 }, b: { x: 60, y: 0 }, thicknessIn: 4.5, bulge: 10 }] }) });
    const m = migrateProject(JSON.parse(JSON.stringify(p)));
    expect(m.floorPlans[MAIN_LEVEL_ID].rooms[0].bulges).toEqual(p.floorPlans[MAIN_LEVEL_ID].rooms[0].bulges);
    expect(m.floorPlans[MAIN_LEVEL_ID].walls[0].bulge).toBe(10);
  });
});
