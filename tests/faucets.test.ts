import { describe, expect, it } from "vitest";
import { House3D, Product, type FloorPlan, type Fixture, type Selection } from "@/lib/model/schema";
import { createProject, migrateProject } from "@/lib/model/project";
import { SCHEMA_VERSION } from "@/lib/model/schema";
import { emptyPlan, makeRoom } from "@/lib/plan/edit";
import { duplicateMany, mirrorMany } from "@/lib/plan/arrange";
import { levelFor, MAIN_LEVEL_ID } from "@/lib/brief/levels";
import { defaultBasics } from "@/lib/plan/basics";
import { siteFor } from "@/lib/house3d/site";
import { buildLevel, forQuality, type HouseContext } from "@/lib/house3d/build";
import { changeFaucet, defaultShape, faucetsOn, maxAlong, removeFaucet, resetFaucets, restoreFaucet, CHROME } from "@/lib/furnish/faucets";
import { fixtureType } from "@/lib/plan/catalog";
import { addOnType } from "@/lib/furnish/catalog";
import { levelHeights } from "@/lib/house3d/levels";
import kitchenFaucets from "@/data/catalog/kitchen-faucets.json";

const L = MAIN_LEVEL_ID;
const fx = (id: string, kind: string, x: number, y: number, extra: Partial<Fixture> = {}): Fixture => {
  const t = fixtureType(kind);
  return { id, kind, x, y, rotation: 0, widthIn: t.widthIn, depthIn: t.depthIn, ...extra };
};

/** A bathroom (0..144 x 0..120) with a vanity on the north wall and a tub at the east end, and a kitchen to its west. */
function bathAndKitchen(extra: Fixture[] = []): FloorPlan {
  const bath = makeRoom([{ x: 0, y: 0 }, { x: 144, y: 0 }, { x: 144, y: 120 }, { x: 0, y: 120 }], "Bath", { type: "bathroom" });
  const kitchen = makeRoom([{ x: -180, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 120 }, { x: -180, y: 120 }], "Kitchen", { type: "kitchen" });
  return {
    ...emptyPlan(),
    rooms: [bath, kitchen],
    fixtures: [
      fx("van", "vanity", 40, 10.5, { roomId: bath.id }),
      fx("tub", "tub", 114, 105, { roomId: bath.id }),
      fx("toilet", "toilet", 80, 14, { roomId: bath.id }),
      fx("sink", "sink", -90, 11, { roomId: kitchen.id }),
      ...extra,
    ],
  };
}

const product = (name: string, color: string) => Product.parse({ ...kitchenFaucets[0], name, color });
const pick = (targetId: string, category: string, name: string, color: string): Selection => ({ id: `${targetId}:${category}`, targetId, category, product: product(name, color) });

describe("automatic faucets", () => {
  it("gives every sink, vanity, tub and shower a faucet, and nothing else", () => {
    const plan = bathAndKitchen([fx("prep", "prep-sink", -40, 60), fx("ls", "laundry-sink", -150, 11)]);
    const fs = faucetsOn(plan, L);
    expect(fs.map((f) => f.fixtureId).sort()).toEqual(["ls", "prep", "sink", "tub", "van"]);
    const kinds = Object.fromEntries(fs.map((f) => [f.fixtureId, f.kind]));
    expect(kinds).toEqual({ van: "bath", tub: "tub", sink: "kitchen", prep: "prep", ls: "laundry" });
    expect(fs.every((f) => f.auto && f.color === CHROME)).toBe(true);
  });

  it("puts sink faucets behind the basin, on the deck", () => {
    const f = faucetsOn(bathAndKitchen(), L).find((x) => x.fixtureId === "sink")!;
    expect(f.shape).toBe("pull-down");
    expect(f.at.x).toBeCloseTo(-90);
    expect(f.at.y).toBeLessThan(11);
    expect(f.at.y).toBeGreaterThan(0);
    expect(f.z).toBe(36);
  });

  it("puts the tub's faucet on the end against a wall, with a shower head when the room has no shower", () => {
    const tub = faucetsOn(bathAndKitchen(), L).find((x) => x.fixtureId === "tub")!;
    expect(tub.shape).toBe("wall-spout");
    // On the face of the east wall, not inside it.
    expect(tub.at.x).toBeLessThan(144);
    expect(tub.at.x).toBeGreaterThan(139);
    expect(tub.shower).toBe(true);
    const withShower = faucetsOn(bathAndKitchen([fx("sh", "shower", 40, 80)]), L);
    expect(withShower.find((x) => x.fixtureId === "tub")!.shower).toBeUndefined();
    expect(withShower.find((x) => x.fixtureId === "sh")!.shape).toBe("standard");
  });

  it("gives a tub away from the walls a freestanding filler", () => {
    const plan = bathAndKitchen();
    plan.fixtures = plan.fixtures.map((f) => (f.id === "tub" ? { ...f, x: 72, y: 60 } : f));
    const tub = faucetsOn(plan, L).find((x) => x.fixtureId === "tub")!;
    expect(tub.shape).toBe("freestanding");
    expect(tub.shower).toBeUndefined();
  });

  it("moves and copies with its fixture", () => {
    const plan = changeFaucet(bathAndKitchen(), "sink", { shape: "bridge" });
    const moved = { ...plan, fixtures: plan.fixtures.map((f) => (f.id === "sink" ? { ...f, x: f.x - 30 } : f)) };
    expect(faucetsOn(moved, L).find((x) => x.fixtureId === "sink")!.at.x).toBeCloseTo(-120);
    const copied = duplicateMany(plan, ["sink"]).plan;
    const sinks = faucetsOn(copied, L).filter((x) => x.kind === "kitchen");
    expect(sinks).toHaveLength(2);
    expect(sinks.every((s) => s.shape === "bridge")).toBe(true);
    const gone = { ...plan, fixtures: plan.fixtures.filter((f) => f.id !== "sink") };
    expect(faucetsOn(gone, L).some((x) => x.fixtureId === "sink")).toBe(false);
  });

  it("slides the other way when its fixture is mirrored", () => {
    const plan = changeFaucet(bathAndKitchen(), "sink", { alongIn: 4 });
    const flipped = mirrorMany(plan, ["sink"], "left-right");
    expect(flipped.fixtures.find((f) => f.id === "sink")!.faucet?.alongIn).toBe(-4);
  });
});

describe("faucet edits", () => {
  it("keeps a removed faucet removed until it's put back, as it was", () => {
    let plan = changeFaucet(bathAndKitchen(), "van", { shape: "widespread" });
    plan = removeFaucet(plan, "van");
    expect(faucetsOn(plan, L).some((f) => f.fixtureId === "van")).toBe(false);
    const listed = faucetsOn(plan, L, [], { removed: true }).find((f) => f.fixtureId === "van")!;
    expect(listed.removed).toBe(true);
    plan = restoreFaucet(plan, "van");
    const back = faucetsOn(plan, L).find((f) => f.fixtureId === "van")!;
    expect(back.shape).toBe("widespread");
    expect(back.auto).toBe(false);
    expect(faucetsOn(resetFaucets(plan), L).find((f) => f.fixtureId === "van")!.auto).toBe(true);
  });

  it("goes back to automatic with shape null, and ignores shapes that don't fit", () => {
    let plan = changeFaucet(bathAndKitchen(), "sink", { shape: "pull-out" });
    expect(faucetsOn(plan, L).find((f) => f.fixtureId === "sink")!.shape).toBe("pull-out");
    plan = changeFaucet(plan, "sink", { shape: null });
    expect(plan.fixtures.find((f) => f.id === "sink")!.faucet).toBeUndefined();
    plan = changeFaucet(plan, "sink", { shape: "rain" });
    expect(faucetsOn(plan, L).find((f) => f.fixtureId === "sink")!.shape).toBe("pull-down");
  });

  it("keeps the faucet inside the basin when slid", () => {
    const plan = bathAndKitchen();
    const max = maxAlong({ kind: "sink", widthIn: fixtureType("sink").widthIn });
    expect(max).toBeGreaterThan(5);
    const slid = changeFaucet(plan, "sink", { alongIn: 100 });
    expect(slid.fixtures.find((f) => f.id === "sink")!.faucet?.alongIn).toBe(max);
    expect(faucetsOn(slid, L).find((f) => f.fixtureId === "sink")!.at.x).toBeCloseTo(-90 + max);
    expect(changeFaucet(plan, "toilet", { alongIn: 3 })).toEqual(plan);
  });
});

describe("faucet shapes and products", () => {
  it("reads the shape from the product's name", () => {
    expect(defaultShape("sink", { name: "Single-Handle Pull-Out Sprayer Kitchen Faucet" })).toBe("pull-out");
    expect(defaultShape("sink", { name: "Two-Handle Bridge Kitchen Faucet" })).toBe("bridge");
    expect(defaultShape("vanity", { name: "8 in. Widespread 2-Handle Bathroom Faucet" })).toBe("widespread");
    expect(defaultShape("vanity", { name: "Vessel Sink Faucet" })).toBe("vessel");
    expect(defaultShape("shower", { name: "Rain Shower Trim Kit" })).toBe("rain");
    expect(defaultShape("shower", { name: "Shower System with Hand Shower" })).toBe("handheld");
    expect(defaultShape("tub", { name: "Freestanding Tub Filler" })).toBe("freestanding");
    expect(defaultShape("vanity", { name: "Pull-Down Thing" })).toBe("single");
    expect(defaultShape("tub", undefined, false)).toBe("freestanding");
  });

  it("takes the finish from the room's pick, or the whole house's", () => {
    const plan = bathAndKitchen();
    const bathId = plan.rooms[0].id;
    const picks = [pick("house", "kitchen-faucets", "Pull-Out Faucet in Matte Black", "#222222"), pick(bathId, "bath-faucets", "Widespread Faucet in Brushed Gold", "#c9a44c"), pick(bathId, "showers", "Rain Shower Trim", "#888888")];
    const fs = faucetsOn(plan, L, picks);
    const by = (id: string) => fs.find((f) => f.fixtureId === id)!;
    expect(by("sink").color).toBe("#222222");
    expect(by("sink").shape).toBe("pull-out");
    expect(by("van").color).toBe("#c9a44c");
    expect(by("van").shape).toBe("widespread");
    expect(by("tub").color).toBe("#888888");
  });

  it("adds the bar or prep sink and the pot filler to the catalogs", () => {
    expect(fixtureType("prep-sink")).toMatchObject({ label: "Bar or prep sink", widthIn: 15, depthIn: 15, group: "Kitchen" });
    expect(addOnType("pot-filler")).toMatchObject({ mount: "wall", bottomIn: 54, widthIn: 4 });
  });
});

describe("faucets in 3D", () => {
  const levels = [levelFor(L)];
  const ctx = (plan: FloorPlan): HouseContext & { heights: ReturnType<typeof levelHeights> } => ({
    heights: levelHeights(levels, defaultBasics()),
    levels,
    basics: defaultBasics(),
    house3d: House3D.parse({}),
    site: siteFor(null, { x: 0, y: 0 }, { [L]: plan }),
    frame: { ox: 0, oy: 0 },
  });

  it("draws every faucet for Pretty and Fast, picked as its fixture's faucet", () => {
    const plan = bathAndKitchen([fx("prep", "prep-sink", -40, 60)]);
    const parts = buildLevel({ [L]: plan }, levels[0], ctx(plan));
    const faucetParts = parts.filter((p) => p.pick?.faucet);
    expect(new Set(faucetParts.map((p) => p.pick!.faucet))).toEqual(new Set(["van", "tub", "sink", "prep"]));
    for (const q of ["pretty", "fast"] as const) expect(forQuality(faucetParts, q)).toHaveLength(4);
    expect(faucetParts.every((p) => p.mesh.count > 0)).toBe(true);
    // The tub/shower head is up near 78" (scene units are feet).
    const tub = faucetParts.find((p) => p.pick!.faucet === "tub" && p.quality === "fast")!;
    const ys = Array.from(tub.mesh.positions).filter((_, i) => i % 3 === 1);
    expect(Math.max(...ys) * 12).toBeGreaterThan(76);
  });

  it("draws nothing for a removed faucet, a pot filler on the wall, and spigots outside", () => {
    let plan = removeFaucet(bathAndKitchen(), "sink");
    plan = { ...plan, addOns: [{ id: "pf", kind: "pot-filler", x: -120, y: 2, rotation: 0, widthIn: 4, depthIn: 4, heightIn: 6, bottomIn: 54 }] };
    const parts = buildLevel({ [L]: plan }, levels[0], ctx(plan));
    expect(parts.some((p) => p.pick?.faucet === "sink")).toBe(false);
    expect(parts.filter((p) => p.key.includes(":pf:pf:"))).toHaveLength(2);
    expect(parts.some((p) => p.key.includes(":hb:"))).toBe(true);
  });

  it("draws every shape without trouble", () => {
    const shapes = { sink: ["pull-down", "pull-out", "bridge", "wall-mount"], vanity: ["single", "widespread", "vessel", "wall-mount"], tub: ["wall-spout", "deck", "freestanding"] } as const;
    for (const [id, list] of Object.entries(shapes)) {
      for (const shape of list) {
        const plan = changeFaucet(bathAndKitchen([fx("sh", "shower", 40, 80, { roomId: undefined })]), id === "sink" ? "sink" : id === "vanity" ? "van" : "tub", { shape });
        const parts = buildLevel({ [L]: plan }, levels[0], ctx(plan)).filter((p) => p.pick?.faucet);
        expect(parts.every((p) => p.mesh.count > 0 && Array.from(p.mesh.positions).every(Number.isFinite))).toBe(true);
      }
    }
  });
});

describe("saved data", () => {
  it("loads a version 30 project and keeps faucet changes", () => {
    const p = createProject("Old faucets");
    const v30 = JSON.parse(JSON.stringify({ ...p, schemaVersion: 30 }));
    const migrated = migrateProject(v30);
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(31);
    const withPlan = { ...migrated, floorPlans: { [L]: changeFaucet(bathAndKitchen(), "sink", { shape: "bridge", alongIn: 2 }) } };
    const again = migrateProject(JSON.parse(JSON.stringify(withPlan)));
    expect(JSON.stringify(again)).toContain('"faucet":{"shape":"bridge","alongIn":2}');
  });
});
