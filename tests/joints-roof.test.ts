import { describe, expect, it } from "vitest";
import polygonClipping from "polygon-clipping";
import { House3D, type FloorPlan, type PlanRoom, type Point, type Project, type Roof } from "@/lib/model/schema";
import { levelsFor } from "@/lib/brief/levels";
import { defaultBasics, exteriorWallIn } from "@/lib/plan/basics";
import { rectangle } from "@/lib/plan/geometry";
import { flatPlans } from "@/lib/plan/flatten";
import { buildHouse, buildRoofs, type HouseContext, type Part } from "@/lib/house3d/build";
import { floorFootprint, offsetRing } from "@/lib/house3d/footprint";
import { levelHeights } from "@/lib/house3d/levels";
import { IN_PER_UNIT, type MeshData } from "@/lib/house3d/mesh";
import { siteFor } from "@/lib/house3d/site";
import { measureRoof } from "@/lib/cost/measureRoof";
import { house, RANCH, TWO_STORY } from "./samples";

const FT = 12;

function room(id: string, x: number, y: number, w: number, h: number, type = "living"): PlanRoom {
  return { id, name: id, type, polygon: rectangle(x + w / 2, y + h / 2, w, h) };
}
function plan(rooms: PlanRoom[]): FloorPlan {
  return { rooms, walls: [], openings: [], stairs: [], fixtures: [], furniture: [] };
}
function roundRoom(id: string, c: Point, r: number): PlanRoom {
  const polygon = [
    { x: c.x, y: c.y - r },
    { x: c.x + r, y: c.y },
    { x: c.x, y: c.y + r },
    { x: c.x - r, y: c.y },
  ];
  const bow = r * (1 - Math.cos(Math.PI / 4));
  return { id, name: id, type: "living", polygon, bulges: [bow, bow, bow, bow] };
}

const levels = levelsFor(2, 0);
function ctxFor(plans: Record<string, FloorPlan>, roof: Partial<Roof>): HouseContext & { heights: ReturnType<typeof levelHeights> } {
  const h3 = House3D.parse({});
  return {
    levels,
    basics: defaultBasics(),
    house3d: { ...h3, roof: { ...h3.roof, ...roof } },
    site: siteFor(null, { x: 0, y: 0 }, plans),
    frame: { ox: 0, oy: 0 },
    heights: levelHeights(levels, defaultBasics()),
  };
}

/** Plan triangles (inches) with heights from a mesh. */
function tris(m: MeshData): { p: Point[]; h: number[] }[] {
  const out = [];
  for (let i = 0; i < m.count; i++) {
    const p: Point[] = [];
    const h: number[] = [];
    for (let k = 0; k < 3; k++) {
      const o = (i * 3 + k) * 3;
      p.push({ x: m.positions[o] * IN_PER_UNIT, y: m.positions[o + 2] * IN_PER_UNIT });
      h.push(m.positions[o + 1] * IN_PER_UNIT);
    }
    out.push({ p, h });
  }
  return out;
}

const ring = (pts: Point[]): [number, number][] => [...pts.map((p) => [p.x, p.y] as [number, number]), [pts[0].x, pts[0].y]];
const areaOf = (mp: [number, number][][][]) =>
  mp.reduce((s, poly) => s + poly.reduce((t, r, i) => t + (i ? -1 : 1) * Math.abs(r.reduce((a, [x, y], j) => (j ? a + (r[j - 1][0] * y - x * r[j - 1][1]) : a), 0) / 2), 0), 0);

/** How much of the lower roof (square inches, in plan) sits inside the upper floor's outside walls, and its highest point. */
function intoUpper(plans: Record<string, FloorPlan>, roof: Partial<Roof>) {
  const c = ctxFor(plans, roof);
  const roofs = buildRoofs(plans, c);
  const wall = exteriorWallIn(c.basics);
  const upper = floorFootprint(flatPlans(plans)["floor-2"]).map((r) => [ring(offsetRing(r.outline, wall / 2 - 0.25))]);
  const lower = roofs.parts.filter((p) => p.levelId === "floor-1" && p.key.endsWith(":roof:roof"));
  let inside = 0;
  let top = -Infinity;
  for (const p of lower)
    for (const t of tris(p.mesh)) {
      top = Math.max(top, ...t.h);
      inside += areaOf(polygonClipping.intersection([ring(t.p)], ...upper) as [number, number][][][]);
    }
  const trim = roofs.parts.filter((p) => p.levelId === "floor-1" && p.key.endsWith(":roof:trim"));
  return { inside, top, lowerCount: lower.reduce((s, p) => s + p.mesh.count, 0), trim, roofs, c };
}

const STYLES: Roof["style"][] = ["gable", "hip", "shed", "flat"];

describe("a lower roof against a taller wall", () => {
  // A two-story block with a one-story wing off its east side.
  const wing = { "floor-1": plan([room("a", 0, 0, 30 * FT, 24 * FT), room("w", 30 * FT, 4 * FT, 20 * FT, 16 * FT)]), "floor-2": plan([room("b", 0, 0, 30 * FT, 24 * FT)]) };
  // A round room downstairs with a square room over its west half.
  const round = { "floor-1": plan([roundRoom("r", { x: 0, y: 0 }, 15 * FT)]), "floor-2": plan([room("b", -15 * FT, -15 * FT, 15 * FT, 30 * FT)]) };
  // A wraparound: the lower floor sticks out on two sides of the upper one.
  const wrap = { "floor-1": plan([room("a", 0, 0, 40 * FT, 30 * FT)]), "floor-2": plan([room("b", 0, 0, 24 * FT, 18 * FT)]) };

  for (const style of STYLES)
    for (const [name, plans] of [["wing", wing], ["round room", round], ["wraparound", wrap]] as const)
      it(`keeps a ${style} roof on the ${name} out of the upper floor's walls`, () => {
        const r = intoUpper(plans, { style, pitch: 6 });
        expect(r.lowerCount).toBeGreaterThan(0);
        expect(r.inside).toBeLessThan(1);
        const up = r.c.heights["floor-2"];
        expect(r.top).toBeLessThanOrEqual(up.floorIn + up.ceilingIn + 0.5);
        expect(r.roofs.fellBack).toBe(false);
      });

  it("puts flashing where the wing's roof meets the wall", () => {
    const r = intoUpper(wing, { style: "gable", pitch: 6 });
    // Some trim stands right at the upper wall's face (x = 30 ft plus half the wall).
    const face = 30 * FT + exteriorWallIn(r.c.basics) / 2;
    const near = r.trim.flatMap((p) => tris(p.mesh)).filter((t) => t.p.every((q) => Math.abs(q.x - face) < 1));
    expect(near.length).toBeGreaterThan(0);
  });

  it("leans a steep roof on the wall instead of running it past the upper floor", () => {
    // A deep, wide wing at a steep pitch would rise past the top of the upper floor's walls.
    const deep = { "floor-1": plan([room("a", 0, 0, 20 * FT, 20 * FT), room("w", 0, 20 * FT, 60 * FT, 40 * FT)]), "floor-2": plan([room("b", 0, 0, 20 * FT, 20 * FT)]) };
    const r = intoUpper(deep, { style: "hip", pitch: 12 });
    expect(r.inside).toBeLessThan(1);
    const up = r.c.heights["floor-2"];
    expect(r.top).toBeLessThanOrEqual(up.floorIn + up.ceilingIn + 0.5);
    expect(r.roofs.leansOnWall).toBe(true);
  });

  it("prices the roof it draws", () => {
    const m = measureRoof(wing, levels, defaultBasics(), { ...House3D.parse({}).roof, style: "gable", pitch: 6 });
    // Main block (30 x 24) plus the wing (20 x 16), with overhangs and slope: a few hundred square feet more than the wing alone.
    expect(m.roofSqft).toBeGreaterThan(30 * 24 + 20 * 16);
    expect(m.roofSqft).toBeLessThan(2 * (30 * 24 + 20 * 16));
  });
});

// ---- Wall joints ----

type Tri3 = [number, number, number][];

/** Wall triangles (scene units) from every floor. */
function wallTris(parts: Part[], layer: Part["layer"] = "walls"): { t: Tri3; key: string }[] {
  const out: { t: Tri3; key: string }[] = [];
  for (const p of parts.filter((x) => x.layer === layer && !x.quality)) {
    const m = p.mesh;
    for (let i = 0; i < m.count; i++) {
      const t: Tri3 = [0, 1, 2].map((k) => {
        const o = (i * 3 + k) * 3;
        return [m.positions[o], m.positions[o + 1], m.positions[o + 2]] as [number, number, number];
      });
      out.push({ t, key: p.key });
    }
  }
  return out;
}

/** Pairs of wall faces that lie in the same plane, face the same way and overlap (they'd flicker). */
function overlaps(parts: Part[], layer: Part["layer"] = "walls"): { a: Tri3; b: Tri3; area: number }[] {
  const buckets = new Map<string, { t: Tri3; n: number[]; key: string }[]>();
  for (const { t, key } of wallTris(parts, layer)) {
    const u = t[1].map((x, j) => x - t[0][j]);
    const v = t[2].map((x, j) => x - t[0][j]);
    const c = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(...c);
    if (l < 1e-9) continue;
    const n = c.map((x) => x / l);
    const d = n[0] * t[0][0] + n[1] * t[0][1] + n[2] * t[0][2];
    const k = `${n.map((x) => Math.round(x * 500)).join(",")}|${Math.round(d * 50)}`;
    const b = buckets.get(k) ?? [];
    b.push({ t, n, key });
    buckets.set(k, b);
  }
  const found: { a: Tri3; b: Tri3; area: number }[] = [];
  for (const b of buckets.values()) {
    if (b.length < 2) continue;
    const n = b[0].n;
    // Flatten onto the plane by dropping its main axis.
    const ax = n.map(Math.abs).indexOf(Math.max(...n.map(Math.abs)));
    const flat = (t: Tri3) => t.map((p) => p.filter((_, j) => j !== ax) as [number, number]);
    for (let i = 0; i < b.length; i++)
      for (let j = i + 1; j < b.length; j++) {
        const area = convexOverlap(flat(b[i].t), flat(b[j].t));
        if (area > 1e-4) found.push({ a: b[i].t, b: b[j].t, area });
      }
  }
  return found;
}

/** The area two triangles share. */
function convexOverlap(p: [number, number][], q: [number, number][]): number {
  const signed = (r: [number, number][]) => r.reduce((s, a, i) => s + (a[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * a[1]), 0) / 2;
  if (signed(p) < 0) p = [...p].reverse();
  if (signed(q) < 0) q = [...q].reverse();
  let out = p;
  for (let i = 0; i < q.length && out.length; i++) {
    const a = q[i];
    const b = q[(i + 1) % q.length];
    const side = (c: [number, number]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const next: [number, number][] = [];
    out.forEach((c, k) => {
      const d = out[(k + 1) % out.length];
      const sc = side(c);
      const sd = side(d);
      if (sc >= 0) next.push(c);
      if (sc * sd < 0) {
        const t = sc / (sc - sd);
        next.push([c[0] + t * (d[0] - c[0]), c[1] + t * (d[1] - c[1])]);
      }
    });
    out = next;
  }
  return out.length >= 3 ? Math.abs(signed(out)) : 0;
}

function houseCtx(p: Project): HouseContext {
  return { levels: p.levels, basics: p.plan.basics, house3d: p.house3d, interior: p.interior.selections, exterior: p.exterior, site: siteFor(p.plot, { x: 0, y: 0 }, p.floorPlans), frame: { ox: 0, oy: 0 } };
}

describe("wall joints", () => {
  const one = levelsFor(1, 0);
  const plainCtx = (plans: Record<string, FloorPlan>): HouseContext => {
    const h3 = House3D.parse({});
    return { levels: one, basics: defaultBasics(), house3d: h3, site: siteFor(null, { x: 0, y: 0 }, plans), frame: { ox: 0, oy: 0 } };
  };

  it("has no overlapping wall faces in the sample houses", () => {
    for (const p of [house(RANCH), house(TWO_STORY, 2)]) {
      const model = buildHouse(p.floorPlans, houseCtx(p));
      expect(overlaps(model.parts)).toEqual([]);
      expect(overlaps(model.parts, "footprints")).toEqual([]);
      expect(overlaps(model.parts, "foundation")).toEqual([]);
    }
  });

  it("meets cleanly at L corners, T joints and a curved room", () => {
    // Two rooms side by side (a T where the wall between them meets the outside wall), and a round room.
    const plans = {
      "floor-1": plan([room("a", 0, 0, 16 * FT, 12 * FT), room("b", 16 * FT, 0, 12 * FT, 12 * FT, "bedroom"), room("c", 0, 12 * FT, 10 * FT, 10 * FT, "bathroom"), roundRoom("r", { x: 50 * FT, y: 10 * FT }, 12 * FT)]),
    };
    const model = buildHouse(plans, plainCtx(plans));
    expect(overlaps(model.parts)).toEqual([]);
    expect(overlaps(model.parts, "footprints")).toEqual([]);
  });

  it("wraps the siding round an outside corner", () => {
    const plans = { "floor-1": plan([room("a", 0, 0, 16 * FT, 12 * FT)]) };
    const model = buildHouse(plans, plainCtx(plans));
    const outside = model.parts.find((p) => p.key.endsWith(":walls:outside"))!;
    // The outside corner of the walls sits out at half the wall's thickness on both sides, and nothing pokes past it.
    const xs = Array.from(outside.mesh.positions).filter((_, i) => i % 3 === 0);
    const half = exteriorWallIn(defaultBasics()) / 2 / IN_PER_UNIT;
    expect(Math.min(...xs)).toBeCloseTo(-half, 4);
    expect(Math.max(...xs)).toBeCloseTo(16 + half, 4);
  });
});
