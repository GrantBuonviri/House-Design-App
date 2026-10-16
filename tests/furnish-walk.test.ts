import { describe, expect, it } from "vitest";
import type { FloorPlan } from "@/lib/model/schema";
import { catalogEntry } from "@/lib/furnish/catalog";
import { layerItems, placeItem } from "@/lib/furnish/layer";
import { addWall, clampLift, itemAt, liftable, openingOnWall, slideOpening, walkGhost, walkMove, wallPoint, withOpening } from "@/lib/furnish/walk";
import { aimAt } from "@/lib/interior/surfaces";
import { emptyPlan, makeRoom } from "@/lib/plan/edit";
import { defaultBasics } from "@/lib/plan/basics";
import { MAIN_LEVEL_ID } from "@/lib/brief/levels";

const L = MAIN_LEVEL_ID;
const basics = defaultBasics();

/** A 10' x 8' bath beside a 12' x 12' bedroom (the bedroom's west wall is the bath's east wall, at x = 120). */
function twoRooms(): { plan: FloorPlan; bath: string; bed: string } {
  const bath = makeRoom([{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 96 }, { x: 0, y: 96 }], "Bath", { type: "bathroom" });
  const bed = makeRoom([{ x: 120, y: 0 }, { x: 264, y: 0 }, { x: 264, y: 144 }, { x: 120, y: 144 }], "Bedroom", { type: "bedroom" });
  return { plan: { ...emptyPlan(), rooms: [bath, bed] }, bath: bath.id, bed: bed.id };
}

const up = { x: 0, y: 0, up: 1 };
/** Looking east at the bedroom's east wall (x = 264) from inside: the wall faces west. */
const eastWall = (y: number, heightIn = 50) => ({ p: { x: 264, y }, heightIn, normal: { x: -1, y: 0, up: 0 } });

describe("aiming at placed things in the walkthrough", () => {
  it("finds the smallest item whose box holds the spot, from the bottom to the top", () => {
    const { plan } = twoRooms();
    let p = placeItem(plan, "fixture:counter", { x: 200, y: 13 }, { rotation: 0 }).plan;
    p = placeItem(p, "fixture:sink", { x: 200, y: 13 }, { rotation: 0 }).plan;
    const items = layerItems(p);
    expect(itemAt(items, { p: { x: 200, y: 13 }, heightIn: 36, normal: up })?.entryId).toBe("fixture:sink");
    expect(itemAt(items, { p: { x: 225, y: 13 }, heightIn: 36, normal: up })?.entryId).toBe("fixture:counter");
    // Above it, or beside it, there's nothing.
    expect(itemAt(items, { p: { x: 200, y: 13 }, heightIn: 70, normal: up })).toBeNull();
    expect(itemAt(items, { p: { x: 200, y: 80 }, heightIn: 20, normal: up })).toBeNull();
  });

  it("puts placed things first in the Place tab, and surfaces first in Finishes", () => {
    const { plan } = twoRooms();
    const p = placeItem(plan, "fixture:toilet", { x: 60, y: 15 }, { rotation: 0 }).plan;
    const items = layerItems(p);
    const fx = items[0];
    const part = { layer: "fixtures" as const, levelId: L, pick: { kind: "fixture" as const, id: fx.id, levelId: L } };
    const hit = { p: { x: 60, y: 15 }, heightIn: 15, normal: up };
    expect(aimAt(p, part, hit, basics, undefined, { tab: "place", items })).toEqual({ kind: "furnish", levelId: L, id: fx.id, label: fx.label, item: "fixture" });
    expect(aimAt(p, part, hit, basics, undefined, { tab: "finishes", items }).kind).toBe("finish");
    // A bookcase has no finishes: Finishes picks it instead.
    const q = placeItem(plan, "addon:bookcase", { x: 200, y: 10 }, { rotation: 0 }).plan;
    const qi = layerItems(q);
    const a = aimAt(q, { layer: "fixtures", levelId: L }, { p: { x: 200, y: 10 }, heightIn: 30, normal: { x: 0, y: 1, up: 0 } }, basics, undefined, { tab: "finishes", items: qi });
    expect(a).toMatchObject({ kind: "furnish", id: qi[0].id });
  });

  it("offers doors and windows in the Place tab, and a hint on a bare wall", () => {
    const { plan } = twoRooms();
    const o = openingOnWall(plan, { x: 263, y: 72 }, "window")!;
    const p = withOpening(plan, o);
    const a = aimAt(p, { layer: "openings", levelId: L, pick: { kind: "opening", id: o.id, levelId: L } }, eastWall(72), basics, undefined, { tab: "place", items: [] });
    expect(a).toMatchObject({ kind: "opening", id: o.id });
    const bare = aimAt(p, { layer: "walls", levelId: L }, eastWall(20), basics, undefined, { tab: "place", items: [] });
    expect(bare.kind).toBe("none");
  });

  it("still finds furniture by the part that was hit", () => {
    const { plan } = twoRooms();
    const p = placeItem(plan, "furniture:sofa", { x: 190, y: 80 }).plan;
    const id = p.furniture[0].id;
    expect(aimAt(p, { layer: "furniture", levelId: L, furnitureId: id }, { p: { x: 190, y: 80 }, heightIn: 18, normal: up }, basics)).toMatchObject({ kind: "furnish", id, item: "furniture" });
  });
});

describe("placing from where you look", () => {
  it("backs floor items onto a wall that's close, and goes red outside the rooms", () => {
    const { plan, bed } = twoRooms();
    const g = walkGhost(plan, "addon:bookcase", { floor: { x: 200, y: 140 } }, 0, [])!;
    expect(g.check.ok).toBe(true);
    expect(g.check.roomId).toBe(bed);
    // Its back is against the south wall (y = 144).
    expect(g.y + g.depthIn / 2).toBeGreaterThan(138);
    expect(g.rotation).toBe(180);
    const bad = walkGhost(plan, "furniture:bed-queen", { floor: { x: 400, y: 400 } }, 0, [])!;
    expect(bad.check.ok).toBe(false);
  });

  it("sticks wall-hung things flat to the aimed wall at their catalog height, and the scroll wheel lifts them", () => {
    const { plan } = twoRooms();
    const e = catalogEntry("addon:mirror")!;
    expect(e.mount).toBe("wall");
    const spot = { floor: { x: 230, y: 60 }, wall: { p: { x: 264, y: 60 }, n: { x: -1, y: 0 } } };
    const g = walkGhost(plan, e.id, spot, 0, [])!;
    expect(g.check.ok).toBe(true);
    expect(g.x).toBeGreaterThan(255);
    expect(Math.abs(g.y - 60)).toBeLessThan(1);
    expect(g.bottomIn).toBe(e.bottomIn);
    const lifted = walkGhost(plan, e.id, spot, 0, [], 96, 6)!;
    expect(lifted.bottomIn).toBe(e.bottomIn + 6);
    // Never through the ceiling.
    expect(walkGhost(plan, e.id, spot, 0, [], 96, 500)!.bottomIn).toBe(clampLift(500, e.heightIn, 96));
  });

  it("moves an item it was picked up from, keeping it out of its own way", () => {
    const { plan } = twoRooms();
    const p = placeItem(plan, "addon:bookcase", { x: 200, y: 10 }, { rotation: 0 }).plan;
    const items = layerItems(p);
    const g = walkMove(p, items[0], { floor: { x: 202, y: 12 } }, 0, items);
    expect(g.check.ok).toBe(true);
    const turned = walkMove(p, items[0], { floor: { x: 202, y: 12 } }, 0, items);
    expect(turned.rotation).toBe(items[0].rotation);
    expect(liftable(items[0])).toBe(false);
  });
});

describe("doors, windows and walls in the walkthrough", () => {
  it("puts a door on the aimed wall and slides it along that wall only", () => {
    const { plan } = twoRooms();
    expect(openingOnWall(plan, { x: 200, y: 72 }, "door-hinged")).toBeNull();
    const o = openingOnWall(plan, { x: 262, y: 40 }, "door-hinged", 80)!;
    expect(o.kind).toBe("door");
    expect(o.heightIn).toBe(80);
    const p = withOpening(plan, o);
    const slid = slideOpening(p, o.id, { x: 262, y: 100 })!;
    expect(slid.offsetIn).not.toBe(o.offsetIn);
    expect(slid.host).toEqual(o.host);
    // Off along a different wall: it stays where it is.
    expect(slideOpening(p, o.id, { x: 200, y: 142 })).toBeNull();
    expect(withOpening(p, slid).openings).toHaveLength(1);
  });

  it("draws a wall between two spots, snapping to corners, and splits a room crossed end to end", () => {
    const { plan } = twoRooms();
    expect(wallPoint(plan, { x: 262, y: 141 })).toEqual({ x: 264, y: 144 });
    const half = addWall(plan, { x: 150, y: 40 }, { x: 200, y: 40 }, "half")!;
    expect(half.split).toBe(false);
    expect(half.plan.walls[0]).toMatchObject({ height: "half" });
    const split = addWall(plan, wallPoint(plan, { x: 190, y: 1 }), wallPoint(plan, { x: 190, y: 143 }), "full")!;
    expect(split.split).toBe(true);
    expect(split.plan.rooms).toHaveLength(3);
    expect(addWall(plan, { x: 150, y: 40 }, { x: 155, y: 40 }, "full")).toBeNull();
  });
});
