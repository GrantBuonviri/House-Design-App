import { describe, expect, it } from "vitest";
import { codeReport } from "@/lib/codes/rules";
import { lotLimits, tallShedRise } from "@/lib/plans/lotLimits";
import { houseFootprintSqft, siteLayout } from "@/lib/plans/lot";
import { onRealLot, RANCH, house } from "./samples";

const ranch = house(RANCH);
const rule = (p: typeof ranch) => codeReport(p).find((r) => r.rule.id === "lot-limits")!;

describe("lot coverage and height limits", () => {
  it("has nothing to check without a real lot", () => {
    expect(lotLimits(ranch)).toEqual([]);
    expect(rule(ranch).status).toBe("manual");
  });

  it("leaves limits that weren't entered as check-by-hand", () => {
    const p = onRealLot(ranch);
    const l = lotLimits(p);
    expect(l.map((c) => c.ok)).toEqual([null, null]);
    expect(rule(p).status).toBe("manual");
  });

  it("passes and fails coverage against the entered percent", () => {
    const base = onRealLot(ranch);
    const pct = (houseFootprintSqft(base) / siteLayout(base)!.areaSqft) * 100;
    expect(lotLimits(onRealLot(ranch, { coverageLimitPct: Math.ceil(pct) + 5 }))[0].ok).toBe(true);
    const tight = onRealLot(ranch, { coverageLimitPct: Math.floor(pct) - 1 });
    expect(lotLimits(tight)[0].ok).toBe(false);
    expect(rule(tight).status).toBe("fail");
  });

  it("passes and fails height against the entered limit", () => {
    const tall = lotLimits(onRealLot(ranch, { heightLimitFt: 10 }))[1];
    expect(tall.actual).toBeGreaterThan(10);
    expect(tall.ok).toBe(false);
    expect(lotLimits(onRealLot(ranch, { heightLimitFt: 60 }))[1].ok).toBe(true);
  });

  it("warns about a shed roof that climbs very high, and only then", () => {
    const withRoof = (style: "shed" | "gable", pitch: number) => ({ ...ranch, house3d: { ...ranch.house3d, roof: { ...ranch.house3d.roof, style, pitch } } });
    expect(tallShedRise(withRoof("gable", 12))).toBeNull();
    expect(tallShedRise(withRoof("shed", 1))).toBeNull();
    expect(tallShedRise(withRoof("shed", 12))).toBeGreaterThan(96);
  });
});
