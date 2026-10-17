import { describe, expect, it } from "vitest";
import type { DesignBrief, FloorPlan } from "@/lib/model/schema";
import { levelsFor } from "@/lib/brief/levels";
import { defaultBasics } from "@/lib/plan/basics";
import { addDoor, newOpening } from "@/lib/plan/connect";
import { emptyPlan, makeRoom } from "@/lib/plan/edit";
import { rectangle } from "@/lib/plan/geometry";
import { DEFAULT_WEIGHTS, compareScores, glassFacing, priorityWeights, scoreDetails, scorePlan } from "@/lib/plan/score";
import { estimate } from "@/lib/cost/estimate";
import { house, RANCH } from "./samples";

const FT = 12;
const levels = levelsFor(1, 0);

function brief(extra: Partial<DesignBrief> = {}): DesignBrief {
  return {
    rooms: [
      { id: "b-living", type: "living", name: "Living room", targetSqFt: 300 },
      { id: "b-kitchen", type: "kitchen", name: "Kitchen", targetSqFt: 200 },
    ],
    adjacencies: [{ a: "b-living", b: "b-kitchen", strength: "must" }],
    floors: 1,
    floorsBelow: 0,
    garageBays: 0,
    openKitchen: false,
    vibe: [],
    priorities: [],
    accessibility: [],
    ...extra,
  };
}

/** A 20x15 living room (300 sq ft, matches) next to a 10x15 kitchen (150, 25% under), no door between. */
function plan(): FloorPlan {
  const living = makeRoom(rectangle(10 * FT, 7.5 * FT, 20 * FT, 15 * FT), "Living room", { type: "living", briefRoomId: "b-living" });
  const kitchen = makeRoom(rectangle(25 * FT, 7.5 * FT, 10 * FT, 15 * FT), "Kitchen", { type: "kitchen", briefRoomId: "b-kitchen" });
  return { ...emptyPlan(), rooms: [living, kitchen] };
}

/** The edge of a room facing south or west (x east, y south). */
function edge(p: FloorPlan, roomId: string, side: "S" | "W"): number {
  const r = p.rooms.find((x) => x.id === roomId)!;
  const mids = r.polygon.map((a, i) => {
    const b = r.polygon[(i + 1) % r.polygon.length];
    return side === "S" ? (a.y === b.y ? (a.y + b.y) / 2 : -Infinity) : a.x === b.x ? -(a.x + b.x) / 2 : -Infinity;
  });
  return mids.indexOf(Math.max(...mids));
}

const ctx = { brief: brief(), plot: null, levels, basics: defaultBasics() };

describe("scorePlan", () => {
  it("measures brief fit, connections, glass and problems", () => {
    const p = plan();
    const s = scorePlan({ "floor-1": p }, ctx);
    expect(s.sized).toBe(2);
    expect(s.offBrief).toBeCloseTo(0.125, 2);
    expect(s.matching).toEqual(["Living room"]);
    expect(s.connections).toBe(1);
    expect(s.kept).toBe(0);
    expect(s.southGlass).toBe(0);
    expect(s.cost).toBeNull();

    // A door between them keeps the brief's connection and scores higher.
    const living = p.rooms[0];
    const withDoor = addDoor(p, living, p.rooms[1])!;
    const s2 = scorePlan({ "floor-1": withDoor }, ctx);
    expect(s2.kept).toBe(1);
    expect(s2.total).toBeGreaterThan(s.total);
    expect(compareScores(s, s2)).toContain("+1 connection from your brief");
  });

  it("counts south glass in living spaces and west glass anywhere", () => {
    const p = plan();
    const living = p.rooms[0];
    const south = newOpening("window", { roomId: living.id, edge: edge(p, living.id, "S") }, 60, 1, 72);
    const west = newOpening("window", { roomId: living.id, edge: edge(p, living.id, "W") }, 60, 1, 36);
    const g = glassFacing({ "floor-1": { ...p, openings: [south, west] } });
    expect(g.south).toBe(Math.round((72 * south.heightIn) / 144));
    expect(g.west).toBe(Math.round((36 * west.heightIn) / 144));
    // The kitchen has its own window either way, so only the south glass differs.
    const kitchenWindow = newOpening("window", { roomId: p.rooms[1].id, edge: 1 }, 90, 1, 48);
    const before = scorePlan({ "floor-1": { ...p, openings: [kitchenWindow] } }, ctx);
    const after = scorePlan({ "floor-1": { ...p, openings: [kitchenWindow, south] } }, ctx);
    expect(after.total).toBeGreaterThan(before.total);
    expect(compareScores(before, after)).toContain(`+${after.southGlass} sq ft south glass`);
  });

  it("prices plans with the cost estimate and counts Things to check", () => {
    const p = house(RANCH);
    const costOf = (plans: typeof p.floorPlans) => estimate({ ...p, floorPlans: plans })?.total.likely ?? null;
    const s = scorePlan(p.floorPlans, { brief: p.brief, plot: p.plot, levels: p.levels, basics: p.plan.basics, costOf });
    expect(s.cost).toBeGreaterThan(100_000);
    expect(s.problems).toBeGreaterThanOrEqual(0);
    expect(s.quietFt).toBeGreaterThan(0);
    expect(scoreDetails(s)).toMatch(/to build/);
    const cheaper = { ...s, cost: s.cost! - 4100 };
    expect(compareScores(s, cheaper)).toContain("saves $4,100");
  });
});

describe("priorities steer the weights", () => {
  it("doubles sun, cost and adds quiet by keyword, and names the priorities", () => {
    const r = priorityWeights(["Lots of light in the kitchen", "Stay on budget", "Privacy between spaces"]);
    expect(r.weights.sun).toBe(DEFAULT_WEIGHTS.sun * 2);
    expect(r.weights.cost).toBe(DEFAULT_WEIGHTS.cost * 2);
    expect(r.weights.quiet).toBeGreaterThan(0);
    expect(r.weights.fit).toBe(DEFAULT_WEIGHTS.fit * 1.5);
    expect(r.rankedFor).toEqual(["Lots of light in the kitchen", "Stay on budget", "Privacy between spaces"]);
  });

  it("leaves the weights alone for priorities about the land", () => {
    const r = priorityWeights(["Place the house around the big rock, or budget to remove it", "Keep the trees for shade and privacy"]);
    expect(r.weights).toEqual(DEFAULT_WEIGHTS);
    expect(r.rankedFor).toEqual([]);
  });
});
