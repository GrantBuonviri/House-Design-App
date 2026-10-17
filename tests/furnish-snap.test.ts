import { describe, expect, it } from "vitest";
import type { FloorPlan } from "@/lib/model/schema";
import { emptyPlan, makeRoom } from "@/lib/plan/edit";
import { layerItems, placeCheck, placeItem } from "@/lib/furnish/layer";
import { dragItem, ghostAt } from "@/lib/furnish/stage";
import { lineUp } from "@/lib/furnish/snapping";
import { clearanceNote, clearanceRule, clearanceZones } from "@/lib/furnish/clearance";

/** A 12' x 12' bedroom (x 120-264, y 0-144) beside a 10' x 8' bath. */
function rooms(): FloorPlan {
  const bath = makeRoom([{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 96 }, { x: 0, y: 96 }], "Bath", { type: "bathroom" });
  const bed = makeRoom([{ x: 120, y: 0 }, { x: 264, y: 0 }, { x: 264, y: 144 }, { x: 120, y: 144 }], "Bedroom", { type: "bedroom" });
  return { ...emptyPlan(), rooms: [bath, bed] };
}

/** The bedroom with a queen bed backed onto its top wall, in the middle. */
function withBed() {
  const plan = rooms();
  const g = ghostAt(plan, "furniture:bed-queen", { x: 192, y: 30 }, 0, layerItems(plan))!;
  const out = placeItem(plan, g.entryId, { x: g.x, y: g.y }, { rotation: g.rotation });
  return { plan: out.plan, bed: layerItems(out.plan).find((x) => x.id === out.id)! };
}

describe("lining furniture up", () => {
  it("slides a nightstand up against the side of the bed", () => {
    const { plan, bed } = withBed();
    expect(bed.x).toBe(192);
    // 4" away from the bed's right side, on the same wall.
    const g = ghostAt(plan, "furniture:nightstand", { x: 192 + 32 + 11 + 4, y: 20 }, 0, layerItems(plan))!;
    expect(g.x).toBeCloseTo(192 + 32 + 11 + 0.1, 1);
    expect(g.y).toBe(18 / 2 + 2.5);
    expect(g.check.ok).toBe(true);
    expect(g.snaps?.length).toBe(1);
    // Too far from the bed: it goes into the corner instead.
    const far = ghostAt(plan, "furniture:nightstand", { x: 192 + 32 + 11 + 12, y: 8 }, 0, layerItems(plan))!;
    expect(far.x).toBeCloseTo(264 - 2.5 - 11, 1);
  });

  it("stays where the mouse is when nothing is close", () => {
    const plan = rooms();
    const g = ghostAt(plan, "furniture:nightstand", { x: 192, y: 8 }, 0, [])!;
    expect(g.x).toBe(192);
    expect(g.snaps).toEqual([]);
  });

  it("slides into the corner when it's close", () => {
    const plan = rooms();
    // A dresser on the top wall, its left side 4" short of where the corner snap puts it.
    const g = ghostAt(plan, "furniture:dresser", { x: 120 + 2.5 + 30 + 4, y: 20 }, 0, [])!;
    expect(g.x).toBeCloseTo(120 + 2.5 + 30, 1);
    expect(g.check.ok).toBe(true);
  });

  it("lines up the middles of things on facing walls, both ways for free-standing ones", () => {
    const { plan, bed } = withBed();
    // A dresser on the bottom wall, a little off the bed's middle.
    const g = ghostAt(plan, "furniture:dresser", { x: 192.6, y: 130 }, 0, layerItems(plan))!;
    expect(g.rotation).toBe(180);
    expect(g.x).toBeCloseTo(bed.x, 1);
    // A free-standing bench at the bed's foot: touches the foot and centers on it.
    const bench = lineUp(plan, { entryId: "furniture:bench", x: 194, y: 45.5 + 43 + 8 + 4, rotation: 0, widthIn: 48, depthIn: 16, mount: "floor" }, layerItems(plan), false);
    expect(bench.x).toBeCloseTo(192, 1);
    expect(bench.y).toBeCloseTo(45.5 + 43 + 8 + 0.1, 1);
    expect(bench.lines.length).toBe(2);
  });

  it("dragging lines up too, and Alt drags freely", () => {
    const { plan } = withBed();
    const ns = placeItem(plan, "furniture:nightstand", { x: 250, y: 11.5 }, { rotation: 0 });
    const items = layerItems(ns.plan);
    const item = items.find((x) => x.id === ns.id)!;
    const snapped = dragItem(ns.plan, item, { x: 239, y: 11.5 }, items);
    expect(snapped.item.x).toBeCloseTo(235.1, 1);
    expect(snapped.snaps.length).toBe(1);
    expect(snapped.check.ok).toBe(true);
    const free = dragItem(ns.plan, item, { x: 239, y: 11.5 }, items, true);
    expect(free.item.x).toBe(239);
    expect(free.snaps).toEqual([]);
  });

  it("never lines up with things in another room or turned some other way", () => {
    const plan = rooms();
    const t = placeItem(plan, "fixture:vanity", { x: 60, y: 13 }, { rotation: 0 });
    // A dresser just through the wall from the vanity doesn't line up with it.
    const s = lineUp(t.plan, { entryId: "furniture:dresser", x: 155, y: 12.5, rotation: 0, widthIn: 60, depthIn: 20, mount: "floor" }, layerItems(t.plan), true);
    expect(s.lines).toEqual([]);
    const { plan: p2 } = withBed();
    const odd = lineUp(p2, { entryId: "furniture:armchair", x: 195, y: 110, rotation: 45, widthIn: 34, depthIn: 34, mount: "floor" }, layerItems(p2), false);
    expect(odd).toMatchObject({ x: 195, y: 110, lines: [] });
  });

  it("lined-up items never count as on top of each other", () => {
    const { plan } = withBed();
    const g = ghostAt(plan, "furniture:nightstand", { x: 192 - 32 - 11 - 3, y: 20 }, 0, layerItems(plan))!;
    expect(placeCheck(plan, { entryId: g.entryId, x: g.x, y: g.y, rotation: g.rotation, widthIn: g.widthIn, depthIn: g.depthIn }).ok).toBe(true);
  });
});

describe("room to move", () => {
  it("has rules for toilets, islands, beds and furniture walkways", () => {
    expect(clearanceRule("fixture:toilet")?.front).toBe(30);
    expect(clearanceRule("fixture:island")).toMatchObject({ front: 42, sides: 42, back: 42 });
    expect(clearanceRule("furniture:sofa")?.front).toBe(36);
    expect(clearanceRule("furniture:rug-large")).toBeNull();
    expect(clearanceRule("furniture:nightstand")).toBeNull();
    expect(clearanceRule("device:outlet")).toBeNull();
  });

  it("is clear in front of a toilet with room, and red when the far wall is too close", () => {
    const plan = rooms();
    const g = ghostAt(plan, "fixture:toilet", { x: 60, y: 10 }, 0, [])!;
    const zones = clearanceZones(plan, { ...g, mount: "floor" }, []);
    expect(zones).toHaveLength(1);
    expect(zones[0].blocked).toBe(false);
    expect(clearanceNote(zones)).toBe(`30" in front of a toilet`);
    // A narrow 4' bath: the 30" zone runs into the far wall.
    const tight: FloorPlan = { ...emptyPlan(), rooms: [makeRoom([{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 48 }, { x: 0, y: 48 }], "Bath", { type: "bathroom" })] };
    const t = ghostAt(tight, "fixture:toilet", { x: 30, y: 10 }, 0, [])!;
    const bad = clearanceZones(tight, { ...t, mount: "floor" }, []);
    expect(bad[0].blocked).toBe(true);
    expect(clearanceNote(bad)).toBe(`Less than 30" in front of a toilet (a wall is in the way)`);
  });

  it("names the furniture in the way, but not a nightstand by the bed", () => {
    const { plan, bed } = withBed();
    const ns = placeItem(plan, "furniture:nightstand", { x: 235.1, y: 11.5 }, { rotation: 0 });
    const clear = clearanceZones(ns.plan, bed, layerItems(ns.plan));
    expect(clear.map((z) => z.blocked)).toEqual([false, false, false]);
    const sofa = placeItem(ns.plan, "furniture:armchair", { x: 192, y: 45.5 + 43 + 20 }, { rotation: 0 });
    const zones = clearanceZones(sofa.plan, bed, layerItems(sofa.plan));
    expect(clearanceNote(zones)).toBe(`Less than 24" beside a bed, 36" at its foot (the armchair is in the way)`);
  });

  it("is nothing for wall-hung things", () => {
    const plan = rooms();
    expect(clearanceZones(plan, { entryId: "fixture:toilet", x: 60, y: 20, rotation: 0, widthIn: 20, depthIn: 28, mount: "wall" }, [])).toEqual([]);
  });
});
