import { describe, expect, it } from "vitest";
import type { FloorPlan, Opening, PlanRoom } from "@/lib/model/schema";
import { dist, rectangle } from "@/lib/plan/geometry";
import { bulgeOf, roomEdgeArc, roomEdgeLength, wallLength } from "@/lib/plan/arcs";
import { bendInfo, bendToDepth, bendToRadius, bendWall, bowFromPoint, bowForRadius, planRadii, radiusFor, sharedEdges, snapBow, straighten, tooWideForCurve, widestUnit } from "@/lib/plan/bend";
import { DRAW_STEP_DEG, flatPlan, roomOutline, savedHost } from "@/lib/plan/flatten";
import { curvedOpeningGuides, edgeFrame, outsideDimensions, roomSizeText } from "@/lib/plan/labels";
import { hostSegment, nearestHost, wallPieces } from "@/lib/plan/walls";
import { describeChange } from "@/lib/store/describe";
import { createProject } from "@/lib/model/project";
import { planWarnings } from "@/lib/plan/checks";
import { setWallLength } from "@/lib/plan/edit";

const FT = 12;
const room = (id: string, x: number, y: number, w: number, h: number): PlanRoom => ({ id, name: id, type: "living", polygon: rectangle(x + w / 2, y + h / 2, w, h) });
const plan = (rooms: PlanRoom[], extra: Partial<FloorPlan> = {}): FloorPlan => ({ rooms, walls: [], openings: [], stairs: [], fixtures: [], furniture: [], ...extra });
const edgeAtX = (r: PlanRoom, x: number) =>
  r.polygon.findIndex((p, i) => {
    const q = r.polygon[(i + 1) % r.polygon.length];
    return Math.abs(p.x - x) < 0.01 && Math.abs(q.x - x) < 0.01;
  });

describe("bend math", () => {
  it("goes between radius and bow", () => {
    const chord = 12 * FT;
    const bow = bowForRadius(chord, 100);
    expect(radiusFor(chord, bow)).toBeCloseTo(100, 6);
    // Too small a radius can't reach: it becomes a half circle.
    expect(bowForRadius(chord, 10)).toBeCloseTo(chord / 2, 6);
  });
  it("reads the bow from where the pointer is", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 100, y: 0 };
    // Walking east, left is north (y up the screen).
    expect(bowFromPoint(a, b, { x: 50, y: -20 })).toBeCloseTo(20);
    expect(bowFromPoint(a, b, { x: 50, y: 20 })).toBeCloseTo(-20);
    expect(bowFromPoint(a, b, { x: 50, y: 500 })).toBeCloseTo(-50);
  });
  it("snaps to flat, a half circle and a nearby radius", () => {
    expect(snapBow(120, 3, [], 0.5)).toEqual({ left: 0, snap: "flat" });
    expect(snapBow(120, -58, [], 0.5)).toEqual({ left: -60, snap: "half" });
    const r = 150;
    const near = bowForRadius(120, r) + 4;
    const out = snapBow(120, near, [r], 0.5);
    expect(out.snap).toBe("radius");
    expect(radiusFor(120, out.left)).toBeCloseTo(r, 3);
    expect(snapBow(120, near, [r], 0.5, true).snap).toBeNull();
    expect(snapBow(120, 30, [], 0.5).snap).toBeNull();
  });
});

describe("bending a wall", () => {
  const two = () => plan([room("a", 0, 0, 12 * FT, 10 * FT), room("b", 12 * FT, 0, 10 * FT, 10 * FT)]);

  it("bends both rooms of a shared wall as one wall", () => {
    const p = two();
    const a = p.rooms[0];
    const edge = edgeAtX(a, 12 * FT);
    expect(sharedEdges(p, "a", edge)).toHaveLength(1);
    const out = bendWall(p, { roomId: "a", edge }, 24);
    const [ra, rb] = out.rooms;
    const arcA = roomEdgeArc(ra, edge)!;
    const arcB = roomEdgeArc(rb, edgeAtX(rb, 12 * FT))!;
    expect(arcA.radius).toBeCloseTo(arcB.radius, 6);
    expect(arcA.center.x).toBeCloseTo(arcB.center.x, 6);
    expect(arcA.center.y).toBeCloseTo(arcB.center.y, 6);
    // It bows out of one room and into the other.
    expect(Math.sign(bulgeOf(ra, edge))).toBe(-Math.sign(bulgeOf(rb, edgeAtX(rb, 12 * FT))));
    // After flattening they still share the wall: one wall piece chain, not two.
    const pieces = wallPieces(flatPlan(out, DRAW_STEP_DEG), 6);
    const shared = pieces.filter((x) => !x.exterior);
    expect(shared.length).toBeGreaterThan(5);
  });

  it("bends one room's side alone when asked", () => {
    const p = two();
    const edge = edgeAtX(p.rooms[0], 12 * FT);
    const out = bendWall(p, { roomId: "a", edge }, 24, true);
    expect(out.rooms[1].bulges).toBeUndefined();
    expect(roomEdgeArc(out.rooms[0], edge)).not.toBeNull();
  });

  it("bows toward the side you drag whichever way the corners run", () => {
    const p = plan([room("a", 0, 0, 12 * FT, 10 * FT)]);
    const edge = edgeAtX(p.rooms[0], 12 * FT);
    const info = bendInfo(p, { roomId: "a", edge })!;
    const pointer = { x: 12 * FT + 20, y: 5 * FT };
    const out = bendWall(p, { roomId: "a", edge }, bowFromPoint(info.a, info.b, pointer));
    const arc = roomEdgeArc(out.rooms[0], edge)!;
    const apex = { x: arc.center.x + (arc.center.x < 12 * FT ? arc.radius : -arc.radius), y: arc.center.y };
    expect(apex.x).toBeGreaterThan(12 * FT + 19);
  });

  it("types a radius or a depth, and makes straight again", () => {
    const p = plan([room("a", 0, 0, 12 * FT, 10 * FT)]);
    const t = { roomId: "a", edge: edgeAtX(p.rooms[0], 12 * FT) };
    const r = bendToRadius(p, t, 8 * FT);
    expect(bendInfo(r, t)!.radius).toBeCloseTo(8 * FT, 0);
    const d = bendToDepth(p, t, 18);
    expect(Math.abs(bendInfo(d, t)!.left)).toBeCloseTo(18, 1);
    const flatAgain = straighten(r, t);
    expect(flatAgain.rooms[0].bulges).toBeUndefined();
    expect(roomEdgeLength(flatAgain.rooms[0], t.edge)).toBeCloseTo(10 * FT);
  });

  it("never bends past a half circle", () => {
    const p = plan([room("a", 0, 0, 12 * FT, 10 * FT)]);
    const t = { roomId: "a", edge: edgeAtX(p.rooms[0], 12 * FT) };
    const out = bendWall(p, t, 9999);
    expect(Math.abs(bendInfo(out, t)!.left)).toBeCloseTo(5 * FT, 1);
  });

  it("bends a wall drawn on its own", () => {
    const p = plan([], { walls: [{ id: "w1", a: { x: 0, y: 0 }, b: { x: 120, y: 0 }, thicknessIn: 4.5 }] });
    const out = bendWall(p, { wallId: "w1" }, 30);
    expect(out.walls[0].bulge).toBe(30);
    expect(wallLength(out.walls[0])).toBeGreaterThan(120);
    expect(straighten(out, { wallId: "w1" }).walls[0].bulge).toBeUndefined();
    expect(planRadii(out)).toHaveLength(1);
    expect(planRadii(out, [{ wallId: "w1" }])).toHaveLength(0);
  });

  it("keeps a window in proportion along the wall", () => {
    const base = plan([room("a", 0, 0, 12 * FT, 10 * FT)]);
    const edge = edgeAtX(base.rooms[0], 12 * FT);
    const win: Opening = { id: "o1", host: { roomId: "a", edge }, offsetIn: 30, kind: "window", style: "window", widthIn: 24, heightIn: 48, sillIn: 30, side: -1, hinge: "start" };
    const out = bendWall({ ...base, openings: [win] }, { roomId: "a", edge }, 40);
    const was = 10 * FT;
    const now = bendInfo(out, { roomId: "a", edge })!.length;
    expect(out.openings[0].offsetIn).toBeCloseTo((30 / was) * now, 0);
  });

  it("stretches a curved loose wall to a length along the curve", () => {
    const p = plan([], { walls: [{ id: "w1", a: { x: 0, y: 0 }, b: { x: 120, y: 0 }, thicknessIn: 4.5, bulge: 30 }] });
    const before = wallLength(p.walls[0]);
    const out = setWallLength(p, "w1", before * 1.5);
    expect(wallLength(out.walls[0])).toBeCloseTo(before * 1.5, 0);
  });
});

describe("curves on screen", () => {
  const curved = () => {
    const p = plan([room("a", 0, 0, 12 * FT, 10 * FT)]);
    const t = { roomId: "a", edge: edgeAtX(p.rooms[0], 12 * FT) };
    return { p: bendWall(p, t, 30), t };
  };

  it("draws a curved room as a fine outline that bulges past its corners", () => {
    const { p } = curved();
    const outline = roomOutline(p.rooms[0]);
    expect(outline.length).toBeGreaterThan(8);
    expect(Math.max(...outline.map((q) => q.x))).toBeCloseTo(12 * FT + 30, 0);
    // A straight room is its own corners.
    expect(roomOutline(room("s", 0, 0, 100, 100))).toHaveLength(4);
  });

  it("measures the whole curved wall, not its pieces", () => {
    const { p, t } = curved();
    const flat = flatPlan(p, DRAW_STEP_DEG);
    const piece = wallPieces(flat, 6).find((x) => !x.open && "roomId" in x.host && x.host.edge !== t.edge);
    expect(piece).toBeDefined();
    const curvedPiece = wallPieces(flat, 6).find((x) => "roomId" in x.host && (savedHost(flat, x.host) as { edge: number }).edge === t.edge && x.host.edge !== t.edge);
    // Flat pieces map back to the saved edge.
    const host = savedHost(flat, curvedPiece!.host) as { roomId: string; edge: number };
    expect(host.edge).toBe(t.edge);
    const seg = hostSegment(p, host)!;
    expect(seg.bulge).toBeDefined();
    const f = edgeFrame(seg.a, seg.b, seg.bulge);
    expect(f.length).toBeCloseTo(roomEdgeLength(p.rooms[0], t.edge), 3);
    expect(f.radius).toBeCloseTo(radiusFor(10 * FT, 30), 3);
    // The middle of the label sits on the curve, a bow out from the chord.
    expect(f.mid.x).toBeCloseTo(12 * FT + 30, 1);
    expect(Math.abs(f.u.x)).toBeLessThan(0.01);
  });

  it("sizes a curved room by its true extent and gives its outside strings an R note", () => {
    const { p } = curved();
    const r = p.rooms[0];
    expect(roomSizeText(r.polygon, "feet", r.bulges)).toContain("×");
    expect(roomSizeText(r.polygon, "feet", r.bulges)).not.toBe(roomSizeText(r.polygon));
    const dims = outsideDimensions(p).filter((d) => d.side === "right");
    expect(dims.some((d) => d.text.includes("R "))).toBe(true);
  });

  it("finds the wall under the pointer on a curve and slides a unit along it", () => {
    const { p, t } = curved();
    const apex = { x: 12 * FT + 30, y: 5 * FT };
    const near = nearestHost(p, { x: apex.x + 3, y: apex.y }, 12)!;
    expect(near.seg.host).toEqual(t.roomId ? { roomId: "a", edge: t.edge } : near.seg.host);
    expect(near.t).toBeCloseTo(roomEdgeLength(p.rooms[0], t.edge) / 2, 0);
    // The wall runs up and down at its middle.
    expect(Math.abs(near.u.x)).toBeLessThan(0.05);
    expect(dist(near.point, apex)).toBeLessThan(1);
    const win: Opening = { id: "o1", host: near.seg.host, offsetIn: near.t, kind: "window", style: "window", widthIn: 36, heightIn: 48, sillIn: 30, side: -1, hinge: "start" };
    const guides = curvedOpeningGuides(hostSegment(p, win.host)!, win);
    expect(guides).toHaveLength(2);
    expect(guides[0].inches).toBeCloseTo(near.t - 18, 3);
  });
});

describe("doors and windows on tight curves", () => {
  it("flags a unit that sticks out of the wall and says what would fit", () => {
    const base = plan([room("a", 0, 0, 12 * FT, 10 * FT)]);
    const edge = edgeAtX(base.rooms[0], 12 * FT);
    const win = (w: number): Opening => ({ id: "o1", host: { roomId: "a", edge }, offsetIn: 60, kind: "window", style: "window", widthIn: w, heightIn: 48, sillIn: 30, side: -1, hinge: "start" });
    const tight = bendWall({ ...base, openings: [win(72)] }, { roomId: "a", edge }, 60);
    const bad = tooWideForCurve(tight);
    expect(bad).toHaveLength(1);
    expect(bad[0].fits).toBeLessThan(72);
    expect(bad[0].fits).toBeGreaterThan(10);
    expect(widestUnit(bad[0].radius)).toBe(bad[0].fits);
    // A narrow one fits, and so does the wide one on a gentle curve.
    expect(tooWideForCurve({ ...tight, openings: [win(bad[0].fits)] })).toHaveLength(0);
    expect(tooWideForCurve(bendWall({ ...base, openings: [win(72)] }, { roomId: "a", edge }, 1.5))).toHaveLength(0);
    expect(tooWideForCurve({ ...base, openings: [win(72)] })).toHaveLength(0);
  });

  it("shows up as a thing to check", () => {
    const base = plan([room("a", 0, 0, 12 * FT, 10 * FT)]);
    const edge = edgeAtX(base.rooms[0], 12 * FT);
    const win: Opening = { id: "o1", host: { roomId: "a", edge }, offsetIn: 60, kind: "window", style: "window", widthIn: 72, heightIn: 48, sillIn: 30, side: -1, hinge: "start" };
    const p = bendWall({ ...base, openings: [win] }, { roomId: "a", edge }, 60);
    const project = createProject("Test");
    const level = project.levels[0].id;
    const warnings = planWarnings({ [level]: p }, { levels: project.levels, brief: null, basics: null });
    expect(warnings.some((w) => w.text.includes("too wide for this curve"))).toBe(true);
  });
});

describe("undo labels", () => {
  it("names bending and straightening", () => {
    const project = createProject("Test");
    const level = Object.keys(project.floorPlans)[0] ?? "main";
    const a = plan([room("Kitchen", 0, 0, 12 * FT, 10 * FT)]);
    const t = { roomId: "Kitchen", edge: edgeAtX(a.rooms[0], 12 * FT) };
    const bent = bendWall(a, t, 24);
    const before = { ...project, floorPlans: { ...project.floorPlans, [level]: a } };
    const after = { ...project, floorPlans: { ...project.floorPlans, [level]: bent } };
    expect(describeChange(before, after)).toBe("curve the Kitchen wall");
    expect(describeChange(after, before)).toBe("straighten the Kitchen wall");
    expect(describeChange(after, { ...project, floorPlans: { ...project.floorPlans, [level]: bendWall(bent, t, 40) } })).toBe("bend the Kitchen wall");
    const w = plan([], { walls: [{ id: "w1", a: { x: 0, y: 0 }, b: { x: 120, y: 0 }, thicknessIn: 4.5 }] });
    const wb = { ...project, floorPlans: { ...project.floorPlans, [level]: w } };
    const wc = { ...project, floorPlans: { ...project.floorPlans, [level]: bendWall(w, { wallId: "w1" }, 20) } };
    expect(describeChange(wb, wc)).toBe("curve a wall");
  });
});
