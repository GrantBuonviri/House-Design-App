import { describe, expect, it } from "vitest";
import { createProject } from "@/lib/model/project";
import { describeChange } from "@/lib/store/describe";
import type { FloorPlan, Opening, PlanRoom, Point } from "@/lib/model/schema";
import { addRoom, emptyPlan, makeRoom } from "@/lib/plan/edit";
import { dist, rectangle } from "@/lib/plan/geometry";
import { roomEdgeArc, roomEdgeLength, wallArc } from "@/lib/plan/arcs";
import type { BendTarget } from "@/lib/plan/bend";
import { curveRun, curveTogether, isRun, runInfo, runOf, runToRadius, sharesOf, straightenRun, type Run, type RunEdit } from "@/lib/plan/curveRun";

const ok = (r: RunEdit) => {
  if ("why" in r) throw new Error(r.why);
  return r.plan;
};
const run = (plan: FloorPlan, targets: BendTarget[]): Run => {
  const r = runOf(plan, targets);
  if (!isRun(r)) throw new Error(r.why);
  return r;
};
const room = (plan: FloorPlan, id: string) => plan.rooms.find((r) => r.id === id)!;
const edgeAt = (r: PlanRoom, p: Point, q: Point) =>
  r.polygon.findIndex((a, i) => {
    const b = r.polygon[(i + 1) % r.polygon.length];
    return (dist(a, p) < 1 && dist(b, q) < 1) || (dist(a, q) < 1 && dist(b, p) < 1);
  });
const cornerAt = (r: PlanRoom, p: Point) => r.polygon.findIndex((q) => dist(q, p) < 1);
const door = (host: Opening["host"], offsetIn: number): Opening => ({ id: "d1", host, offsetIn, kind: "door", style: "door-hinged", widthIn: 32, heightIn: 80, side: 1, hinge: "start" });

/** A room with its top wall in three pieces, 100", 160" and 100" long. */
function threePieces() {
  const r = makeRoom([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 260, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 200 }, { x: 0, y: 200 }], "Great room");
  const plan = addRoom(emptyPlan(), r);
  const e = (p: Point, q: Point) => ({ roomId: r.id, edge: edgeAt(r, p, q) });
  const targets = [e({ x: 0, y: 0 }, { x: 100, y: 0 }), e({ x: 100, y: 0 }, { x: 260, y: 0 }), e({ x: 260, y: 0 }, { x: 360, y: 0 })];
  return { plan, r, targets };
}

describe("finding a run", () => {
  it("orders walls that meet end to end, picked in any order", () => {
    const { plan, targets } = threePieces();
    const r = run(plan, [targets[2], targets[0], targets[1]]);
    expect(r.pieces).toHaveLength(3);
    const ends = [r.a, r.b].map((p) => p.x).sort((a, b) => a - b);
    expect(ends).toEqual([0, 360]);
    for (let k = 1; k < 3; k++) expect(dist(r.pieces[k - 1].to, r.pieces[k].from)).toBeLessThan(1);
  });

  it("says why walls that don't touch, branch, or go all the way round aren't a run", () => {
    const { plan, r, targets } = threePieces();
    expect(runOf(plan, [targets[0], targets[2]])).toMatchObject({ why: expect.stringContaining("don't meet") });
    expect(runOf(plan, [targets[0]])).toMatchObject({ why: expect.stringContaining("two or more") });
    const all = r.polygon.map((_, edge) => ({ roomId: r.id, edge }));
    expect(runOf(plan, all)).toMatchObject({ why: expect.stringContaining("all the way around") });
    const branch: FloorPlan = { ...plan, walls: [{ id: "w9", a: { x: 100, y: 0 }, b: { x: 100, y: -80 }, thicknessIn: 4.5 }] };
    expect(runOf(branch, [...targets, { wallId: "w9" }])).toMatchObject({ why: expect.stringContaining("branch") });
  });
});

describe("curving walls together", () => {
  it("an L corner curves through the corner, so nothing moves at first", () => {
    // A corner wider than a right angle, so the circle through it is less than a half circle.
    const r = makeRoom([{ x: 0, y: 0 }, { x: 120, y: -40 }, { x: 240, y: 0 }, { x: 240, y: 160 }, { x: 0, y: 160 }], "Den");
    const plan = addRoom(emptyPlan(), r);
    const apex = { x: 120, y: -40 };
    const t = [{ roomId: r.id, edge: edgeAt(r, { x: 0, y: 0 }, apex) }, { roomId: r.id, edge: edgeAt(r, apex, { x: 240, y: 0 }) }];
    const out = ok(curveTogether(plan, run(plan, t)));
    const after = room(out, r.id);
    expect(cornerAt(after, apex)).toBeGreaterThan(-1);
    const a1 = roomEdgeArc(after, t[0].edge)!;
    const a2 = roomEdgeArc(after, t[1].edge)!;
    expect(Math.abs(a1.radius - a2.radius)).toBeLessThan(2);
    expect(dist(a1.center, a2.center)).toBeLessThan(1);
    // The circle through both ends and the corner: radius 200 here.
    expect(Math.abs(a1.radius - 200)).toBeLessThan(2);
    expect(runInfo(out, run(out, t)).together).toBe(true);
  });

  it("three pieces end up on one circle, corners at the same share of the length", () => {
    const { plan, r, targets } = threePieces();
    const rn = run(plan, targets);
    expect(sharesOf(plan, rn)[0]).toBeCloseTo(100 / 360, 5);
    const out = ok(curveRun(plan, rn, 80));
    const after = room(out, r.id);
    const arcs = targets.map((t) => roomEdgeArc(after, t.edge)!);
    for (const a of arcs) {
      expect(Math.abs(a.radius - arcs[0].radius)).toBeLessThan(2);
      expect(dist(a.center, arcs[0].center)).toBeLessThan(1);
    }
    const lengths = targets.map((t) => roomEdgeLength(after, t.edge));
    const total = lengths.reduce((a, b) => a + b, 0);
    expect(lengths[0] / total).toBeCloseTo(100 / 360, 2);
    expect(lengths[1] / total).toBeCloseTo(160 / 360, 2);
    expect(runInfo(out, run(out, targets)).together).toBe(true);
  });

  it("making it straight again gives straight pieces on the line", () => {
    const { plan, r, targets } = threePieces();
    const rn = run(plan, targets);
    const curved = ok(curveTogether(plan, rn));
    expect(room(curved, r.id).bulges).toBeDefined();
    const flat = ok(straightenRun(curved, run(curved, targets)));
    const after = room(flat, r.id);
    expect(after.bulges).toBeUndefined();
    expect(after.polygon.filter((p) => Math.abs(p.y) < 0.2)).toHaveLength(4);
    expect(after.polygon).toContainEqual({ x: 100, y: 0 });
    expect(after.polygon).toContainEqual({ x: 260, y: 0 });
  });

  it("a straight run starts with a gentle bow out of the room", () => {
    const { plan, r, targets } = threePieces();
    const out = ok(curveTogether(plan, run(plan, targets)));
    const after = room(out, r.id);
    expect(after.bulges!.filter((b) => b > 0)).toHaveLength(3); // Positive bulges bow out of the room.
    expect(Math.min(...after.polygon.map((p) => p.y))).toBeLessThan(-30);
  });

  it("a shared corner and a shared wall move with it", () => {
    const den = makeRoom(rectangle(0, 0, 120, 120), "Den");
    const kit = makeRoom(rectangle(120, 0, 120, 120), "Kitchen");
    const plan = addRoom(addRoom(emptyPlan(), den), kit);
    // Den's top wall and the wall it shares with the Kitchen, meeting at the shared corner (60, -60).
    const corner = { x: 60, y: -60 };
    const t = [{ roomId: den.id, edge: edgeAt(den, { x: -60, y: -60 }, corner) }, { roomId: den.id, edge: edgeAt(den, corner, { x: 60, y: 60 }) }];
    const out = ok(curveRun(plan, run(plan, t), 30));
    const d = room(out, den.id);
    const k = room(out, kit.id);
    const moved = d.polygon.find((p) => dist(p, corner) > 1 && dist(p, corner) < 80 && p.y < 0 && p.x > 0)!;
    expect(moved).toBeDefined();
    expect(cornerAt(k, moved)).toBeGreaterThan(-1);
    const shared = edgeAt(d, moved, { x: 60, y: 60 });
    const theirs = edgeAt(k, moved, { x: 60, y: 60 });
    const a1 = roomEdgeArc(d, shared)!;
    const a2 = roomEdgeArc(k, theirs)!;
    expect(a2).not.toBeNull();
    expect(dist(a1.center, a2.center)).toBeLessThan(1);
    // Option: only this room's side moves.
    const alone = ok(curveRun(plan, run(plan, t), 30, { alone: true }));
    expect(room(alone, kit.id)).toEqual(kit);
  });

  it("a door keeps its place in proportion along its wall", () => {
    const { plan: p0, r, targets } = threePieces();
    const plan: FloorPlan = { ...p0, openings: [door(targets[1], 40)] };
    const was = roomEdgeLength(r, targets[1].edge);
    const out = ok(curveTogether(plan, run(plan, targets)));
    const after = room(out, r.id);
    const now = roomEdgeLength(after, (out.openings[0].host as { edge: number }).edge);
    expect(out.openings[0].offsetIn).toBeCloseTo((40 / was) * now, 0);
  });

  it("refuses a bow past a half circle, or one that turns a room inside out", () => {
    const thin = makeRoom([{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 40 }, { x: 0, y: 40 }], "Hall");
    const plan = addRoom(emptyPlan(), thin);
    const t = [{ roomId: thin.id, edge: edgeAt(thin, { x: 0, y: 0 }, { x: 120, y: 0 }) }, { roomId: thin.id, edge: edgeAt(thin, { x: 120, y: 0 }, { x: 240, y: 0 }) }];
    const rn = run(plan, t);
    expect(curveRun(plan, rn, 130)).toMatchObject({ why: expect.stringContaining("half circle") });
    const both = [curveRun(plan, rn, 100), curveRun(plan, rn, -100)];
    expect(both.filter((x) => "why" in x && x.why.includes("inside out"))).toHaveLength(1);
    expect(both.filter((x) => "plan" in x)).toHaveLength(1);
    expect(runToRadius(plan, rn, 50)).toMatchObject({ why: expect.stringContaining("radius") });
  });

  it("loose walls that meet curve together as one circle", () => {
    const plan: FloorPlan = {
      ...emptyPlan(),
      walls: [
        { id: "w1", a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, thicknessIn: 4.5 },
        { id: "w2", a: { x: 200, y: 0 }, b: { x: 100, y: 0 }, thicknessIn: 4.5 },
      ],
    };
    const out = ok(curveRun(plan, run(plan, [{ wallId: "w1" }, { wallId: "w2" }]), 50));
    const [w1, w2] = out.walls;
    expect(dist(w1.b, w2.b)).toBeLessThan(0.01);
    const a1 = wallArc(w1)!;
    const a2 = wallArc(w2)!;
    expect(dist(a1.center, a2.center)).toBeLessThan(1);
    expect(Math.abs(a1.radius - a2.radius)).toBeLessThan(2);
  });
});


describe("undo labels", () => {
  const base = createProject("Test");
  const at = (plan: FloorPlan) => ({ ...base, floorPlans: { "floor-1": plan } });

  it("names curving walls together and straightening them", () => {
    const { plan, targets } = threePieces();
    const curved = ok(curveTogether(plan, run(plan, targets)));
    expect(describeChange(at(plan), at(curved))).toBe("curve the Great room walls together");
    const flat = ok(straightenRun(curved, run(curved, targets)));
    expect(describeChange(at(curved), at(flat))).toBe("straighten the Great room walls");
  });
});
