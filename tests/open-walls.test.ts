import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type FloorPlan, type PlanRoom, type Project } from "@/lib/model/schema";
import { createProject, migrateProject } from "@/lib/model/project";
import { MAIN_LEVEL_ID } from "@/lib/brief/levels";
import { emptyPlan, makeRoom, moveMany, moveEdge, removeMany } from "@/lib/plan/edit";
import { mirrorPlans } from "@/lib/plan/changes";
import { rectangle, polygonArea } from "@/lib/plan/geometry";
import { newOpening, reachable, roomLinks, doorBetween } from "@/lib/plan/connect";
import { wallPieces } from "@/lib/plan/walls";
import { combineRooms, edgeWalls, pruneOpenWalls, removeWall, restoreWall, whyNotCombine, whyWallStays } from "@/lib/plan/openWalls";
import { buildLevel } from "@/lib/house3d/build";
import { levelHeights } from "@/lib/house3d/levels";
import { siteFor } from "@/lib/house3d/site";
import { walkWorld } from "@/lib/house3d/walk";
import { measurePlan } from "@/lib/cost/quantities";
import { floorPlanSheet } from "@/lib/plans/sheets/floorPlan";
import { describeChange } from "@/lib/store/describe";
import { defaultBasics } from "@/lib/plan/basics";
import { House3D } from "@/lib/model/schema";
import { house, RANCH } from "./samples";

const FT = 12;

function room(id: string, x: number, y: number, w: number, h: number, extra: Partial<PlanRoom> = {}): PlanRoom {
  return { ...makeRoom(rectangle((x + w / 2) * FT, (y + h / 2) * FT, w * FT, h * FT), id), id, type: "living", ...extra };
}
const plan = (rooms: PlanRoom[], extra: Partial<FloorPlan> = {}): FloorPlan => ({ ...emptyPlan(), rooms, ...extra });
/** Two 10 by 10 ft rooms side by side, sharing the wall at x = 10 ft. */
const pair = () => plan([room("a", 0, 0, 10, 10), room("b", 10, 0, 10, 10, { type: "dining" })]);
/** The edge of room a that runs along the shared wall. */
const sharedEdge = (p: FloorPlan) => p.rooms[0].polygon.findIndex((q, i, poly) => q.x === 120 && poly[(i + 1) % poly.length].x === 120);

describe("removing walls", () => {
  it("takes out the shared wall but keeps both rooms", () => {
    const p = pair();
    const e = sharedEdge(p);
    expect(whyWallStays(p, "a", e)).toBeNull();
    const out = removeWall(p, "a", e)!;
    expect(out.plan.rooms).toHaveLength(2);
    expect(out.plan.openWalls).toHaveLength(1);
    const pieces = wallPieces(out.plan, 6.5);
    const gone = pieces.filter((w) => w.removed);
    expect(gone).toHaveLength(1);
    expect(gone[0].open && gone[0].thicknessIn === 0).toBe(true);
    // The outside walls all stay.
    expect(pieces.filter((w) => !w.open).every((w) => w.exterior)).toBe(true);
    expect(edgeWalls(out.plan, "a", e).removed).toHaveLength(1);
  });

  it("won't take out an outside wall, and says why", () => {
    const p = pair();
    const outside = (sharedEdge(p) + 2) % 4;
    expect(removeWall(p, "a", outside)).toBeNull();
    expect(whyWallStays(p, "a", outside)).toMatch(/outside wall/);
  });

  it("takes out only the shared part of a longer edge", () => {
    // a is 20 ft deep; b covers only its top 10 ft.
    const p = plan([room("a", 0, 0, 10, 20), room("b", 10, 0, 10, 10)]);
    const e = p.rooms[0].polygon.findIndex((q, i, poly) => q.x === 120 && poly[(i + 1) % poly.length].x === 120);
    const out = removeWall(p, "a", e)!;
    const gone = wallPieces(out.plan, 6.5).filter((w) => w.removed);
    expect(gone).toHaveLength(1);
    expect(Math.hypot(gone[0].b.x - gone[0].a.x, gone[0].b.y - gone[0].a.y)).toBeCloseTo(120, 0);
    expect(wallPieces(out.plan, 6.5).some((w) => w.exterior && Math.abs(w.a.x - 120) < 1 && Math.abs(w.b.x - 120) < 1)).toBe(true);
  });

  it("removes doors in the wall with it, and puts the wall back", () => {
    const p = pair();
    const door = doorBetween(p, p.rooms[0], p.rooms[1])!;
    const withDoor = { ...p, openings: [door] };
    const out = removeWall(withDoor, "a", sharedEdge(p))!;
    expect(out.removedOpenings.map((o) => o.id)).toEqual([door.id]);
    expect(out.plan.openings).toHaveLength(0);
    expect(describeChange(proj(withDoor), proj(out.plan))).toBe("remove a wall and a door");
    const back = restoreWall(out.plan, "a", sharedEdge(p));
    expect(back.openWalls).toBeUndefined();
    expect(wallPieces(back, 6.5).some((w) => w.removed)).toBe(false);
    expect(describeChange(proj(out.plan), proj(back))).toBe("put a wall back");
  });

  it("counts open rooms as connected, and won't put a door in a removed wall", () => {
    const p = { ...pair(), openings: [newOpening("door-entry", { roomId: "a", edge: (sharedEdge(pair()) + 2) % 4 }, 60, 1)] };
    expect(roomLinks(p).get("a")!.has("b")).toBe(false);
    const open = removeWall(p, "a", sharedEdge(p))!.plan;
    expect(roomLinks(open).get("a")!.has("b")).toBe(true);
    expect(reachable(open, ["a"]).has("b")).toBe(true);
    expect(doorBetween(open, open.rooms[0], open.rooms[1])).toBeNull();
  });

  it("keeps the removed wall with the rooms when they move together, and drops it when one leaves", () => {
    const open = removeWall(pair(), "a", sharedEdge(pair()))!.plan;
    const both = moveMany(open, ["a", "b"], 24, 0);
    expect(both.openWalls![0].a.x).toBe(144);
    expect(wallPieces(both, 6.5).some((w) => w.removed)).toBe(true);
    const one = moveMany(open, ["b"], 0, 240);
    expect(one.openWalls).toBeUndefined();
    // Pushing the shared wall carries the gap along too.
    const pushed = moveEdge(open, "a", sharedEdge(open), { x: 12, y: 0 });
    expect(wallPieces(pushed, 6.5).some((w) => w.removed)).toBe(true);
    // Deleting a room drops it.
    expect(removeMany(open, ["b"]).openWalls).toBeUndefined();
    expect(pruneOpenWalls(open)).toBe(open);
  });

  it("flips removed walls when the house is mirrored", () => {
    const open = removeWall(pair(), "a", sharedEdge(pair()))!.plan;
    const flipped = mirrorPlans({ [MAIN_LEVEL_ID]: open }, "x")[MAIN_LEVEL_ID];
    expect(wallPieces(flipped, 6.5).some((w) => w.removed)).toBe(true);
  });
});

describe("combining rooms", () => {
  it("joins two rooms into the bigger one, dropping the door between them", () => {
    const p0 = plan([room("a", 0, 0, 12, 10, { name: "Kitchen", type: "kitchen" }), room("b", 12, 0, 10, 10, { name: "Dining", type: "dining" })]);
    const door = doorBetween(p0, p0.rooms[0], p0.rooms[1])!;
    const outside = newOpening("window", { roomId: "b", edge: 0 }, 60, -1);
    const p = { ...p0, openings: [door, outside], fixtures: [{ id: "f", kind: "sink", x: 200, y: 20, rotation: 0, widthIn: 30, depthIn: 22, roomId: "b" }] } as FloorPlan;
    expect(whyNotCombine(p, ["a", "b"])).toBeNull();
    const out = combineRooms(p, ["a", "b"])!;
    expect(out.keptId).toBe("a");
    expect(out.plan.rooms).toHaveLength(1);
    expect(out.plan.rooms[0].name).toBe("Kitchen");
    expect(out.plan.rooms[0].polygon).toHaveLength(4);
    expect(polygonArea(out.plan.rooms[0].polygon) / 144).toBeCloseTo(220, 0);
    expect(out.removedOpenings.map((o) => o.id)).toEqual([door.id]);
    const win = out.plan.openings.find((o) => o.id === outside.id)!;
    expect("roomId" in win.host && win.host.roomId).toBe("a");
    expect(out.plan.fixtures[0].roomId).toBe("a");
    expect(describeChange(proj(p), proj(out.plan))).toBe("combine Kitchen and Dining");
  });

  it("combines rooms that were opened up, and an L-shaped set", () => {
    const open = removeWall(pair(), "a", sharedEdge(pair()))!.plan;
    const out = combineRooms(open, ["a", "b"])!;
    expect(out.plan.openWalls).toBeUndefined();
    const l = plan([room("a", 0, 0, 10, 10), room("b", 10, 0, 10, 10), room("c", 0, 10, 10, 10)]);
    expect(combineRooms(l, ["a", "b", "c"])!.plan.rooms[0].polygon).toHaveLength(6);
  });

  it("won't combine rooms that only touch at a corner or a porch with a room", () => {
    const corner = plan([room("a", 0, 0, 10, 10), room("b", 10, 10, 10, 10)]);
    expect(whyNotCombine(corner, ["a", "b"])).toMatch(/corner/);
    expect(combineRooms(corner, ["a", "b"])).toBeNull();
    const porch = plan([room("a", 0, 0, 10, 10), room("b", 10, 0, 10, 10, { type: "porch" })]);
    expect(whyNotCombine(porch, ["a", "b"])).toMatch(/porch/);
  });
});

const ROOF = House3D.parse({}).roof;
function proj(p: FloorPlan): Project {
  return { ...createProject("Test"), floorPlans: { [MAIN_LEVEL_ID]: p } };
}

describe("removed walls everywhere else", () => {
  /** The sample ranch with one inside wall taken out. */
  function opened(): { before: Project; after: Project } {
    const before = house(RANCH);
    const id = before.levels[0].id;
    const p = before.floorPlans[id];
    let out: ReturnType<typeof removeWall> = null;
    for (const r of p.rooms) {
      for (let e = 0; e < r.polygon.length && !out; e++) out = removeWall(p, r.id, e);
      if (out) break;
    }
    return { before, after: { ...before, floorPlans: { ...before.floorPlans, [id]: out!.plan } } };
  }

  it("leaves the wall out of the 3D house and the walkthrough", () => {
    const { before, after } = opened();
    const level = before.levels[0];
    const ctx = (p: Project) => ({ levels: p.levels, basics: p.plan.basics ?? defaultBasics(), house3d: { roof: ROOF }, site: siteFor(null, { x: 0, y: 0 }, p.floorPlans), frame: { ox: 0, oy: 0 }, heights: levelHeights(p.levels, p.plan.basics ?? defaultBasics()) });
    const count = (p: Project) => buildLevel(p.floorPlans, level, ctx(p)).filter((x) => x.layer === "walls").reduce((s, x) => s + x.mesh.count, 0);
    expect(count(after)).toBeLessThan(count(before));
    const walls = (p: Project) => walkWorld(p.floorPlans, ctx(p)).blockers.length;
    expect(walls(after)).toBeLessThan(walls(before));
  });

  it("costs less inside wall, and draws a dashed line on the PDF instead of a wall", () => {
    const { before, after } = opened();
    expect(measurePlan(after)!.intWallLf).toBeLessThan(measurePlan(before)!.intWallLf);
    const solid = (p: Project) => floorPlanSheet(p, p.levels[0]).items.filter((i) => i.t === "poly" && i.fill).length;
    expect(solid(after)).toBeLessThan(solid(before));
  });

  it("keeps old projects opening: version 15 gets an empty list", () => {
    const old = { ...createProject("Old"), schemaVersion: 15, floorPlans: { [MAIN_LEVEL_ID]: { rooms: [], walls: [], openings: [], stairs: [], fixtures: [], furniture: [] } } };
    const p = migrateProject(old);
    expect(p.schemaVersion).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(16);
    expect(p.floorPlans[MAIN_LEVEL_ID].openWalls).toEqual([]);
  });
});
