import { describe, expect, it } from "vitest";
import { House3D, type FloorPlan, type Opening, type PlanRoom, type Point } from "@/lib/model/schema";
import { levelFor, MAIN_LEVEL_ID } from "@/lib/brief/levels";
import { defaultBasics } from "@/lib/plan/basics";
import { pointInPolygon, rectangle } from "@/lib/plan/geometry";
import { buildHouse, type HouseContext } from "@/lib/house3d/build";
import { levelHeights } from "@/lib/house3d/levels";
import { IN_PER_UNIT } from "@/lib/house3d/mesh";
import { siteFor } from "@/lib/house3d/site";
import { SEASONS, clockTime } from "@/lib/house3d/sun";
import { blockersOf, sunNote, sunThroughWindow, timeSpan } from "@/lib/house3d/sunHours";
import { canPreview, rayToSegments, windowViews, type WindowViews } from "@/lib/house3d/windowView";
import { DEFAULT_PLACE } from "@/lib/location/current";

const FT = 12;
const UPPER = "floor-2";

function room(id: string, x: number, y: number, w: number, h: number, rotation = 0): PlanRoom {
  return { id, name: id, type: "living", polygon: rectangle(x + w / 2, y + h / 2, w, h, rotation) };
}
function plan(rooms: PlanRoom[], openings: Opening[] = []): FloorPlan {
  return { rooms, walls: [], openings, stairs: [], fixtures: [], furniture: [] };
}
function win(id: string, roomId: string, edge: number, offsetIn: number, style = "window"): Opening {
  const slider = style === "door-slider";
  return { id, host: { roomId, edge }, offsetIn, kind: slider ? "door" : "window", style, widthIn: slider ? 72 : 48, heightIn: slider ? 80 : 48, ...(slider ? {} : { sillIn: 30 }), side: 1, hinge: "start" };
}

function setup(plans: Record<string, FloorPlan>, levelIds = [MAIN_LEVEL_ID]) {
  const levels = levelIds.map(levelFor);
  const basics = defaultBasics();
  const ctx: HouseContext = { levels, basics, house3d: House3D.parse({}), site: siteFor(null, { x: 0, y: 0 }, plans), frame: { ox: 0, oy: 0 } };
  const heights = levelHeights(levels, basics);
  return { ctx: { ...ctx, heights }, basics };
}

/** A scene point back on the plan. */
const plan2d = (v: [number, number, number]): Point => ({ x: v[0] * IN_PER_UNIT, y: v[2] * IN_PER_UNIT });

function views(plans: Record<string, FloorPlan>, openingId: string, levelId = MAIN_LEVEL_ID, levelIds?: string[]): WindowViews {
  const { ctx } = setup(plans, levelIds);
  const v = windowViews(plans, ctx, levelId, openingId);
  if (!v) throw new Error("no view");
  return v;
}

// A 20 by 15 ft room. Edges go clockwise from the top-left: 0 north, 1 east, 2 south, 3 west.
const box = (openings: Opening[]) => plan([room("a", 0, 0, 20 * FT, 15 * FT)], openings);

describe("where the window preview stands", () => {
  it("stands inside the room looking out, and outside on the ground looking back, for a north window", () => {
    const v = views({ [MAIN_LEVEL_ID]: box([win("w", "a", 0, 10 * FT)]) }, "w");
    expect(v.facing).toBe("north");
    expect(v.out.y).toBeCloseTo(-1);
    const inside = plan2d(v.inside.eye);
    const outside = plan2d(v.outside.eye);
    expect(pointInPolygon(inside, box([]).rooms[0].polygon)).toBe(true);
    expect(inside.y).toBeCloseTo(6 * FT); // 6 ft back from the north wall
    expect(outside.y).toBeLessThan(-15 * FT); // well out to the north
    expect(outside.x).toBeCloseTo(10 * FT);
    // Eye height above the floor (and the ground, which sits just under it).
    expect(v.inside.eye[1]).toBeCloseTo(64 / FT);
    expect(v.outside.eye[1]).toBeLessThan(64 / FT);
    expect(v.outside.eye[1]).toBeGreaterThan(4);
    expect(v.roomName).toBe("a");
  });

  it("works for walls at odd angles", () => {
    const r = room("a", 0, 0, 20 * FT, 15 * FT, 30);
    const v = views({ [MAIN_LEVEL_ID]: plan([r], [win("w", "a", 2, 10 * FT)]) }, "w");
    expect(pointInPolygon(plan2d(v.inside.eye), r.polygon)).toBe(true);
    expect(pointInPolygon(plan2d(v.outside.eye), r.polygon)).toBe(false);
    // The south edge turned 30 degrees clockwise faces south-southwest, rounded to the nearest of 8 directions.
    expect(["south", "south-west"]).toContain(v.facing);
  });

  it("stands less far back in a small room", () => {
    const v = views({ [MAIN_LEVEL_ID]: plan([room("a", 0, 0, 8 * FT, 5 * FT)], [win("w", "a", 0, 4 * FT)]) }, "w");
    const inside = plan2d(v.inside.eye);
    expect(inside.y).toBeGreaterThan(0);
    expect(inside.y).toBeLessThan(5 * FT - 6);
  });

  it("stays outside on the ground for an upper floor window, looking up", () => {
    const plans = { [MAIN_LEVEL_ID]: box([]), [UPPER]: box([win("w", "a", 2, 10 * FT)]) };
    const v = views(plans, "w", UPPER, [MAIN_LEVEL_ID, UPPER]);
    expect(v.inside.eye[1]).toBeGreaterThan(9);
    expect(v.outside.eye[1]).toBeLessThan(6);
    expect(v.outside.target[1]).toBeGreaterThan(v.outside.eye[1] + 5);
  });

  it("stops short of another wing of the house in front of the window", () => {
    // An L: the window on room a's south wall looks at room c, 10 ft away.
    const plans = { [MAIN_LEVEL_ID]: plan([room("a", 0, 0, 20 * FT, 15 * FT), room("b", 20 * FT, 0, 15 * FT, 40 * FT), room("c", 0, 25 * FT, 20 * FT, 15 * FT)], [win("w", "a", 2, 10 * FT)]) };
    const v = views(plans, "w");
    const outside = plan2d(v.outside.eye);
    expect(outside.y).toBeGreaterThan(15 * FT);
    expect(outside.y).toBeLessThan(25 * FT);
  });

  it("stands out past an upper floor that hangs over the ground", () => {
    // The upper floor sticks out 8 ft past the main floor's south wall, over the window.
    const plans = { [MAIN_LEVEL_ID]: box([win("w", "a", 2, 10 * FT)]), [UPPER]: plan([room("a", 0, 0, 20 * FT, 23 * FT)]) };
    const v = views(plans, "w", MAIN_LEVEL_ID, [MAIN_LEVEL_ID, UPPER]);
    expect(plan2d(v.outside.eye).y).toBeGreaterThan(30 * FT);
  });

  it("previews windows and sliding glass doors on outside walls only", () => {
    const pl = plan([room("a", 0, 0, 15 * FT, 12 * FT), room("b", 15 * FT, 0, 15 * FT, 12 * FT)], [win("out", "a", 0, 6 * FT), win("in", "a", 1, 6 * FT), win("slide", "b", 2, 6 * FT, "door-slider"), { ...win("door", "b", 0, 6 * FT), kind: "door", style: "door-hinged" }]);
    const basics = defaultBasics();
    const can = (id: string) => canPreview(pl, pl.openings.find((o) => o.id === id)!, basics);
    expect(can("out")).toBe(true);
    expect(can("slide")).toBe(true);
    expect(can("in")).toBe(false);
    expect(can("door")).toBe(false);
    const { ctx } = setup({ [MAIN_LEVEL_ID]: pl });
    expect(windowViews({ [MAIN_LEVEL_ID]: pl }, ctx, MAIN_LEVEL_ID, "in")).toBeNull();
  });

  it("finds where a ray crosses a wall", () => {
    expect(rayToSegments({ x: 0, y: 0 }, { x: 1, y: 0 }, [{ a: { x: 10, y: -5 }, b: { x: 10, y: 5 } }])).toBeCloseTo(10);
    expect(rayToSegments({ x: 0, y: 0 }, { x: -1, y: 0 }, [{ a: { x: 10, y: -5 }, b: { x: 10, y: 5 } }])).toBe(Infinity);
  });
});

describe("sun through the window", () => {
  function sun(plans: Record<string, FloorPlan>, id: string) {
    const { ctx } = setup(plans);
    const v = windowViews(plans, ctx, MAIN_LEVEL_ID, id)!;
    const model = buildHouse(plans, ctx);
    return sunThroughWindow(v, blockersOf(model.parts), ctx.site, ctx.frame, DEFAULT_PLACE);
  }
  const hours = (spans: [number, number][]) => spans.reduce((s, [a, b]) => s + (b - a), 0);

  it("lets winter sun into a south window but not a north one", () => {
    const south = sun({ [MAIN_LEVEL_ID]: box([win("w", "a", 2, 10 * FT)]) }, "w");
    const north = sun({ [MAIN_LEVEL_ID]: box([win("w", "a", 0, 10 * FT)]) }, "w");
    const winter = (s: typeof south) => s.find((x) => x.season.id === "winter")!;
    expect(hours(winter(south).spans)).toBeGreaterThan(5);
    expect(hours(winter(north).spans)).toBe(0);
    // Summer: the sun rises and sets north of east and west, so a north window catches a little early and late.
    expect(hours(north.find((x) => x.season.id === "summer")!.spans)).toBeGreaterThan(0);
  });

  it("counts the rest of the house blocking the sun", () => {
    // Window at the east end of room a's south wall, with a long wing (b) just east of it running south.
    const alone = sun({ [MAIN_LEVEL_ID]: box([win("w", "a", 2, 17 * FT)]) }, "w");
    const tucked = sun({ [MAIN_LEVEL_ID]: plan([room("a", 0, 0, 20 * FT, 15 * FT), room("b", 20 * FT, 0, 16 * FT, 45 * FT)], [win("w", "a", 2, 17 * FT)]) }, "w");
    const winter = (s: typeof alone) => hours(s.find((x) => x.season.id === "winter")!.spans);
    expect(winter(tucked)).toBeLessThan(winter(alone) - 1);
    // Morning is what's lost: the wing is to the east.
    const start = (s: typeof alone) => s.find((x) => x.season.id === "winter")!.spans[0][0];
    expect(start(tucked)).toBeGreaterThan(start(alone));
  });

  it("writes a short note", () => {
    const north = sun({ [MAIN_LEVEL_ID]: box([win("w", "a", 0, 10 * FT)]) }, "w");
    const note = sunNote(north);
    expect(note).toMatch(/^Direct sun through this window: /);
    expect(note).toContain("none in winter");
    expect(note).toContain("in summer");
    expect(sunNote(SEASONS.map((season) => ({ season, spans: [], brief: false, place: DEFAULT_PLACE })))).toMatch(/No direct sun/);
  });

  it("writes times like a clock", () => {
    expect(clockTime(12, false, DEFAULT_PLACE)).toBe("12:45 pm");
    expect(timeSpan(6.25, 10.25, true, DEFAULT_PLACE)).toBe("8 am to 12 pm");
    expect(timeSpan(8.25, 13.75, false, DEFAULT_PLACE)).toBe("9 am to 2:30 pm");
  });
});
