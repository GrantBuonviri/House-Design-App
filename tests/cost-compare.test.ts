import { describe, expect, it } from "vitest";
import { estimate } from "@/lib/cost/estimate";
import { compareChoices, currentChoice, withChoice } from "@/lib/cost/compare";
import { estimateCsv, estimateFileName, estimatePdf, estimateRows } from "@/lib/cost/exportEstimate";
import { measureHouse } from "@/lib/cost/quantities";
import { describeChange } from "@/lib/store/describe";
import { house, onRealLot, RANCH } from "./samples";

const ranch = house(RANCH, 1, 0);
const base = estimate(ranch)!;
const line = (e: NonNullable<ReturnType<typeof estimate>>, id: string) => e.categories.flatMap((c) => c.lines).find((l) => l.id === id);

describe("compare choices", () => {
  const groups = compareChoices(ranch, base);

  it("prices every option, with the house as it is marked and costing nothing extra", () => {
    expect(groups.map((g) => g.id)).toEqual(["foundation", "roof", "walls"]);
    for (const g of groups) {
      const cur = g.options.filter((o) => o.current);
      expect(cur.length).toBe(1);
      expect(cur[0].value).toBe(currentChoice(ranch, g.id));
      expect(cur[0].diff).toBe(0);
      expect(cur[0].total).toBe(base.total.likely);
      for (const o of g.options) expect(o.total).toBeGreaterThan(0);
    }
  });

  it("a basement costs more than a slab", () => {
    const f = groups.find((g) => g.id === "foundation")!.options;
    const total = (v: string) => f.find((o) => o.value === v)!.total;
    expect(total("basement")).toBeGreaterThan(total("crawlspace"));
    expect(total("basement")).toBeGreaterThan(total("slab"));
  });

  it("matches the estimate after using the option", () => {
    const hip = groups.find((g) => g.id === "roof")!.options.find((o) => o.value === "hip")!;
    expect(estimate(withChoice(ranch, "roof", "hip"))!.total.likely).toBeCloseTo(hip.total, 0);
  });

  it("prices 2x4 walls with the 2x4 framing and foam insulation rates", () => {
    const e = estimate(withChoice(ranch, "walls", "2x4"))!;
    expect(line(e, "ext-wall-framing")!.rate).toBe("ext-wall-framing-2x4");
    expect(line(e, "wall-insulation")!.rate).toBe("wall-insulation-2x4");
    expect(line(e, "ext-wall-framing")!.cost.likely).toBeLessThan(line(base, "ext-wall-framing")!.cost.likely);
    expect(line(e, "wall-insulation")!.cost.likely).toBeGreaterThan(line(base, "wall-insulation")!.cost.likely);
  });

  it("names the choice in undo and What changed", () => {
    expect(describeChange(ranch, withChoice(ranch, "walls", "2x4"))).toBe("switch to 2x4 outside walls");
    expect(describeChange(ranch, withChoice(ranch, "roof", "hip"))).toBe("switch to a hip roof");
    expect(describeChange(ranch, withChoice(ranch, "foundation", "basement"))).toBe("switch to a basement");
  });
});

describe("real lot driveway and trench", () => {
  it("measures to the lot's street line when My real lot is filled in", () => {
    const near = measureHouse(onRealLot(ranch, { houseFrontFt: 25 }))!;
    const far = measureHouse(onRealLot(ranch, { houseFrontFt: 90 }))!;
    expect(near.realLot).toBe(true);
    expect(measureHouse(ranch)!.realLot).toBe(false);
    expect(far.trenchLf).toBeGreaterThan(near.trenchLf + 40);
    expect(far.driveSqft).toBeGreaterThan(near.driveSqft);
    const e = estimate(onRealLot(ranch, { houseFrontFt: 90 }))!;
    expect(line(e, "utility-trench")!.note).toMatch(/real lot/);
  });

  it("uses the real lot for the rough estimate too", () => {
    const rough = { ...onRealLot(ranch, { houseFrontFt: 60 }), floorPlans: {} };
    const q = measureHouse(rough)!;
    expect(q.source).toBe("rough");
    expect(q.realLot).toBe(true);
    expect(q.driveSqft).toBeGreaterThanOrEqual(60 * 12);
  });
});

describe("estimate export", () => {
  it("has a row per line, adding up to the categories", () => {
    const rows = estimateRows(base);
    expect(rows.length).toBe(base.categories.reduce((s, c) => s + c.lines.length, 0));
    const sum = rows.reduce((s, r) => s + r.likely, 0);
    const lines = base.categories.reduce((s, c) => s + c.cost.likely, 0);
    expect(Math.abs(sum - lines)).toBeLessThan(rows.length);
  });

  it("writes a CSV with a Bid column and quotes commas", () => {
    const csv = estimateCsv(base, "Sagebrush House");
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("Sagebrush House: materials estimate");
    expect(csv).toContain("Category,Item,Amount,Unit,Rate (likely, per unit)".replace("Rate (likely, per unit)", '"Rate (likely, per unit)"'));
    expect(csv).toContain(",Bid,");
    expect(lines.find((l) => l.startsWith("Total,"))).toContain(String(Math.round(base.total.likely)));
    expect(estimateFileName("My/House!", "csv")).toBe("MyHouse - Materials estimate.csv");
  });

  it("makes a PDF", async () => {
    const doc = await estimatePdf(base, "Sagebrush House", new Date(2026, 9, 17));
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    expect(doc.output("arraybuffer").byteLength).toBeGreaterThan(2000);
  });
});
