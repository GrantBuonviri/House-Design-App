import { describe, expect, it } from "vitest";
import type { FloorPlan, Level, PlanRoom } from "@/lib/model/schema";
import { emptyPlan, makeRoom } from "@/lib/plan/edit";
import { polygonArea, rectangle } from "@/lib/plan/geometry";
import { CANTILEVER_MAX_IN, fillBelow, fillShapes, overhangsOf, overPorches, postsUnder, pullBack, supportOf, supportTargets } from "@/lib/plan/support";
import { planWarnings } from "@/lib/plan/checks";
import { defaultBasics } from "@/lib/plan/basics";
import { roofFootprint } from "@/lib/house3d/footprint";

const FT = 12;
const room = (id: string, x: number, y: number, w: number, h: number, extra: Partial<PlanRoom> = {}): PlanRoom => ({ ...makeRoom(rectangle((x + w / 2) * FT, (y + h / 2) * FT, w * FT, h * FT), id), id, type: "living", ...extra });
const plan = (rooms: PlanRoom[]): FloorPlan => ({ ...emptyPlan(), rooms });
const levels: Level[] = [
  { id: "main", name: "Main floor", kind: "main", elevationIn: 0 },
  { id: "up", name: "Second floor", kind: "upper", elevationIn: 110 },
];
const main = plan([room("a", 0, 0, 30, 20), room("garage", 30, 0, 20, 20, { type: "garage" })]);

describe("what holds up a floor", () => {
  it("checks upper floors only, never the main floor or a basement", () => {
    const plans = { main, up: plan([]) };
    expect(supportOf(plans, levels, levels[0])).toBeNull();
    expect(supportOf(plans, levels, levels[1])?.below.id).toBe("main");
    expect(supportOf({ main: plan([]), up: plan([]) }, levels, levels[1])).toBeNull();
    const base: Level[] = [{ id: "b", name: "Basement", kind: "basement", elevationIn: -100 }, ...levels];
    expect(supportOf({ b: main, main, up: plan([]) }, base, base[0])).toBeNull();
    expect(supportOf({ b: main, main, up: plan([]) }, base, base[1])).toBeNull();
  });

  it("counts the garage and covered porches, but not decks", () => {
    const withOutdoor = plan([...main.rooms, room("porch", 0, 20, 30, 6, { type: "porch" }), room("deck", 0, 26, 30, 8, { type: "deck" })]);
    const area = roofFootprint(withOutdoor).reduce((s, r) => s + polygonArea(r.outline), 0) / 144;
    expect(Math.round(area)).toBe(30 * 20 + 20 * 20 + 30 * 6);
    const sup = supportOf({ main: withOutdoor, up: plan([]) }, levels, levels[1])!;
    expect(overhangsOf([room("r", 2, 2, 20, 22)], sup.regions)).toHaveLength(0);
    expect(overhangsOf([room("r", 2, 2, 20, 30)], sup.regions)).toHaveLength(1);
  });
});

describe("overhangs", () => {
  const regions = supportOf({ main, up: plan([]) }, levels, levels[1])!.regions;

  it("finds how far a room reaches past the wall below", () => {
    const [o] = overhangsOf([room("bed", 10, 10, 15, 13)], regions); // 3 ft past the south wall at y=20
    expect(o.roomId).toBe("bed");
    expect(o.depthIn).toBe(3 * FT);
    expect(polygonArea(o.pieces[0]) / 144).toBeCloseTo(15 * 3);
  });

  it("ignores rooms that fit and slivers under an inch", () => {
    expect(overhangsOf([room("fits", 0, 0, 30, 20), room("sliver", 0, 0, 30, 20 + 0.5 / FT)], regions)).toHaveLength(0);
  });

  it("reaches over the garage too, and skips outdoor rooms", () => {
    expect(overhangsOf([room("over", 25, 0, 20, 10)], regions)).toHaveLength(0);
    expect(overhangsOf([room("balcony", 0, 15, 10, 10, { type: "deck" })], regions)).toHaveLength(0);
  });
});

describe("pulling back", () => {
  const sup = supportOf({ main, up: plan([]) }, levels, levels[1])!;

  it("trims the room to the support area", () => {
    const up = plan([room("bed", 10, 10, 15, 13)]);
    const fixed = pullBack(up, "bed", sup.regions);
    expect(polygonArea(fixed.rooms[0].polygon) / 144).toBeCloseTo(15 * 10);
    expect(overhangsOf(fixed.rooms, sup.regions)).toHaveLength(0);
  });

  it("leaves a room alone when nothing of it would be left", () => {
    const up = plan([room("far", 60, 60, 10, 10)]);
    expect(pullBack(up, "far", sup.regions)).toBe(up);
  });
});

describe("the warning in Things to check", () => {
  it("names the room, the depth and the floor below, with a Pull back fix, and clears once fixed", () => {
    const up = plan([room("bed", 10, 10, 15, 13, { name: "Bedroom 2" })]);
    const ctx = { levels, brief: null, basics: defaultBasics() };
    const w = planWarnings({ main, up }, ctx).find((x) => x.id === "up:overhang:bed")!;
    expect(w.text).toBe("Bedroom 2 hangs 3' past the outside wall of the main floor. Nothing holds it up.");
    expect(w.pullBack).toEqual({ roomId: "bed" });
    const sup = supportOf({ main, up }, levels, levels[1])!;
    const fixed = pullBack(up, "bed", sup.regions);
    expect(planWarnings({ main, up: fixed }, ctx).some((x) => x.id.includes("overhang"))).toBe(false);
    // Nothing on the main floor is ever flagged.
    expect(planWarnings({ main, up }, ctx).filter((x) => x.levelId === "main" && x.id.includes("overhang"))).toHaveLength(0);
  });
});

describe("Fill the floor below", () => {
  const sup = supportOf({ main, up: plan([]) }, levels, levels[1])!;

  it("makes a room over the whole support area", () => {
    const filled = fillBelow(plan([]), sup.regions);
    expect(filled.rooms).toHaveLength(1);
    expect(polygonArea(filled.rooms[0].polygon) / 144).toBeCloseTo(50 * 20);
    expect(overhangsOf(filled.rooms, sup.regions)).toHaveLength(0);
  });

  it("only fills what's still empty", () => {
    const part = plan([room("a", 0, 0, 30, 20)]);
    const shapes = fillShapes(part, sup.regions);
    expect(shapes).toHaveLength(1);
    expect(polygonArea(shapes[0]) / 144).toBeCloseTo(20 * 20);
    expect(fillShapes(fillBelow(part, sup.regions), sup.regions)).toHaveLength(0);
  });
});

describe("snapping to the floor below", () => {
  it("offers the outline's corners and walls", () => {
    const t = supportTargets(supportOf({ main, up: plan([]) }, levels, levels[1])!.regions);
    expect(t.points.length).toBe(4);
    expect(t.segments.length).toBe(4);
  });
});

describe("overhangs on purpose", () => {
  const sup = supportOf({ main, up: plan([]) }, levels, levels[1])!;
  const ctx = { levels, brief: null, basics: defaultBasics() };
  const warn = (r: PlanRoom) => planWarnings({ main, up: plan([r]) }, ctx).find((x) => x.id === `up:overhang:${r.id}`);

  it("lets a short cantilever reach up to 2' with no warning, and warns past that", () => {
    const short = room("bed", 10, 10, 15, 11.5, { name: "Bedroom 2", overhang: "cantilever" }); // 1' 6" past y=20
    const [o] = overhangsOf([short], sup.regions);
    expect(o.depthIn).toBe(18);
    expect(o.ok).toBe(true);
    expect(warn(short)).toBeUndefined();
    const edge = room("bed", 10, 10, 15, 10 + CANTILEVER_MAX_IN / FT, { overhang: "cantilever" });
    expect(warn(edge)).toBeUndefined();
    const far = room("bed", 10, 10, 15, 13, { name: "Bedroom 2", overhang: "cantilever" });
    expect(warn(far)?.text).toBe("Bedroom 2 hangs 3' past the outside wall of the main floor. That's more than a short cantilever's 2': set it to On posts or Engineered, or pull it back.");
  });

  it("clears the warning for rooms on posts or engineered, however far they reach", () => {
    expect(warn(room("bed", 10, 10, 15, 20, { overhang: "posts" }))).toBeUndefined();
    expect(warn(room("bed", 10, 10, 15, 20, { overhang: "engineered" }))).toBeUndefined();
    expect(warn(room("bed", 10, 10, 15, 20))).toBeDefined();
  });

  it("puts a beam along the outer edges and posts at its ends and every 8'", () => {
    // 20' wide, 6' past the south wall: one beam along the south edge, posts at both ends and 2 between.
    const [o] = overhangsOf([room("bonus", 5, 10, 20, 16, { overhang: "posts" })], sup.regions);
    const { posts, beams } = postsUnder(o, sup.regions);
    expect(beams).toHaveLength(3);
    const south = beams.filter(([a, b]) => a.y === 26 * FT && b.y === 26 * FT);
    expect(south).toHaveLength(1);
    expect(posts.every((p) => p.y > 20 * FT)).toBe(true);
    expect(posts.filter((p) => p.y === 26 * FT)).toHaveLength(4);
  });

  it("finds rooms over a covered porch, with no warning", () => {
    const below = plan([...main.rooms, room("porch", 0, 20, 30, 6, { type: "porch", name: "Front porch" })]);
    const over = room("bed", 0, 14, 15, 12, { name: "Bedroom 3" });
    expect(overPorches([over], below).map((x) => x.porch.name)).toEqual(["Front porch"]);
    expect(planWarnings({ main: below, up: plan([over]) }, ctx).some((x) => x.id.includes("overhang"))).toBe(false);
    expect(overPorches([room("bed", 0, 0, 15, 12)], below)).toEqual([]);
  });
});
