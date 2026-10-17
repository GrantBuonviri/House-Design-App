import { describe, expect, it } from "vitest";
import polygonClipping from "polygon-clipping";
import { createProject, migrateProject } from "@/lib/model/project";
import { SCHEMA_VERSION, type FloorPlan, type Opening, type PlanRoom, type PlanStairs, type Point } from "@/lib/model/schema";
import { levelsFor } from "@/lib/brief/levels";
import { defaultBasics } from "@/lib/plan/basics";
import { emptyPlan, moveEdge, moveMany, removeMany, rotateMany, type Plans } from "@/lib/plan/edit";
import { alignMany, duplicateMany, mirrorMany } from "@/lib/plan/arrange";
import { closeGap, findGaps } from "@/lib/plan/overlaps";
import { pullBack } from "@/lib/plan/support";
import { boundsOf, polygonArea } from "@/lib/plan/geometry";
import { bendWall } from "@/lib/plan/bend";
import { combineRooms } from "@/lib/plan/openWalls";
import { isLocked } from "@/lib/plan/locks";
import { anchor, footprintOf, hallFloor, hallLimit, hallOn, reconcileStacks, unanchor, type StackCtx } from "@/lib/plan/anchor";
import { describeChange } from "@/lib/store/describe";

const levels = levelsFor(3, 0);
const ctx: StackCtx = { levels, basics: defaultBasics() };
const [L1, L2, L3] = levels.map((l) => l.id);

const room = (id: string, poly: Point[], extra: Partial<PlanRoom> = {}): PlanRoom => ({ id, name: id, type: "living", polygon: poly, ...extra });
const stairs = (id: string, toLevelId: string, extra: Partial<PlanStairs> = {}): PlanStairs => ({ id, x: 200, y: 200, rotation: 0, widthIn: 40, shape: "straight", flip: false, toLevelId, ...extra });
const plan = (rooms: PlanRoom[], st: PlanStairs[] = [], openings: Opening[] = []): FloorPlan => ({ ...emptyPlan(), rooms, stairs: st, openings });
/** A box from x0,y0 to x1,y1, clockwise on screen. */
const box = (x0: number, y0: number, x1: number, y1: number): Point[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

const ring = (p: Point[]) => [[...p.map((q): [number, number] => [q.x, q.y]), [p[0].x, p[0].y]]] as [number, number][][];
const areaOf = (mp: ReturnType<typeof polygonClipping.union>) => mp.reduce((s, poly) => s + polygonArea(poly[0].slice(0, -1).map(([x, y]) => ({ x, y }))), 0);
/** Is `inner` inside `outer` (to a square inch)? */
const inside = (inner: Point[], outer: Point[]) => areaOf(polygonClipping.difference(ring(inner), ring(outer))) < 1;
const sameRegion = (a: Point[], b: Point[]) => areaOf(polygonClipping.xor(ring(a), ring(b))) < 1;

/**
 * Three floors. Main-floor stairs climb north from y = 275 at x 180-220 and
 * floor-2 stairs sit right on top of them. The main floor has a living room
 * east of the stairs; floor 2 has a big hall around the stairwell and a
 * bedroom that reaches into the space past the stairs; floor 3 has a bedroom
 * over everything.
 */
function house(): Plans {
  return {
    [L1]: plan([room("living", box(220, 60, 460, 340))], [stairs("s1", L2)]),
    [L2]: plan([room("hall2", box(100, 40, 300, 360), { type: "hall" }), room("bed2", box(300, 40, 500, 360), { type: "bedroom" })], [stairs("s2", L3)]),
    [L3]: plan([room("bed3", box(100, 40, 500, 360), { type: "bedroom" })]),
  };
}

const anchored = () => anchor(house(), ctx, L1, "s1")!;

describe("stair stacks: limits", () => {
  it("lets a stair hall be the stairs plus 3' past the bottom and top", () => {
    const p = { ...house(), [L2]: plan([]) };
    const s = { ...p, [L1]: { ...p[L1], stairs: [stairs("s1", L2, { stackId: "k" })] } };
    const print = footprintOf(ctx, { levelId: L1, stairs: s[L1].stairs[0] });
    const fb = boundsOf(print)!;
    const lb = boundsOf(hallLimit(s, ctx, "k")!)!;
    expect(lb.x0).toBeCloseTo(fb.x0);
    expect(lb.x1).toBeCloseTo(fb.x1);
    expect(lb.y0).toBeCloseTo(fb.y0 - 36, 0);
    expect(lb.y1).toBeCloseTo(fb.y1 + 36, 0);
    expect(sameRegion(hallFloor(s, ctx, "k")!, print)).toBe(true);
  });

  it("reaches 3' past the second flight of L stairs too, and stays one rectangle", () => {
    const s = { [L1]: plan([], [stairs("s1", L2, { stackId: "k", shape: "l" })]), [L2]: plan([]) };
    const limit = hallLimit(s, ctx, "k")!;
    expect(limit).toHaveLength(4);
    const fb = boundsOf(footprintOf(ctx, { levelId: L1, stairs: s[L1].stairs[0] }))!;
    const lb = boundsOf(limit)!;
    expect(lb.x1).toBeCloseTo(fb.x1 + 36, 0);
    expect(lb.y1).toBeCloseTo(fb.y1 + 36, 0);
  });
});

describe("anchoring", () => {
  it("links the stacked stairs and gives every floor a stair hall with the same outline", () => {
    const { plans, stackId } = anchored();
    expect(plans[L1].stairs[0]).toMatchObject({ stackId, anchored: true });
    expect(plans[L2].stairs[0]).toMatchObject({ stackId, anchored: true });
    const halls = [L1, L2, L3].map((l) => hallOn(plans[l], stackId)!);
    expect(halls.every(Boolean)).toBe(true);
    for (const h of halls) expect(sameRegion(h.polygon, halls[0].polygon)).toBe(true);
    expect(halls.every((h) => h.anchored && h.type === "hall")).toBe(true);
  });

  it("keeps the stair hall inside the limit and around the stairs", () => {
    const { plans, stackId } = anchored();
    const hall = hallOn(plans[L1], stackId)!;
    expect(inside(hall.polygon, hallLimit(plans, ctx, stackId)!)).toBe(true);
    expect(inside(hallFloor(plans, ctx, stackId)!, hall.polygon)).toBe(true);
  });

  it("cuts a big existing hall down to the limit, keeping the room", () => {
    const { plans, stackId } = anchored();
    const hall = hallOn(plans[L2], stackId)!;
    expect(hall.id).toBe("hall2");
    expect(polygonArea(hall.polygon)).toBeLessThan(polygonArea(box(100, 40, 300, 360)));
  });

  it("trims rooms in the way upstairs, and leaves the stairs where they were", () => {
    const before = house();
    const { plans, note } = anchored();
    const bed3 = plans[L3].rooms.find((r) => r.id === "bed3")!;
    const hall3 = plans[L3].rooms.find((r) => r.stairStack)!;
    expect(polygonArea(bed3.polygon)).toBeLessThan(polygonArea(before[L3].rooms[0].polygon));
    expect(areaOf(polygonClipping.intersection(ring(bed3.polygon), ring(hall3.polygon)))).toBeLessThan(1);
    expect(plans[L1].stairs[0]).toMatchObject({ x: 200, y: 200, rotation: 0 });
    expect(note).toMatch(/Made room for the stair hall/);
  });

  it("names the change for Undo", () => {
    const p = createProject("Anchor");
    const before = { ...p, levels, floorPlans: house() };
    const done = anchored();
    const after = { ...before, floorPlans: done.plans };
    expect(describeChange(before, after)).toBe("anchor the stairs");
    expect(describeChange(after, { ...after, floorPlans: unanchor(after.floorPlans, done.stackId) })).toBe("unanchor the stairs");
  });
});

describe("what anchoring locks", () => {
  it("leaves anchored stairs and stair halls out of moves, turns, deletes, flips and line ups", () => {
    const { plans, stackId } = anchored();
    const p = plans[L1];
    const hall = hallOn(p, stackId)!;
    const ids = ["s1", hall.id, "living"];
    expect(isLocked(p, "s1") && isLocked(p, hall.id)).toBe(true);
    const moved = moveMany(p, ids, 24, 0);
    expect(moved.stairs[0]).toEqual(p.stairs[0]);
    expect(moved.rooms.find((r) => r.id === hall.id)).toEqual(hall);
    expect(moved.rooms.find((r) => r.id === "living")!.polygon[0].x).toBe(p.rooms.find((r) => r.id === "living")!.polygon[0].x + 24);
    expect(rotateMany(p, ids, 90, { x: 0, y: 0 }).stairs[0]).toEqual(p.stairs[0]);
    expect(removeMany(p, ids).stairs).toHaveLength(1);
    expect(removeMany(p, ids).rooms.some((r) => r.id === hall.id)).toBe(true);
    expect(mirrorMany(p, ids, "left-right").stairs[0]).toEqual(p.stairs[0]);
    expect(alignMany(p, [hall.id, "living"], "tops").rooms.find((r) => r.id === hall.id)).toEqual(hall);
    expect(combineRooms(p, [hall.id, "living"])).toBeNull();
    expect(bendWall(p, { roomId: hall.id, edge: 0 }, 12)).toBe(p);
  });

  it("makes copies of anchored stairs free", () => {
    const { plans } = anchored();
    const copy = duplicateMany(plans[L1], ["s1"]);
    const made = copy.plan.stairs.find((s) => s.id === copy.ids[0])!;
    expect(made.anchored).toBeUndefined();
    expect(made.stackId).toBeUndefined();
  });

  it("keeps automatic fixes off the stair hall: Pull back and close gaps", () => {
    const { plans, stackId } = anchored();
    const p = plans[L2];
    const hall = hallOn(p, stackId)!;
    expect(pullBack(p, hall.id, [{ outline: box(0, 0, 10, 10), holes: [] }])).toBe(p);
    // A room 3" east of the hall: closing the gap moves the room, never the hall.
    const hb = boundsOf(hall.polygon)!;
    const near = { ...p, rooms: [...p.rooms.filter((r) => r.id === hall.id), room("den", box(hb.x1 + 3, hb.y0, hb.x1 + 120, hb.y1))] };
    const gap = findGaps(near).find((g) => [g.aId, g.bId].includes("den"))!;
    const closed = closeGap(near, gap);
    expect(closed.rooms.find((r) => r.id === hall.id)).toEqual(hall);
    expect(boundsOf(closed.rooms.find((r) => r.id === "den")!.polygon)!.x0).toBeCloseTo(hb.x1);
  });

  it("puts anchored stairs and halls back when an edit moves or deletes them anyway", () => {
    const { plans } = anchored();
    const p = plans[L1];
    const forced = { ...p, stairs: [{ ...p.stairs[0], x: 300 }], rooms: p.rooms.filter((r) => !r.stairStack) };
    const r = reconcileStacks(plans, { ...plans, [L1]: forced }, L1, ctx);
    expect(r.plans[L1].stairs[0].x).toBe(200);
    expect(r.plans[L1].rooms.some((x) => x.stairStack)).toBe(true);
    expect(r.note).toMatch(/anchored/);
  });

  it("still lets the railings on anchored stairs change", () => {
    const { plans } = anchored();
    const p = plans[L1];
    const edited = { ...p, stairs: [{ ...p.stairs[0], railings: [{ edge: "f1-left", removed: true }] }] };
    const r = reconcileStacks(plans, { ...plans, [L1]: edited }, L1, ctx);
    expect(r.plans[L1].stairs[0].railings).toEqual([{ edge: "f1-left", removed: true }]);
  });
});

describe("stair hall walls", () => {
  it("move within the limit, and the change goes to every floor", () => {
    const { plans, stackId } = anchored();
    const hall = hallOn(plans[L1], stackId)!;
    const hb = boundsOf(hall.polygon)!;
    // Pull the east wall 2' east: past the limit, so it stops there (the limit is the stairs' width).
    const east = hall.polygon.findIndex((q, i) => q.x === hb.x1 && hall.polygon[(i + 1) % hall.polygon.length].x === hb.x1);
    const edited = moveEdge(plans[L1], hall.id, east, { x: 24, y: 0 }, false);
    const r = reconcileStacks(plans, { ...plans, [L1]: edited }, L1, ctx);
    const after = hallOn(r.plans[L1], stackId)!;
    expect(inside(after.polygon, hallLimit(r.plans, ctx, stackId)!)).toBe(true);
    // Pull the south wall 1' north instead: allowed, and every floor follows.
    const south = hall.polygon.findIndex((q, i) => q.y === hb.y1 && hall.polygon[(i + 1) % hall.polygon.length].y === hb.y1);
    const shorter = moveEdge(plans[L1], hall.id, south, { x: 0, y: -12 }, false);
    const r2 = reconcileStacks(plans, { ...plans, [L1]: shorter }, L1, ctx);
    const b1 = boundsOf(hallOn(r2.plans[L1], stackId)!.polygon)!;
    expect(b1.y1).toBeCloseTo(hb.y1 - 12);
    for (const l of [L2, L3]) expect(boundsOf(hallOn(r2.plans[l], stackId)!.polygon)!.y1).toBeCloseTo(hb.y1 - 12);
  });

  it("never cut into the stairs", () => {
    const { plans, stackId } = anchored();
    const hall = hallOn(plans[L1], stackId)!;
    const hb = boundsOf(hall.polygon)!;
    const south = hall.polygon.findIndex((q, i) => q.y === hb.y1 && hall.polygon[(i + 1) % hall.polygon.length].y === hb.y1);
    const crushed = moveEdge(plans[L1], hall.id, south, { x: 0, y: -100 }, false);
    const r = reconcileStacks(plans, { ...plans, [L1]: crushed }, L1, ctx);
    expect(inside(hallFloor(r.plans, ctx, stackId)!, hallOn(r.plans[L1], stackId)!.polygon)).toBe(true);
  });

  it("keep their doors per floor", () => {
    const { plans, stackId } = anchored();
    const hall1 = hallOn(plans[L1], stackId)!;
    const door: Opening = { id: "d1", host: { roomId: hall1.id, edge: 0 }, offsetIn: 20, kind: "door", style: "door-hinged", widthIn: 32, heightIn: 80, side: 1, hinge: "start" };
    const withDoor = { ...plans, [L1]: { ...plans[L1], openings: [door] } };
    const hb = boundsOf(hall1.polygon)!;
    const south = hall1.polygon.findIndex((q, i) => q.y === hb.y1 && hall1.polygon[(i + 1) % hall1.polygon.length].y === hb.y1);
    const r = reconcileStacks(withDoor, { ...withDoor, [L1]: moveEdge(withDoor[L1], hall1.id, south, { x: 0, y: -12 }, false) }, L1, ctx);
    expect(r.plans[L1].openings.map((o) => o.id)).toEqual(["d1"]);
    expect(r.plans[L2].openings).toHaveLength(0);
  });
});

describe("unanchored stacks", () => {
  it("move together on every floor", () => {
    const { plans, stackId } = anchored();
    const free = unanchor(plans, stackId);
    expect(free[L1].stairs[0].anchored).toBeUndefined();
    expect(free[L1].stairs[0].stackId).toBe(stackId);
    const hall3 = hallOn(free[L3], stackId)!;
    const r = reconcileStacks(free, { ...free, [L1]: moveMany(free[L1], ["s1"], 24, -12) }, L1, ctx);
    expect(r.plans[L2].stairs[0]).toMatchObject({ x: 224, y: 188 });
    expect(hallOn(r.plans[L3], stackId)!.polygon[0]).toEqual({ x: hall3.polygon[0].x + 24, y: hall3.polygon[0].y - 12 });
    expect(hallOn(r.plans[L1], stackId)!.polygon[0]).toEqual({ x: hall3.polygon[0].x + 24, y: hall3.polygon[0].y - 12 });
  });

  it("turn together", () => {
    const { plans, stackId } = anchored();
    const free = unanchor(plans, stackId);
    const r = reconcileStacks(free, { ...free, [L2]: rotateMany(free[L2], ["s2"], 90, { x: 200, y: 200 }) }, L2, ctx);
    expect(r.plans[L1].stairs[0]).toMatchObject({ x: 200, y: 200, rotation: 90 });
    const b = boundsOf(hallOn(r.plans[L3], stackId)!.polygon)!;
    expect(b.x1 - b.x0).toBeGreaterThan(b.y1 - b.y0);
  });

  it("frees the stair halls when the last flight is deleted", () => {
    const { plans, stackId } = anchored();
    let free = unanchor(plans, stackId);
    free = reconcileStacks(free, { ...free, [L2]: removeMany(free[L2], ["s2"]) }, L2, ctx).plans;
    expect(hallOn(free[L1], stackId)).toBeTruthy();
    free = reconcileStacks(free, { ...free, [L1]: removeMany(free[L1], ["s1"]) }, L1, ctx).plans;
    for (const l of [L1, L2, L3]) expect(free[l].rooms.some((r) => r.stairStack)).toBe(false);
  });
});

describe("saved data", () => {
  it("opens a version 27 project unchanged", () => {
    const p = createProject("Old stairs");
    const v27 = JSON.parse(JSON.stringify({ ...p, schemaVersion: 27, floorPlans: { [L1]: plan([room("r", box(0, 0, 100, 100))], [stairs("s", L2)]) } }));
    const migrated = migrateProject(v27);
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(28);
    expect(migrated.floorPlans[L1].stairs[0].stackId).toBeUndefined();
    expect(migrated.floorPlans[L1].rooms[0].stairStack).toBeUndefined();
  });
});
