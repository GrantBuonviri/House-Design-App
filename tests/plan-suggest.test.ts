import { describe, expect, it } from "vitest";
import { DiscoveryAnswers, type ChosenRoom, type DesignBrief, type FloorPlan, type PlanRoom, type Plot } from "@/lib/model/schema";
import { FLAT_PLOT_SEED, generatePlot } from "@/lib/land/generate";
import { buildRuleBrief } from "@/lib/brief/rules";
import { MAIN_LEVEL_ID, levelsFor } from "@/lib/brief/levels";
import { roomType } from "@/lib/brief/rooms";
import { suggestDiagrams } from "@/lib/bubbles/arrange";
import { defaultBasics } from "@/lib/plan/basics";
import { OUTSIDE, addDoor, doorBetween, freeSpot, newOpening, openingRooms, reachable, roomLinks, sharedWall } from "@/lib/plan/connect";
import { applyChange, applyChanges, mirrorPlans, pushWall, type PlanChange } from "@/lib/plan/changes";
import { pickDistinct, rankAlternatives, ruleAlternatives, signature, suggestPlanAlternatives } from "@/lib/plan/alternatives";
import { planWarnings } from "@/lib/plan/checks";
import { emptyPlan, makeRoom, moveEdge, planOf, type Plans } from "@/lib/plan/edit";
import { closeGaps } from "@/lib/plan/fromSketch";
import { boundsOf, collinearOverlap, dist, polygonArea, polygonsOverlap, rectangle } from "@/lib/plan/geometry";
import { roomSqft } from "@/lib/plan/measure";
import {
  addClosets,
  addHallways,
  coverStairs,
  addWindows,
  connectAll,
  outsideStretches,
  roomsNeedingHall,
  stairsBoxes,
  suggestPlans,
  wayInRooms,
} from "@/lib/plan/suggest";
import { openingGeometry } from "@/lib/plan/walls";
import { hangingArea } from "@/lib/plan/support";
import { stackIds } from "@/lib/plan/anchor";

const FT = 12;
const EXT = 6.5;

/** A rectangular room from its top-left corner and size, in feet. */
function room(id: string, type: string, x: number, y: number, w: number, h: number): PlanRoom {
  return { ...makeRoom(rectangle((x + w / 2) * FT, (y + h / 2) * FT, w * FT, h * FT), roomType(type).label), id, type };
}

function plan(rooms: PlanRoom[], extra: Partial<FloorPlan> = {}): FloorPlan {
  return { ...emptyPlan(), rooms, ...extra };
}

const byId = (p: FloorPlan, id: string) => p.rooms.find((r) => r.id === id)!;
const totalArea = (p: FloorPlan) => p.rooms.reduce((s, r) => s + polygonArea(r.polygon), 0);

/** Nothing on top of anything: rooms, doors and windows. */
function expectSound(p: FloorPlan) {
  for (let i = 0; i < p.rooms.length; i++) {
    for (let j = i + 1; j < p.rooms.length; j++) expect(polygonsOverlap(p.rooms[i].polygon, p.rooms[j].polygon), `${p.rooms[i].name} / ${p.rooms[j].name}`).toBe(false);
  }
  const geos = p.openings.map((o) => openingGeometry(p, o));
  expect(geos.every(Boolean)).toBe(true);
  for (let i = 0; i < geos.length; i++) {
    for (let j = i + 1; j < geos.length; j++) expect(collinearOverlap(geos[i]!.a, geos[i]!.b, geos[j]!.a, geos[j]!.b, 4)).toBeNull();
  }
}

const flat = generatePlot(FLAT_PLOT_SEED, { flat: true });
const levels = levelsFor(1, 0);

function brief(rooms: { id: string; type: string; name: string; targetSqFt: number }[], extra: Partial<DesignBrief> = {}): DesignBrief {
  return { rooms, adjacencies: [], floors: 1, floorsBelow: 0, garageBays: 0, openKitchen: false, vibe: [], priorities: [], accessibility: [], ...extra };
}

let n = 0;
function chosen(type: string, levelId?: string): ChosenRoom {
  return { id: `c${++n}`, type, name: `${roomType(type).label} ${n}`, description: "", ...(levelId ? { levelId } : {}) };
}

/** A whole house from the rules: brief, flow sketch, and Suggest a plan. */
function house(types: [string, string?][], floorsAbove = 1, floorsBelow = 0, seed = 7) {
  const rooms = types.map(([t, l]) => chosen(t, l));
  const plot = generatePlot(seed);
  const b = buildRuleBrief({ answers: DiscoveryAnswers.parse({ rooms, floorsAbove, floorsBelow }), profile: { mustHaves: [], dislikes: [] }, plot });
  const lv = levelsFor(b.floors, b.floorsBelow);
  const ctx = { brief: b, plot, levels: lv, basics: defaultBasics() };
  return { ctx, sketch: suggestDiagrams({ brief: b, plot, levels: lv }), result: suggestPlans(suggestDiagrams({ brief: b, plot, levels: lv }), ctx) };
}

const RANCH: [string, string?][] = [["entry"], ["kitchen"], ["dining"], ["living"], ["primary-bedroom"], ["primary-bath"], ["bedroom"], ["bedroom"], ["bathroom"], ["garage"], ["laundry"]];
const TWO_STORY: [string, string?][] = [
  ["entry"],
  ["kitchen"],
  ["family"],
  ["half-bath"],
  ["garage"],
  ["mudroom"],
  ["primary-bedroom", "floor-2"],
  ["primary-bath", "floor-2"],
  ["bedroom", "floor-2"],
  ["bedroom", "floor-2"],
  ["bathroom", "floor-2"],
];

// ---------- How rooms connect ----------

describe("connecting rooms", () => {
  const living = room("l", "living", 0, 0, 16, 14);
  const bed = room("b", "bedroom", 16, 0, 12, 12);

  it("finds the wall two rooms share and the rooms either side of a door", () => {
    const w = sharedWall(living, bed)!;
    expect(w.t1 - w.t0).toBeCloseTo(12 * FT);
    const p = addDoor(plan([living, bed]), living, bed)!;
    expect(p.openings).toHaveLength(1);
    expect([...openingRooms(p, p.openings[0])].sort()).toEqual(["b", "l"]);
    expect(roomLinks(p).get("l")!.has("b")).toBe(true);
  });

  it("swings doors into the smaller room, and away from a hallway", () => {
    const d = doorBetween(plan([living, bed]), living, bed)!;
    const p = plan([living, bed], { openings: [d] });
    const g = openingGeometry(p, d)!;
    // The swing side points into the bedroom (east of the shared wall).
    expect(g.n.x * d.side).toBeGreaterThan(0);
    const hall = room("h", "hall", 16, 12, 12, 3.5);
    const toHall = doorBetween(plan([bed, hall]), hall, bed)!;
    const q = plan([bed, hall], { openings: [toHall] });
    const gh = openingGeometry(q, toHall)!;
    expect(gh.n.y * toHall.side).toBeLessThan(0);
  });

  it("puts a new opening clear of the ones already in a wall", () => {
    const p = plan([living, bed]);
    const w = sharedWall(living, bed)!;
    const host = { roomId: "l", edge: w.edge };
    const mid = freeSpot(p, host, w.t0, w.t1, 32)!;
    const first = newOpening("door-hinged", host, mid, 1, 32);
    const next = freeSpot({ ...p, openings: [first] }, host, w.t0, w.t1, 32)!;
    expect(Math.abs(next - mid)).toBeGreaterThan(32 + 6);
    expect(freeSpot({ ...p, openings: [first] }, host, w.t0, w.t1, 120)).toBeNull();
  });
});

// ---------- Suggest a plan ----------

describe("hallways", () => {
  // A living room, then two rows of bedrooms and baths back to back: only the first of each row touches the living room.
  const rooms = [
    room("l", "living", 0, 0, 16, 24),
    room("b1", "bedroom", 16, 0, 12, 12),
    room("b2", "bedroom", 28, 0, 12, 12),
    room("ba", "bathroom", 40, 0, 8, 12),
    room("b3", "bedroom", 16, 12, 12, 12),
    room("b4", "bedroom", 28, 12, 12, 12),
    room("bb", "bathroom", 40, 12, 8, 12),
  ];

  it("adds a hallway so bedrooms don't open off each other", () => {
    const before = plan(rooms);
    expect(roomsNeedingHall(before).map((r) => r.id).sort()).toEqual(["b2", "b4", "ba", "bb"]);
    const { plan: p, added } = addHallways(before);
    expect(added).toBe(1);
    expect(roomsNeedingHall(p)).toHaveLength(0);
    const hall = p.rooms.find((r) => r.type === "hall")!;
    for (const id of ["b1", "b2", "ba", "b3", "b4", "bb"]) expect((sharedWall(byId(p, id), hall)?.t1 ?? 0) - (sharedWall(byId(p, id), hall)?.t0 ?? 0)).toBeGreaterThanOrEqual(36);
    expectSound(p);
  });

  it("adds doors so every room can be reached", () => {
    const p = connectAll(addHallways(plan(rooms)).plan);
    const seen = reachable(p, ["l"]);
    expect(p.rooms.every((r) => seen.has(r.id))).toBe(true);
    // Bedrooms and the bath open onto the hallway, not through each other.
    const links = roomLinks(p);
    const hall = p.rooms.find((r) => r.type === "hall")!;
    for (const id of ["b2", "ba", "b4", "bb"]) expect(links.get(id)!.has(hall.id)).toBe(true);
    expect(links.get("b1")!.has("b2")).toBe(false);
    expectSound(p);
  });
});

describe("closets", () => {
  it("carves a reach-in closet out of a bedroom corner, with a door", () => {
    const p0 = plan([room("l", "living", 0, 0, 16, 14), room("b", "bedroom", 16, 0, 12, 12)]);
    const before = totalArea(p0);
    const { plan: p, added } = addClosets(p0, EXT);
    expect(added).toBe(1);
    const closet = p.rooms.find((r) => r.type === "closet")!;
    expect(roomSqft(closet)).toBeGreaterThanOrEqual(10);
    expect(totalArea(p)).toBeCloseTo(before, 0);
    expect(roomLinks(p).get(closet.id)!.has("b")).toBe(true);
    expect(p.fixtures.some((f) => f.kind === "closet" && f.roomId === closet.id)).toBe(true);
    expectSound(p);
  });

  it("gives a big primary bedroom a walk-in, unless the brief has its own closet room", () => {
    const p0 = plan([room("l", "living", 0, 0, 16, 16), room("pb", "primary-bedroom", 16, 0, 16, 15)]);
    const walkIn = addClosets(p0, EXT).plan.rooms.find((r) => r.type === "closet")!;
    expect(walkIn.name).toBe("Walk-in closet");
    expect(roomSqft(walkIn)).toBeGreaterThanOrEqual(30);
    const b = brief([{ id: "pc", type: "primary-closet", name: "Primary closet", targetSqFt: 70 }]);
    expect(addClosets(p0, EXT, b).added).toBe(0);
  });

  it("leaves small bedrooms alone", () => {
    expect(addClosets(plan([room("b", "bedroom", 0, 0, 9, 9)]), EXT).added).toBe(0);
  });
});

describe("windows", () => {
  const living = room("l", "living", 0, 0, 20, 16);
  const bed = room("b", "bedroom", 20, 0, 12, 12);
  const hall = room("h", "hall", 20, 12, 12, 3.5);

  it("gives bedrooms a window you could climb out of, and living spaces a big south window", () => {
    const { plan: p, added } = addWindows(plan([living, bed, hall]), { kind: "main" });
    expect(added).toBeGreaterThan(2);
    const windowsOf = (id: string) => p.openings.filter((o) => o.kind === "window" && openingRooms(p, o).includes(id));
    expect(windowsOf("b").some((o) => o.widthIn >= 24 && o.heightIn >= 24 && (o.sillIn ?? 30) <= 44)).toBe(true);
    const south = windowsOf("l").filter((o) => openingGeometry(p, o)!.center.y > 15 * FT);
    expect(south.some((o) => o.style === "window-picture")).toBe(true);
    expect(windowsOf("h")).toHaveLength(0);
    expectSound(p);
  });

  it("puts one egress window in a basement bedroom", () => {
    const { plan: p } = addWindows(plan([bed]), { kind: "basement" });
    expect(p.openings).toHaveLength(1);
    expect(p.openings[0].style).toBe("window");
  });

  it("looks out onto a patio, but not into another room a few inches away", () => {
    const patio = room("p", "patio", 20, 12, 12, 10);
    const stretches = outsideStretches(plan([living, bed, patio]), bed);
    // The south wall faces the patio, so it counts as outside; the west wall is the living room's.
    expect(stretches.some((s) => s.host.edge === 2)).toBe(true);
    expect(stretches.some((s) => s.host.edge === 3)).toBe(false);
    const near = room("n", "office", 32.5, 0, 10, 12);
    const { plan: p } = addWindows(plan([bed, near]), { kind: "main" });
    expect(p.openings.filter((o) => openingRooms(p, o).includes("b")).every((o) => openingGeometry(p, o)!.center.x < 31 * FT)).toBe(true);
  });
});

describe("stairs in a room", () => {
  const boxes = (p: FloorPlan, plans: Plans, ctx: Parameters<typeof stairsBoxes>[1], levelId: string) =>
    stairsBoxes({ ...plans, [levelId]: p }, ctx, ctx.levels.find((l) => l.id === levelId)!);

  it("stretches the neighboring living space to take in stairs that stand outside every room", () => {
    const a = room("a", "bedroom", 0, 0, 12, 12);
    const l = room("l", "living", 20, 0, 12, 12);
    const box = { x0: 12 * FT + 4, y0: 4 * FT, x1: 20 * FT - 4, y1: 8 * FT + 60 };
    const { plan: p, added } = coverStairs(plan([a, l]), [box]);
    expect(added).toBe(1);
    expect(p.rooms.some((r) => r.name === "Stair hall")).toBe(false);
    const living = byId(p, "l");
    const b = boundsOf(living.polygon)!;
    expect(b.x0).toBeLessThanOrEqual(box.x0 + 0.5);
    expect(b.y1).toBeGreaterThanOrEqual(box.y1 + 36 - 0.5);
    expect(byId(p, "a").polygon).toEqual(a.polygon);
    expectSound(p);
  });

  it("never stretches a bedroom: a plain Hall takes the stairs instead", () => {
    const a = room("a", "bedroom", 0, 0, 12, 12);
    const b = room("b", "bedroom", 20, 0, 12, 12);
    const box = { x0: 12 * FT + 4, y0: 1 * FT, x1: 20 * FT - 4, y1: 11 * FT };
    const { plan: p, added } = coverStairs(plan([a, b]), [box]);
    expect(added).toBe(1);
    expect(byId(p, "a").polygon).toEqual(a.polygon);
    expect(byId(p, "b").polygon).toEqual(b.polygon);
    const hall = p.rooms.find((r) => r.type === "hall")!;
    expect(hall.name).toBe("Hall");
    expect(hall.stairStack).toBeUndefined();
    expectSound(p);
  });

  it("leaves stairs that are already inside a room alone", () => {
    const box = { x0: 12 * FT + 4, y0: 1 * FT, x1: 20 * FT - 4, y1: 11 * FT };
    const living = plan([room("l", "living", 0, 0, 30, 20)]);
    const { plan: p, added } = coverStairs(living, [box]);
    expect(added).toBe(0);
    expect(p).toEqual(living);
  });

  it("Suggest a plan makes no stair halls, keeps stairs linked and anchored, and puts them inside rooms", () => {
    for (const stairs of ["straight", "u"] as const) {
      const { ctx, sketch } = house(TWO_STORY, 2);
      const c = { ...ctx, basics: { ...ctx.basics, stairs } };
      const res = suggestPlans(sketch, c);
      expect(res.notes[0]).not.toMatch(/around the stairs/);
      const ids = stackIds(res.plans);
      expect(ids.length).toBeGreaterThan(0);
      for (const level of c.levels) {
        const p = planOf(res.plans, level.id);
        expectSound(p);
        expect(p.rooms.some((r) => /stair hall/i.test(r.name) || r.stairStack || r.anchored)).toBe(false);
        expect(p.stairs.every((st) => !st.stackId || st.anchored)).toBe(true);
        for (const b of boxes(p, res.plans, c, level.id)) {
          const cx = (b.x0 + b.x1) / 2;
          const cy = (b.y0 + b.y1) / 2;
          expect(p.rooms.some((r) => polygonsOverlap(rectangle(cx, cy, b.x1 - b.x0 - 4, b.y1 - b.y0 - 4), r.polygon, 0)), `${stairs} stairs on ${level.id}`).toBe(true);
        }
      }
    }
  });
});

describe("Suggest a plan", () => {
  it("makes a sound plan where every room can be reached", () => {
    for (const types of [RANCH, TWO_STORY]) {
      const { ctx, result } = house(types, types === TWO_STORY ? 2 : 1);
      expect(result.notes[0]).toMatch(/^Added \d+ hallways?/);
      for (const level of ctx.levels) {
        const p = planOf(result.plans, level.id);
        expectSound(p);
        const seen = reachable(p, wayInRooms(p, stairsBoxes(result.plans, ctx, level)));
        expect(p.rooms.filter((r) => !seen.has(r.id) && !["patio", "deck", "porch"].includes(r.type ?? "")).map((r) => r.name)).toEqual([]);
        // Every door joins two rooms, or a room and the outside.
        for (const o of p.openings) if (o.kind !== "window") expect(openingRooms(p, o).some(Boolean)).toBe(true);
      }
      // Bedrooms get closets, wherever they are.
      expect(ctx.levels.some((l) => planOf(result.plans, l.id).rooms.some((r) => r.type === "closet"))).toBe(true);
      expect(planOf(result.plans, MAIN_LEVEL_ID).openings.some((o) => o.kind === "window")).toBe(true);
    }
  });
});

// ---------- Upper floors stay over the floor below ----------

describe("upper floors fit on the floor below", () => {
  it("Suggest a plan keeps every upper floor inside the floor below, still sound and reachable", () => {
    for (const seed of [1, 2, 7, 11]) {
      const { ctx, result } = house(TWO_STORY, 2, 0, seed);
      for (const level of ctx.levels) {
        expect(hangingArea(result.plans, ctx.levels, level)).toBe(0);
        const p = planOf(result.plans, level.id);
        expectSound(p);
        const seen = reachable(p, wayInRooms(p, stairsBoxes(result.plans, ctx, level)));
        expect(p.rooms.filter((r) => !seen.has(r.id) && !["patio", "deck", "porch"].includes(r.type ?? "")).map((r) => r.name)).toEqual([]);
      }
      expect(result.notes.some((n) => /needs .* sq ft/.test(n))).toBe(false);
    }
  });

  it("says so when the upstairs needs more room than the main floor", () => {
    const big: [string, string?][] = [["entry"], ["kitchen"], ["half-bath"], ...(["primary-bedroom", "primary-bath", "bedroom", "bedroom", "bedroom", "bathroom", "family"].map((t) => [t, "floor-2"]) as [string, string][])];
    const { ctx, result } = house(big, 2);
    expect(result.notes.find((n) => /needs .* sq ft/.test(n))).toMatch(/^The second floor needs [\d,]+ sq ft but the main floor is [\d,]+ sq ft/);
    for (const level of ctx.levels) expect(hangingArea(result.plans, ctx.levels, level)).toBe(0);
  });

  it("alternatives don't push upper rooms past the floor below", () => {
    const two = levelsFor(2, 0);
    const ctx = { brief: null, plot: flat, levels: two, basics: defaultBasics() };
    const plans: Plans = {
      "floor-1": plan([room("k", "kitchen", 0, 0, 20, 20)]),
      "floor-2": plan([room("bed", "bedroom", 0, 0, 12, 20), room("bath", "bathroom", 12, 0, 8, 20)]),
    };
    // Growing the bedroom out to the west would hang it 3' past the kitchen wall below.
    expect(applyChanges(plans, [{ op: "grow", room: "bed", other: "", side: "W", feet: 3 }], ctx).applied).toEqual([]);
    // Shrinking the kitchen would leave the upstairs hanging over nothing.
    expect(applyChanges(plans, [{ op: "shrink", room: "k", other: "", side: "E", feet: 3 }], ctx).applied).toEqual([]);
    // Growing the bedroom into the bathroom stays on top of the kitchen.
    expect(applyChanges(plans, [{ op: "grow", room: "bed", other: "", side: "E", feet: 2 }], ctx).applied).toHaveLength(1);
  });

  it("the built-in alternatives of a two-story plan keep the upstairs on the floor below", () => {
    const { ctx, result } = house(TWO_STORY, 2);
    for (const alt of ruleAlternatives(result.plans, ctx)) {
      for (const level of ctx.levels) expect(hangingArea(alt.plans, ctx.levels, level)).toBe(0);
    }
  });
});

// ---------- Small fixes from part 1 ----------

describe("editing keeps doors in place", () => {
  it("leaves a door where it was when the wall next to it is pushed", () => {
    const a = room("a", "bedroom", 0, 0, 10, 10);
    const b = room("b", "office", 10, 0, 10, 10);
    const c = room("c", "hall", 0, 10, 20, 4);
    // A door on a's bottom edge, which runs from its bottom-right corner (the one that moves).
    const door = newOpening("door-hinged", { roomId: "a", edge: 2 }, 30, 1, 30);
    const p = plan([a, b, c], { openings: [door] });
    const before = openingGeometry(p, door)!.center;
    const westOfB = b.polygon.findIndex((pt, i) => pt.x === 10 * FT && b.polygon[(i + 1) % 4].x === 10 * FT);
    const moved = moveEdge(p, "b", westOfB, { x: 24, y: 0 });
    expect(byId(moved, "a").polygon.some((pt) => pt.x === 10 * FT + 24)).toBe(true);
    const after = openingGeometry(moved, moved.openings[0])!.center;
    expect(dist(before, after)).toBeLessThan(0.5);
  });

  it("closes small gaps between rooms when turning a sketch into a plan", () => {
    const rects = [
      { id: "a", x0: 0, y0: 0, x1: 120, y1: 120, fixed: false },
      { id: "b", x0: 130, y0: 0, x1: 250, y1: 100, fixed: false },
    ];
    closeGaps(rects);
    expect(rects[0].x1).toBe(rects[1].x0);
  });
});

// ---------- Warnings ----------

describe("warnings", () => {
  const living = room("l", "living", 0, 0, 16, 14);
  const front = (p: FloorPlan) => {
    const w = p.rooms[0];
    return { ...p, openings: [...p.openings, newOpening("door-entry", { roomId: w.id, edge: 3 }, 60, -1, 36)] };
  };
  const texts = (p: FloorPlan, extra: Partial<Parameters<typeof planWarnings>[1]> = {}, plans?: Plans) =>
    planWarnings(plans ?? { [MAIN_LEVEL_ID]: p }, { levels, brief: null, basics: defaultBasics(), ...extra }).map((w) => w.text);

  it("flags rooms with no door, and a floor with no front door", () => {
    const bed = room("b", "bedroom", 16, 0, 12, 12);
    expect(texts(plan([living, bed]))).toEqual(expect.arrayContaining([expect.stringMatching(/Bedroom has no door/), expect.stringMatching(/no front door/)]));
    const garage = room("g", "garage", 0, 14, 22, 22);
    const garageDoorOnly = plan([living, garage], { openings: [newOpening("door-garage", { roomId: "g", edge: 2 }, 100, -1, 96), doorBetween(plan([living, garage]), garage, living)!] });
    expect(texts(garageDoorOnly).some((t) => /no front door/.test(t))).toBe(true);
    expect(texts(front(garageDoorOnly)).some((t) => /no front door/.test(t))).toBe(false);
  });

  it("flags a bedroom with no window you could climb out of", () => {
    const bed = room("b", "bedroom", 16, 0, 12, 12);
    const base = front(addDoor(plan([living, bed]), living, bed)!);
    expect(texts(base).some((t) => /Bedroom has no window/.test(t))).toBe(true);
    const high = { ...base, openings: [...base.openings, newOpening("window-high", { roomId: "b", edge: 1 }, 60, 1, 48)] };
    expect(texts(high).some((t) => /don.t open wide enough/.test(t))).toBe(true);
    const good = { ...base, openings: [...base.openings, newOpening("window", { roomId: "b", edge: 1 }, 60, 1, 36)] };
    expect(texts(good).some((t) => /Bedroom/.test(t))).toBe(false);
  });

  it("flags a bedroom you can only reach through another bedroom", () => {
    const b1 = room("b1", "bedroom", 16, 0, 12, 12);
    const b2 = room("b2", "bedroom", 28, 0, 12, 12);
    let p = front(plan([living, b1, b2]));
    p = addDoor(p, living, b1)!;
    p = addDoor(p, b1, b2)!;
    expect(texts(p).some((t) => /Bedroom can only be reached through Bedroom/.test(t))).toBe(true);
  });

  it("flags narrow hallways, missing stairs, and sizes far from the brief", () => {
    const hall = room("h", "hall", 0, 14, 16, 2.5);
    let p = front(plan([living, hall]));
    p = { ...p, openings: [...p.openings, newOpening("opening", { roomId: "h", edge: 0 }, 60, 1, 36)] };
    expect(texts(p).some((t) => /Hallway is 2' \d+" wide inside/.test(t))).toBe(true);

    const b = brief([
      { id: "bl", type: "living", name: "Living room", targetSqFt: 400 },
      { id: "bo", type: "office", name: "Office", targetSqFt: 120 },
    ]);
    const small = { ...front(plan([{ ...living, briefRoomId: "bl" }])) };
    const t = texts(small, { brief: b });
    expect(t.some((x) => /224 sq ft, much smaller than the 400/.test(x))).toBe(true);
    expect(t.some((x) => /Office from your brief isn't in the plan yet/.test(x))).toBe(true);

    const two = levelsFor(2, 0);
    const upper = plan([room("u", "bedroom", 0, 0, 12, 12)]);
    const w = planWarnings({ [MAIN_LEVEL_ID]: front(plan([living])), [two[1].id]: upper }, { levels: two, brief: null, basics: defaultBasics() });
    expect(w.some((x) => /no stairs up to the second floor/i.test(x.text))).toBe(true);
  });

  it("points each warning at its floor and room", () => {
    const bed = room("b", "bedroom", 16, 0, 12, 12);
    const w = planWarnings({ [MAIN_LEVEL_ID]: plan([living, bed]) }, { levels, brief: null, basics: defaultBasics() }).find((x) => x.roomIds.includes("b"))!;
    expect(w.levelId).toBe(MAIN_LEVEL_ID);
    expect(w.at!.x).toBeCloseTo(22 * FT);
    expect(new Set(planWarnings({ [MAIN_LEVEL_ID]: plan([living, bed]) }, { levels, brief: null, basics: defaultBasics() }).map((x) => x.id)).size).toBeGreaterThan(1);
  });
});

// ---------- Changes for alternatives ----------

describe("changes", () => {
  const ctx = { brief: null, plot: flat, levels, basics: defaultBasics() };
  const seeds = () => ["k"];
  const k = room("k", "kitchen", 0, 0, 14, 14);
  const d = room("d", "dining", 14, 0, 12, 14);
  const lr = room("lr", "living", 0, 14, 30, 16);
  const linked = (rooms: PlanRoom[]) => {
    let p = plan(rooms);
    p = addDoor(p, k, d)!;
    p = addDoor(p, k, lr)!;
    return p;
  };

  it("closes an opening between living spaces when every room can still be reached", () => {
    const p = applyChange(linked([k, d, lr]), { op: "open_up", room: "d", other: "lr", side: "none", feet: 0 }, { exteriorIn: EXT, seeds })!.plan;
    const closing = ruleAlternatives({ [MAIN_LEVEL_ID]: p }, ctx).find((a) => a.title === "Close the opening between living room and dining");
    expect(closing?.why).toMatch(/quieter/);
    expect(planOf(closing!.plans, MAIN_LEVEL_ID).openings.filter((o) => o.kind === "opening")).toHaveLength(0);
  });

  it("pushes a wall into the next room, which gives up the space", () => {
    const p = linked([k, d, lr]);
    const res = applyChange(p, { op: "grow", room: "k", other: "", side: "E", feet: 2 }, { exteriorIn: EXT, seeds })!;
    expect(roomSqft(byId(res.plan, "k"))).toBe(14 * 16);
    expect(roomSqft(byId(res.plan, "d"))).toBe(10 * 14);
    expect(res.rooms.sort()).toEqual(["d", "k"]);
    expect(totalArea(res.plan)).toBeCloseTo(totalArea(p), 0);
    expectSound(res.plan);
  });

  it("notches a longer wall instead of moving all of it", () => {
    const p = linked([k, d, lr]);
    const res = applyChange(p, { op: "grow", room: "k", other: "", side: "S", feet: 2 }, { exteriorIn: EXT, seeds })!;
    const living = byId(res.plan, "lr");
    // One new step where the kitchen's wall ends: two corners at one spot, one of them moved.
    expect(living.polygon).toHaveLength(6);
    expect(roomSqft(living)).toBe(30 * 16 - 14 * 2);
    // The dining room, also along the living room's wall, didn't move.
    expect(byId(res.plan, "d").polygon).toEqual(d.polygon);
    expectSound(res.plan);
  });

  it("won't squeeze a room too thin or cut one off", () => {
    const thin = room("t", "pantry", 14, 0, 4, 14);
    const p = plan([k, thin]);
    expect(pushWall(p, "k", k.polygon.findIndex((pt, i) => pt.x === 14 * FT && k.polygon[(i + 1) % 4].x === 14 * FT), { x: 24, y: 0 })).toBeNull();
    const cut = applyChange(linked([k, d, lr]), { op: "no_door", room: "k", other: "d", side: "none", feet: 0 }, { exteriorIn: EXT, seeds });
    expect(cut).toBeNull();
  });

  it("swaps two rooms, opens up a wall, and adds a door or a window", () => {
    const p = linked([k, d, lr]);
    const swapped = applyChange(p, { op: "swap", room: "k", other: "d", side: "none", feet: 0 }, { exteriorIn: EXT, seeds })!.plan;
    expect(byId(swapped, "k").type).toBe("dining");
    expect(byId(swapped, "d").type).toBe("kitchen");

    const open = applyChange(p, { op: "open_up", room: "k", other: "lr", side: "none", feet: 0 }, { exteriorIn: EXT, seeds })!.plan;
    const between = open.openings.filter((o) => [...openingRooms(open, o)].sort().join() === "k,lr");
    expect(between).toHaveLength(1);
    expect(between[0].kind).toBe("opening");
    expect(between[0].widthIn).toBeGreaterThanOrEqual(120);

    const out = applyChange(p, { op: "door", room: "lr", other: OUTSIDE, side: "S", feet: 0 }, { exteriorIn: EXT, seeds })!.plan;
    expect(roomLinks(out).get("lr")!.has(OUTSIDE)).toBe(true);
    expect(out.openings.at(-1)!.style).toBe("door-slider");

    const win = applyChange(p, { op: "window", room: "lr", other: "", side: "S", feet: 8 }, { exteriorIn: EXT, seeds })!.plan;
    expect(win.openings.at(-1)!.style).toBe("window-picture");
    expect(win.openings.at(-1)!.widthIn).toBe(96);
    // No outside wall facing north on the living room.
    expect(applyChange(p, { op: "window", room: "lr", other: "", side: "N", feet: 4 }, { exteriorIn: EXT, seeds })).toBeNull();
  });

  it("flips the house and keeps every door on its wall", () => {
    const p = linked([k, d, lr]);
    const flipped = mirrorPlans({ [MAIN_LEVEL_ID]: p }, "x")[MAIN_LEVEL_ID];
    expect(byId(flipped, "k").polygon.some((pt) => pt.x === 30 * FT)).toBe(true);
    for (const [i, o] of p.openings.entries()) {
      const a = openingGeometry(p, o)!.center;
      const b = openingGeometry(flipped, flipped.openings[i])!.center;
      expect(b.x).toBeCloseTo(30 * FT - a.x, 0);
      expect(b.y).toBeCloseTo(a.y, 0);
      expect([...openingRooms(flipped, flipped.openings[i])].sort()).toEqual([...openingRooms(p, o)].sort());
    }
    const twice = mirrorPlans(mirrorPlans({ [MAIN_LEVEL_ID]: p }, "x"), "x")[MAIN_LEVEL_ID];
    expect(twice.openings.map((o) => openingGeometry(twice, o)!.center.x)).toEqual(p.openings.map((o) => openingGeometry(p, o)!.center.x));
  });

  it("applies a list, skipping changes that don't work, and finds each room's floor", () => {
    const plans = { [MAIN_LEVEL_ID]: linked([k, d, lr]) };
    const changes: PlanChange[] = [
      { op: "grow", room: "k", other: "", side: "E", feet: 2 },
      { op: "grow", room: "ghost", other: "", side: "E", feet: 2 },
      { op: "swap", room: "k", other: "nope", side: "none", feet: 0 },
      { op: "mirror", room: "k", other: "", side: "none", feet: 0 },
    ];
    const res = applyChanges(plans, changes, ctx);
    expect(res.applied.map((c) => c.op)).toEqual(["grow", "mirror"]);
    expect(res.mirrored).toBe(true);
    // No flip when the road is on the east or west: the entry would turn away from it.
    const sideRoad = { ...flat, roadSide: "E" } as Plot;
    expect(applyChanges(plans, changes, { ...ctx, plot: sideRoad }).mirrored).toBe(false);
  });
});

describe("built-in alternatives", () => {
  it("makes three different, sound variations on a suggested plan", () => {
    for (const [types, floors] of [
      [RANCH, 1],
      [TWO_STORY, 2],
    ] as const) {
      const { ctx, result } = house([...types], floors);
      const all = ruleAlternatives(result.plans, ctx);
      const picked = pickDistinct(result.plans, all);
      expect(picked).toHaveLength(3);
      expect(new Set(picked.map((a) => signature(a.plans))).size).toBe(3);
      for (const alt of picked) {
        expect(signature(alt.plans)).not.toBe(signature(result.plans));
        for (const level of ctx.levels) {
          const p = planOf(alt.plans, level.id);
          expectSound(p);
          const seen = reachable(p, wayInRooms(p, stairsBoxes(alt.plans, ctx, level)));
          expect(p.rooms.filter((r) => !seen.has(r.id) && !["patio", "deck", "porch"].includes(r.type ?? ""))).toHaveLength(0);
        }
      }
    }
  });

  it("tries new ideas for Show me different ones, and needs rooms first", () => {
    const { ctx, result } = house(RANCH);
    const r = suggestPlanAlternatives(result.plans, ctx);
    expect(r.alternatives).toHaveLength(3);
    const again = suggestPlanAlternatives(result.plans, ctx, r.alternatives.map((a) => a.title));
    expect(again.alternatives[0].title).not.toBe(r.alternatives[0].title);
    expect(suggestPlanAlternatives({}, ctx).note).toMatch(/rooms first/);
  });

  it("ranks the ideas best first, with numbers in each reason", () => {
    const { ctx: withPriorities, result } = house([...RANCH, ["office"]]);
    // No priorities, so the default weights rank both lists.
    const ctx = { ...withPriorities, brief: { ...withPriorities.brief, priorities: [] } };
    const ranked = rankAlternatives(result.plans, ruleAlternatives(result.plans, ctx), ctx);
    expect(ranked.length).toBeGreaterThan(3);
    for (let i = 1; i < ranked.length; i++) expect(ranked[i - 1].gain!).toBeGreaterThanOrEqual(ranked[i].gain!);
    expect(ranked.every((a) => a.details && /sq ft south glass/.test(a.details))).toBe(true);
    expect(ranked.filter((a) => a.numbers && /\d/.test(a.numbers)).length).toBeGreaterThan(2);
    expect(ranked.every((a) => !a.numbers || a.numbers.split(" · ").length <= 3)).toBe(true);
    const shown = suggestPlanAlternatives(result.plans, ctx).alternatives;
    expect(shown[0].gain).toBe(ranked[0].gain);
  });

  it("names the priorities that set the order", () => {
    const { ctx, result } = house(RANCH);
    const r = suggestPlanAlternatives(result.plans, { ...ctx, brief: { ...ctx.brief, priorities: ["Stay on budget", "Keep the trees for shade and privacy"] } });
    expect(r.rankedFor).toEqual(["Stay on budget"]);
  });

  it("tries swapping a bedroom east for morning sun", () => {
    const { ctx, result } = house([...RANCH, ["office"]]);
    const swap = ruleAlternatives(result.plans, ctx).find((a) => a.title.startsWith("Swap"));
    expect(swap?.why).toMatch(/morning sun/);
    const plan = planOf(swap!.plans, MAIN_LEVEL_ID);
    const before = planOf(result.plans, MAIN_LEVEL_ID);
    // Same outlines; the bedroom and office traded places.
    expect(plan.rooms.map((r) => r.polygon)).toEqual(before.rooms.map((r) => r.polygon));
    expect(plan.rooms.map((r) => r.type)).not.toEqual(before.rooms.map((r) => r.type));
  });

  it("adds a door the brief wants", () => {
    const { ctx, result } = house(RANCH);
    const plan = planOf(result.plans, MAIN_LEVEL_ID);
    // Take away the door between two rooms the brief wants together.
    const between = (o: FloorPlan["openings"][number], a: string, b: string) => {
      const [x, y] = openingRooms(plan, o);
      return (x === a && y === b) || (x === b && y === a);
    };
    const pairs = ctx.brief.adjacencies
      .map((e) => [plan.rooms.find((r) => r.briefRoomId === e.a), plan.rooms.find((r) => r.briefRoomId === e.b)] as const)
      .filter(([a, b]) => a && b && (sharedWall(a, b)?.t1 ?? 0) - (sharedWall(a, b)?.t0 ?? 0) >= 48 && plan.openings.some((o) => o.kind === "door" && between(o, a.id, b.id)));
    expect(pairs.length).toBeGreaterThan(0);
    const [a, b] = pairs[0] as [PlanRoom, PlanRoom];
    const cut = { ...plan, openings: plan.openings.filter((o) => !between(o, a.id, b.id)) };
    const idea = ruleAlternatives({ ...result.plans, [MAIN_LEVEL_ID]: cut }, ctx).find((x) => x.title.startsWith("Add a door from the"));
    expect(idea?.title).toMatch(new RegExp(`${a.name.toLowerCase()}|${b.name.toLowerCase()}`));
    expect(planOf(idea!.plans, MAIN_LEVEL_ID).openings.some((o) => between(o, a.id, b.id))).toBe(true);
  });
});

describe("closets and the brief", () => {
  it("puts the closet outside a bedroom that's at its brief size, where the floor has room", () => {
    // A 10x12 bedroom next to a 10x15 den, leaving an empty 10x3 pocket south of the bedroom.
    const bed = makeRoom(rectangle(5 * FT, 6 * FT, 10 * FT, 12 * FT), "Bed 2", { type: "bedroom", briefRoomId: "b-bed" });
    const den = makeRoom(rectangle(15 * FT, 7.5 * FT, 10 * FT, 15 * FT), "Den", { type: "office" });
    const plan = { ...emptyPlan(), rooms: [bed, den], openings: [newOpening("door-hinged", { roomId: den.id, edge: 0 }, 60, 1, 32)] };
    const b = brief([{ id: "b-bed", type: "bedroom", name: "Bed 2", targetSqFt: 120 }]);
    const res = addClosets(plan, EXT, b);
    expect(res.added).toBe(1);
    const after = res.plan.rooms.find((r) => r.id === bed.id)!;
    expect(roomSqft(after)).toBe(120);
    const closet = res.plan.rooms.find((r) => r.type === "closet")!;
    expect(polygonsOverlap(closet.polygon, after.polygon)).toBe(false);
    // Without a brief size to keep, the closet goes inside as before.
    const inside = addClosets(plan, EXT, null);
    expect(roomSqft(inside.plan.rooms.find((r) => r.id === bed.id)!)).toBeLessThan(120);
  });
});
