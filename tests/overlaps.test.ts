import { describe, expect, it } from "vitest";
import type { FloorPlan, PlanRoom } from "@/lib/model/schema";
import { emptyPlan, makeRoom, moveMany } from "@/lib/plan/edit";
import { polygonArea, polygonsOverlap, rectangle } from "@/lib/plan/geometry";
import { newOpening } from "@/lib/plan/connect";
import { closeGap, findGaps, trimOverlap } from "@/lib/plan/overlaps";
import { alignMany, duplicateMany, mirrorMany, whyNotAlign } from "@/lib/plan/arrange";
import { wallPieces } from "@/lib/plan/walls";
import { describeChange } from "@/lib/store/describe";
import { createProject } from "@/lib/model/project";
import { MAIN_LEVEL_ID } from "@/lib/brief/levels";

const FT = 12;
function room(id: string, x: number, y: number, w: number, h: number, extra: Partial<PlanRoom> = {}): PlanRoom {
  return { ...makeRoom(rectangle((x + w / 2) * FT, (y + h / 2) * FT, w * FT, h * FT), id), id, type: "living", ...extra };
}
const plan = (rooms: PlanRoom[], extra: Partial<FloorPlan> = {}): FloorPlan => ({ ...emptyPlan(), rooms, ...extra });
const sqft = (r: PlanRoom) => polygonArea(r.polygon) / 144;

describe("trimming overlaps", () => {
  it("trims the room that stayed put back to the edge of the one that was dropped", () => {
    const base = plan([room("a", 0, 0, 12, 10, { name: "Living" }), room("b", 14, 0, 10, 10, { name: "Kitchen" })]);
    const dropped = moveMany(base, ["b"], -3 * FT, 0); // b now covers x 11..21, over a by 1 ft
    expect(polygonsOverlap(dropped.rooms[0].polygon, dropped.rooms[1].polygon)).toBe(true);
    const out = trimOverlap(dropped, ["b"]);
    expect(out.trims).toEqual([{ roomId: "a", byId: "b" }]);
    const a = out.plan.rooms.find((r) => r.id === "a")!;
    expect(sqft(a)).toBeCloseTo(11 * 10);
    expect(polygonsOverlap(a.polygon, out.plan.rooms.find((r) => r.id === "b")!.polygon)).toBe(false);
    // The moved room is untouched, and the two now share one wall.
    expect(out.plan.rooms.find((r) => r.id === "b")!.polygon).toEqual(dropped.rooms[1].polygon);
    expect(wallPieces(out.plan, 6).filter((w) => !w.exterior && !w.open).length).toBe(1);
    expect(describeChange(proj(base), proj(out.plan))).toBe("trim Living to fit Kitchen");
  });

  it("leaves an overlap alone when the room would be left in two pieces or nothing", () => {
    const base = plan([room("a", 0, 0, 20, 10), room("b", 8, -2, 4, 14)]); // b cuts right across a
    expect(trimOverlap(base, ["b"]).trims).toHaveLength(0);
    const covered = plan([room("a", 2, 2, 6, 6), room("b", 0, 0, 12, 12)]);
    expect(trimOverlap(covered, ["b"]).trims).toHaveLength(0);
  });

  it("keeps doors on the trimmed room's remaining walls", () => {
    let p = plan([room("a", 0, 0, 12, 10), room("b", 14, 0, 10, 10)]);
    p = { ...p, openings: [newOpening("window", { roomId: "a", edge: 0 }, 3 * FT, 1)] };
    const out = trimOverlap(moveMany(p, ["b"], -3 * FT, 0), ["b"]);
    expect(out.plan.openings).toHaveLength(1);
  });
});

describe("closing gaps", () => {
  it("finds rooms a few inches apart and pushes them together", () => {
    const p = plan([room("a", 0, 0, 12, 10), { ...room("b", 12, 0, 10, 10), polygon: room("b", 12, 0, 10, 10).polygon.map((q) => ({ x: q.x + 4, y: q.y })) }]);
    const gaps = findGaps(p);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].gapIn).toBeCloseTo(4);
    const fixed = closeGap(p, gaps[0]);
    expect(findGaps(fixed)).toHaveLength(0);
    const xs = fixed.rooms.flatMap((r) => r.polygon.map((q) => q.x));
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(22 * FT - 0); // b moved left, a (the bigger one) stayed
  });

  it("ignores rooms that touch, are far apart, or only meet at a corner", () => {
    expect(findGaps(plan([room("a", 0, 0, 10, 10), room("b", 10, 0, 10, 10)]))).toHaveLength(0);
    expect(findGaps(plan([room("a", 0, 0, 10, 10), room("b", 12, 0, 10, 10)]))).toHaveLength(0); // 2 ft apart
    expect(findGaps(plan([room("a", 0, 0, 10, 10), { ...room("b", 10, 10, 10, 10), polygon: room("b", 10, 10, 10, 10).polygon.map((q) => ({ x: q.x + 3, y: q.y + 3 })) }]))).toHaveLength(0);
  });
});

describe("duplicate, mirror and align", () => {
  const withStuff = () => {
    const p = plan([room("a", 0, 0, 12, 10, { name: "Bedroom", briefRoomId: "br1" })]);
    return {
      ...p,
      openings: [newOpening("door-hinged", { roomId: "a", edge: 1 }, 2 * FT, 1)],
      fixtures: [{ id: "f1", kind: "toilet", x: 60, y: 30, rotation: 90, widthIn: 20, depthIn: 30, roomId: "a" }],
    } as FloorPlan;
  };

  it("copies a room with its door and fixture, under a new name and no brief link", () => {
    const out = duplicateMany(withStuff(), ["a"]);
    expect(out.plan.rooms).toHaveLength(2);
    const copy = out.plan.rooms.find((r) => r.id === out.ids[0])!;
    expect(copy.name).toBe("Bedroom 2");
    expect(copy.briefRoomId).toBeUndefined();
    expect(copy.polygon[0].x).toBe(24);
    expect(out.plan.openings).toHaveLength(2);
    expect(out.plan.openings.filter((o) => "roomId" in o.host && o.host.roomId === copy.id)).toHaveLength(1);
    expect(out.plan.fixtures.filter((f) => f.roomId === copy.id)).toHaveLength(1);
    expect(out.plan.fixtures.find((f) => f.id === "f1")!.x).toBe(60);
  });

  it("mirrors a room left-right: same footprint, door and fixture flipped with it", () => {
    const p = withStuff();
    const out = mirrorMany(p, ["a"], "left-right");
    const r = out.rooms[0];
    expect(sqft(r)).toBeCloseTo(120);
    expect(r.polygon[0].x).toBeGreaterThanOrEqual(0);
    const f = out.fixtures[0];
    expect(f.x).toBe(144 - 60);
    expect(f.rotation).toBe(270);
    // The door stays on the same physical wall (the east wall becomes the west wall).
    const door = out.openings[0];
    const n = r.polygon.length;
    const e = r.polygon[(door as { host: { edge: number } }).host.edge];
    const e2 = r.polygon[(door as { host: { edge: number } }).host.edge + 1 === n ? 0 : (door as { host: { edge: number } }).host.edge + 1];
    expect(e.x).toBe(0);
    expect(e2.x).toBe(0);
    expect(door.hinge).toBe("end");
    // Mirroring twice puts everything back.
    const back = mirrorMany(out, ["a"], "left-right");
    expect(back.fixtures[0].x).toBe(60);
    expect(back.openings[0]).toMatchObject({ host: p.openings[0].host, offsetIn: p.openings[0].offsetIn, hinge: p.openings[0].hinge });
  });

  it("lines rooms up and makes them the same width", () => {
    const p = plan([room("a", 0, 5, 10, 8), room("b", 20, 2, 12, 6), room("c", 40, 9, 8, 6)]);
    const tops = alignMany(p, ["a", "b", "c"], "tops");
    expect(new Set(tops.rooms.map((r) => Math.min(...r.polygon.map((q) => q.y)))).size).toBe(1);
    const lefts = alignMany(p, ["a", "b", "c"], "lefts");
    expect(new Set(lefts.rooms.map((r) => Math.min(...r.polygon.map((q) => q.x)))).size).toBe(1);
    const same = alignMany(p, ["b", "a", "c"], "same-width");
    for (const r of same.rooms) expect(Math.max(...r.polygon.map((q) => q.x)) - Math.min(...r.polygon.map((q) => q.x))).toBeCloseTo(12 * FT);
    expect(whyNotAlign(p, ["a"], "tops")).not.toBeNull();
  });
});

function proj(p: FloorPlan) {
  const base = createProject("T");
  return { ...base, floorPlans: { [MAIN_LEVEL_ID]: p } };
}

describe("gap warnings", () => {
  it("shows up in the Things to check list with a fix, and not for plans that fit together", async () => {
    const { planWarnings } = await import("@/lib/plan/checks");
    const { defaultBasics } = await import("@/lib/plan/basics");
    const { suggestPlans } = await import("@/lib/plan/suggest");
    const { house, RANCH } = await import("./samples");
    const proj0 = house(RANCH);
    const levels = proj0.levels;
    const res = suggestPlans(proj0.bubbles, { brief: proj0.brief, plot: proj0.plot, levels, basics: defaultBasics() });
    const clean = planWarnings(res.plans, { levels, brief: proj0.brief, basics: defaultBasics() });
    expect(clean.filter((w) => w.gap)).toHaveLength(0);
    const p = plan([room("a", 0, 0, 12, 10), { ...room("b", 12, 0, 10, 10), polygon: room("b", 12, 0, 10, 10).polygon.map((q) => ({ x: q.x + 4, y: q.y })) }]);
    const w = planWarnings({ [MAIN_LEVEL_ID]: p }, { levels, brief: null, basics: defaultBasics() }).find((x) => x.gap);
    expect(w?.text).toMatch(/4" apart/);
  });
});
