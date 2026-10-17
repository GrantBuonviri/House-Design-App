import { describe, expect, it } from "vitest";
import { house, TWO_STORY, withKitchen } from "./samples";
import { planWarnings } from "@/lib/plan/checks";
import { buildSet, selectedIds } from "@/lib/plans/build";
import { estimate } from "@/lib/cost/estimate";
import { measureHouse } from "@/lib/cost/quantities";
import type { Plans } from "@/lib/plan/edit";

/** The speed-ups keep answers and reuse them; these check the reused answers match fresh ones. */

const p = withKitchen(house(TWO_STORY, 2));
const ctx = { levels: p.levels, brief: p.brief, basics: p.plan.basics };
const rename = (plans: Plans, levelId: string, name: string): Plans => ({ ...plans, [levelId]: { ...plans[levelId], rooms: plans[levelId].rooms.map((r, i) => (i === 0 ? { ...r, name } : r)) } });
const ids = (ws: { id: string; text: string }[]) => ws.map((w) => `${w.id} ${w.text}`).sort();

describe("Things to check reuses unchanged floors", () => {
  it("gives the same answer twice, from the kept copy", () => {
    const a = planWarnings(p.floorPlans, ctx);
    const b = planWarnings(p.floorPlans, ctx);
    expect(ids(b)).toEqual(ids(a));
  });

  it("an edit on one floor shows up, and the other floor's warnings stay right", () => {
    planWarnings(p.floorPlans, ctx);
    const next = rename(p.floorPlans, "floor-2", "Zebra room");
    const ws = planWarnings(next, ctx);
    const fresh = planWarnings(next, { ...ctx, levels: [...ctx.levels] });
    expect(ids(ws)).toEqual(ids(fresh));
  });

  it("taking away the main floor's rooms brings up the upper floor's overhangs", () => {
    planWarnings(p.floorPlans, ctx);
    const bare = { ...p.floorPlans, "floor-1": { ...p.floorPlans["floor-1"], rooms: p.floorPlans["floor-1"].rooms.filter((r) => r.type === "garage") } };
    const up = planWarnings(bare, ctx).filter((w) => w.levelId === "floor-2" && w.id.includes(":overhang:"));
    expect(up.length).toBeGreaterThan(0);
  });

  it("the main floor notices when the stairs up go away", () => {
    planWarnings(p.floorPlans, ctx);
    const noStairs = { ...p.floorPlans, "floor-1": { ...p.floorPlans["floor-1"], stairs: [] }, "floor-2": { ...p.floorPlans["floor-2"], stairs: [] } };
    expect(planWarnings(noStairs, ctx).some((w) => w.id === "floor-1:nostairs")).toBe(true);
  });
});

describe("Plans page preview draws only the shown sheet", () => {
  it("matches the same sheet from the whole set", () => {
    const date = new Date(2026, 9, 17);
    const all = buildSet(p, { date });
    for (const id of ["floor:floor-2", "cover", "sections"]) {
      const one = buildSet(p, { only: selectedIds(p), draw: [id], date });
      expect(one.map((s) => s.id)).toEqual(all.filter((s) => s.id === id || s.id.startsWith(`${id}:`)).map((s) => s.id));
      expect(one).toEqual(all.filter((s) => s.id === id || s.id.startsWith(`${id}:`)));
    }
  });
});

describe("cost measure keeps a few answers", () => {
  it("scoring alternatives doesn't throw out the shown house's measure", () => {
    const shown = measureHouse(p);
    for (let i = 0; i < 4; i++) estimate({ ...p, floorPlans: rename(p.floorPlans, "floor-1", `Alt ${i}`) });
    expect(measureHouse({ ...p })).toBe(shown);
  });
});
