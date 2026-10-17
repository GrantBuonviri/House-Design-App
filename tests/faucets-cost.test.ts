import { describe, expect, it } from "vitest";
import type { AddOn, FloorPlan, Project } from "@/lib/model/schema";
import { estimate, type Estimate } from "@/lib/cost/estimate";
import { fixtureLines } from "@/lib/plans/sheets/schedules";
import { fixtureUnits } from "@/lib/plans/sheets/plumbing";
import { productsIn } from "@/lib/catalog/catalog";
import { toProduct } from "@/lib/interior/picks";
import { removeFaucet } from "@/lib/furnish/faucets";
import { house, RANCH, withKitchen } from "./samples";

const MAIN = "floor-1";
const withPlan = (p: Project, patch: (plan: FloorPlan) => Partial<FloorPlan>): Project => ({ ...p, floorPlans: { ...p.floorPlans, [MAIN]: { ...p.floorPlans[MAIN], ...patch(p.floorPlans[MAIN]) } } });
const lines = (e: Estimate, id: string) => e.categories.flatMap((c) => c.lines).filter((l) => l.id === id);
const withBath = (p: Project): Project =>
  withPlan(p, (plan) => {
    const b = plan.rooms.find((r) => r.type === "bathroom")!;
    const xs = b.polygon.map((pt) => pt.x);
    const ys = b.polygon.map((pt) => pt.y);
    const at = { x: Math.min(...xs) + 40, y: Math.min(...ys) + 40 };
    return {
      fixtures: [
        ...plan.fixtures,
        { id: "tub1", kind: "tub", ...at, rotation: 0, widthIn: 60, depthIn: 30, roomId: b.id },
        { id: "sh1", kind: "shower", x: at.x + 80, y: at.y, rotation: 0, widthIn: 36, depthIn: 36, roomId: b.id },
      ] as never,
    };
  });
const base = () => withBath(withKitchen(house(RANCH)));
const kitchen = (plan: FloorPlan) => {
  const k = plan.rooms.find((r) => r.type === "kitchen")!;
  const xs = k.polygon.map((pt) => pt.x);
  const ys = k.polygon.map((pt) => pt.y);
  return { room: k, x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
};
const potFiller = (plan: FloorPlan): AddOn => {
  const k = kitchen(plan);
  return { id: "pf1", kind: "pot-filler", x: k.x, y: k.y, rotation: 0, widthIn: 4, depthIn: 4, heightIn: 6, bottomIn: 54, roomId: k.room.id };
};
const prepSink = (plan: FloorPlan) => {
  const k = kitchen(plan);
  return { id: "ps1", kind: "prep-sink", x: k.x, y: k.y, rotation: 0, widthIn: 15, depthIn: 15, roomId: k.room.id };
};

describe("faucet costs", () => {
  it("splits the tub/shower line into the tub and its trim without changing the total", () => {
    const e = estimate(base())!;
    const tub = lines(e, "shower-tub")[0];
    const trim = lines(e, "tub-shower-trim")[0];
    expect(tub.qty).toBe(trim.qty);
    expect(tub.qty).toBe(2);
    // The old single line: 2,173.91 US average each, scaled by the place's cost level.
    expect((tub.cost.likely + trim.cost.likely) / tub.qty / 2173.913).toBeCloseTo(0.92, 2);
    expect(trim.cost.likely / (tub.cost.likely + trim.cost.likely)).toBeCloseTo(0.3, 2);
  });

  it("drops a tub or shower's trim when its faucet is removed", () => {
    const p = base();
    const plan = p.floorPlans[MAIN];
    const fx = plan.fixtures.find((f) => f.id === "tub1")!;
    const before = lines(estimate(p)!, "tub-shower-trim")[0].qty;
    const after = lines(estimate(withPlan(p, (pl) => removeFaucet(pl, fx.id)))!, "tub-shower-trim")[0].qty;
    expect(after).toBe(before - 1);
    expect(lines(estimate(withPlan(p, (pl) => removeFaucet(pl, fx.id)))!, "shower-tub")[0].qty).toBe(lines(estimate(p)!, "shower-tub")[0].qty);
  });

  it("adds pot filler and bar sink lines only when placed", () => {
    const p = base();
    const e0 = estimate(p)!;
    expect(lines(e0, "pot-filler")).toHaveLength(0);
    expect(lines(e0, "prep-sink-faucet")).toHaveLength(0);
    const placed = withPlan(p, (plan) => ({ addOns: [...(plan.addOns ?? []), potFiller(plan)], fixtures: [...plan.fixtures, { ...prepSink(plan) } as never] }));
    const e = estimate(placed)!;
    expect(lines(e, "pot-filler")[0].qty).toBe(1);
    expect(lines(e, "prep-sink-faucet")[0].qty).toBe(1);
    expect(e.total.likely).toBeGreaterThan(e0.total.likely);
  });

  it("prices a picked pot filler and bar faucet in the room's lines", () => {
    const p = withPlan(base(), (plan) => ({ addOns: [...(plan.addOns ?? []), potFiller(plan)], fixtures: [...plan.fixtures, { ...prepSink(plan) } as never] }));
    const room = kitchen(p.floorPlans[MAIN]).room.id;
    const pf = productsIn("pot-fillers")[2];
    const bf = productsIn("bar-faucets")[2];
    const picked: Project = {
      ...p,
      interior: { ...p.interior, selections: [...p.interior.selections, { id: "sel-pf", targetId: room, category: "pot-fillers", product: toProduct(pf) }, { id: "sel-bf", targetId: room, category: "bar-faucets", product: toProduct(bf) }] },
    };
    const e = estimate(picked)!;
    expect(lines(e, "pot-filler")[0].product).toContain("Pot Filler");
    expect(lines(e, "pot-filler")[0].cost.likely).toBeGreaterThan(pf.price!);
    expect(lines(e, "prep-sink-faucet")[0].cost.likely).toBeGreaterThan(bf.price!);
  });

  it("has real products for the new categories", () => {
    for (const c of ["pot-fillers", "bar-faucets"] as const) {
      const list = productsIn(c);
      expect(list).toHaveLength(6);
      expect(list.every((x) => x.price && x.url.startsWith("http"))).toBe(true);
    }
  });
});

describe("faucets on the plans", () => {
  it("lists the pot filler and bar sink, names faucet shapes, and counts the bar sink's fixture units", () => {
    const p = withPlan(base(), (plan) => ({ addOns: [...(plan.addOns ?? []), potFiller(plan)], fixtures: [...plan.fixtures, { ...prepSink(plan) } as never] }));
    const { plumbing } = fixtureLines(p);
    expect(plumbing.map((l) => l.kind)).toEqual(expect.arrayContaining(["pot-filler", "prep-sink", "sink"]));
    expect(plumbing.find((l) => l.kind === "sink")!.product).toMatch(/Kitchen faucet, pull-down/);
    expect(plumbing.find((l) => l.kind === "vanity")!.product).toMatch(/Bath faucet, /);
    const base0 = fixtureUnits(base()).dfu;
    expect(fixtureUnits(p).dfu).toBeGreaterThan(base0);
  });
});
