import { describe, expect, it } from "vitest";
import type { FloorPlan, PlanRoom } from "@/lib/model/schema";
import { levelsFor } from "@/lib/brief/levels";
import { roomType } from "@/lib/brief/rooms";
import { defaultBasics } from "@/lib/plan/basics";
import { newOpening } from "@/lib/plan/connect";
import { emptyPlan, makeRoom } from "@/lib/plan/edit";
import { rectangle } from "@/lib/plan/geometry";
import { fillBelow, supportOf } from "@/lib/plan/support";
import { fixMessage, newSummary, recheck } from "@/lib/plan/recheck";

const FT = 12;
const levels = levelsFor(2, 0);
const [main, upper] = levels;
const ctx = { levels, brief: null, basics: defaultBasics() };

function room(id: string, type: string, x: number, y: number, w: number, h: number, name = roomType(type).label): PlanRoom {
  return { ...makeRoom(rectangle((x + w / 2) * FT, (y + h / 2) * FT, w * FT, h * FT), name), id, type };
}
const plan = (rooms: PlanRoom[], extra: Partial<FloorPlan> = {}): FloorPlan => ({ ...emptyPlan(), rooms, ...extra });

describe("re-checking after a fix", () => {
  const living = room("l", "living", 0, 0, 16, 14);
  const front = (p: FloorPlan) => ({ ...p, openings: [...p.openings, newOpening("door-entry", { roomId: "l", edge: 2 }, 6 * FT, -1, 36)] });

  it("lists only the warnings that are new, with a one-line summary", () => {
    const before = { [main.id]: front(plan([living])) };
    const after = { [main.id]: front(plan([living, room("b", "bedroom", 16, 0, 12, 12, "Bed 2")])) };
    const r = recheck(before, after, ctx);
    expect(r.added.map((w) => w.id)).toEqual(expect.arrayContaining([`${main.id}:nodoor:b`, `${main.id}:egress:b`]));
    expect(r.summary).toMatch(/^\d new things to check: Bed 2 has no door/);
    expect(fixMessage("Closed the gap.", r)).toMatch(/^Closed the gap\. \d new things to check: .* Undo puts it back\.$/);
  });

  it("says nothing when the fix broke nothing", () => {
    const p = { [main.id]: front(plan([living])) };
    const r = recheck(p, p, ctx);
    expect(r.added).toHaveLength(0);
    expect(r.summary).toBeNull();
    expect(fixMessage("Closed the gap.", r)).toBe("Closed the gap. Undo puts it back.");
  });

  it("spells out three and counts the rest", () => {
    const ws = [1, 2, 3, 4, 5].map((i) => ({ id: `w${i}`, levelId: main.id, tag: "comfort" as const, text: `Thing ${i}`, roomIds: [], at: null }));
    expect(newSummary(ws)).toBe("5 new things to check: Thing 1. Thing 2. Thing 3. And 2 more in Things to check.");
    expect(newSummary(ws.slice(0, 1))).toBe("1 new thing to check: Thing 1.");
  });
});

describe("Fill the floor below", () => {
  it("names each new room for what it's over and gives it a door", () => {
    const below = plan([room("k", "kitchen", 0, 0, 14, 12, "Kitchen"), room("b2", "bedroom", 14, 0, 12, 12, "Bed 2"), room("h", "hall", 0, 12, 26, 4, "Hall")]);
    const up = plan([room("u", "hall", 0, 12, 26, 4, "Upper hall"), room("ub", "bedroom", 0, 0, 14, 12, "Bed 3")]);
    const plans = { [main.id]: below, [upper.id]: up };
    const sup = supportOf(plans, levels, upper)!;
    const filled = fillBelow(up, sup.regions, sup.arcs, below.rooms);
    const added = filled.rooms.filter((r) => !up.rooms.some((x) => x.id === r.id));
    expect(added.map((r) => r.name)).toEqual(["Under Bed 2"]);
    expect(added[0].type).toBeUndefined();
    expect(filled.openings.some((o) => o.kind === "door")).toBe(true);
  });
});
