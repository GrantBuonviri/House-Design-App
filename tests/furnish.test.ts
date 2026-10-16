import { describe, expect, it } from "vitest";
import { HouseSystems, SCHEMA_VERSION, type FloorPlan } from "@/lib/model/schema";
import { createProject, migrateProject } from "@/lib/model/project";
import { FURNISH_CATALOG, FURNISH_GROUPS, catalogEntry, catalogGroups, entryFor, swapChoices } from "@/lib/furnish/catalog";
import { carryFurnish, furnishOf, furnishProblems, layerItems, moveInside, moveItem, placeCheck, placeItem, removeItem, resizeItem, snapToWall, swapItem, turnItem, updateItem, withFurnish } from "@/lib/furnish/layer";
import { emptyPlan, makeRoom, moveMany, planOf, removeMany, rotateMany } from "@/lib/plan/edit";
import { duplicateMany, mirrorMany } from "@/lib/plan/arrange";
import { cabinetLayout } from "@/lib/plan/cabinets";
import { fixtureHookups } from "@/lib/plan/devices";
import { mirrorPlans } from "@/lib/plan/changes";
import { ruleAlternatives } from "@/lib/plan/alternatives";
import { suggestPlans } from "@/lib/plan/suggest";
import { planWarnings } from "@/lib/plan/checks";
import { pointInPolygon } from "@/lib/plan/geometry";
import { buildHouse, type HouseContext } from "@/lib/house3d/build";
import { walkWorld } from "@/lib/house3d/walk";
import { siteFor } from "@/lib/house3d/site";
import { levelHeights } from "@/lib/house3d/levels";
import { MAIN_LEVEL_ID, levelFor } from "@/lib/brief/levels";
import { defaultBasics } from "@/lib/plan/basics";
import { House3D } from "@/lib/model/schema";
import { house, RANCH } from "./samples";
import { copyToRooms, dragItem, duplicateItem, furnishLayouts, ghostAt, patchItem, placeGhost, sameTypeRooms, setWallGap, stageItems, wallGaps } from "@/lib/furnish/stage";
import { describeChange } from "@/lib/store/describe";
import { PLAN_TOOLS } from "@/components/plan/types";

const SYSTEMS = HouseSystems.parse({});

/** A 10' x 8' bath beside a 12' x 12' bedroom. */
function twoRooms(): { plan: FloorPlan; bath: string; bed: string } {
  const bath = makeRoom([{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 96 }, { x: 0, y: 96 }], "Bath", { type: "bathroom" });
  const bed = makeRoom([{ x: 120, y: 0 }, { x: 264, y: 0 }, { x: 264, y: 144 }, { x: 120, y: 144 }], "Bedroom", { type: "bedroom" });
  return { plan: { ...emptyPlan(), rooms: [bath, bed] }, bath: bath.id, bed: bed.id };
}

const only = (plan: FloorPlan, id: string | null) => layerItems(plan).find((x) => x.id === id)!;

describe("furnish catalog", () => {
  it("has every group and resolves every entry", () => {
    expect(new Set(FURNISH_CATALOG.map((e) => e.id)).size).toBe(FURNISH_CATALOG.length);
    for (const g of FURNISH_GROUPS) expect(FURNISH_CATALOG.some((e) => e.group === g)).toBe(true);
    for (const e of FURNISH_CATALOG) {
      expect(catalogEntry(e.id)).toBe(e);
      expect(e.widthIn).toBeGreaterThan(0);
      expect(e.heightIn).toBeGreaterThan(0);
    }
    for (const k of ["toilet", "fireplace", "closet"]) expect(entryFor("fixture", k)?.kind).toBe("fixture");
    for (const k of ["water", "drain", "gas", "dryer-vent", "outlet-240"]) expect(entryFor("device", k)?.kind).toBe("hookup");
    for (const k of ["corner", "pantry", "open-shelf", "appliance-garage", "wine"]) expect(entryFor("cabinet", k)).toBeTruthy();
    expect(catalogEntry("addon:ceiling-fan")?.mount).toBe("ceiling");
    expect(catalogEntry("closet:walk-in")?.kind).toBe("closet");
    expect(catalogEntry("opening:door-hinged")?.group).toBe("Doors and windows");
    expect(catalogEntry("wall:half")?.group).toBe("Walls");
    expect(catalogEntry("furniture:sofa")?.priced).toBe(false);
  });

  it("searches by name and offers swaps from the same group", () => {
    expect(catalogGroups("towel").flatMap((g) => g.entries.map((e) => e.id))).toEqual(["addon:towel-bar"]);
    const swaps = swapChoices("fixture:toilet").map((e) => e.id);
    expect(swaps).toContain("fixture:tub");
    expect(swaps).not.toContain("fixture:range");
  });
});

describe("furnish layer edits", () => {
  it("places, moves, turns, resizes and removes every kind of item", () => {
    const { plan, bed } = twoRooms();
    for (const e of FURNISH_CATALOG.filter((x) => !["closet", "opening", "wall"].includes(x.kind))) {
      const placed = placeItem(plan, e.id, { x: 190, y: 70 });
      expect(placed.id, e.id).toBeTruthy();
      const it0 = only(placed.plan, placed.id);
      expect(it0.entryId).toBe(e.id);
      expect(it0.roomId).toBe(bed);
      let p = moveItem(placed.plan, it0, { x: 200, y: 80 });
      const moved = only(p, placed.id);
      expect([moved.x, moved.y]).toEqual([200, 80]);
      p = turnItem(p, moved, 90);
      expect(only(p, placed.id).rotation).toBe(90);
      if (it0.kind !== "device") {
        p = resizeItem(p, only(p, placed.id), { widthIn: 20 });
        expect(only(p, placed.id).widthIn).toBe(20);
      }
      p = removeItem(p, only(p, placed.id));
      expect(layerItems(p)).toHaveLength(0);
    }
  });

  it("keeps the layer apart with furnishOf and withFurnish", () => {
    const { plan } = twoRooms();
    const { plan: p } = placeItem(plan, "addon:bookcase", { x: 200, y: 20 });
    const layer = furnishOf(p);
    expect(layer.addOns).toHaveLength(1);
    const back = withFurnish(plan, layer);
    expect(back.addOns).toEqual(p.addOns);
    expect(back.rooms).toBe(plan.rooms);
    expect(withFurnish(plan, furnishOf(plan))).not.toHaveProperty("cabinets");
  });

  it("swaps an item for another in the same spot", () => {
    const { plan } = twoRooms();
    const placed = placeItem(plan, "fixture:toilet", { x: 40, y: 20 }, { rotation: 0 });
    const s = swapItem(placed.plan, only(placed.plan, placed.id), "fixture:shower");
    expect(s.plan.fixtures.map((f) => f.kind)).toEqual(["shower"]);
    expect(s.plan.fixtures[0].roomId).toBe(placed.plan.fixtures[0].roomId);
  });

  it("backs floor items onto a wall and lays wall items flat on it", () => {
    const { plan } = twoRooms();
    const floor = snapToWall(plan, { x: 190, y: 20 }, { widthIn: 36, depthIn: 12, mount: "floor" })!;
    expect(floor.y).toBeCloseTo(6 + 2.5, 1);
    expect(floor.rotation).toBe(0);
    const wall = snapToWall(plan, { x: 200, y: 130 }, { widthIn: 30, depthIn: 1, mount: "wall" })!;
    expect(wall.y).toBeCloseTo(144 - 0.5 - 2.5, 1);
    expect(snapToWall(plan, { x: 190, y: 70 }, { widthIn: 30, depthIn: 1, mount: "wall" })).toBeNull();
    expect(snapToWall(plan, { x: 190, y: 20 }, { widthIn: 52, depthIn: 52, mount: "ceiling" })).toBeNull();
  });

  it("checks a spot for any kind", () => {
    const { plan } = twoRooms();
    const at = (entryId: string, x: number, y: number, rotation = 0) => {
      const e = catalogEntry(entryId)!;
      return { entryId, x, y, rotation, widthIn: e.widthIn, depthIn: e.depthIn, heightIn: e.heightIn, bottomIn: e.bottomIn };
    };
    expect(placeCheck(plan, at("addon:bookcase", 190, 70)).ok).toBe(true);
    expect(placeCheck(plan, at("addon:bookcase", 120, 70)).problem).toMatch(/through a wall/);
    expect(placeCheck(plan, at("addon:bookcase", 400, 70)).problem).toMatch(/inside a room/);
    expect(placeCheck(plan, at("addon:mirror", 190, 70)).problem).toMatch(/on a wall/);
    expect(placeCheck(plan, at("addon:mirror", 190, 3.5)).ok).toBe(true);
    expect(placeCheck(plan, at("addon:ceiling-fan", 190, 70)).ok).toBe(true);
    const { plan: withBench } = placeItem(plan, "addon:bench", { x: 190, y: 70 });
    expect(placeCheck(withBench, at("addon:bookcase", 190, 70)).problem).toMatch(/on top of the built-in bench/);
    // A sink sits in a counter.
    const { plan: withCounter } = placeItem(plan, "fixture:counter", { x: 190, y: 20 });
    expect(placeCheck(withCounter, at("fixture:sink", 190, 20)).ok).toBe(true);
  });

  it("hides an app-placed cabinet and keeps it hidden when the layout rebuilds", () => {
    const { plan } = twoRooms();
    const { plan: p, id } = placeItem(plan, "fixture:counter", { x: 192, y: 15 }, { widthIn: 120 });
    const auto = cabinetLayout(p, 96).cabinets.filter((c) => c.auto);
    expect(auto.length).toBeGreaterThan(1);
    const items = layerItems(p, { cabinets: cabinetLayout(p, 96).cabinets });
    const target = items.find((x) => x.id === auto[0].id)!;
    expect(target.auto).toBe(true);
    let next = removeItem(p, target);
    // Move the counter: the layout is made again, with the same ids.
    next = moveItem(next, only(next, id), { x: 196, y: 15 });
    const again = cabinetLayout(next, 96).cabinets;
    expect(again.some((c) => c.id === auto[0].id)).toBe(false);
    expect(again.filter((c) => c.auto).length).toBe(auto.length - 1);
    // Moving an app-placed cabinet swaps it for a hand-placed copy.
    const second = layerItems(next, { cabinets: again }).find((x) => x.id === auto[1].id)!;
    const moved = updateItem(next, second, { widthIn: 18 });
    expect(moved.cabinets!.hidden).toContain(auto[1].id);
    expect(moved.cabinets!.added.at(-1)!.widthIn).toBe(18);
  });

  it("gives fixtures their own hookups, which follow a moved toilet", () => {
    const { plan } = twoRooms();
    const { plan: p, id } = placeItem(plan, "fixture:toilet", { x: 40, y: 20 });
    const hk = fixtureHookups(p, SYSTEMS);
    expect(hk.map((d) => d.id).sort()).toEqual([`hk:${id}:drain`, `hk:${id}:water`]);
    const moved = moveItem(p, only(p, id), { x: 80, y: 20 });
    const hk2 = fixtureHookups(moved, SYSTEMS);
    expect(hk2.every((d) => Math.abs(d.x - 80) < 12)).toBe(true);
    // Gas follows the fuel choices.
    const { plan: withDryer, id: dryer } = placeItem(plan, "fixture:dryer", { x: 200, y: 20 });
    expect(fixtureHookups(withDryer, SYSTEMS).map((d) => d.kind)).toEqual(["dryer-vent"]);
    expect(fixtureHookups(withDryer, { ...SYSTEMS, dryer: "gas" }).map((d) => d.id)).toEqual([`hk:${dryer}:gas`, `hk:${dryer}:dryer-vent`]);
  });
});

describe("furnish items ride with their room", () => {
  it("moves, turns, copies, flips and keeps them when the room goes", () => {
    const { plan, bath } = twoRooms();
    let p = placeItem(plan, "addon:towel-bar", { x: 60, y: 3 }).plan;
    p = placeItem(p, "device:water", { x: 20, y: 3 }).plan;
    p = placeItem(p, "cabinet:open-shelf", { x: 60, y: 90 }).plan;
    const moved = moveMany(p, [bath], -200, 0);
    expect(moved.addOns![0].x).toBe(-140);
    expect(moved.devices!.added[0].x).toBe(-180);
    expect(moved.cabinets!.added[0].x).toBe(-140);
    const turned = rotateMany(p, [bath], 90, { x: 60, y: 48 });
    expect(turned.addOns![0].rotation).toBe(90);
    const copy = duplicateMany(p, [bath]);
    expect(copy.plan.addOns).toHaveLength(2);
    expect(copy.plan.devices!.added).toHaveLength(2);
    expect(new Set(copy.plan.addOns!.map((a) => a.roomId)).size).toBe(2);
    const flipped = mirrorMany(p, [bath], "left-right");
    expect(flipped.addOns![0].x).toBe(60);
    expect(flipped.devices!.added[0].x).toBe(100);
    const gone = removeMany(p, [bath]);
    expect(gone.addOns).toHaveLength(1);
    expect(gone.addOns![0].roomId).toBeUndefined();
  });

  it("survive Suggest a plan, a flipped plan and an alternative", () => {
    const proj = house(RANCH);
    const ctx = { brief: proj.brief!, plot: proj.plot, levels: proj.levels, basics: proj.plan.basics };
    const old = planOf(proj.floorPlans, "floor-1");
    const bedroom = old.rooms.find((r) => r.type === "bedroom")!;
    const spot = { x: (bedroom.polygon[0].x + bedroom.polygon[2].x) / 2, y: (bedroom.polygon[0].y + bedroom.polygon[2].y) / 2 };
    const placed = placeItem(old, "addon:desk", spot);
    const plans = { ...proj.floorPlans, "floor-1": placed.plan };

    const fresh = suggestPlans(proj.bubbles, ctx).plans["floor-1"];
    const carried = carryFurnish(placed.plan, fresh);
    const desk = carried.addOns!.find((a) => a.kind === "desk")!;
    const room = carried.rooms.find((r) => r.id === desk.roomId)!;
    expect(room.briefRoomId).toBe(bedroom.briefRoomId);
    expect(pointInPolygon(desk, room.polygon)).toBe(true);

    const flipped = mirrorPlans(plans, "x")["floor-1"];
    expect(flipped.addOns).toHaveLength(1);

    const alts = ruleAlternatives(plans, ctx);
    expect(alts.length).toBeGreaterThan(0);
    for (const alt of alts) {
      const p = planOf(alt.plans, "floor-1");
      const d = p.addOns?.find((a) => a.kind === "desk");
      expect(d, alt.title).toBeTruthy();
      expect(p.rooms.some((r) => r.id === d!.roomId)).toBe(true);
    }
  });
});

describe("furnish things to check", () => {
  it("points out items outside their room, off their wall or in a doorway, and moves them back", () => {
    const { plan, bed } = twoRooms();
    const { plan: p, id } = placeItem(plan, "addon:bench", { x: 190, y: 70 });
    expect(furnishProblems(p)).toHaveLength(0);
    // Pushed out of the bedroom (into the bath), it's flagged.
    const out = { ...p, addOns: p.addOns!.map((a) => ({ ...a, x: 60 })) };
    const probs = furnishProblems(out);
    expect(probs.map((x) => x.key)).toEqual([`furnish-out:${id}`]);
    expect(probs[0].text).toMatch(/outside its room \(Bedroom\)/);
    const back = moveInside(out, probs[0].item);
    expect(back.addOns![0].roomId).toBe(bed);
    expect(furnishProblems(back)).toHaveLength(0);
    // Shows in Things to check with its buttons.
    const w = planWarnings({ "floor-1": out }, { levels: createProject("x").levels, brief: null, basics: null }).find((x) => x.furnish);
    expect(w?.furnish).toEqual({ kind: "addon", id, canMoveInside: true });

    const mirror = placeItem(plan, "addon:mirror", { x: 200, y: 3.5 });
    const offWall = { ...mirror.plan, addOns: mirror.plan.addOns!.map((a) => ({ ...a, y: 70 })) };
    expect(furnishProblems(offWall)[0].text).toMatch(/no longer on a wall/);
  });

  it("keeps items that were pushed out of their room through a plan change", () => {
    const { plan, bath } = twoRooms();
    const { plan: p } = placeItem(plan, "fixture:toilet", { x: 40, y: 20 });
    // Moving the room alone (not with the toilet) used to drop it; now it stays and is flagged.
    const shifted = { ...p, rooms: p.rooms.map((r) => (r.id === bath ? { ...r, polygon: r.polygon.map((q) => ({ x: q.x, y: q.y + 200 })) } : r)) };
    expect(furnishProblems(shifted).some((x) => x.item.kind === "fixture")).toBe(true);
  });
});

describe("furnish in 3D and saved data", () => {
  it("draws add-ons, hookups and new cabinet kinds, and walking bumps into floor add-ons", () => {
    const { plan: base } = twoRooms();
    let plan = placeItem(base, "addon:bookcase", { x: 190, y: 70 }).plan;
    plan = placeItem(plan, "fixture:toilet", { x: 40, y: 20 }).plan;
    plan = placeItem(plan, "cabinet:pantry", { x: 240, y: 20 }).plan;
    const plans = { [MAIN_LEVEL_ID]: plan };
    const ctx: HouseContext = { levels: [levelFor(MAIN_LEVEL_ID)], basics: defaultBasics(), house3d: House3D.parse({}), site: siteFor(null, { x: 0, y: 0 }, plans), frame: { ox: 0, oy: 0 } };
    const keys = buildHouse(plans, ctx).parts.map((x) => x.key);
    expect(keys.some((k) => k.includes(":ao:"))).toBe(true);
    expect(keys.some((k) => k.endsWith(":hk"))).toBe(true);
    expect(keys.some((k) => k.endsWith(":cab"))).toBe(true);
    const heights = levelHeights(ctx.levels, ctx.basics);
    const without = walkWorld({ [MAIN_LEVEL_ID]: { ...plan, addOns: [] } }, { ...ctx, heights }).blockers.length;
    expect(walkWorld(plans, { ...ctx, heights }).blockers.length).toBe(without + 4);
  });

  it("opens a version 24 project", () => {
    const p = createProject("Old");
    const v24 = JSON.parse(JSON.stringify({ ...p, schemaVersion: 24, stage: "plan", floorPlans: { "floor-1": emptyPlan() } }));
    delete v24.plan.showFurnishings;
    const m = migrateProject(v24);
    expect(m.schemaVersion).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(25);
    expect(m.floorPlans["floor-1"].addOns).toBeUndefined();
    expect(m.plan.showFurnishings).toBeUndefined();
    const withFurnishStage = migrateProject({ ...JSON.parse(JSON.stringify(m)), stage: "furnish" });
    expect(withFurnishStage.stage).toBe("furnish");
  });
});


describe("the 2D Furnish page", () => {
  it("lists the app's own cabinets with the hand-placed ones, less any hidden", () => {
    const { plan } = twoRooms();
    const { plan: p, id } = placeItem(plan, "fixture:counter", { x: 192, y: 15 }, { widthIn: 120 });
    const layouts = { cabinets: cabinetLayout(p, 96).cabinets, devices: [] };
    const all = stageItems(p, layouts);
    const auto = all.filter((i) => i.kind === "cabinet" && i.auto);
    expect(auto.length).toBeGreaterThan(1);
    expect(all.some((i) => i.id === id)).toBe(true);
    // Dragging one gives a hand-placed copy with a new id, and the app's own is hidden in the preview.
    const drag = dragItem(p, auto[0], { x: auto[0].x + 6, y: auto[0].y }, all);
    expect(drag.id).not.toBe(auto[0].id);
    const preview = stageItems(drag.plan, layouts);
    expect(preview.some((i) => i.id === auto[0].id)).toBe(false);
    expect(preview.some((i) => i.id === drag.id && !i.auto)).toBe(true);
    expect(preview).toHaveLength(all.length);
  });

  it("shows a ghost that backs onto a wall and goes red where it can't go", () => {
    const { plan } = twoRooms();
    const near = ghostAt(plan, "fixture:toilet", { x: 190, y: 20 }, 0, []);
    expect(near?.check.ok).toBe(true);
    // Backed onto the north wall of the bedroom: its back is at the wall.
    expect(near!.y).toBeLessThan(40);
    expect(near!.rotation).toBe(0);
    const turned = ghostAt(plan, "fixture:toilet", { x: 190, y: 20 }, 180, []);
    expect(turned!.rotation).toBe(180);
    const outside = ghostAt(plan, "fixture:toilet", { x: 900, y: 900 }, 0, []);
    expect(outside?.check.ok).toBe(false);
    expect(outside?.check.problem).toMatch(/inside a room/);
    expect(placeGhost(plan, outside!).id).toBeNull();
    const noWall = ghostAt(plan, "addon:mirror", { x: 190, y: 70 }, 0, []);
    expect(noWall?.check.ok).toBe(false);
    expect(ghostAt(plan, "opening:door-hinged", { x: 190, y: 70 }, 0, [])).toBeNull();
    const placed = placeGhost(plan, near!);
    expect(placed.id).toBeTruthy();
    expect(placed.plan.fixtures).toHaveLength(1);
  });

  it("says where a moved app-placed outlet is afterwards", () => {
    const { plan } = twoRooms();
    const { plan: p, id } = placeItem(plan, "device:outlet", { x: 150, y: 2 });
    const it = only(p, id);
    const out = patchItem(p, it, { x: 170, y: 2 });
    expect(out.id).toBe(id);
    expect(only(out.plan, id).x).toBe(170);
  });

  it("measures the walls around an item and moves it to a typed distance", () => {
    const { plan, bed } = twoRooms();
    const { plan: p, id } = placeItem(plan, "furniture:sofa", { x: 192, y: 72 }, { rotation: 0 });
    const it = only(p, id);
    expect(it.roomId).toBe(bed);
    const gaps = wallGaps(p, it);
    const up = gaps.find((g) => g.side === "up")!;
    expect(up.inches).toBeGreaterThan(0);
    const out = setWallGap(p, it, up, 10);
    const moved = only(out.plan, out.id);
    expect(wallGaps(out.plan, moved).find((g) => g.side === "up")!.inches).toBeCloseTo(10, 0);
  });

  it("duplicates an item beside itself and copies it to the other rooms of its kind", () => {
    const b1 = makeRoom([{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 96 }, { x: 0, y: 96 }], "Bath 1", { type: "bathroom" });
    const b2 = makeRoom([{ x: 240, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 96 }, { x: 240, y: 96 }], "Bath 2", { type: "bathroom" });
    const plan: FloorPlan = { ...emptyPlan(), rooms: [b1, b2] };
    const { plan: p, id } = placeItem(plan, "fixture:vanity", { x: 40, y: 13 });
    const it = only(p, id);
    const dup = duplicateItem(p, it)!;
    expect(dup.plan.fixtures).toHaveLength(2);
    expect(dup.id).not.toBe(id);
    expect(sameTypeRooms(p, it).map((r) => r.name)).toEqual(["Bath 2"]);
    const copied = copyToRooms(p, it);
    expect(copied.placed).toBe(1);
    expect(copied.plan.fixtures.find((f) => f.roomId === b2.id)?.kind).toBe("vanity");
    // Nothing to copy to without another room of the kind.
    expect(copyToRooms(dup.plan, only(dup.plan, dup.id)).placed).toBe(1);
  });

  it("names what was placed, moved, recolored and deleted for Undo", () => {
    const project = createProject("Test");
    const level = Object.keys(project.floorPlans)[0] ?? "main";
    const { plan } = twoRooms();
    const mk = (pl: FloorPlan) => ({ ...project, floorPlans: { ...project.floorPlans, [level]: pl } });
    const { plan: p, id } = placeItem(plan, "fixture:toilet", { x: 40, y: 20 });
    expect(describeChange(mk(plan), mk(p))).toBe("place a toilet in Bath");
    expect(describeChange(mk(p), mk(moveItem(p, only(p, id), { x: 70, y: 20 })))).toBe("move the toilet");
    expect(describeChange(mk(p), mk(removeItem(p, only(p, id))))).toBe("delete the toilet in Bath");
    const { plan: q, id: sid } = placeItem(plan, "furniture:sofa", { x: 190, y: 70 });
    expect(describeChange(mk(q), mk(updateItem(q, only(q, sid), { color: "#111111" })))).toBe("recolor the sofa");
  });

  it("no longer has a Fixture tool on the floor plan", () => {
    expect(PLAN_TOOLS.some((t) => (t.id as string) === "fixture")).toBe(false);
    expect(PLAN_TOOLS.some((t) => t.key === "F")).toBe(false);
  });
});

describe("furnish layouts", () => {
  it("reads the app's devices for a sample house floor", () => {
    const project = house(RANCH);
    const level = project.levels[0];
    const l = furnishLayouts(project, level);
    expect(l.devices.length).toBeGreaterThan(0);
    const items = stageItems(project.floorPlans[level.id], l);
    expect(items.some((i) => i.kind === "device" && i.auto)).toBe(true);
  });
});
