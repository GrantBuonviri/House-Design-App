import { describe, expect, it } from "vitest";
import { House3D, SCHEMA_VERSION, type FloorPlan, type PlanRoom, type PlanWall, type Project } from "@/lib/model/schema";
import { createProject, migrateProject } from "@/lib/model/project";
import { MAIN_LEVEL_ID } from "@/lib/brief/levels";
import { emptyPlan, makeRoom } from "@/lib/plan/edit";
import { polygonArea, rectangle } from "@/lib/plan/geometry";
import { newOpening } from "@/lib/plan/connect";
import { fillOutline, fillRoomAt, splitRoom, whyNotFill } from "@/lib/plan/partitions";
import { openingGeometry, wallPieces } from "@/lib/plan/walls";
import { buildLevel } from "@/lib/house3d/build";
import { levelHeights } from "@/lib/house3d/levels";
import { siteFor } from "@/lib/house3d/site";
import { walkWorld } from "@/lib/house3d/walk";
import { measurePlan } from "@/lib/cost/quantities";
import { floorPlanSheet } from "@/lib/plans/sheets/floorPlan";
import { describeChange } from "@/lib/store/describe";
import { defaultBasics } from "@/lib/plan/basics";
import { house, RANCH } from "./samples";

const FT = 12;
const ROOF = House3D.parse({}).roof;

function room(id: string, x: number, y: number, w: number, h: number, extra: Partial<PlanRoom> = {}): PlanRoom {
  return { ...makeRoom(rectangle((x + w / 2) * FT, (y + h / 2) * FT, w * FT, h * FT), id), id, type: "bedroom", ...extra };
}
const plan = (rooms: PlanRoom[], extra: Partial<FloorPlan> = {}): FloorPlan => ({ ...emptyPlan(), rooms, ...extra });
const wall = (id: string, ax: number, ay: number, bx: number, by: number, extra: Partial<PlanWall> = {}): PlanWall => ({ id, a: { x: ax * FT, y: ay * FT }, b: { x: bx * FT, y: by * FT }, thicknessIn: 4.5, ...extra });
const pt = (x: number, y: number) => ({ x: x * FT, y: y * FT });

describe("splitting a room with a wall", () => {
  it("splits a room along a wall drawn from one side to the other", () => {
    const p = plan([room("a", 0, 0, 20, 12)]);
    const out = splitRoom(p, [pt(14, 0), pt(14, 12)])!;
    expect(out).not.toBeNull();
    expect(out.plan.rooms).toHaveLength(2);
    const kept = out.plan.rooms.find((r) => r.id === "a")!;
    const made = out.plan.rooms.find((r) => r.id === out.newRoomId)!;
    // The bigger piece keeps the room; the new one waits for a name.
    expect(polygonArea(kept.polygon) / 144).toBeCloseTo(14 * 12);
    expect(polygonArea(made.polygon) / 144).toBeCloseTo(6 * 12);
    expect(kept.type).toBe("bedroom");
    expect(made.name).toBe("Room 2");
    // The new wall between them is an inside wall.
    const inside = wallPieces(out.plan, 6.5).filter((w) => !w.exterior && !w.open);
    expect(inside).toHaveLength(1);
    expect(inside[0].a.x).toBeCloseTo(14 * FT);
  });

  it("splits along a wall with turns, like an L-shaped closet", () => {
    const p = plan([room("a", 0, 0, 20, 12)]);
    const out = splitRoom(p, [pt(15, 0), pt(15, 5), pt(20, 5)])!;
    expect(out.plan.rooms).toHaveLength(2);
    const made = out.plan.rooms.find((r) => r.id === out.newRoomId)!;
    expect(polygonArea(made.polygon) / 144).toBeCloseTo(25);
  });

  it("leaves a shorter wall as a divider", () => {
    const p = plan([room("a", 0, 0, 20, 12)]);
    expect(splitRoom(p, [pt(14, 0), pt(14, 8)])).toBeNull();
    expect(splitRoom(p, [pt(4, 4), pt(10, 4)])).toBeNull();
  });

  it("keeps doors and windows where they were, on whichever room now has that wall", () => {
    const base = plan([room("a", 0, 0, 20, 12)]);
    // A window on the north wall at 17 ft along, in what becomes the small room.
    const north = base.rooms[0].polygon.findIndex((q, i, poly) => q.y === 0 && poly[(i + 1) % poly.length].y === 0);
    const start = base.rooms[0].polygon[north];
    const offset = Math.abs(17 * FT - start.x);
    const win = newOpening("window", { roomId: "a", edge: north }, offset, 1, 36);
    const p = { ...base, openings: [win] };
    const before = openingGeometry(p, win)!.center;
    const out = splitRoom(p, [pt(14, 0), pt(14, 12)])!;
    const o = out.plan.openings[0];
    expect("roomId" in o.host && o.host.roomId).toBe(out.newRoomId);
    const after = openingGeometry(out.plan, o)!.center;
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it("moves fixtures into the piece they stand in, and labels the undo", () => {
    const base = plan([room("a", 0, 0, 20, 12)], { fixtures: [{ id: "t", kind: "toilet", x: 18 * FT, y: 6 * FT, rotation: 0, widthIn: 20, depthIn: 28, roomId: "a" }] });
    const out = splitRoom(base, [pt(14, 0), pt(14, 12)])!;
    expect(out.plan.fixtures[0].roomId).toBe(out.newRoomId);
    const p = createProject("Split");
    const a: Project = { ...p, floorPlans: { [MAIN_LEVEL_ID]: { ...base, rooms: [{ ...base.rooms[0], name: "Bedroom" }] } } };
    const b: Project = { ...p, floorPlans: { [MAIN_LEVEL_ID]: out.plan } };
    expect(describeChange(a, b)).toBe("split Bedroom");
  });
});

describe("filling a space walls close in", () => {
  it("makes a room shaped to four walls", () => {
    const p = plan([], { walls: [wall("n", 0, 0, 10, 0), wall("e", 10, 0, 10, 8), wall("s", 10, 8, 0, 8), wall("w", 0, 8, 0, 0)] });
    expect(whyNotFill(p, pt(5, 4))).toBeNull();
    const out = fillRoomAt(p, pt(5, 4))!;
    expect(out.plan.rooms).toHaveLength(1);
    expect(polygonArea(out.plan.rooms[0].polygon) / 144).toBeCloseTo(80);
    // The walls became the room's walls.
    expect(out.plan.walls).toHaveLength(0);
  });

  it("uses an existing room's wall and keeps what sticks out", () => {
    // Walls off the east side of a room, the north one running on past the corner.
    const p = plan([room("a", 0, 0, 10, 10)], { walls: [wall("n", 10, 0, 18, 0), wall("e", 16, -2, 16, 10), wall("s", 16, 10, 10, 10)] });
    const out = fillRoomAt(p, pt(13, 5))!;
    expect(out).not.toBeNull();
    const made = out.plan.rooms.find((r) => r.id === out.roomId)!;
    expect(polygonArea(made.polygon) / 144).toBeCloseTo(60);
    // Only the bits past the new room are left as walls.
    const left = out.plan.walls.reduce((s, w) => s + Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y), 0) / FT;
    expect(left).toBeCloseTo(4);
  });

  it("ignores a divider poking into the space", () => {
    const p = plan([], { walls: [wall("n", 0, 0, 10, 0), wall("e", 10, 0, 10, 8), wall("s", 10, 8, 0, 8), wall("w", 0, 8, 0, 0), wall("d", 5, 0, 5, 3)] });
    const ring = fillOutline(p, pt(2, 5))!;
    expect(polygonArea(ring) / 144).toBeCloseTo(80);
  });

  it("explains when there's nothing closed in, or it's already a room", () => {
    const open = plan([], { walls: [wall("n", 0, 0, 10, 0), wall("e", 10, 0, 10, 8)] });
    expect(whyNotFill(open, pt(5, 4))).toMatch(/no closed space/);
    const p = plan([room("a", 0, 0, 10, 10, { name: "Den" })]);
    expect(whyNotFill(p, pt(5, 5))).toMatch(/already part of Den/);
  });
});

describe("half walls", () => {
  /** The sample ranch with a half wall in its biggest room. */
  function withHalf(height: PlanWall["height"]): Project {
    const p = house(RANCH);
    const id = p.levels[0].id;
    const fp = p.floorPlans[id];
    const big = fp.rooms.reduce((x, y) => (polygonArea(y.polygon) > polygonArea(x.polygon) ? y : x));
    const ys = big.polygon.map((q) => q.y);
    const xs = big.polygon.map((q) => q.x);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const w: PlanWall = { id: "half", a: { x: cx - 30, y: (Math.min(...ys) + Math.max(...ys)) / 2 }, b: { x: cx + 30, y: (Math.min(...ys) + Math.max(...ys)) / 2 }, thicknessIn: 4.5, height };
    return { ...p, floorPlans: { ...p.floorPlans, [id]: { ...fp, walls: [...fp.walls, w] } } };
  }
  const ctx = (p: Project) => ({ levels: p.levels, basics: p.plan.basics ?? defaultBasics(), house3d: { roof: ROOF }, site: siteFor(null, { x: 0, y: 0 }, p.floorPlans), frame: { ox: 0, oy: 0 }, heights: levelHeights(p.levels, p.plan.basics ?? defaultBasics()) });
  const tallest = (p: Project) => {
    const parts = buildLevel(p.floorPlans, p.levels[0], ctx(p)).filter((x) => x.layer === "walls" && x.wall === "inside");
    return parts;
  };

  it("stands 42 inches tall in 3D and the walkthrough, with a cap when asked", () => {
    const full = withHalf("full");
    const half = withHalf("half");
    const cap = withHalf("half-cap");
    const count = (p: Project) => tallest(p).reduce((s, x) => s + x.mesh.count, 0);
    // The cap is an extra box on top.
    expect(count(cap)).toBeGreaterThan(count(half));
    const blocker = (p: Project) => walkWorld(p.floorPlans, ctx(p)).blockers.find((b) => Math.abs(b.a.y - b.b.y) < 0.01 && Math.abs(Math.abs(b.a.x - b.b.x) - 60) < 0.5 && b.half === 2.25)!;
    const floorIn = levelHeights(half.levels, half.plan.basics ?? defaultBasics())[half.levels[0].id].floorIn;
    expect(blocker(half).z1 - floorIn).toBeCloseTo(42);
    expect(blocker(cap).z1 - floorIn).toBeCloseTo(43.5);
    expect(blocker(full).z1 - floorIn).toBeGreaterThan(80);
  });

  it("costs less framing and drywall than a full wall, and a cap adds counter", () => {
    const full = measurePlan(withHalf("full"))!;
    const half = measurePlan(withHalf("half"))!;
    const cap = measurePlan(withHalf("half-cap"))!;
    expect(half.intWallLf).toBeLessThan(full.intWallLf);
    expect(half.drywallSqft).toBeLessThan(full.drywallSqft);
    expect(cap.counterSqft).toBeGreaterThan(half.counterSqft);
  });

  it("has a note on the PDF floor plan", () => {
    const texts = (p: Project) => floorPlanSheet(p, p.levels[0]).items.flatMap((i) => (i.t === "text" ? [i.text] : []));
    expect(texts(withHalf("half"))).toContain('42" HALF WALL');
    expect(texts(withHalf("half-cap"))).toContain('42" HALF WALL W/ CAP');
    expect(texts(withHalf("full")).some((t) => t.includes("HALF WALL"))).toBe(false);
  });

  it("keeps old projects opening: version 16 walls become full height", () => {
    const old = { ...createProject("Old"), schemaVersion: 16, floorPlans: { [MAIN_LEVEL_ID]: { rooms: [], walls: [{ id: "w", a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, thicknessIn: 4.5 }], openWalls: [], openings: [], stairs: [], fixtures: [], furniture: [] } } };
    const p = migrateProject(old);
    expect(p.schemaVersion).toBe(SCHEMA_VERSION);
    expect(p.floorPlans[MAIN_LEVEL_ID].walls[0].height).toBe("full");
    expect(wallPieces(p.floorPlans[MAIN_LEVEL_ID], 6.5)[0].height).toBeUndefined();
  });
});
