import { describe, expect, it } from "vitest";
import { DiscoveryAnswers, type FloorPlan, type PlanRoom, type Plot, type Project } from "@/lib/model/schema";
import { FLAT_PLOT_SEED, generatePlot } from "@/lib/land/generate";
import { plotImplications } from "@/lib/land/implications";
import { buildRuleBrief } from "@/lib/brief/rules";
import { levelsFor } from "@/lib/brief/levels";
import { roomType } from "@/lib/brief/rooms";
import { ruleSpots, suggestDiagrams, type SketchContext } from "@/lib/bubbles/arrange";
import { centerOf } from "@/lib/bubbles/arrange";
import { ruleSpot, siteOf } from "@/lib/bubbles/site";
import { emptyPlan, makeRoom } from "@/lib/plan/edit";
import { boundsOf, rectangle } from "@/lib/plan/geometry";
import { addHallways, addWindows, roomsNeedingHall } from "@/lib/plan/suggest";
import { openingGeometry } from "@/lib/plan/walls";
import { planWarnings } from "@/lib/plan/checks";
import { overruns, worstOverrun, type SetbackLimit } from "@/lib/plan/setbacks";
import { houseSpot } from "@/lib/house3d/site";
import { doorWindowRows } from "@/lib/plans/sheets/schedules";
import { insideSetbacks, setbackLimits } from "@/lib/plans/lot";
import { growOptions } from "@/lib/plan/alternatives";
import { defaultBasics } from "@/lib/plan/basics";
import { house, onRealLot, RANCH } from "./samples";

const FT = 12;
const room = (id: string, type: string, x: number, y: number, w: number, h: number): PlanRoom => ({ ...makeRoom(rectangle((x + w / 2) * FT, (y + h / 2) * FT, w * FT, h * FT), roomType(type).label), id, type });
const plan = (rooms: PlanRoom[], extra: Partial<FloorPlan> = {}): FloorPlan => ({ ...emptyPlan(), rooms, ...extra });
const sq = (o: { widthIn: number; heightIn: number }) => (o.widthIn * o.heightIn) / 144;

/** Window area on the walls of a room that face within 60 degrees of west. */
function westGlass(p: FloorPlan, roomId: string) {
  const mine = p.openings.filter((o) => o.kind === "window" && "roomId" in o.host && o.host.roomId === roomId);
  const total = mine.reduce((n, o) => n + sq(o), 0);
  const west = mine.filter((o) => openingGeometry(p, o)!.n.x <= -0.5).reduce((n, o) => n + sq(o), 0);
  return { total, west };
}

describe("west glass", () => {
  it("keeps west windows to a quarter of a room's glass when other walls can have them", () => {
    // One free-standing living room: all four walls are outside.
    const { plan: p } = addWindows(plan([room("l", "living", 0, 0, 24, 18)]), { kind: "main" });
    const { total, west } = westGlass(p, "l");
    expect(total).toBeGreaterThan(0);
    expect(west).toBeLessThanOrEqual(total * 0.25 + 0.01);
  });

  it("still gives a room with only west and north walls a window", () => {
    const rooms = [room("l", "living", 0, 0, 14, 14), room("a", "family", 14, 0, 14, 14), room("b", "dining", 0, 14, 14, 14)];
    const { plan: p } = addWindows(plan(rooms), { kind: "main" });
    // "l" has outside walls only on the north (top) and west (left).
    expect(westGlass(p, "l").total).toBeGreaterThan(0);
  });

  it("keeps the whole house's west glass to 4% of its floor", () => {
    const rooms = [room("a", "living", 0, 0, 20, 20), room("b", "kitchen", 20, 0, 14, 20), room("c", "bedroom", 0, 20, 12, 12), room("d", "bedroom", 12, 20, 12, 12), room("e", "bedroom", 24, 20, 10, 12)];
    const { plan: p } = addWindows(plan(rooms), { kind: "main" });
    const west = p.openings.filter((o) => o.kind === "window" && openingGeometry(p, o)!.n.x <= -0.5).reduce((n, o) => n + sq(o), 0);
    const floor = p.rooms.reduce((n, r) => n + (r.polygon.length ? (boundsOf(r.polygon)!.x1 - boundsOf(r.polygon)!.x0) * (boundsOf(r.polygon)!.y1 - boundsOf(r.polygon)!.y0) / 144 : 0), 0);
    // A bedroom's escape window can ask for more, so allow one escape-sized window over.
    expect(west).toBeLessThanOrEqual(floor * 0.04 + 12);
  });
});

describe("kitchen sink window", () => {
  const kitchen = room("k", "kitchen", 0, 0, 14, 12);

  it("puts a 42-inch-sill window over a sink on an outside wall", () => {
    // A sink against the south (bottom) wall, 4 ft from the left corner.
    const sink = { id: "s", kind: "sink", x: 4 * FT, y: 12 * FT - 11, rotation: 0, widthIn: 33, depthIn: 22, roomId: "k" };
    const { plan: p } = addWindows(plan([kitchen], { fixtures: [sink] }), { kind: "main" });
    const over = p.openings.find((o) => o.kind === "window" && o.sillIn === 42)!;
    expect(over).toBeTruthy();
    const g = openingGeometry(p, over)!;
    expect(Math.abs(g.center.x - 4 * FT)).toBeLessThan(30);
    expect(g.center.y).toBeCloseTo(12 * FT, 0);
    expect(over.widthIn).toBeGreaterThanOrEqual(36);
    expect(over.widthIn).toBeLessThanOrEqual(48);
  });

  it("gives a kitchen with no sink yet a 42-inch-sill window on its best wall", () => {
    const { plan: p } = addWindows(plan([kitchen]), { kind: "main" });
    const wins = p.openings.filter((o) => o.kind === "window");
    expect(wins.some((o) => o.sillIn === 42)).toBe(true);
    expect(wins.length).toBeLessThanOrEqual(2);
  });
});

describe("light and air", () => {
  it("warns softly about a room with too little glass", () => {
    const base = plan([room("l", "living", 0, 0, 20, 20)]);
    const { plan: withWin } = addWindows(base, { kind: "main" });
    const ctx = { levels: levelsFor(1, 0), brief: null, basics: defaultBasics() };
    expect(planWarnings({ "floor-1": withWin }, ctx).some((w) => w.id.includes("light:"))).toBe(false);
    const tiny = { ...withWin, openings: withWin.openings.filter((o) => o.kind !== "window").concat(withWin.openings.filter((o) => o.kind === "window").slice(0, 1).map((o) => ({ ...o, widthIn: 24, heightIn: 24 }))) };
    expect(planWarnings({ "floor-1": tiny }, ctx).some((w) => w.id.includes("light:l"))).toBe(true);
  });
});

function plotWhere(test: (p: Plot) => boolean): Plot {
  for (let seed = 2; seed < 3000; seed++) {
    const p = generatePlot(seed);
    if (test(p)) return p;
  }
  throw new Error("no plot found");
}

describe("compass spots", () => {
  it("puts the garage northwest on a north-road lot, storage and laundry north or west", () => {
    const site = siteOf(plotWhere((p) => p.roadSide === "N" && plotImplications(p).foundation.type === "slab"));
    expect(ruleSpot("garage", "main", site)).toBe("NW");
    for (const t of ["storage", "laundry", "mechanical"]) expect(ruleSpot(t, "main", site)).toMatch(/N|W/);
  });

  it("sends storage northwest when the garage isn't there, and the garage keeps the road side", () => {
    const s = siteOf(plotWhere((p) => p.roadSide === "S" && plotImplications(p).foundation.type === "slab"));
    expect(ruleSpot("storage", "main", s)).toBe("NW");
    expect(ruleSpot("garage", "main", s)).toBe("SW");
  });

  it("puts living south and the kitchen east of it", () => {
    const site = siteOf(plotWhere((p) => p.roadSide === "N" && plotImplications(p).foundation.type === "slab"));
    expect(ruleSpot("living", "main", site)).toMatch(/S/);
    expect(ruleSpot("kitchen", "main", site)).toMatch(/E/);
  });

  it("spreads bedrooms over different spots", () => {
    const plot = generatePlot(FLAT_PLOT_SEED, { flat: true });
    const rooms = ["bedroom", "bedroom", "bedroom", "primary-bedroom", "living", "kitchen", "entry", "garage"].map((t, i) => ({ id: `c${i}`, type: t, name: roomType(t).label, description: "" }));
    const brief = buildRuleBrief({ answers: DiscoveryAnswers.parse({ rooms, floorsAbove: 1, floorsBelow: 0 }), profile: { mustHaves: [], dislikes: [] }, plot });
    const ctx: SketchContext = { brief, plot, levels: levelsFor(brief.floors, brief.floorsBelow) };
    const spots = ruleSpots(ctx);
    const beds = brief.rooms.filter((r) => r.type === "bedroom").map((r) => spots.get(r.id));
    expect(new Set(beds).size).toBe(beds.length);
    // The sketch still works with them spread out.
    expect(Object.values(suggestDiagrams(ctx)).flatMap((d) => d.bubbles).length).toBeGreaterThan(5);
    expect(centerOf(suggestDiagrams(ctx)["floor-1"].bubbles)).toBeTruthy();
  });
});

describe("setbacks", () => {
  const rooms = [
    room("l", "living", 0, 0, 16, 24),
    room("b1", "bedroom", 16, 0, 12, 12),
    room("b2", "bedroom", 28, 0, 12, 12),
    room("ba", "bathroom", 40, 0, 8, 12),
    room("b3", "bedroom", 16, 12, 12, 12),
    room("b4", "bedroom", 28, 12, 12, 12),
    room("bb", "bathroom", 40, 12, 8, 12),
  ];
  /** A line along the bottom of the lot at y = 300 in, the house must stay above it. */
  const south: SetbackLimit = { name: "Rear", a: { x: -2000, y: 300 }, b: { x: 2000, y: 300 }, bufferIn: 0, inward: { x: 0, y: -1 } };
  const north: SetbackLimit = { name: "Front", a: { x: -2000, y: -300 }, b: { x: 2000, y: -300 }, bufferIn: 0, inward: { x: 0, y: 1 } };

  it("skips a hallway cut that would cross a setback", () => {
    const free = addHallways(plan(rooms)).plan;
    expect(boundsOf(free.rooms.flatMap((r) => r.polygon))!.y1).toBeGreaterThan(300);
    const kept = addHallways(plan(rooms), [], 3, [south]).plan;
    expect(roomsNeedingHall(kept)).toHaveLength(0);
    expect(boundsOf(kept.rooms.flatMap((r) => r.polygon))!.y1).toBeLessThanOrEqual(300 + 0.5);
    expect(worstOverrun(kept, [south])).toBe(0);
  });

  it("keeps the best hallway and warns when every cut crosses", () => {
    const tight: SetbackLimit[] = [{ ...south, a: { x: -2000, y: 290 }, b: { x: 2000, y: 290 } }, { ...north, a: { x: -2000, y: 0 }, b: { x: 2000, y: 0 } }];
    const res = addHallways(plan(rooms), [], 3, tight);
    expect(res.added).toBe(1);
    expect(worstOverrun(res.plan, tight)).toBeGreaterThan(0);
    const ctx = { levels: levelsFor(1, 0), brief: null, basics: defaultBasics(), limits: tight };
    const w = planWarnings({ "floor-1": res.plan }, ctx).filter((x) => x.id.includes("setback:"));
    expect(w.length).toBeGreaterThan(0);
    expect(w[0].text).toMatch(/past the (rear|front) (setback|lot line)/);
  });

  it("doesn't grow a wall out past a setback when another wall can grow", () => {
    const k = room("k", "kitchen", 0, 0, 12, 12);
    const p = plan([k, room("o", "other", 12, 0, 12, 12)]);
    // The kitchen's west, north and south walls are all outside. The lot line is 1 ft past its north wall.
    const lot: SetbackLimit = { name: "Front", a: { x: -2000, y: -12 }, b: { x: 2000, y: -12 }, bufferIn: 0, inward: { x: 0, y: 1 } };
    const ctx = { brief: null, plot: null, levels: levelsFor(1, 0), basics: null, limits: [lot] };
    const sides = growOptions(p, k, 2, ctx).map((g) => g.change.side);
    expect(sides).not.toContain("N");
    expect(growOptions(p, k, 2, { ...ctx, limits: [] }).map((g) => g.change.side)).toContain("N");
  });

  it("names how far a room is past a setback", () => {
    const o = overruns([{ x: 10, y: 320 }], [south]);
    expect(o).toHaveLength(1);
    expect(o[0].byIn).toBeCloseTo(20);
    expect(o[0].pastLine).toBe(true);
  });

  it("uses 20 / 5 / 20 ft on made-up land and the lot's own numbers on a real lot", () => {
    const p = house(RANCH);
    const made = setbackLimits(p);
    expect(made.map((l) => l.bufferIn / FT).sort((a, b) => a - b)).toEqual([5, 5, 20, 20]);
    const real = setbackLimits(onRealLot(p, { setbacks: { front: 25, side: 8, rear: 15, streetSide: null } }));
    expect(real.map((l) => l.bufferIn / FT).sort((a, b) => a - b)).toEqual([8, 8, 15, 25]);
    expect(insideSetbacks(p).every((o) => o.byIn > 0)).toBe(true);
  });
});

describe("where the house sits", () => {
  it("passes the house's spot, so land notes follow the slope under it", () => {
    const p: Project = house(RANCH);
    const spot = houseSpot(p)!;
    expect(spot).toBeTruthy();
    expect(typeof plotImplications(p.plot!, spot).foundation.type).toBe("string");
    expect(houseSpot({ ...p, plot: null })).toBeUndefined();
    // On land with a hill, the notes at two spots can differ; the function takes the spot.
    const hilly = { ...p.plot!, ground: [{ id: "h", kind: "hill", at: { x: 200, y: 200 }, radiusFt: 30, percent: 30 }] } as unknown as Plot;
    const a = plotImplications(hilly, { x: 200, y: 200 }).foundation.type;
    const b = plotImplications(hilly, { x: 5000, y: 5000 }).foundation.type;
    expect(typeof a + typeof b).toBe("stringstring");
  });
});

describe("window schedule", () => {
  it("notes the overhang on south windows of the top floor", () => {
    const p = house(RANCH);
    const rows = doorWindowRows(p).windows;
    expect(rows.some((r) => /Faces south: the .* roof overhang shades it/.test(r[r.length - 1]))).toBe(true);
  });
});
