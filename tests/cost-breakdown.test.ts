import { describe, expect, it } from "vitest";
import { estimate } from "@/lib/cost/estimate";
import { budgetCheck, budgetOf, categoryShares, changeNote, costByRoom } from "@/lib/cost/breakdown";
import { house, RANCH, TWO_STORY } from "./samples";

const ranch = estimate(house(RANCH, 1, 0))!;

describe("budget tracker", () => {
  it("reads the Rooms page budget", () => {
    expect(budgetOf({})).toBeNull();
    expect(budgetOf({ budget: { high: 0 } })).toBeNull();
    expect(budgetOf({ budget: { high: 300_000 } })).toBe(300_000);
    expect(budgetOf({ budget: { low: 200_000 } })).toBe(200_000);
  });

  it("is under, close or over", () => {
    const t = ranch.total.likely;
    expect(budgetCheck({}, ranch)).toBeNull();
    expect(budgetCheck({ budget: { high: t * 2 } }, ranch)!.status).toBe("under");
    expect(budgetCheck({ budget: { high: t * 1.03 } }, ranch)!.status).toBe("close");
    const over = budgetCheck({ budget: { high: t * 0.8 } }, ranch)!;
    expect(over.status).toBe("over");
    expect(over.diff).toBeCloseTo(t * 0.2, 0);
    expect(over.used).toBeCloseTo(1.25, 2);
    expect(budgetCheck({ budget: { high: ranch.total.low * 0.9 } }, ranch)!.lowOver).toBe(true);
    expect(over.lowOver).toBe(ranch.total.low > t * 0.8);
  });
});

describe("cost by room", () => {
  for (const [name, e] of [
    ["ranch", ranch],
    ["two-story", estimate(house(TWO_STORY, 2, 0))!],
  ] as const) {
    it(`adds up to the total (${name})`, () => {
      const { rooms, wholeHouse } = costByRoom(e);
      expect(rooms.length).toBe(e.quantities.rooms.length);
      const sum = rooms.reduce((s, r) => s + r.total, 0) + wholeHouse;
      expect(sum).toBeCloseTo(e.total.likely, 0);
      for (const r of rooms) {
        expect(r.own).toBeGreaterThanOrEqual(0);
        expect(r.shared).toBeGreaterThanOrEqual(0);
      }
      // Biggest first.
      for (let i = 1; i < rooms.length; i++) expect(rooms[i - 1].total).toBeGreaterThanOrEqual(rooms[i].total);
    });
  }

  it("gives kitchens and baths more of their own than a bedroom", () => {
    const { rooms } = costByRoom(ranch);
    const kitchen = rooms.find((r) => r.type === "kitchen")!;
    const bath = rooms.find((r) => r.type === "bathroom")!;
    const bed = rooms.find((r) => r.type === "bedroom")!;
    expect(kitchen.own).toBeGreaterThan(bed.own);
    expect(bath.own / bath.sqft).toBeGreaterThan(bed.own / bed.sqft);
  });

  it("keeps site work and permits out of the rooms", () => {
    const site = ranch.categories.filter((c) => c.id === "site" || c.id === "permits").reduce((s, c) => s + c.cost.likely, 0);
    expect(costByRoom(ranch).wholeHouse).toBeCloseTo(site, 0);
  });
});

describe("category chart", () => {
  it("lists the biggest categories and the rest, adding up to the total", () => {
    const shares = categoryShares(ranch);
    expect(shares.length).toBeLessThanOrEqual(7);
    expect(shares.at(-1)!.id).toBe("other");
    expect(shares.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 5);
    for (let i = 1; i < shares.length - 1; i++) expect(shares[i - 1].likely).toBeGreaterThanOrEqual(shares[i].likely);
  });
});

describe("what changed", () => {
  it("writes the change with its sign, and skips small ones", () => {
    expect(changeNote(100_000, 104_200, "add Bathroom")!.text).toBe("+$4,200: add Bathroom");
    expect(changeNote(100_000, 98_750, "remove Office")!.text).toBe("−$1,250: remove Office");
    expect(changeNote(100_000, 100_030, "move Kitchen")).toBeNull();
  });

  it("notes a bigger house costing more", () => {
    const smaller = estimate(house(RANCH.filter(([t]) => t !== "bathroom"), 1, 0))!;
    const note = changeNote(smaller.total.likely, ranch.total.likely, "add Bathroom")!;
    expect(note.diff).toBeGreaterThan(0);
  });
});
