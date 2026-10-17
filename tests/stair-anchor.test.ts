import { describe, expect, it } from "vitest";
import { createProject, migrateProject } from "@/lib/model/project";
import { SCHEMA_VERSION, type FloorPlan, type Opening, type PlanRoom, type PlanStairs, type Point } from "@/lib/model/schema";
import { levelsFor } from "@/lib/brief/levels";
import { defaultBasics } from "@/lib/plan/basics";
import { emptyPlan, moveMany, removeMany, rotateMany, type Plans } from "@/lib/plan/edit";
import { alignMany, duplicateMany, mirrorMany } from "@/lib/plan/arrange";
import { bendWall } from "@/lib/plan/bend";
import { combineRooms, whyNotCombine } from "@/lib/plan/openWalls";
import { splitRoom } from "@/lib/plan/partitions";
import { roundCorner } from "@/lib/plan/shapes";
import { isLocked, lockedIds } from "@/lib/plan/locks";
import { anchor, reconcileStacks, stackOfItem, unanchor, type StackCtx } from "@/lib/plan/anchor";
import { describeChange } from "@/lib/store/describe";

const levels = levelsFor(3, 0);
const ctx: StackCtx = { levels, basics: defaultBasics() };
const [L1, L2, L3] = levels.map((l) => l.id);

const room = (id: string, poly: Point[], extra: Partial<PlanRoom> = {}): PlanRoom => ({ id, name: id, type: "living", polygon: poly, ...extra });
const stairs = (id: string, toLevelId: string, extra: Partial<PlanStairs> = {}): PlanStairs => ({ id, x: 200, y: 200, rotation: 0, widthIn: 40, shape: "straight", flip: false, toLevelId, ...extra });
const plan = (rooms: PlanRoom[], st: PlanStairs[] = [], openings: Opening[] = []): FloorPlan => ({ ...emptyPlan(), rooms, stairs: st, openings });
/** A box from x0,y0 to x1,y1, clockwise on screen. */
const box = (x0: number, y0: number, x1: number, y1: number): Point[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const door = (id: string, roomId: string, edge = 0): Opening => ({ id, host: { roomId, edge }, offsetIn: 40, kind: "door", style: "door-hinged", widthIn: 32, heightIn: 80, side: 1, hinge: "start" });

/**
 * Three floors. Main-floor stairs climb north at x 180-220 and floor-2 stairs
 * sit right on top of them. The main floor has a living room the stairs
 * stand in; floor 2 has a hall around the stairwell and a bedroom; floor 3
 * has a bedroom over everything. Every floor has a door.
 */
function house(): Plans {
  return {
    [L1]: plan([room("living", box(100, 40, 460, 360))], [stairs("s1", L2)], [door("d1", "living")]),
    [L2]: plan([room("hall2", box(100, 40, 300, 360), { type: "hall" }), room("bed2", box(300, 40, 500, 360), { type: "bedroom" })], [stairs("s2", L3)], [door("d2", "bed2", 3)]),
    [L3]: plan([room("bed3", box(100, 40, 500, 360), { type: "bedroom" })], [], [door("d3", "bed3")]),
  };
}

const anchored = () => anchor(house(), ctx, L1, "s1")!;
const json = (x: unknown) => JSON.stringify(x);

describe("anchoring", () => {
  it("links and locks the stacked stairs and nothing else", () => {
    const { plans, stackId, note } = anchored();
    expect(plans[L1].stairs[0]).toMatchObject({ stackId, anchored: true, x: 200, y: 200, rotation: 0 });
    expect(plans[L2].stairs[0]).toMatchObject({ stackId, anchored: true });
    expect(note).toBe("Anchored the stairs on every floor they connect.");
  });

  it("leaves every room, wall and opening on every floor exactly as it was", () => {
    const before = house();
    const { plans } = anchored();
    for (const l of [L1, L2, L3]) {
      expect(json(plans[l].rooms)).toBe(json(before[l].rooms));
      expect(json(plans[l].walls)).toBe(json(before[l].walls));
      expect(json(plans[l].openings)).toBe(json(before[l].openings));
      expect(json(plans[l].openWalls)).toBe(json(before[l].openWalls));
    }
  });

  it("says just 'Anchored the stairs.' for stairs with nothing stacked on them", () => {
    const one = { [L1]: plan([room("r", box(0, 0, 400, 400))], [stairs("s", L2, { x: 600 })]), [L2]: plan([]) };
    const out = anchor(one, ctx, L1, "s")!;
    expect(out.note).toBe("Anchored the stairs.");
    expect(json(out.plans[L1].rooms)).toBe(json(one[L1].rooms));
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
  it("locks only the anchored stairs", () => {
    const { plans } = anchored();
    expect([...lockedIds(plans[L1])]).toEqual(["s1"]);
    expect([...lockedIds(plans[L2])]).toEqual(["s2"]);
    expect(isLocked(plans[L2], "hall2")).toBe(false);
  });

  it("leaves anchored stairs out of moves, turns, deletes, flips; rooms still move", () => {
    const { plans } = anchored();
    const p = plans[L1];
    const ids = ["s1", "living"];
    const moved = moveMany(p, ids, 24, 0);
    expect(moved.stairs[0]).toEqual(p.stairs[0]);
    expect(moved.rooms[0].polygon[0].x).toBe(p.rooms[0].polygon[0].x + 24);
    expect(rotateMany(p, ids, 90, { x: 0, y: 0 }).stairs[0]).toEqual(p.stairs[0]);
    expect(removeMany(p, ids).stairs).toHaveLength(1);
    expect(removeMany(p, ids).rooms).toHaveLength(0);
    expect(mirrorMany(p, ids, "left-right").stairs[0]).toEqual(p.stairs[0]);
  });

  it("lets the room around anchored stairs be lined up, combined and curved", () => {
    const { plans } = anchored();
    const p = plans[L2];
    expect(alignMany(p, ["hall2", "bed2"], "tops")).toBeTruthy();
    expect(whyNotCombine(p, ["hall2", "bed2"])).toBeNull();
    expect(combineRooms(p, ["hall2", "bed2"])).not.toBeNull();
    expect(bendWall(p, { roomId: "hall2", edge: 0 }, 12)).not.toBe(p);
  });

  it("makes copies of anchored stairs free", () => {
    const { plans } = anchored();
    const copy = duplicateMany(plans[L1], ["s1"]);
    const made = copy.plan.stairs.find((s) => s.id === copy.ids[0])!;
    expect(made.anchored).toBeUndefined();
    expect(made.stackId).toBeUndefined();
  });

  it("puts anchored stairs back when an edit moves or deletes them anyway", () => {
    const { plans } = anchored();
    const p = plans[L1];
    const moved = reconcileStacks(plans, { ...plans, [L1]: { ...p, stairs: [{ ...p.stairs[0], x: 300 }] } }, L1, ctx);
    expect(moved.plans[L1].stairs[0].x).toBe(200);
    expect(moved.note).toMatch(/anchored/);
    const gone = reconcileStacks(plans, { ...plans, [L1]: { ...p, stairs: [] } }, L1, ctx);
    expect(gone.plans[L1].stairs.map((s) => s.id)).toEqual(["s1"]);
  });

  it("still lets the railings on anchored stairs change", () => {
    const { plans } = anchored();
    const p = plans[L1];
    const edited = { ...p, stairs: [{ ...p.stairs[0], railings: [{ edge: "f1-left", removed: true }] }] };
    const r = reconcileStacks(plans, { ...plans, [L1]: edited }, L1, ctx);
    expect(r.plans[L1].stairs[0].railings).toEqual([{ edge: "f1-left", removed: true }]);
    expect(r.note).toBeNull();
  });

  it("leaves room edits alone", () => {
    const { plans } = anchored();
    const edited = { ...plans[L2], rooms: plans[L2].rooms.map((r) => (r.id === "hall2" ? { ...r, polygon: box(100, 40, 280, 360) } : r)) };
    const r = reconcileStacks(plans, { ...plans, [L2]: edited }, L2, ctx);
    expect(r.plans[L2]).toBe(edited);
    expect(r.note).toBeNull();
  });
});

describe("unanchored stacks", () => {
  it("move together on every floor, and no room moves with them", () => {
    const { plans, stackId } = anchored();
    const free = unanchor(plans, stackId);
    expect(free[L1].stairs[0].anchored).toBeUndefined();
    expect(free[L1].stairs[0].stackId).toBe(stackId);
    expect(stackOfItem(free[L1], "s1")).toBe(stackId);
    const r = reconcileStacks(free, { ...free, [L1]: moveMany(free[L1], ["s1"], 24, -12) }, L1, ctx);
    expect(r.plans[L2].stairs[0]).toMatchObject({ x: 224, y: 188 });
    for (const l of [L2, L3]) expect(json(r.plans[l].rooms)).toBe(json(free[l].rooms));
  });

  it("turn together", () => {
    const { plans, stackId } = anchored();
    const free = unanchor(plans, stackId);
    const r = reconcileStacks(free, { ...free, [L2]: rotateMany(free[L2], ["s2"], 90, { x: 200, y: 200 }) }, L2, ctx);
    expect(r.plans[L1].stairs[0]).toMatchObject({ x: 200, y: 200, rotation: 90 });
  });
});

describe("saved data", () => {
  /** A version 30 project with an anchored stair hall on two floors, as part 1 of the stair anchor work saved them. */
  function oldProject() {
    const p = createProject("Old stair hall");
    const hall = (id: string) => ({ ...room(id, box(160, 60, 260, 380), { type: "hall" }), name: "Stair hall", stairStack: "k", anchored: true });
    return JSON.parse(
      json({
        ...p,
        schemaVersion: 30,
        levels,
        floorPlans: {
          [L1]: plan([hall("h1"), room("living", box(260, 60, 500, 380))], [stairs("s1", L2, { stackId: "k", anchored: true })], [door("dh", "h1", 1)]),
          [L2]: plan([hall("h2"), room("bed", box(260, 60, 500, 380), { type: "bedroom" })], []),
        },
      }),
    );
  }

  it("opens an old stair hall as an ordinary room with the same outline and openings", () => {
    const raw = oldProject();
    const migrated = migrateProject(raw);
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(32);
    const h1 = migrated.floorPlans[L1].rooms.find((r) => r.id === "h1")!;
    expect(Object.keys(h1)).not.toContain("stairStack");
    expect(Object.keys(h1)).not.toContain("anchored");
    expect(h1).toMatchObject({ name: "Stair hall", type: "hall", polygon: raw.floorPlans[L1].rooms[0].polygon });
    expect(migrated.floorPlans[L1].openings).toEqual(raw.floorPlans[L1].openings);
    // The stairs keep their stack and stay anchored.
    expect(migrated.floorPlans[L1].stairs[0]).toMatchObject({ stackId: "k", anchored: true });
  });

  it("lets the old stair hall be moved, curved, rounded, split and combined", () => {
    const p = migrateProject(oldProject()).floorPlans[L1];
    expect(isLocked(p, "h1")).toBe(false);
    expect(moveMany(p, ["h1"], 12, 0).rooms.find((r) => r.id === "h1")!.polygon[0].x).toBe(172);
    expect(bendWall(p, { roomId: "h1", edge: 0 }, 12)).not.toBe(p);
    expect(roundCorner(p, "h1", 0, 24)).not.toBeNull();
    expect(splitRoom(p, [{ x: 160, y: 220 }, { x: 260, y: 220 }])?.roomId).toBe("h1");
    expect(combineRooms(p, ["h1", "living"])).not.toBeNull();
  });
});
