import { describe, expect, it } from "vitest";
import { DEFAULT_LABELS, distanceGuides, formatLength, labelOn, openingGuides, outsideDimensions, roomSizeText, tapeReading, wallSegments } from "@/lib/plan/labels";
import { DiscoveryAnswers, Project, SCHEMA_VERSION, type ChosenRoom, type FloorPlan, type PlanRoom, type Point } from "@/lib/model/schema";
import { createProject, migrateProject } from "@/lib/model/project";
import { FLAT_PLOT_SEED, generatePlot } from "@/lib/land/generate";
import { buildRuleBrief } from "@/lib/brief/rules";
import { levelFor, levelsFor } from "@/lib/brief/levels";
import { roomType } from "@/lib/brief/rooms";
import { suggestDiagrams } from "@/lib/bubbles/arrange";
import { FREE_COLOR, emptyDiagram, outlineShape, type Bubble } from "@/lib/bubbles/shapes";
import { ceilingFor, defaultBasics, riseBetween } from "@/lib/plan/basics";
import {
  emptyPlan,
  insertCorner,
  makeRoom,
  moveEdge,
  moveMany,
  moveOpeningTo,
  removeCorner,
  removeMany,
  insertGluedCorner,
  rotateMany,
  setCornerGlued,
  setEdgeLength,
  updateOpening,
} from "@/lib/plan/edit";
import { sharedWall } from "@/lib/plan/connect";
import { alignEdges, compact, fitInside, plansFromSketch, resolveOverlaps, straightenOutline } from "@/lib/plan/fromSketch";
import { overhangsOf, supportOf } from "@/lib/plan/support";
import { collinearOverlap, dist, edgesOf, isRectangle, polygonArea, polygonsOverlap, rectangle, signedArea, subtractIntervals } from "@/lib/plan/geometry";
import { houseTotals, planTotals, roomSqft } from "@/lib/plan/measure";
import { snapAngles, snapMove, snapNode, snapPoint, snapPush, snapTargets } from "@/lib/plan/snap";
import { parseTypedLength } from "@/lib/model/units";
import { stairsDrawing, stepsFor } from "@/lib/plan/stairs";
import { nearestHost, openingGeometries, openingGeometry, solidWalls, wallPieces } from "@/lib/plan/walls";

const FT = 12;

/** A rectangular room from its top-left corner and size, in feet. */
function room(id: string, x: number, y: number, w: number, h: number, extra: Partial<PlanRoom> = {}): PlanRoom {
  return { ...makeRoom(rectangle((x + w / 2) * FT, (y + h / 2) * FT, w * FT, h * FT), id), id, ...extra };
}

function plan(rooms: PlanRoom[], extra: Partial<FloorPlan> = {}): FloorPlan {
  return { ...emptyPlan(), rooms, ...extra };
}

/** Two 10 ft by 10 ft rooms side by side, sharing the wall at x = 10 ft. */
const pair = () => plan([room("a", 0, 0, 10, 10), room("b", 10, 0, 10, 10)]);

describe("floor plan geometry", () => {
  it("keeps room corners clockwise on screen, whichever way they were drawn", () => {
    const ccw: Point[] = [
      { x: 0, y: 0 },
      { x: 0, y: 120 },
      { x: 120, y: 120 },
      { x: 120, y: 0 },
    ];
    expect(signedArea(makeRoom(ccw).polygon)).toBeGreaterThan(0);
  });

  it("finds where two edges lie along the same line", () => {
    expect(collinearOverlap({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 150, y: 0.5 }, { x: 40, y: 0.5 })).toEqual([40, 100]);
    expect(collinearOverlap({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 6 }, { x: 100, y: 6 })).toBeNull();
    expect(collinearOverlap({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 })).toBeNull();
  });

  it("cuts gaps out of a wall", () => {
    expect(subtractIntervals(100, [
      [20, 40],
      [70, 120],
    ])).toEqual([
      [0, 20],
      [40, 70],
    ]);
  });

  it("tells overlapping rooms from rooms that only touch", () => {
    const p = pair();
    expect(polygonsOverlap(p.rooms[0].polygon, p.rooms[1].polygon)).toBe(false);
    expect(polygonsOverlap(room("a", 0, 0, 10, 10).polygon, room("c", 5, 5, 10, 10).polygon)).toBe(true);
  });
});

describe("walls from rooms", () => {
  it("makes a shared edge one interior wall, and the rest outside walls", () => {
    const pieces = wallPieces(pair(), 6.5);
    const inside = pieces.filter((p) => !p.exterior);
    const outside = pieces.filter((p) => p.exterior);
    expect(inside).toHaveLength(1);
    expect(inside[0].thicknessIn).toBe(4.5);
    expect(dist(inside[0].a, inside[0].b)).toBeCloseTo(120);
    expect(outside.reduce((s, p) => s + dist(p.a, p.b), 0)).toBeCloseTo(60 * FT);
    expect(outside.every((p) => p.thicknessIn === 6.5)).toBe(true);
  });

  it("splits an edge that's only partly shared", () => {
    const p = plan([room("a", 0, 0, 10, 20), room("b", 10, 0, 10, 10)]);
    const east = wallPieces(p, 6.5).filter((w) => "roomId" in w.host && w.host.roomId === "a" && w.host.edge === 1);
    expect(east.map((w) => [w.exterior, Math.round(dist(w.a, w.b))])).toEqual([
      [false, 120],
      [true, 120],
    ]);
  });

  it("leaves a porch's open sides without walls, but walls it off from the house", () => {
    const p = plan([room("a", 0, 0, 10, 10, { type: "living" }), room("b", 10, 0, 10, 10, { type: "porch" })]);
    const pieces = wallPieces(p, 6.5);
    expect(pieces.filter((w) => w.open)).toHaveLength(3);
    const between = pieces.find((w) => !w.open && w.a.x === 120 && w.b.x === 120)!;
    expect(between.exterior).toBe(true);
  });

  it("cuts doors and windows out of the wall they sit in", () => {
    const p = pair();
    const door = { id: "d", host: { roomId: "a", edge: 1 }, offsetIn: 60, kind: "door", style: "door-hinged", widthIn: 32, heightIn: 80, side: 1, hinge: "start" } as const;
    const withDoor = { ...p, openings: [door] };
    const g = openingGeometry(withDoor, door)!;
    expect(g.center).toEqual({ x: 120, y: 60 });
    const solid = solidWalls(wallPieces(withDoor, 6.5), [g]).filter((w) => !w.exterior);
    expect(solid.map((w) => Math.round(dist(w.a, w.b)))).toEqual([44, 44]);
    // The cut ends aren't capped; the corner ends are.
    expect(solid.map((w) => [w.capA, w.capB])).toEqual([
      [true, false],
      [false, true],
    ]);
  });

  it("finds the nearest wall and which side of it a point is on", () => {
    const near = nearestHost(pair(), { x: 115, y: 50 }, 12)!;
    expect(Math.round(near.t)).toBe(50);
    expect(near.d).toBeCloseTo(5);
    expect(nearestHost(pair(), { x: 60, y: 60 }, 12)).toBeNull();
  });
});

describe("editing a floor plan", () => {
  it("keeps a rectangle square when one side gets a new length", () => {
    const p = setEdgeLength(pair(), "a", 0, 14 * FT);
    const a = p.rooms.find((r) => r.id === "a")!;
    expect(isRectangle(a.polygon)).toBe(true);
    expect(roomSqft(a)).toBe(140);
  });

  it("pushes a shared wall for both rooms", () => {
    const p = moveEdge(pair(), "a", 1, { x: 24, y: 0 });
    const [a, b] = p.rooms;
    expect(roomSqft(a)).toBe(120);
    expect(roomSqft(b)).toBe(80);
    expect(polygonsOverlap(a.polygon, b.polygon)).toBe(false);
    expect(wallPieces(p, 6.5).filter((w) => !w.exterior)).toHaveLength(1);
  });

  it("moves doors with their room, and fixtures that belong to it", () => {
    const base = pair();
    const p0: FloorPlan = {
      ...base,
      openings: [{ id: "d", host: { roomId: "b", edge: 2 }, offsetIn: 60, kind: "door", style: "door-hinged", widthIn: 32, heightIn: 80, side: -1, hinge: "start" }],
      fixtures: [
        { id: "f1", kind: "toilet", x: 180, y: 60, rotation: 0, widthIn: 20, depthIn: 28, roomId: "b" },
        { id: "f2", kind: "toilet", x: 60, y: 60, rotation: 0, widthIn: 20, depthIn: 28, roomId: "a" },
      ],
    };
    const p = moveMany(p0, ["b"], 0, 36);
    expect(openingGeometry(p, p.openings[0])!.center.y).toBe(120 + 36);
    expect(p.fixtures.map((f) => f.y)).toEqual([96, 60]);
  });

  it("turns rooms with their fixtures", () => {
    const p0: FloorPlan = { ...plan([room("a", 0, 0, 20, 10)]), fixtures: [{ id: "f", kind: "tub", x: 30, y: 60, rotation: 0, widthIn: 60, depthIn: 30, roomId: "a" }] };
    const p = rotateMany(p0, ["a"], 90, { x: 120, y: 60 });
    const xs = p.rooms[0].polygon.map((q) => q.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(120);
    expect(p.fixtures[0]).toMatchObject({ x: 120, y: -30, rotation: 90 });
  });

  it("keeps doors where they were when corners are added or taken away", () => {
    const base = pair();
    const p0: FloorPlan = { ...base, openings: [{ id: "d", host: { roomId: "a", edge: 2 }, offsetIn: 30, kind: "door", style: "door-hinged", widthIn: 32, heightIn: 80, side: -1, hinge: "start" }] };
    const before = openingGeometry(p0, p0.openings[0])!.center;
    const p1 = insertCorner(p0, "a", 2, { x: 60, y: 120 });
    expect(p1.rooms[0].polygon).toHaveLength(5);
    expect(openingGeometry(p1, p1.openings[0])!.center).toEqual(before);
    const p2 = removeCorner(p1, "a", 3);
    expect(p2.rooms[0].polygon).toHaveLength(4);
    expect(openingGeometry(p2, p2.openings[0])!.center).toEqual(before);
  });

  it("slides a door along its wall, or onto another wall nearby, and keeps it inside the wall", () => {
    const p0: FloorPlan = { ...pair(), openings: [{ id: "d", host: { roomId: "a", edge: 1 }, offsetIn: 60, kind: "door", style: "door-hinged", widthIn: 32, heightIn: 80, side: 1, hinge: "start" }] };
    const along = moveOpeningTo(p0, "d", { x: 130, y: 500 }, 12);
    expect(along.openings[0].offsetIn).toBe(120 - 16);
    const other = moveOpeningTo(p0, "d", { x: 60, y: 3 }, 12);
    expect(other.openings[0].host).toEqual({ roomId: "a", edge: 0 });
    const wide = updateOpening(p0, "d", { widthIn: 200 });
    expect(wide.openings[0].offsetIn).toBe(60);
  });

  it("deletes doors with their room, and lets fixtures stay", () => {
    const p0: FloorPlan = {
      ...pair(),
      openings: [{ id: "d", host: { roomId: "a", edge: 1 }, offsetIn: 60, kind: "door", style: "door-hinged", widthIn: 32, heightIn: 80, side: 1, hinge: "start" }],
      fixtures: [{ id: "f", kind: "toilet", x: 60, y: 60, rotation: 0, widthIn: 20, depthIn: 28, roomId: "a" }],
    };
    const p = removeMany(p0, ["a"]);
    expect(p.rooms.map((r) => r.id)).toEqual(["b"]);
    expect(p.openings).toEqual([]);
    expect(p.fixtures[0].roomId).toBeUndefined();
  });
});

describe("snapping", () => {
  const targets = snapTargets(pair());

  it("snaps to a corner, then to lining up with one, then to the grid", () => {
    expect(snapPoint({ x: 117, y: 3 }, targets, 8, true)).toMatchObject({ p: { x: 120, y: 0 }, on: "corner" });
    expect(snapPoint({ x: 238, y: 300 }, targets, 8, true).p).toEqual({ x: 240, y: 300 });
    expect(snapPoint({ x: 400, y: 401 }, targets, 8, true).p).toEqual({ x: 402, y: 402 });
    expect(snapPoint({ x: 400, y: 401 }, targets, 8, false).p).toEqual({ x: 400, y: 401 });
  });

  it("snaps a move so corners line up", () => {
    const m = snapMove([{ x: 0, y: 0 }], [{ x: 240, y: 0 }], 236, 50, 8, true);
    expect(m.dx).toBe(240);
    expect(m.dy).toBe(48);
  });

  it("snaps a pushed wall to line up with a corner", () => {
    const { d, n } = snapPush({ x: 0, y: 0 }, { x: 0, y: 120 }, { x: -5, y: 0 }, [{ x: -6, y: 300 }], 8, true);
    expect(n.x * d).toBe(-6);
  });
});

describe("stairs", () => {
  it("are sized from how far they climb", () => {
    const rise = riseBetween(defaultBasics(), levelFor("floor-1"), levelFor("floor-2"));
    expect(rise).toBe(108 + 13);
    const steps = stepsFor(rise);
    expect(steps.risers).toBe(16);
    expect(steps.riserIn).toBeLessThanOrEqual(7.75);
    const d = stairsDrawing({ x: 0, y: 0, rotation: 0, widthIn: 40, shape: "straight", flip: false }, rise);
    expect(d.runIn).toBe(15 * 10);
    expect(Math.round(polygonArea(d.footprint))).toBe(40 * 150);
  });

  it("take less length when they turn", () => {
    const rise = 121;
    const straight = stairsDrawing({ x: 0, y: 0, rotation: 0, widthIn: 40, shape: "straight", flip: false }, rise);
    for (const shape of ["l", "u"] as const) {
      const d = stairsDrawing({ x: 0, y: 0, rotation: 0, widthIn: 40, shape, flip: false }, rise);
      const ys = d.footprint.map((p) => p.y);
      expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(150);
      expect(d.runIn).toBeLessThan(straight.runIn);
    }
  });

  it("taller ceilings make longer stairs", () => {
    const b = { ...defaultBasics(), ceilings: { "floor-1": 120 } };
    expect(riseBetween(b, levelFor("floor-1"), levelFor("floor-2"))).toBe(133);
    expect(ceilingFor(null, levelFor("floor-2"))).toBe(96);
  });
});

describe("turning the flow sketch into a plan", () => {
  let n = 0;
  const pick = (type: string, extra: Partial<ChosenRoom> = {}): ChosenRoom => ({ id: `r${++n}`, type, name: roomType(type).label, description: "", ...extra });
  const flat = generatePlot(FLAT_PLOT_SEED, { flat: true });

  function sample(floors = 1) {
    const rooms = [pick("entry"), pick("kitchen"), pick("dining"), pick("living"), pick("pantry"), pick("mudroom"), pick("primary-bedroom"), pick("bathroom"), pick("garage")];
    if (floors > 1) rooms.push(pick("bedroom", { levelId: "floor-2" }), pick("bedroom", { levelId: "floor-2", name: "Bedroom 2" }), pick("bathroom", { levelId: "floor-2", name: "Upstairs bath" }));
    const answers = DiscoveryAnswers.parse({ rooms, floorsAbove: floors, floorsBelow: 0 });
    const brief = buildRuleBrief({ answers, profile: { mustHaves: [], dislikes: [] }, plot: flat });
    const levels = levelsFor(brief.floors, brief.floorsBelow);
    const diagrams = suggestDiagrams({ brief, plot: flat, levels });
    return { brief, levels, diagrams };
  }

  it("makes one room per bubble, each about the bubble's size, with no overlaps", () => {
    const { brief, levels, diagrams } = sample();
    const { plans } = plansFromSketch(diagrams, { brief, plot: flat, levels, basics: defaultBasics() });
    const main = plans["floor-1"];
    const bubbles = diagrams["floor-1"].bubbles.filter((b) => !b.stairs);
    expect(main.rooms).toHaveLength(bubbles.length);
    for (const b of bubbles) {
      const r = main.rooms.find((x) => x.briefRoomId === b.roomId)!;
      expect(r.name).toBe(b.label);
      const want = (Math.PI * b.rx * b.ry) / 144;
      expect(Math.abs(roomSqft(r) - want) / want).toBeLessThan(0.3);
    }
    for (let i = 0; i < main.rooms.length; i++) {
      for (let j = i + 1; j < main.rooms.length; j++) expect(polygonsOverlap(main.rooms[i].polygon, main.rooms[j].polygon)).toBe(false);
    }
  });

  it("pushes rooms together so most share walls, with doors between connected rooms", () => {
    const { brief, levels, diagrams } = sample();
    const { plans, needHall } = plansFromSketch(diagrams, { brief, plot: flat, levels, basics: defaultBasics() });
    const main = plans["floor-1"];
    const touching = main.rooms.filter((r) => main.rooms.some((o) => o !== r && sharedWall(r, o)));
    expect(touching.length).toBe(main.rooms.length);
    const flows = diagrams["floor-1"].flows.filter((f) => !f.from.startsWith("stairs") && !f.to.startsWith("stairs"));
    const inside = main.openings.filter((o) => o.style !== "door-entry" && o.style !== "door-garage");
    expect(inside.length + needHall.length).toBe(flows.length);
    expect(inside.length).toBeGreaterThan(0);
  });

  it("adds a front door and a garage door facing the road", () => {
    const { brief, levels, diagrams } = sample();
    const { plans } = plansFromSketch(diagrams, { brief, plot: flat, levels, basics: defaultBasics() });
    const main = plans["floor-1"];
    expect(main.openings.filter((o) => o.style === "door-entry")).toHaveLength(1);
    const garage = main.openings.find((o) => o.style === "door-garage")!;
    const g = openingGeometry(main, garage)!;
    // The road is on the south side of the flat plot; outside is to the left of a room edge.
    expect(flat.roadSide).toBe("S");
    expect(g.n.y).toBeCloseTo(1);
  });

  it("puts stairs in the same spot on both floors, and rooms make way for them", () => {
    const { brief, levels, diagrams } = sample(2);
    const { plans } = plansFromSketch(diagrams, { brief, plot: flat, levels, basics: defaultBasics() });
    const st = plans["floor-1"].stairs[0];
    expect(st.toLevelId).toBe("floor-2");
    expect(plans["floor-2"].stairs).toHaveLength(0);
    const d = stairsDrawing(st, riseBetween(defaultBasics(), levelFor("floor-1"), levelFor("floor-2")));
    for (const level of ["floor-1", "floor-2"]) {
      for (const r of plans[level].rooms) expect(polygonsOverlap(r.polygon, d.footprint, 2)).toBe(false);
    }
  });

  it("keeps a room drawn in any shape, with straight walls", () => {
    const wobbly: Point[] = [];
    for (let i = 0; i < 60; i++) {
      const t = (i / 60) * Math.PI * 2;
      wobbly.push({ x: Math.cos(t) * 120, y: Math.sin(t) * 80 });
    }
    const b: Bubble = { id: "nook", label: "Nook", shape: "free", ...outlineShape(wobbly), rotation: 0, color: FREE_COLOR };
    const levels = levelsFor(1, 0);
    const { plans } = plansFromSketch({ "floor-1": { ...emptyDiagram(), bubbles: [b] } }, { brief: null, plot: null, levels, basics: null });
    const r = plans["floor-1"].rooms[0];
    expect(r.polygon.length).toBeGreaterThan(5);
    expect(r.polygon.length).toBeLessThan(30);
    expect(Math.abs(polygonArea(r.polygon) - Math.PI * 120 * 80) / (Math.PI * 120 * 80)).toBeLessThan(0.1);
  });

  it("straightens a shaky outline into a few corners", () => {
    const square: Point[] = [];
    for (let i = 0; i <= 40; i++) square.push({ x: i * 3, y: i % 2 });
    for (let i = 0; i <= 40; i++) square.push({ x: 120 + (i % 2), y: i * 3 });
    for (let i = 0; i <= 40; i++) square.push({ x: 120 - i * 3, y: 120 });
    for (let i = 0; i <= 40; i++) square.push({ x: 0, y: 120 - i * 3 });
    expect(straightenOutline(square, 6)).toHaveLength(4);
  });

  it("packs rectangles: separates overlaps, then pulls them together", () => {
    const rects = [
      { id: "a", x0: 0, y0: 0, x1: 100, y1: 100, fixed: false },
      { id: "b", x0: 150, y0: 4, x1: 250, y1: 108, fixed: false },
      { id: "c", x0: 50, y0: 50, x1: 120, y1: 120, fixed: false },
    ];
    resolveOverlaps(rects);
    compact(rects, { x: 120, y: 60 });
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const overlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.5 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.5;
        expect(overlap).toBe(false);
      }
    }
    // The rooms end up touching, with no gaps between them.
    const touching = (a: (typeof rects)[number], b: (typeof rects)[number]) =>
      (Math.abs(a.x1 - b.x0) < 0.5 || Math.abs(b.x1 - a.x0) < 0.5 || Math.abs(a.y1 - b.y0) < 0.5 || Math.abs(b.y1 - a.y0) < 0.5) &&
      Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) >= -0.5 &&
      Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) >= -0.5;
    expect(rects.every((r) => rects.some((o) => o !== r && touching(r, o)))).toBe(true);
  });

  it("lays out the upper floor on top of the floor below", () => {
    const { brief, levels, diagrams } = sample(2);
    // The sketch spreads the upstairs bubbles wider than the main floor.
    const { plans, notes } = plansFromSketch(diagrams, { brief, plot: flat, levels, basics: defaultBasics() });
    const upper = levels.find((l) => l.id === "floor-2")!;
    const support = supportOf(plans, levels, upper)!;
    expect(support.below.id).toBe("floor-1");
    expect(plans["floor-2"].rooms).toHaveLength(diagrams["floor-2"].bubbles.filter((b) => !b.stairs).length);
    expect(overhangsOf(plans["floor-2"].rooms, support.regions)).toEqual([]);
    expect(notes).toEqual([]);
    const up = plans["floor-2"].rooms;
    for (let i = 0; i < up.length; i++) for (let j = i + 1; j < up.length; j++) expect(polygonsOverlap(up[i].polygon, up[j].polygon)).toBe(false);
  });

  it("makes an upper floor's rooms smaller when they need more room than the floor below, and says so", () => {
    const bubble = (id: string, x: number, y: number, ft: number) => ({ id, label: id, shape: "circle" as const, x, y, rx: (ft * FT) / 2, ry: (ft * FT) / 2, rotation: 0 });
    const levels = levelsFor(2, 0);
    const diagrams = {
      "floor-1": { ...emptyDiagram(), bubbles: [bubble("Kitchen", 0, 0, 16)] },
      "floor-2": { ...emptyDiagram(), bubbles: [bubble("Bed A", -150, 0, 14), bubble("Bed B", 150, 0, 14), bubble("Bath", 0, 150, 10)] },
    };
    const { plans, notes } = plansFromSketch(diagrams, { brief: null, plot: null, levels, basics: null });
    const support = supportOf(plans, levels, levels[1])!;
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/^The second floor needs [\d,]+ sq ft but the main floor is \d+ sq ft/);
    expect(notes[0]).toMatch(/Hangs over the floor below/);
    expect(plans["floor-2"].rooms).toHaveLength(3);
    expect(overhangsOf(plans["floor-2"].rooms, support.regions)).toEqual([]);
    const up = plans["floor-2"].rooms;
    for (let i = 0; i < up.length; i++) for (let j = i + 1; j < up.length; j++) expect(polygonsOverlap(up[i].polygon, up[j].polygon)).toBe(false);
  });

  it("moves rooms out of the notch of an L-shaped floor below", () => {
    // An L: 30 ft by 30 ft with the top right 15 ft by 15 ft missing.
    const L = [
      { x: 0, y: 0 },
      { x: 180, y: 0 },
      { x: 180, y: 180 },
      { x: 360, y: 180 },
      { x: 360, y: 360 },
      { x: 0, y: 360 },
    ];
    const rects = [
      { id: "in-notch", x0: 220, y0: 20, x1: 340, y1: 140, fixed: false },
      { id: "sticks-out", x0: -60, y0: 200, x1: 100, y1: 320, fixed: false },
    ];
    fitInside(rects, [{ outline: L, holes: [] }]);
    const regions = [{ outline: L, holes: [] }];
    const rooms = rects.map((r) => ({ ...makeRoom(rectangle((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, r.x1 - r.x0, r.y1 - r.y0), r.id), id: r.id }));
    expect(overhangsOf(rooms, regions)).toEqual([]);
    // Neither was shrunk: they fit.
    for (const r of rects) expect(r.x1 - r.x0).toBe(120 + (r.id === "sticks-out" ? 40 : 0));
  });

  it("lines up edges that nearly line up, without squashing rooms", () => {
    const rects = [
      { id: "a", x0: 0, y0: 0, x1: 100, y1: 100, fixed: false },
      { id: "b", x0: 100, y0: 6, x1: 200, y1: 108, fixed: false },
      { id: "c", x0: 0, y0: 100, x1: 40, y1: 140, fixed: false },
    ];
    alignEdges(rects);
    expect(rects[0].y0).toBe(rects[1].y0);
    expect(rects[0].y1).toBe(rects[1].y1);
    expect(rects[2].y1 - rects[2].y0).toBeGreaterThanOrEqual(30);
  });
});

describe("areas", () => {
  it("count garages and outdoor rooms apart from living space", () => {
    const p = plan([room("a", 0, 0, 10, 10, { type: "living" }), room("g", 10, 0, 20, 20, { type: "garage" }), room("d", 0, 10, 10, 10, { type: "deck" })]);
    expect(planTotals(p)).toEqual({ living: 100, garage: 400, outdoor: 100 });
    expect(houseTotals([p, p]).living).toBe(200);
  });
});

describe("saved projects", () => {
  it("open older saves with an empty floor plan and default plan settings", () => {
    const p = createProject("Old");
    const older = { ...p, schemaVersion: 3, floorPlans: { "floor-1": { ceilingHeightIn: 108, walls: [], openings: [], rooms: [], stairs: [], fixtures: [], furniture: [] } } } as Record<string, unknown>;
    delete older.plan;
    const migrated = migrateProject(older);
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.floorPlans).toEqual({});
    expect(migrated.plan).toEqual({ basics: null, showSketch: false, labels: DEFAULT_LABELS });
  });

  it("round-trip a floor plan", () => {
    const p = { ...createProject("Plan"), floorPlans: { "floor-1": pair() }, plan: { basics: defaultBasics(), showSketch: true, labels: { ...DEFAULT_LABELS, wallLengths: false } } };
    expect(Project.safeParse(p).success).toBe(true);
    expect(migrateProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });
});

describe("reshaping with nodes", () => {
  // Room a is 0-120 wide, b sits right of it (120-240); they share the wall at x = 120.
  const corner = (p: FloorPlan, id: string, x: number, y: number) => p.rooms.find((r) => r.id === id)!.polygon.findIndex((q) => q.x === x && q.y === y);

  it("moves a neighbor's corner along with a dragged corner, unless detached", () => {
    const p = pair();
    const i = corner(p, "a", 120, 0);
    const glued = setCornerGlued(p, "a", i, { x: 120, y: -30 });
    expect(glued.rooms.find((r) => r.id === "b")!.polygon.some((q) => q.x === 120 && q.y === -30)).toBe(true);
    const alone = setCornerGlued(p, "a", i, { x: 120, y: -30 }, false);
    expect(alone.rooms.find((r) => r.id === "b")!.polygon.some((q) => q.y === -30)).toBe(false);
  });

  it("puts a new node in both rooms on a shared wall", () => {
    const p = pair();
    const edge = edgesOf(p.rooms.find((r) => r.id === "a")!.polygon).find((e) => e.a.x === 120 && e.b.x === 120)!.i;
    const { plan: next, index } = insertGluedCorner(p, "a", edge, { x: 120, y: 60 });
    expect(next.rooms.find((r) => r.id === "a")!.polygon).toHaveLength(5);
    expect(next.rooms.find((r) => r.id === "b")!.polygon).toHaveLength(5);
    expect(next.rooms.find((r) => r.id === "a")!.polygon[index]).toEqual({ x: 120, y: 60 });
    const pulled = setCornerGlued(next, "a", index, { x: 150, y: 60 });
    expect(pulled.rooms.find((r) => r.id === "b")!.polygon.some((q) => q.x === 150 && q.y === 60)).toBe(true);
  });

  it("snaps to 90 and 45 degree lines from neighbors, and not at all with Shift", () => {
    const t = snapTargets(emptyPlan());
    const up = snapNode({ x: 3, y: -98 }, [{ x: 0, y: 0 }], t, 9, false, false);
    expect(up.p.x).toBeCloseTo(0, 5);
    const diag = snapNode({ x: 101, y: 98 }, [{ x: 0, y: 0 }], t, 9, false, false);
    expect(diag.p.x).toBeCloseTo(diag.p.y, 5);
    const both = snapAngles({ x: 98, y: 103 }, [{ x: 0, y: 100 }, { x: 100, y: 0 }], 9);
    expect(both!.x).toBeCloseTo(100, 5);
    expect(both!.y).toBeCloseTo(100, 5);
    expect(snapNode({ x: 3, y: -98 }, [{ x: 0, y: 0 }], t, 9, false, true).p).toEqual({ x: 3, y: -98 });
  });

  it("reads typed lengths: feet and inches, or inches alone", () => {
    expect(parseTypedLength("12'6")).toBe(150);
    expect(parseTypedLength("150")).toBe(150);
    expect(parseTypedLength("12'")).toBe(144);
    expect(parseTypedLength("abc")).toBeNull();
  });
});

describe("labels and measurements", () => {
  it("writes a rectangle's size, and the longest width and depth for other shapes", () => {
    expect(roomSizeText(room("a", 0, 0, 12.5, 14).polygon)).toBe("12' 6\" × 14'");
    expect(roomSizeText(room("a", 0, 0, 12.5, 14).polygon, "inches")).toBe('150" × 168"');
    const l = [{ x: 0, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 120 }, { x: 120, y: 120 }, { x: 120, y: 240 }, { x: 0, y: 240 }];
    expect(roomSizeText(l)).toBe("20' × 20'");
    expect(formatLength(150, "inches")).toBe('150"');
  });

  it("strings dimensions around the outside, each room's stretch and the overall length", () => {
    const dims = outsideDimensions(pair());
    const top = dims.filter((d) => d.side === "top");
    expect(top.filter((d) => d.row === 1).map((d) => d.text)).toEqual(["10'", "10'"]);
    expect(top.find((d) => d.row === 2)?.text).toBe("20'");
    const left = dims.filter((d) => d.side === "left");
    expect(left).toHaveLength(1);
    expect(left[0].text).toBe("10'");
    expect(top[0].a.y).toBeLessThan(0);
  });

  it("measures from a moved box to the nearest wall on each side", () => {
    const p = plan([room("a", 0, 0, 20, 20), room("b", 4, 4, 4, 4)]);
    const guides = distanceGuides({ x0: 48, y0: 48, x1: 96, y1: 96 }, wallSegments(p, ["b"]));
    expect(guides.map((g) => Math.round(g.inches)).sort((x, y) => x - y)).toEqual([48, 48, 144, 144]);
  });

  it("shows how far a door sits from the corners of its wall", () => {
    const p = { ...pair(), openings: [{ id: "o1", host: { roomId: "a", edge: 0 }, offsetIn: 36, kind: "door" as const, style: "door-hinged", widthIn: 32, heightIn: 80, side: 1 as const, hinge: "start" as const }] };
    const g = openingGeometries(p)[0];
    const gaps = openingGuides(g).map((x) => Math.round(x.inches));
    expect(gaps).toEqual([20, 68]);
  });

  it("reads a tape's distance and angle", () => {
    const r = tapeReading({ x: 0, y: 0 }, { x: 120, y: 0 });
    expect(r).toEqual({ inches: 120, angle: 0 });
    expect(tapeReading({ x: 0, y: 0 }, { x: 0, y: -60 }).angle).toBe(90);
  });
});

describe("label settings in saved data", () => {
  it("carry the old Show wall lengths choice over", () => {
    const p = createProject("Old");
    const off = { ...p, schemaVersion: 14, plan: { basics: null, showSketch: false, showDims: false } } as Record<string, unknown>;
    expect(migrateProject(off).plan.labels).toEqual({ ...DEFAULT_LABELS, wallLengths: false });
    const on = { ...p, schemaVersion: 14, plan: { basics: null, showSketch: true, showDims: true } } as Record<string, unknown>;
    const m = migrateProject(on);
    expect(m.plan.labels).toEqual(DEFAULT_LABELS);
    expect(m.plan.showSketch).toBe(true);
    expect("showDims" in m.plan).toBe(false);
    expect(m.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("start with every label showing", () => {
    expect(createProject("New").plan.labels).toEqual(DEFAULT_LABELS);
    expect(labelOn({ ...DEFAULT_LABELS, hideAll: true }, "roomNames")).toBe(false);
    expect(labelOn(DEFAULT_LABELS, "roomNames")).toBe(true);
  });
});
