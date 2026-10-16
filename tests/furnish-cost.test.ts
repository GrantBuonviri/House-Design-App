import { describe, expect, it } from "vitest";
import type { AddOn, Device, FloorPlan, Project } from "@/lib/model/schema";
import { estimate, type Estimate } from "@/lib/cost/estimate";
import { measurePlan } from "@/lib/cost/quantities";
import { furnishExtras } from "@/lib/cost/furnishQuantities";
import { buildSet } from "@/lib/plans/build";
import { sheetText } from "@/lib/plans/draw";
import { builtInLines } from "@/lib/plans/sheets/schedules";
import { dryerRuns } from "@/lib/plans/sheets/mechanical";
import { house, RANCH, withKitchen } from "./samples";

const MAIN = "floor-1";

function withPlan(p: Project, patch: (plan: FloorPlan) => Partial<FloorPlan>): Project {
  const plan = p.floorPlans[MAIN];
  return { ...p, floorPlans: { ...p.floorPlans, [MAIN]: { ...plan, ...patch(plan) } } };
}

const kitchenAt = (plan: FloorPlan) => {
  const k = plan.rooms.find((r) => r.type === "kitchen")!;
  const xs = k.polygon.map((pt) => pt.x);
  const ys = k.polygon.map((pt) => pt.y);
  return { room: k, x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
};
const addOn = (plan: FloorPlan, kind: string, widthIn: number, over: Partial<AddOn> = {}): AddOn => {
  const k = kitchenAt(plan);
  return { id: `ao-${kind}`, kind, x: k.x, y: k.y, rotation: 0, widthIn, depthIn: 12, heightIn: 30, bottomIn: 0, roomId: k.room.id, ...over };
};
const dev = (kind: Device["kind"], id: string, plan: FloorPlan): Device => ({ id, kind, x: kitchenAt(plan).x, y: kitchenAt(plan).y, rotation: 0 });
const lines = (e: Estimate, id: string) => e.categories.flatMap((c) => c.lines).filter((l) => l.id === id);
const cat = (e: Estimate, id: string) => e.categories.find((c) => c.id === id)!;
const has = (e: Estimate, id: string) => e.categories.some((c) => c.id === id);

const base = () => withKitchen(house(RANCH));

describe("furnish cost", () => {
  it("prices built-ins and extras, and leaves furniture unpriced", () => {
    const p = base();
    const plain = estimate(p)!;
    expect(has(plain, "builtins")).toBe(false);
    const stocked = withPlan(p, (plan) => ({
      addOns: [addOn(plan, "bookcase", 60), addOn(plan, "ceiling-fan", 52, { id: "f" }), addOn(plan, "mirror", 30, { id: "m" }), addOn(plan, "shelving", 48, { id: "s" })],
    }));
    const e = estimate(stocked)!;
    expect(lines(e, "built-in-cabinetry")[0].qty).toBeCloseTo(5);
    expect(lines(e, "ceiling-fan")[0].qty).toBe(1);
    expect(lines(e, "bath-accessory")[0].qty).toBe(1);
    expect(lines(e, "wall-shelving")[0].qty).toBeCloseTo(4);
    expect(cat(e, "builtins").label).toBe("Built-ins and extras");
    expect(cat(e, "builtins").cost.likely).toBeGreaterThan(0);

    const furnished = withPlan(p, (plan) => ({ furniture: [{ id: "sofa", kind: "sofa", x: 10, y: 10, rotation: 0, widthIn: 84, depthIn: 36 } as never, ...plan.furniture] }));
    expect(estimate(furnished)!.total.likely).toBeCloseTo(plain.total.likely, 0);
  });

  it("prices a fireplace", () => {
    const p = withPlan(base(), (plan) => ({ fixtures: [...plan.fixtures, { id: "fp", kind: "fireplace", x: kitchenAt(plan).x, y: kitchenAt(plan).y, rotation: 0, widthIn: 48, depthIn: 18, roomId: kitchenAt(plan).room.id }] }));
    expect(lines(estimate(p)!, "fireplace")[0].qty).toBe(1);
  });

  it("prices only hookups and devices placed beyond what fixtures bring", () => {
    const p = base();
    expect(has(estimate(p)!, "hookups")).toBe(false);
    const extra = withPlan(p, (plan) => ({
      devices: { hidden: [], added: [dev("water", "w1", plan), dev("water", "w2", plan), dev("drain", "d1", plan), dev("gas", "g1", plan), dev("outlet-240", "o1", plan), dev("dryer-vent", "v1", plan), dev("outlet", "x1", plan)] },
    }));
    const e = estimate(extra)!;
    expect(lines(e, "extra-water-run")[0].qty).toBe(2);
    for (const id of ["extra-drain-run", "gas-line-run", "circuit-240", "dryer-vent-run", "extra-device"]) expect(lines(e, id)[0].qty, id).toBe(1);
    expect(cat(e, "hookups").label).toBe("Extra hookups");
  });

  it("counts a moved fixture hookup or app outlet as nothing extra", () => {
    const p = base();
    const plan = p.floorPlans[MAIN];
    const moved = furnishExtras({ ...plan, devices: { hidden: ["hk:abc:water", "out:abc", "out:r1:0:1"], added: [dev("water", "w1", plan), dev("outlet-240", "o1", plan), dev("outlet", "x1", plan)] } });
    expect(moved.extraWaterRuns).toBe(0);
    expect(moved.circuits240).toBe(0);
    expect(moved.extraDevices).toBe(0);
  });

  it("prices cabinets from the real layout, falling back to a typical kitchen only with none", () => {
    const p = base();
    const q = measurePlan(p)!;
    expect(q.cabinetLf).toBeGreaterThan(0);
    // Take every cabinet away in the kitchen: the typical kitchen is priced instead, so there is still a cabinet line.
    const plan = p.floorPlans[MAIN];
    const noCounters = withPlan(p, (pl) => ({ fixtures: pl.fixtures.filter((f) => f.kind !== "counter" && f.kind !== "island") }));
    expect(measurePlan(noCounters)!.cabinetLf).toBeGreaterThan(0);
    // A tall cabinet and a wine rack added by hand show up as their own lines.
    const k = kitchenAt(plan);
    const cab = (kind: string, id: string) => ({ id, kind, x: k.x, y: k.y, rotation: 0, widthIn: 24, depthIn: 24, heightIn: kind === "tall" ? 84 : 34.5, bottomIn: 0, roomId: k.room.id });
    const more = withPlan(p, () => ({ cabinets: { hidden: [], added: [cab("tall", "t1"), cab("wine", "w1")] as never } }));
    const e = estimate(more)!;
    expect(lines(e, "tall-cabinet")[0].qty).toBeGreaterThanOrEqual(1);
    expect(lines(e, "cabinet-specialty")[0].qty).toBeGreaterThanOrEqual(1);
  });
});

describe("furnish PDF", () => {
  it("draws add-ons on the floor plan and lists them in the schedule", () => {
    const p = withPlan(base(), (plan) => ({ addOns: [addOn(plan, "window-seat", 60)] }));
    expect(builtInLines(p)).toMatchObject([{ tag: "BI1", kind: "window-seat", count: 1 }]);
    const text = buildSet(p).flatMap(sheetText);
    expect(text).toContain("SEAT");
    expect(text.map((t) => t.toLowerCase())).toContain("built-ins and extras");
  });

  it("shows water, drain and gas stubs with a legend on the plumbing sheet", () => {
    const set = buildSet(base());
    const plumbing = set.filter((s) => s.number.startsWith("P-1")).flatMap(sheetText);
    expect(plumbing).toContain("Hot and cold water supply stub-out, with a shutoff valve.");
    expect(plumbing).toContain("Drain and vent stub-out.");
  });

  it("gives hand-placed 240V outlets their own circuit rows", () => {
    const p = withPlan(base(), (plan) => ({ devices: { hidden: [], added: [dev("outlet-240", "o1", plan)] } }));
    expect(buildSet(p).flatMap(sheetText)).toContain("240V outlet");
  });

  it("runs a dryer duct to a vent placed in Furnish", () => {
    const p = base();
    const plan = p.floorPlans[MAIN];
    const dryer = plan.fixtures.find((f) => f.kind === "dryer");
    expect(dryer).toBeTruthy();
    if (!dryer) return;
    const vent: Device = { id: "v", kind: "dryer-vent", x: dryer.x + 24, y: dryer.y, rotation: 0 };
    const run = dryerRuns({ ...plan, devices: { hidden: [], added: [vent] } })[0];
    expect(run.to).toEqual({ x: vent.x, y: vent.y });
  });
});
