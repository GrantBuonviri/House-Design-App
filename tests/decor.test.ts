import { describe, expect, it } from "vitest";
import type { FloorPlan, Opening, Project } from "@/lib/model/schema";
import { createProject, migrateProject } from "@/lib/model/project";
import { FURNISH_CATALOG, catalogEntry, catalogGroups, swapChoices } from "@/lib/furnish/catalog";
import { layerItems, moveItem, placeCheck, placeItem, swapItem } from "@/lib/furnish/layer";
import { ghostAt } from "@/lib/furnish/stage";
import { CURTAIN_ABOVE_IN, CURTAIN_SIDE_IN, coveringFit, fittedAddOns, restHeight } from "@/lib/furnish/decor";
import { furnishLevel, furnishRoom } from "@/lib/furnish/autoFurnish";
import { furnishExtras } from "@/lib/cost/furnishQuantities";
import { emptyPlan, makeRoom } from "@/lib/plan/edit";
import { newFurniture } from "@/lib/plan/furniture";
import { buildHouse, forQuality, type HouseContext, type Part } from "@/lib/house3d/build";
import { siteFor } from "@/lib/house3d/site";
import { MeshBuilder } from "@/lib/house3d/mesh";
import { drawDecorDetail } from "@/lib/house3d/decor3d";
import { MAX_LIVE_LIGHTS, latestHour, lightSources, lightsAmount, linkedRooms, liveLights, nightAmount, type LightSource } from "@/lib/house3d/nightLights";
import { house, RANCH } from "./samples";

/** A 12' x 12' bedroom with a 36" window on its north wall, beside a 10' x 8' bath through a door. */
function bedroom(): { plan: FloorPlan; bed: string; bath: string; win: Opening } {
  const bed = makeRoom([{ x: 120, y: 0 }, { x: 264, y: 0 }, { x: 264, y: 144 }, { x: 120, y: 144 }], "Bedroom", { type: "bedroom" });
  const bath = makeRoom([{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 96 }, { x: 0, y: 96 }], "Bath", { type: "bathroom" });
  const win: Opening = { id: "w1", host: { roomId: bed.id, edge: 0 }, offsetIn: 72, kind: "window", style: "window", widthIn: 36, heightIn: 48, sillIn: 30, side: 1, hinge: "start" };
  const door: Opening = { id: "d1", host: { roomId: bed.id, edge: 3 }, offsetIn: 96, kind: "door", style: "door-hinged", widthIn: 30, heightIn: 80, side: 1, hinge: "start" };
  return { plan: { ...emptyPlan(), rooms: [bed, bath], openings: [win, door] }, bed: bed.id, bath: bath.id, win };
}

const ctxFor = (p: Project): HouseContext => ({ levels: p.levels, basics: p.plan.basics, house3d: p.house3d, site: siteFor(p.plot, { x: 0, y: 0 }, p.floorPlans), frame: { ox: 0, oy: 0 }, exterior: p.exterior });
const tris = (parts: Part[]) => parts.reduce((n, p) => n + p.mesh.count, 0);

describe("the Decor group", () => {
  it("lists lamps, plants, art, rugs, pillows, curtains and blinds, none of them priced", () => {
    const decor = catalogGroups().find((g) => g.group === "Decor")!.entries;
    const ids = decor.map((e) => e.id);
    for (const id of ["addon:table-lamp", "furniture:floor-lamp", "addon:pendant", "furniture:plant", "furniture:plant-snake", "furniture:plant-tree", "addon:wall-art", "furniture:rug-large", "furniture:rug-runner", "addon:throw-pillows", "addon:curtains", "addon:blinds"]) expect(ids).toContain(id);
    expect(decor.every((e) => !e.priced)).toBe(true);
    // The rest of the built-ins are still priced.
    expect(catalogEntry("addon:bookcase")!.priced).toBe(true);
    expect(FURNISH_CATALOG.filter((e) => e.group === "Furniture").some((e) => e.type.startsWith("rug"))).toBe(false);
  });

  it("leaves decor out of the cost", () => {
    const { plan } = bedroom();
    let p = plan;
    for (const id of ["addon:table-lamp", "addon:wall-art", "addon:pendant", "addon:throw-pillows"]) p = placeItem(p, id, { x: 200, y: 80 }).plan;
    p = placeItem(p, "addon:curtains", { x: 192, y: 8 }).plan;
    expect((p.addOns ?? []).length).toBe(5);
    const x = furnishExtras(p);
    expect(x.builtInLf + x.wallShelfLf + x.ceilingFans + x.accessories).toBe(0);
  });
});

describe("curtains and blinds", () => {
  it("hang on the nearest window, sized to it, facing into the room", () => {
    const { plan, win } = bedroom();
    const fit = coveringFit(plan, "curtains", { x: 200, y: 20 })!;
    expect(fit.openingId).toBe(win.id);
    expect(fit.widthIn).toBe(36 + CURTAIN_SIDE_IN * 2);
    expect(fit.bottomIn + fit.heightIn).toBeCloseTo(30 + 48 + CURTAIN_ABOVE_IN, 0);
    // In front of the window's middle (x 192), on the room side of the north wall, facing south.
    expect(fit.x).toBeCloseTo(192, 0);
    expect(fit.y).toBeGreaterThan(0);
    expect(fit.rotation).toBe(0);
    const blinds = coveringFit(plan, "blinds", { x: 200, y: 20 })!;
    expect(blinds.widthIn).toBeLessThan(fit.widthIn);
    expect(blinds.bottomIn).toBeGreaterThan(20);
    // No window close by: nowhere to hang them.
    expect(coveringFit(plan, "curtains", { x: 200, y: 130 })).toBeNull();
    expect(placeCheck(plan, { entryId: "addon:curtains", x: 200, y: 130, rotation: 0, widthIn: 60, depthIn: 4 }).ok).toBe(false);
    expect(placeItem(plan, "addon:curtains", { x: 200, y: 130 }).id).toBeNull();
  });

  it("follow the window when it moves or gets wider", () => {
    const { plan, win } = bedroom();
    const placed = placeItem(plan, "addon:curtains", { x: 192, y: 10 });
    expect(placed.plan.addOns![0].openingId).toBe(win.id);
    const moved: FloorPlan = { ...placed.plan, openings: placed.plan.openings.map((o) => (o.id === win.id ? { ...o, offsetIn: 40, widthIn: 48 } : o)) };
    const [c] = fittedAddOns(moved);
    expect(c.x).toBeCloseTo(120 + 40, 0);
    expect(c.widthIn).toBe(48 + CURTAIN_SIDE_IN * 2);
    // The Furnish list and the 3D view read the followed copy.
    expect(layerItems(moved).find((i) => i.id === placed.id)!.x).toBeCloseTo(160, 0);
    // A removed window leaves them where they were.
    const gone: FloorPlan = { ...placed.plan, openings: placed.plan.openings.filter((o) => o.id !== win.id) };
    expect(fittedAddOns(gone)[0].x).toBe(placed.plan.addOns![0].x);
  });

  it("show on the window in the placing ghost, and swap only for each other", () => {
    const { plan, win } = bedroom();
    const g = ghostAt(plan, "addon:blinds", { x: 180, y: 30 }, 0, layerItems(plan))!;
    expect(g.check.ok).toBe(true);
    expect(g.widthIn).toBe(win.widthIn + 3);
    expect(swapChoices("addon:curtains").map((e) => e.id)).toEqual(["addon:blinds"]);
    const placed = placeItem(plan, "addon:curtains", { x: 192, y: 10 });
    const item = layerItems(placed.plan).find((i) => i.id === placed.id)!;
    const swapped = swapItem(placed.plan, item, "addon:blinds");
    expect(swapped.plan.addOns!.map((a) => [a.kind, a.openingId])).toEqual([["blinds", win.id]]);
    // Moved toward no window, they stay on theirs.
    expect(moveItem(placed.plan, item, { x: 200, y: 130 }).addOns![0]).toEqual(placed.plan.addOns![0]);
  });
});

describe("decor that rests on furniture", () => {
  it("puts a table lamp on a nightstand and pillows on a sofa's seat", () => {
    const { plan } = bedroom();
    const withStand: FloorPlan = { ...plan, furniture: [newFurniture("nightstand", { x: 140, y: 20 }, 0, "#b07f4f", "n1"), newFurniture("sofa", { x: 200, y: 110 }, 180, "#8a99a6", "s1")] };
    expect(restHeight(withStand, { x: 140, y: 20 })).toBe(26);
    expect(restHeight(withStand, { x: 200, y: 110 })).toBe(18);
    expect(restHeight(withStand, { x: 240, y: 60 })).toBe(0);
    const lamp = placeItem(withStand, "addon:table-lamp", { x: 140, y: 20 });
    expect(lamp.plan.addOns![0].bottomIn).toBe(26);
    // It can sit over the nightstand (it doesn't count as in the way) and goes back to the floor when moved off it.
    expect(placeCheck(withStand, { entryId: "addon:table-lamp", x: 140, y: 20, rotation: 0, widthIn: 14, depthIn: 14 }).ok).toBe(true);
    const item = layerItems(lamp.plan).find((i) => i.id === lamp.id)!;
    expect(moveItem(lamp.plan, item, { x: 240, y: 60 }).addOns![0].bottomIn).toBe(0);
    const g = ghostAt(withStand, "addon:throw-pillows", { x: 200, y: 112 }, 0, layerItems(withStand))!;
    expect(g.bottomIn).toBe(18);
  });
});

describe("Furnish for me Full with decor", () => {
  const p = house(RANCH);
  const res = furnishLevel(p.floorPlans["floor-1"], 108, "full");
  const kinds = [...res.plan.furniture.map((f) => f.kind), ...(res.plan.addOns ?? []).map((a) => a.kind)];

  it("adds a lamp, a plant and a rug where they fit", () => {
    expect(kinds).toContain("table-lamp");
    expect(kinds).toContain("floor-lamp");
    expect(kinds.some((k) => k.startsWith("plant"))).toBe(true);
    expect(kinds.some((k) => k.startsWith("rug"))).toBe(true);
    expect(kinds).toContain("throw-pillows");
    // Minimal stays as it was: no decor.
    const min = furnishLevel(p.floorPlans["floor-1"], 108, "minimal").plan;
    expect([...min.furniture, ...(min.addOns ?? [])].some((x) => catalogEntry(`furniture:${x.kind}`)?.group === "Decor" || catalogEntry(`addon:${x.kind}`)?.group === "Decor")).toBe(false);
  });

  it("puts the table lamps on the nightstands", () => {
    const plan = res.plan;
    for (const a of (plan.addOns ?? []).filter((x) => x.kind === "table-lamp")) expect(a.bottomIn).toBe(26);
  });

  it("only furnishes a living room once", () => {
    const living = p.floorPlans["floor-1"].rooms.find((r) => r.type === "living")!;
    const again = furnishRoom(res.plan, living.id, 108, "full");
    expect(again.added).toHaveLength(0);
  });

  it("draws decor in detail with Pretty only, lamp shades as glowing parts, at a reasonable size", () => {
    const parts = buildHouse({ ...p.floorPlans, "floor-1": res.plan }, ctxFor(p)).parts;
    const pretty = forQuality(parts, "pretty");
    const fast = forQuality(parts, "fast");
    const glow = parts.filter((x) => x.glow);
    expect(glow.length).toBeGreaterThan(2);
    expect(glow.every((x) => x.quality === "pretty")).toBe(true);
    expect(fast.some((x) => x.glow || x.key.includes(":aog:") || x.key.includes(":fug:"))).toBe(false);
    const decorTris = tris(pretty.filter((x) => /:(aop|aog|fug):/.test(x.key) || ["floor-lamp", "plant", "plant-snake", "plant-tree", "rug-large", "rug-small"].some((k) => res.plan.furniture.find((f) => f.id === x.furnitureId)?.kind === k)));
    expect(decorTris).toBeLessThan(40000);
  });
});

describe("each decor add-on in detail", () => {
  it("draws inside its size, with the shade apart for lamps", () => {
    for (const kind of ["table-lamp", "pendant", "wall-art", "throw-pillows", "curtains", "blinds"]) {
      const e = catalogEntry(`addon:${kind}`)!;
      const mb = new MeshBuilder();
      const glow = new MeshBuilder();
      expect(drawDecorDetail(mb, glow, { ox: 0, oy: 0 }, { id: `t-${kind}`, kind, x: 0, y: 0, rotation: 0, widthIn: e.widthIn, depthIn: e.depthIn, heightIn: e.heightIn, bottomIn: e.bottomIn }, 0, [0.8, 0.7, 0.6])).toBe(true);
      expect(mb.build().count).toBeGreaterThan(10);
      expect(glow.empty).toBe(!["table-lamp", "pendant"].includes(kind));
      expect(mb.build().count).toBeLessThan(6000);
    }
  });
});

describe("lights at night", () => {
  it("come on as the sun sets and the sky darkens after it", () => {
    expect(lightsAmount(30)).toBe(0);
    expect(lightsAmount(2)).toBeGreaterThan(0);
    expect(lightsAmount(-5)).toBe(1);
    expect(nightAmount(10)).toBe(0);
    expect(nightAmount(-10)).toBe(1);
    expect(latestHour(19.5)).toBe(23.5);
    expect(latestHour(21)).toBe(23.75);
  });

  it("lists the lamps and ceiling lights, links rooms through doors, and keeps to a few real lights", () => {
    const { plan, bed, bath } = bedroom();
    const links = linkedRooms(plan);
    expect(links.get(bed)?.has(bath)).toBe(true);
    let p = placeItem(plan, "addon:table-lamp", { x: 140, y: 20 }).plan;
    p = placeItem(p, "furniture:floor-lamp", { x: 250, y: 130 }).plan;
    const items = [
      ...layerItems(p),
      ...[1, 2, 3, 4, 5].map((i) => ({ ...layerItems(p)[0], kind: "device" as const, id: `lt${i}`, entryId: "device:light-recessed", x: 130 + i * 20, y: 70 })),
      { ...layerItems(p)[0], kind: "device" as const, id: "ltb", entryId: "device:light", x: 60, y: 48 },
    ];
    const sources = lightSources(p, items, "floor-1", 96);
    expect(sources.filter((s) => s.kind === "lamp")).toHaveLength(2);
    expect(sources.filter((s) => s.roomId === bed)).toHaveLength(7);
    const live = liveLights(sources, { levelId: "floor-1", roomId: bed, p: { x: 200, y: 70 } }, links);
    expect(live.length).toBe(MAX_LIVE_LIGHTS);
    // Both lamps, and the bath's light through the door.
    expect(live.filter((s: LightSource) => s.kind === "lamp")).toHaveLength(2);
    expect(live.some((s) => s.id === "ltb")).toBe(true);
    expect(liveLights(sources, { levelId: "floor-2", p: { x: 0, y: 0 } }, links)).toHaveLength(0);
  });
});

describe("saved data", () => {
  it("opens version 37 houses unchanged (curtains' window is a new, optional field)", () => {
    const p = createProject("Old");
    const old = { ...JSON.parse(JSON.stringify(p)), schemaVersion: 37 };
    const m = migrateProject(old);
    expect({ ...m, schemaVersion: 37 }).toEqual(old);
  });
});
