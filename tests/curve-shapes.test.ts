import { describe, expect, it } from "vitest";
import type { FloorPlan, PlanRoom } from "@/lib/model/schema";
import { createProject } from "@/lib/model/project";
import { generatePlot, FLAT_PLOT_SEED } from "@/lib/land/generate";
import { levelFor, MAIN_LEVEL_ID } from "@/lib/brief/levels";
import { defaultBasics } from "@/lib/plan/basics";
import { DEFAULT_LABELS } from "@/lib/plan/labels";
import { rectangle } from "@/lib/plan/geometry";
import { roomArea } from "@/lib/plan/arcs";
import { addBay, makeRoundRoom, roundCorner, roundRoomShape, whyNoBay } from "@/lib/plan/shapes";
import { measurePlan } from "@/lib/cost/quantities";
import { estimate } from "@/lib/cost/estimate";
import { buildSet } from "@/lib/plans/build";
import { curvedWallLength } from "@/lib/cost/measurePlan";

const flat = generatePlot(FLAT_PLOT_SEED, { flat: true });
const room = (id: string, x: number, y: number, w: number, h: number): PlanRoom => ({ id, name: id, type: "living", polygon: rectangle(x + w / 2, y + h / 2, w, h) });
const plan = (rooms: PlanRoom[]): FloorPlan => ({ rooms, walls: [], openings: [], stairs: [], fixtures: [], furniture: [] });
const project = (plans: Record<string, FloorPlan>) => ({ ...createProject("Shapes"), plot: flat, levels: [levelFor(MAIN_LEVEL_ID)], floorPlans: plans, plan: { basics: defaultBasics(), showSketch: false, labels: DEFAULT_LABELS } });

describe("round corner", () => {
  it("cuts a 2' quarter circle off a corner and takes that much off the area", () => {
    const p = plan([room("a", 0, 0, 240, 240)]);
    const out = roundCorner(p, "a", 0, 24)!;
    const r = out.rooms[0];
    expect(r.polygon).toHaveLength(5);
    expect(r.bulges!.filter((b) => b !== 0)).toHaveLength(1);
    const lost = 24 * 24 * (1 - Math.PI / 4);
    expect(roomArea(p.rooms[0]) - roomArea(r)).toBeCloseTo(lost, -1);
  });
  it("rounds the inside of an L-shape's inner corner by adding area", () => {
    const l: PlanRoom = { id: "l", name: "l", type: "living", polygon: [{ x: 0, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 120 }, { x: 120, y: 120 }, { x: 120, y: 240 }, { x: 0, y: 240 }] };
    const out = roundCorner(plan([l]), "l", 3, 24)!;
    expect(roomArea(out.rooms[0])).toBeGreaterThan(roomArea(l));
  });
  it("shrinks the radius to fit a short wall and refuses curved or flat corners", () => {
    const small = plan([room("a", 0, 0, 240, 40)]);
    const out = roundCorner(small, "a", 0, 100)!;
    expect(roomArea(out.rooms[0])).toBeLessThan(roomArea(small.rooms[0]));
    const round = plan([makeRoundRoom({ x: 0, y: 0 }, 144)]);
    expect(roundCorner(round, round.rooms[0].id, 0)).toBeNull();
  });
});

describe("round room", () => {
  it("is a circle of the typed diameter", () => {
    const { polygon, bulges } = roundRoomShape({ x: 100, y: 100 }, 144);
    expect(polygon).toHaveLength(4);
    expect(roomArea({ polygon, bulges })).toBeCloseTo(Math.PI * 72 * 72, -1);
  });
});

describe("half-round bay", () => {
  it("adds a half circle to an outside wall and not to a shared wall", () => {
    const p = plan([room("a", 0, 0, 240, 240), room("b", 240, 0, 240, 240)]);
    const edge = p.rooms[0].polygon.findIndex((c, i) => c.y === 0 && p.rooms[0].polygon[(i + 1) % 4].y === 0);
    const out = addBay(p, "a", edge)!;
    expect(out.rooms[0].polygon).toHaveLength(6);
    expect(roomArea(out.rooms[0]) - roomArea(p.rooms[0])).toBeCloseTo((Math.PI * 48 * 48) / 2, -1);
    const shared = p.rooms[0].polygon.findIndex((c, i) => c.x === 240 && p.rooms[0].polygon[(i + 1) % 4].x === 240);
    expect(whyNoBay(p, "a", shared)).toMatch(/outside/);
    expect(addBay(p, "a", shared)).toBeNull();
  });
});

describe("cost of curved walls", () => {
  it("measures curve length once and adds the two extra lines", () => {
    const plans = { [MAIN_LEVEL_ID]: plan([makeRoundRoom({ x: 0, y: 0 }, 240)]) };
    expect(curvedWallLength(plans)).toBeCloseTo(Math.PI * 240, 0);
    expect(measurePlan(project(plans))!.curvedWallLf).toBeCloseTo((Math.PI * 240) / 12, 0);
    const lines = estimate(project(plans))!.categories.flatMap((c) => c.lines).filter((l) => l.id.startsWith("curved-wall"));
    expect(lines.map((l) => l.id).sort()).toEqual(["curved-wall-drywall", "curved-wall-framing"]);
    const straight = { [MAIN_LEVEL_ID]: plan([room("a", 0, 0, 240, 240)]) };
    expect(estimate(project(straight))!.categories.flatMap((c) => c.lines).some((l) => l.id.startsWith("curved-wall"))).toBe(false);
  });
});

describe("curved walls on the PDF", () => {
  const round = makeRoundRoom({ x: 0, y: 0 }, 360);
  const win = { id: "w1", kind: "window" as const, style: "window", host: { roomId: round.id, edge: 0 }, offsetIn: 40, widthIn: 36, heightIn: 48, sillIn: 30, side: 1 as const };
  const p = project({ [MAIN_LEVEL_ID]: { ...plan([round]), openings: [win as never] } });
  const texts = (items: { t: string; text?: string }[]) => items.filter((i) => i.t === "text").map((i) => i.text ?? "");

  it("labels each curve with its radius and arc length, and adds the framing and schedule notes", () => {
    const set = buildSet(p);
    const plan101 = set.find((s) => s.number === "A-101")!;
    const all = texts(plan101.items as never);
    expect(all).toContain("R 15'-0\"");
    expect(all.filter((t) => t.startsWith("ARC "))).toHaveLength(4);
    expect(all.some((t) => t.includes("studs at 12\" on center"))).toBe(true);
    const every = set.flatMap((s) => texts(s.items as never));
    expect(every.some((t) => t.includes("Set in a curved wall"))).toBe(true);
    expect(every.some((t) => t.includes("Units marked as set in a curved wall"))).toBe(true);
  });
  it("adds none of that to a straight house", () => {
    const q = project({ [MAIN_LEVEL_ID]: plan([room("a", 0, 0, 240, 240)]) });
    const every = buildSet(q).flatMap((s) => texts(s.items as never));
    expect(every.some((t) => t.startsWith("ARC ") || t.includes("curved wall"))).toBe(false);
  });
});
