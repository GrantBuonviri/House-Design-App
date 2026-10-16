import { describe, expect, it } from "vitest";
import { createProject } from "@/lib/model/project";
import { describeChange } from "@/lib/store/describe";
import type { FloorPlan, Opening, PlanRoom, Point } from "@/lib/model/schema";
import { addRoom, emptyPlan, makeRoom } from "@/lib/plan/edit";
import { dist, rectangle } from "@/lib/plan/geometry";
import { roomArea, roomEdgeLength, wallLength } from "@/lib/plan/arcs";
import { edgeWalls, removeWall } from "@/lib/plan/openWalls";
import { hostSegment } from "@/lib/plan/walls";
import { combineAt, combineWalls, cornerBetween, splitEdge, splitEdgeEqual, splitWall, splitWallEqual, type WallEdit } from "@/lib/plan/wallEdits";

const ok = (r: WallEdit) => {
  if ("why" in r) throw new Error(r.why);
  return r.plan;
};
const room = (plan: FloorPlan, id: string) => plan.rooms.find((r) => r.id === id)!;
/** The edge of a room running between these two points, either way round. */
const edgeAt = (r: PlanRoom, p: Point, q: Point) =>
  r.polygon.findIndex((a, i) => {
    const b = r.polygon[(i + 1) % r.polygon.length];
    return (dist(a, p) < 1 && dist(b, q) < 1) || (dist(a, q) < 1 && dist(b, p) < 1);
  });
const cornerAt = (r: PlanRoom, p: Point) => r.polygon.findIndex((q) => dist(q, p) < 1);
const door = (host: Opening["host"], offsetIn: number, id = "d1"): Opening => ({ id, host, offsetIn, kind: "door", style: "door-hinged", widthIn: 32, heightIn: 80, side: 1, hinge: "start" });

function twoRooms() {
  const a = makeRoom(rectangle(0, 0, 120, 120), "Den");
  const b = makeRoom(rectangle(120, 0, 120, 120), "Kitchen");
  return { plan: addRoom(addRoom(emptyPlan(), a), b), a, b };
}

describe("splitting and combining room walls", () => {
  it("split then combine gives back the same room, door included", () => {
    const a = makeRoom(rectangle(0, 0, 240, 120), "Den");
    const top = edgeAt(a, { x: -120, y: -60 }, { x: 120, y: -60 });
    const plan: FloorPlan = { ...addRoom(emptyPlan(), a), openings: [door({ roomId: a.id, edge: top }, 50)] };
    const split = ok(splitEdge(plan, a.id, top, { x: 30, y: -58 }));
    expect(room(split, a.id).polygon).toHaveLength(5);
    const mid = cornerAt(room(split, a.id), { x: 30, y: -60 });
    expect(mid).toBeGreaterThan(-1);
    const back = ok(combineAt(split, a.id, mid));
    expect(room(back, a.id).polygon).toEqual(a.polygon);
    expect(back.openings[0]).toMatchObject({ host: { roomId: a.id, edge: top }, offsetIn: 50 });
  });

  it("split then combine a curved wall keeps its curve", () => {
    const base = makeRoom(rectangle(0, 0, 240, 120), "Den");
    const top = edgeAt(base, { x: -120, y: -60 }, { x: 120, y: -60 });
    const a: PlanRoom = { ...base, bulges: base.polygon.map((_, i) => (i === top ? 30 : 0)) };
    const plan = addRoom(emptyPlan(), a);
    const length = roomEdgeLength(a, top);
    const split = ok(splitEdgeEqual(plan, a.id, top, 2));
    const r = room(split, a.id);
    expect(r.polygon).toHaveLength(5);
    const pieces = r.polygon.map((_, i) => roomEdgeLength(r, i)).filter((l) => l > 0 && Math.abs(l - length / 2) < 1);
    expect(pieces).toHaveLength(2);
    const mid = r.polygon.findIndex((p) => Math.abs(p.x) < 1 && p.y < -60);
    const back = room(ok(combineAt(split, a.id, mid)), a.id);
    expect(back.polygon).toEqual(a.polygon);
    expect(Math.abs(back.bulges![top] - 30)).toBeLessThanOrEqual(0.2);
  });

  it("equal pieces have equal lengths on a straight wall", () => {
    const a = makeRoom(rectangle(0, 0, 240, 120), "Den");
    const top = edgeAt(a, { x: -120, y: -60 }, { x: 120, y: -60 });
    const r = room(ok(splitEdgeEqual(addRoom(emptyPlan(), a), a.id, top, 3)), a.id);
    expect(r.polygon).toHaveLength(6);
    const xs = r.polygon.filter((p) => p.y === -60).map((p) => p.x).sort((p, q) => p - q);
    expect(xs).toEqual([-120, -40, 40, 120]);
  });

  it("splitting a shared wall adds the corner to both rooms, and combining takes it out of both", () => {
    const { plan, a, b } = twoRooms();
    const shared = edgeAt(a, { x: 60, y: -60 }, { x: 60, y: 60 });
    const split = ok(splitEdge(plan, a.id, shared, { x: 60, y: 10 }));
    expect(cornerAt(room(split, a.id), { x: 60, y: 10 })).toBeGreaterThan(-1);
    expect(cornerAt(room(split, b.id), { x: 60, y: 10 })).toBeGreaterThan(-1);
    const back = ok(combineAt(split, a.id, cornerAt(room(split, a.id), { x: 60, y: 10 })));
    expect(room(back, a.id).polygon).toEqual(a.polygon);
    expect(room(back, b.id).polygon).toEqual(b.polygon);
  });

  it("combining at an angle makes one straight wall, and is refused at a shared corner", () => {
    const { plan, a } = twoRooms();
    // The top-left corner: nobody else is there.
    const free = cornerAt(a, { x: -60, y: -60 });
    const out = room(ok(combineAt(plan, a.id, free)), a.id);
    expect(out.polygon).toHaveLength(3);
    expect(roomArea(out)).toBeCloseTo(roomArea(a) / 2, 0);
    const shared = cornerAt(a, { x: 60, y: -60 });
    const why = combineAt(plan, a.id, shared);
    expect("why" in why && why.why).toMatch(/Kitchen shares this corner/);
  });

  it("finds the corner between two picked walls that meet", () => {
    const { plan, a } = twoRooms();
    expect(cornerBetween(plan, a.id, 0, 1)).toBe(1);
    expect(cornerBetween(plan, a.id, 3, 0)).toBe(0);
    expect(cornerBetween(plan, a.id, 0, 2)).toBeNull();
  });

  it("taking out one half of a split shared wall leaves the other half standing", () => {
    const { plan, a, b } = twoRooms();
    const shared = edgeAt(a, { x: 60, y: -60 }, { x: 60, y: 60 });
    const split = ok(splitEdge(plan, a.id, shared, { x: 60, y: 0 }));
    const ra = room(split, a.id);
    const upper = edgeAt(ra, { x: 60, y: -60 }, { x: 60, y: 0 });
    const lower = edgeAt(ra, { x: 60, y: 0 }, { x: 60, y: 60 });
    const out = removeWall(split, a.id, upper)!;
    expect(out).not.toBeNull();
    expect(edgeWalls(out.plan, a.id, upper).removed).toHaveLength(1);
    expect(edgeWalls(out.plan, a.id, lower).inside).toHaveLength(1);
    const rb = room(out.plan, b.id);
    expect(edgeWalls(out.plan, b.id, edgeAt(rb, { x: 60, y: 0 }, { x: 60, y: 60 })).inside).toHaveLength(1);
  });
});

describe("splitting and combining loose walls", () => {
  const plan0 = (bulge?: number): FloorPlan => ({
    ...emptyPlan(),
    walls: [{ id: "w1", a: { x: 0, y: 0 }, b: { x: 200, y: 0 }, thicknessIn: 4.5, ...(bulge ? { bulge } : {}) }],
    openings: [door({ wallId: "w1" }, 150)],
  });

  it("split keeps the door where it was, and combine puts the wall back", () => {
    const plan = plan0();
    const split = ok(splitWall(plan, "w1", { x: 80, y: 3 }));
    expect(split.walls).toHaveLength(2);
    expect(split.walls[0]).toMatchObject({ id: "w1", a: { x: 0, y: 0 }, b: { x: 80, y: 0 }, thicknessIn: 4.5 });
    const d = split.openings[0];
    expect(d.host).toEqual({ wallId: split.walls[1].id });
    expect(d.offsetIn).toBe(70);
    const back = ok(combineWalls(split, ["w1", split.walls[1].id]));
    expect(back.walls).toEqual(plan.walls);
    expect(back.openings[0]).toMatchObject({ host: { wallId: "w1" }, offsetIn: 150, side: 1, hinge: "start" });
  });

  it("equal pieces of a curved wall stay on the same circle and combine back", () => {
    const plan = { ...plan0(40), openings: [door({ wallId: "w1" }, 80)] };
    const L = wallLength(plan.walls[0]);
    const split = ok(splitWallEqual(plan, "w1", 4));
    expect(split.walls).toHaveLength(4);
    for (const w of split.walls) expect(wallLength(w)).toBeCloseTo(L / 4, 0);
    let back = split;
    while (back.walls.length > 1) back = ok(combineWalls(back, [back.walls[0].id, back.walls[1].id]));
    expect(back.walls[0].bulge).toBeCloseTo(40, 0);
    expect(back.openings[0].offsetIn).toBeCloseTo(80, 0);
  });

  it("combining a reversed wall flips its door so it swings the same way", () => {
    const plan: FloorPlan = {
      ...emptyPlan(),
      walls: [
        { id: "w1", a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, thicknessIn: 4.5 },
        { id: "w2", a: { x: 200, y: 0 }, b: { x: 100, y: 0 }, thicknessIn: 4.5 },
      ],
      openings: [door({ wallId: "w2" }, 30)],
    };
    const out = ok(combineWalls(plan, ["w1", "w2"]));
    expect(out.walls).toHaveLength(1);
    expect(out.openings[0]).toMatchObject({ host: { wallId: "w1" }, offsetIn: 170, side: -1, hinge: "end" });
  });

  it("combines at an angle into one straight wall, and refuses walls of different heights", () => {
    const plan: FloorPlan = {
      ...emptyPlan(),
      walls: [
        { id: "w1", a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, thicknessIn: 4.5 },
        { id: "w2", a: { x: 100, y: 0 }, b: { x: 100, y: 100 }, thicknessIn: 4.5 },
      ],
      openings: [],
    };
    const out = ok(combineWalls(plan, ["w1", "w2"]));
    expect(out.walls).toEqual([{ id: "w1", a: { x: 0, y: 0 }, b: { x: 100, y: 100 }, thicknessIn: 4.5 }]);
    const half = { ...plan, walls: [plan.walls[0], { ...plan.walls[1], height: "half" as const }] };
    const why = combineWalls(half, ["w1", "w2"]);
    expect("why" in why && why.why).toBe("These walls are different heights.");
  });

  it("takes out a door that no longer fits after a split, and says so", () => {
    const plan = plan0();
    const out = splitWallEqual(plan, "w1", 4);
    if ("why" in out) throw new Error(out.why);
    expect(out.plan.openings).toHaveLength(1);
    const tight = { ...plan, openings: [{ ...plan.openings[0], widthIn: 60 }] };
    const r = splitWallEqual(tight, "w1", 4);
    if ("why" in r) throw new Error(r.why);
    expect(r.plan.openings).toHaveLength(0);
    expect(r.note).toMatch(/Took out a door/);
    expect(hostSegment(r.plan, { wallId: "w1" })).not.toBeNull();
  });
});

describe("undo labels", () => {
  const base = createProject("Test");
  const at = (plan: FloorPlan) => ({ ...base, floorPlans: { "floor-1": plan } });

  it("names splitting and combining", () => {
    const { plan, a } = twoRooms();
    const split = ok(splitEdgeEqual(plan, a.id, 0, 2));
    expect(describeChange(at(plan), at(split))).toBe("split the Den wall");
    expect(describeChange(at(split), at(ok(combineAt(split, a.id, 1))))).toBe("combine Den walls");
    const loose: FloorPlan = { ...emptyPlan(), walls: [{ id: "w1", a: { x: 0, y: 300 }, b: { x: 200, y: 300 }, thicknessIn: 4.5 }] };
    const cut = ok(splitWall(loose, "w1", { x: 100, y: 300 }));
    expect(describeChange(at(loose), at(cut))).toBe("split a wall");
    expect(describeChange(at(cut), at(ok(combineWalls(cut, cut.walls.map((w) => w.id)))))).toBe("combine walls");
  });
});
