import { describe, expect, it } from "vitest";
import { Product, type FloorPlan, type Fixture, type Selection } from "@/lib/model/schema";
import { emptyPlan, makeRoom } from "@/lib/plan/edit";
import { createProject } from "@/lib/model/project";
import { MAIN_LEVEL_ID } from "@/lib/brief/levels";
import { planWarnings } from "@/lib/plan/checks";
import { aimAt } from "@/lib/interior/surfaces";
import { defaultBasics } from "@/lib/plan/basics";
import { faucetsOn, removeFaucet } from "@/lib/furnish/faucets";
import { applyFaucetChange, faucetById, faucetProducts, isRange, pickFaucetProduct, potFillerAbove, usedFor } from "@/lib/furnish/faucetPick";
import { fixtureType } from "@/lib/plan/catalog";
import { catalogEntry } from "@/lib/furnish/catalog";
import { layerItems } from "@/lib/furnish/layer";
import kitchenFaucets from "@/data/catalog/kitchen-faucets.json";

const L = MAIN_LEVEL_ID;
const fx = (id: string, kind: string, x: number, y: number, extra: Partial<Fixture> = {}): Fixture => {
  const t = fixtureType(kind);
  return { id, kind, x, y, rotation: 0, widthIn: t.widthIn, depthIn: t.depthIn, ...extra };
};

/** A kitchen (0..180 x 0..144) with a sink and a range on the north wall. */
function kitchen(): FloorPlan {
  const room = makeRoom([{ x: 0, y: 0 }, { x: 180, y: 0 }, { x: 180, y: 144 }, { x: 0, y: 144 }], "Kitchen", { type: "kitchen" });
  return { ...emptyPlan(), rooms: [room], fixtures: [fx("sink", "sink", 50, 15, { roomId: room.id }), fx("range", "range", 130, 15, { roomId: room.id })] };
}

const chosen = (name: string, color: string) => Product.parse({ ...kitchenFaucets[0], name, color });

describe("editing faucets in Furnish", () => {
  it("applies a panel change to the fixture's faucet, and Put back restores it", () => {
    let plan = kitchen();
    plan = applyFaucetChange(plan, "sink", { shape: "bridge" });
    expect(faucetById(plan, L, "sink", [])?.shape).toBe("bridge");
    plan = applyFaucetChange(plan, "sink", "remove");
    expect(faucetById(plan, L, "sink", [])?.removed).toBe(true);
    plan = applyFaucetChange(plan, "sink", "restore");
    expect(faucetById(plan, L, "sink", [])).toMatchObject({ shape: "bridge" });
    plan = applyFaucetChange(plan, "sink", { shape: null });
    expect(faucetById(plan, L, "sink", [])?.auto).toBe(true);
  });

  it("writes the product to the room's Interior design pick, which colors every faucet there", () => {
    const plan = kitchen();
    const fixture = plan.fixtures[0];
    const f = faucetById(plan, L, "sink", [])!;
    const sel: Selection[] = pickFaucetProduct(plan, fixture, f.kind, [], chosen("Brass pull-down", "#b08d57"));
    expect(sel).toHaveLength(1);
    expect(sel[0]).toMatchObject({ targetId: plan.rooms[0].id, category: "kitchen-faucets" });
    expect(faucetsOn(plan, L, sel).find((x) => x.fixtureId === "sink")?.color).toBe("#b08d57");
    // Clearing the pick goes back to chrome.
    expect(pickFaucetProduct(plan, fixture, f.kind, sel, null)).toHaveLength(0);
    expect(usedFor(plan, fixture, f.kind)).toContain("Kitchen");
  });

  it("lists the same products Interior design does for each kind", () => {
    expect(faucetProducts("kitchen").length).toBeGreaterThan(0);
    expect(faucetProducts("bath").length).toBeGreaterThan(0);
    expect(faucetProducts("tub").length).toBeGreaterThan(0);
  });
});

describe("pot filler over the range", () => {
  it("puts a pot filler on the wall behind the range, centered, once", () => {
    const plan = kitchen();
    const range = layerItems(plan).find((i) => i.id === "range")!;
    expect(isRange(range.entryId)).toBe(true);
    const out = potFillerAbove(plan, range);
    expect(out && "id" in out).toBe(true);
    if (!out || !("id" in out)) return;
    const pf = out.plan.addOns!.find((a) => a.id === out.id)!;
    expect(pf.kind).toBe("pot-filler");
    expect(pf.x).toBeCloseTo(130, 0);
    expect(pf.y).toBeLessThan(range.y);
    expect(pf.bottomIn).toBe(catalogEntry("addon:pot-filler")!.bottomIn);
    expect(potFillerAbove(out.plan, range)).toEqual({ already: true });
  });

  it("says no when there's no wall behind the range", () => {
    const plan = { ...emptyPlan(), fixtures: [fx("range", "range", 500, 500)] };
    const range = layerItems(plan).find((i) => i.id === "range")!;
    expect(potFillerAbove(plan, range)).toBeNull();
  });
});

describe("Things to check for a removed faucet", () => {
  it("lists a sink without a faucet, and not once it's put back", () => {
    const project = createProject("Test");
    const plan = removeFaucet(kitchen(), "sink");
    const ctx = { levels: project.levels, brief: null, basics: null };
    const found = planWarnings({ [L]: plan }, ctx).find((w) => w.noFaucet);
    expect(found).toMatchObject({ noFaucet: { fixtureId: "sink" }, text: "This kitchen sink has no faucet." });
    const back = applyFaucetChange(plan, "sink", "restore");
    expect(planWarnings({ [L]: back }, ctx).some((w) => w.noFaucet)).toBe(false);
  });
});

describe("aiming at a faucet in the walkthrough", () => {
  it("tells a faucet from its sink in both tabs", () => {
    const plan = kitchen();
    const part = { layer: "fixtures" as const, levelId: L, pick: { kind: "fixture" as const, id: "sink", levelId: L, faucet: "sink" } };
    const hit = { p: { x: 50, y: 10 }, heightIn: 20, normal: { x: 0, y: 1, up: 0 } };
    for (const tab of ["place", "finishes"] as const) {
      const aim = aimAt(plan, part, hit, defaultBasics(), undefined, { tab, items: layerItems(plan) });
      expect(aim).toMatchObject({ kind: "faucet", id: "sink", levelId: L });
    }
    const sinkOnly = { ...part, pick: { kind: "fixture" as const, id: "sink", levelId: L } };
    expect(aimAt(plan, sinkOnly, hit, defaultBasics(), undefined, { tab: "place", items: layerItems(plan) }).kind).toBe("furnish");
  });
});
