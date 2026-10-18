import { describe, expect, it } from "vitest";
import type { FloorPlan } from "@/lib/model/schema";
import { closetSpotAt, isClosetRod, leftoverClosets, placeCloset, removeLeftoverCloset, CLOSET_SIZES } from "@/lib/furnish/closets";
import { canAutoFurnish, furnishLevel, furnishRoom, furnishSummary, previewLines } from "@/lib/furnish/autoFurnish";
import { layerItems, placeCheck, removeItem } from "@/lib/furnish/layer";
import { ghostAt, placeGhost } from "@/lib/furnish/stage";
import { emptyPlan, makeRoom, planOf } from "@/lib/plan/edit";
import { newOpening } from "@/lib/plan/connect";
import { openingGeometries } from "@/lib/plan/walls";
import { cabinetLayout } from "@/lib/plan/cabinets";
import { fixtureHookups } from "@/lib/plan/devices";
import { planWarnings } from "@/lib/plan/checks";
import { openingType } from "@/lib/plan/catalog";
import { motionOf } from "@/lib/house3d/doors";
import { defaultBasics } from "@/lib/plan/basics";
import { MAIN_LEVEL_ID, levelFor } from "@/lib/brief/levels";
import { pointInPolygon, polygonArea } from "@/lib/plan/geometry";
import { HouseSystems } from "@/lib/model/schema";
import { house, RANCH, TWO_STORY } from "./samples";
import { describeChange } from "@/lib/store/describe";
import { createProject } from "@/lib/model/project";

const withPlan = (plan: FloorPlan) => {
  const p = createProject("T");
  return { ...p, floorPlans: { [MAIN_LEVEL_ID]: plan } };
};

const SYSTEMS = HouseSystems.parse({});
const sq = (x0: number, y0: number, x1: number, y1: number) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

/** A 12' x 12' bedroom with a door on its south wall. */
function bedroom(): { plan: FloorPlan; bed: string } {
  const bed = makeRoom(sq(0, 0, 144, 144), "Bedroom", { type: "bedroom" });
  const plan = { ...emptyPlan(), rooms: [bed] };
  const south = bed.polygon.findIndex((p, i) => p.y === 144 && bed.polygon[(i + 1) % 4].y === 144);
  return { plan: { ...plan, openings: [newOpening("door-hinged", { roomId: bed.id, edge: south }, 100, 1, 32)] }, bed: bed.id };
}

const levels = [levelFor(MAIN_LEVEL_ID)];

describe("closet pieces", () => {
  it("puts a reach-in in a corner: walls on the open sides, a bifold door and the rod, in one change", () => {
    const { plan, bed } = bedroom();
    const spot = closetSpotAt(plan, "reach-in", { x: 10, y: 20 }, CLOSET_SIZES["reach-in"])!;
    expect(spot.ok).toBe(true);
    // In the north-west corner: only one side needs a wall.
    expect(spot.sides.filter(Boolean)).toHaveLength(1);
    const out = placeCloset(plan, spot);
    expect(out.id && isClosetRod(out.id)).toBe(true);
    expect(out.plan.walls).toHaveLength(2);
    const door = out.plan.openings.find((o) => o.id.endsWith("-door"))!;
    expect(door.style).toBe("door-bifold");
    expect("wallId" in door.host).toBe(true);
    expect(door.widthIn).toBe(60);
    const rod = out.plan.fixtures.find((f) => f.id === out.id)!;
    expect(rod.kind).toBe("closet");
    expect(rod.roomId).toBe(bed);
    // The reach-in stays part of the bedroom.
    expect(out.plan.rooms).toHaveLength(1);
    expect(leftoverClosets(out.plan)).toEqual([]);
    expect(describeChange(withPlan(plan), withPlan(out.plan))).toBe("add a closet in Bedroom");
  });

  it("won't cover a doorway or go where there's no room to walk", () => {
    const { plan } = bedroom();
    const door = openingGeometries(plan)[0].center;
    const atDoor = closetSpotAt(plan, "reach-in", { x: door.x, y: door.y - 10 }, CLOSET_SIZES["reach-in"])!;
    expect(atDoor.ok).toBe(false);
    expect(atDoor.problem).toMatch(/doorway/);
    const deep = closetSpotAt(plan, "walk-in", { x: 72, y: 10 }, { widthIn: 120, depthIn: 120 })!;
    expect(deep.ok).toBe(false);
  });

  it("makes a walk-in its own closet room with a door, through splitRoom", () => {
    const big = makeRoom(sq(0, 0, 192, 168), "Primary bedroom", { type: "primary-bedroom" });
    const plan = { ...emptyPlan(), rooms: [big] };
    const spot = closetSpotAt(plan, "walk-in", { x: 20, y: 20 }, CLOSET_SIZES["walk-in"])!;
    expect(spot.ok).toBe(true);
    const out = placeCloset(plan, spot);
    expect(out.plan.rooms).toHaveLength(2);
    const closet = out.plan.rooms.find((r) => r.type === "closet")!;
    expect(closet.name).toBe("Walk-in closet");
    expect(out.roomId).toBe(closet.id);
    expect(Math.round(polygonArea(closet.polygon) / 144)).toBe(36);
    const door = out.plan.openings.find((o) => o.id.endsWith("-door"))!;
    expect(door.host).toMatchObject({ roomId: closet.id });
    const rod = out.plan.fixtures.find((f) => f.id === out.id)!;
    expect(rod.roomId).toBe(closet.id);
    expect(pointInPolygon(rod, closet.polygon)).toBe(true);
    // The bedroom kept its id and name.
    expect(out.plan.rooms.find((r) => r.id === big.id)?.name).toBe("Primary bedroom");
  });

  it("places through the Furnish ghost like any item", () => {
    const { plan } = bedroom();
    const g = ghostAt(plan, "closet:reach-in", { x: 140, y: 10 }, 0, layerItems(plan), 96, { widthIn: 60, depthIn: 26 })!;
    expect(g.check.ok).toBe(true);
    expect(g.widthIn).toBe(60);
    const out = placeGhost(plan, g);
    expect(out.plan.walls.length).toBeGreaterThan(0);
    expect(out.plan.fixtures).toHaveLength(1);
  });

  it("deleting the rod leaves the walls, and Things to check offers to remove them", () => {
    const { plan } = bedroom();
    const out = placeCloset(plan, closetSpotAt(plan, "reach-in", { x: 10, y: 20 }, CLOSET_SIZES["reach-in"])!);
    const gone = removeItem(out.plan, { kind: "fixture", id: out.id! });
    expect(gone.walls).toHaveLength(2);
    const left = leftoverClosets(gone);
    expect(left).toHaveLength(1);
    expect(left[0].wallIds).toHaveLength(2);
    const w = planWarnings({ [MAIN_LEVEL_ID]: gone }, { levels, brief: null, basics: defaultBasics() }).find((x) => x.closetWalls);
    expect(w?.text).toMatch(/still there/);
    const cleared = removeLeftoverCloset(gone, left[0]);
    expect(cleared.walls).toHaveLength(0);
    expect(cleared.openings).toHaveLength(1);
    expect(leftoverClosets(cleared)).toEqual([]);
  });

  it("joins a walk-in's room back into the bedroom when its walls are removed", () => {
    const big = makeRoom(sq(0, 0, 192, 168), "Primary bedroom", { type: "primary-bedroom" });
    const out = placeCloset({ ...emptyPlan(), rooms: [big] }, closetSpotAt({ ...emptyPlan(), rooms: [big] }, "walk-in", { x: 20, y: 20 }, CLOSET_SIZES["walk-in"])!);
    const gone = removeItem(out.plan, { kind: "fixture", id: out.id! });
    const [lc] = leftoverClosets(gone);
    expect(lc.roomId).toBeTruthy();
    expect(lc.besideId).toBe(big.id);
    const back = removeLeftoverCloset(gone, lc);
    expect(back.rooms).toHaveLength(1);
    expect(back.rooms[0].id).toBe(big.id);
    expect(back.openings).toHaveLength(0);
  });

  it("has a bifold door style that slides open in the walkthrough", () => {
    expect(openingType("door-bifold").kind).toBe("door");
    expect(motionOf("door-bifold")).toBe("slide");
  });
});

describe("Furnish for me", () => {
  it("fills a kitchen: counter, sink, dishwasher, range and fridge, with cabinets and hookups following", () => {
    const k = makeRoom(sq(0, 0, 168, 144), "Kitchen", { type: "kitchen" });
    const south = k.polygon.findIndex((p, i) => p.y === 144 && k.polygon[(i + 1) % 4].y === 144);
    const plan = { ...emptyPlan(), rooms: [k], openings: [newOpening("opening", { roomId: k.id, edge: south }, 84, 1, 48)] };
    const res = furnishRoom(plan, k.id);
    const kinds = res.plan.fixtures.map((f) => f.kind).sort();
    expect(kinds).toEqual(["counter", "dishwasher", "fridge", "range", "sink"]);
    expect(res.notes).toEqual([]);
    for (const it of layerItems(res.plan)) {
      const c = placeCheck(res.plan, { ...it }, layerItems(res.plan));
      expect(c.ok, it.label).toBe(true);
      expect(c.blocksDoors, it.label).toEqual([]);
    }
    expect(cabinetLayout(res.plan, 96).cabinets.length).toBeGreaterThan(0);
    expect(fixtureHookups(res.plan, SYSTEMS).some((d) => d.kind === "water")).toBe(true);
    // Running it again adds nothing.
    expect(furnishRoom(res.plan, k.id).placed).toBe(0);
  });

  it("gives a bath too small for a tub a shower, and says so", () => {
    // 4'2" x 9'2", with the door in the middle of a long wall: no 5' stretch of wall is clear of it.
    const b = makeRoom(sq(0, 0, 50, 110), "Bath 2", { type: "bathroom" });
    const east = b.polygon.findIndex((p, i) => p.x === 50 && b.polygon[(i + 1) % 4].x === 50);
    const res = furnishRoom({ ...emptyPlan(), rooms: [b], openings: [newOpening("door-hinged", { roomId: b.id, edge: east }, 55, 1, 32)] }, b.id);
    expect(res.plan.fixtures.map((f) => f.kind)).toContain("shower");
    expect(res.plan.fixtures.map((f) => f.kind)).not.toContain("tub");
    expect(res.notes[0]).toMatch(/^No room for a tub in Bath 2: it got a \d+" shower\.$/);
  });

  it("gives a bedroom without one a reach-in closet", () => {
    const { plan, bed } = bedroom();
    const res = furnishRoom(plan, bed);
    expect(res.placed).toBe(1);
    expect(res.plan.walls.length).toBeGreaterThan(0);
    expect(res.plan.fixtures[0].kind).toBe("closet");
    expect(furnishRoom(res.plan, bed).placed).toBe(0);
  });

  it("furnishes every room of the sample houses, clear of doors", () => {
    for (const types of [RANCH, TWO_STORY]) {
      const project = house(types);
      for (const level of project.levels) {
        const plan = planOf(project.floorPlans, level.id);
        const res = furnishLevel(plan);
        const want = plan.rooms.filter((r) => canAutoFurnish(r) && r.type !== "bedroom" && r.type !== "primary-bedroom" && r.type !== "guest-suite");
        for (const r of want) expect(res.rooms, r.name).toContain(r.name);
        const before = new Set(layerItems(plan).map((i) => i.id));
        const added = layerItems(res.plan).filter((i) => !before.has(i.id));
        for (const it of added) expect(placeCheck(res.plan, it, layerItems(res.plan)).blocksDoors, it.label).toEqual([]);
      }
    }
    expect(furnishSummary({ placed: 3, rooms: ["Kitchen"] })).toMatch(/put 3 things in Kitchen/);
  });

  it("Full adds furniture that fits, clear of doors; Minimal adds none; running it again adds nothing", () => {
    for (const types of [RANCH, TWO_STORY]) {
      const project = house(types);
      for (const level of project.levels) {
        const plan = planOf(project.floorPlans, level.id);
        expect(furnishLevel(plan).plan.furniture).toEqual(plan.furniture);
        const res = furnishLevel(plan, 96, "full");
        const added = new Set(res.added.map((a) => a.id));
        const items = layerItems(res.plan);
        for (const it of items.filter((i) => added.has(i.id))) {
          const c = placeCheck(res.plan, it, items);
          expect(c.ok, it.label).toBe(true);
          expect(c.blocksDoors, it.label).toEqual([]);
        }
        expect(furnishLevel(res.plan, 96, "full").placed).toBe(0);
      }
    }
    const ranch = planOf(house(RANCH).floorPlans, MAIN_LEVEL_ID);
    const kinds = furnishLevel(ranch, 96, "full").plan.furniture.map((f) => f.kind);
    for (const k of ["bed-king", "nightstand", "dresser", "sofa", "coffee-table", "tv-stand", "dining-table"]) expect(kinds, k).toContain(k);
  });

  it("a desk chair faces its desk, and the preview lists what would go in each room", () => {
    const o = makeRoom(sq(0, 0, 120, 120), "Office", { type: "office" });
    const south = o.polygon.findIndex((p, i) => p.y === 120 && o.polygon[(i + 1) % 4].y === 120);
    const plan = { ...emptyPlan(), rooms: [o], openings: [newOpening("door-hinged", { roomId: o.id, edge: south }, 20, 1, 32)] };
    expect(canAutoFurnish(o)).toBe(false);
    expect(canAutoFurnish(o, "full")).toBe(true);
    expect(furnishRoom(plan, o.id).placed).toBe(0);
    const res = furnishRoom(plan, o.id, 96, "full");
    const desk = res.plan.furniture.find((f) => f.kind === "desk")!;
    const chair = res.plan.furniture.find((f) => f.kind === "desk-chair")!;
    expect(Math.abs(((chair.rotation - desk.rotation + 360) % 360) - 180)).toBeLessThan(1);
    // Nothing is saved by a preview: the plan passed in is unchanged.
    expect(plan.furniture).toEqual([]);
    expect(previewLines(res.added)).toEqual([{ room: "Office", items: "Desk, Desk chair, Snake plant" }]);
    expect(previewLines([...res.added, { id: "x", label: "Nightstand", room: "Office", roomId: o.id }, { id: "y", label: "Nightstand", room: "Office", roomId: o.id }])[0].items).toBe("Desk, Desk chair, Snake plant, 2 nightstands");
  });
});
