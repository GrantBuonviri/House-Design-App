import { describe, expect, it } from "vitest";
import { DiscoveryAnswers, Project, SCHEMA_VERSION, type BubbleDiagram, type ChosenRoom, type Plot, type Point } from "@/lib/model/schema";
import { createProject, migrateProject } from "@/lib/model/project";
import { FLAT_PLOT_SEED, bearingVector, generatePlot } from "@/lib/land/generate";
import { pointInPolygon } from "@/lib/land/geometry";
import { dayArc, SUMMER_SOLSTICE } from "@/lib/land/sun";
import { buildRuleBrief } from "@/lib/brief/rules";
import { levelsFor } from "@/lib/brief/levels";
import { roomType } from "@/lib/brief/rooms";
import { moveToSpots, suggestDiagrams, type Diagrams, type SketchContext } from "@/lib/bubbles/arrange";
import { ruleAlternatives } from "@/lib/bubbles/alternatives";
import {
  FREE_COLOR,
  MIN_SQFT,
  bubbleIdFor,
  bubbleSqft,
  emptyDiagram,
  isDrawn,
  outlineShape,
  polygonArea,
  reshaped,
  resized,
  scaledOutline,
  tidyOutline,
  type Bubble,
} from "@/lib/bubbles/shapes";
import { addFlow, cleanDiagram, connected, moveBubblesToLevel, moveMany, removeMany, toggleFlow } from "@/lib/bubbles/edit";
import { blankSketch, hasContent } from "@/lib/bubbles/start";
import { contours, defaultLotOffset, houseCenter, landDrawing, lotCenter, sunPaths } from "@/lib/bubbles/land";
import { DEFAULT_PLACE } from "@/lib/location/current";

const FT = 12;
const flat = generatePlot(FLAT_PLOT_SEED, { flat: true });
/** The first generated lot with a real slope. */
const sloped: Plot = (() => {
  for (let seed = 2; seed < 400; seed++) {
    const p = generatePlot(seed);
    if (!p.isFlat && p.slope.percent >= 4) return p;
  }
  throw new Error("no sloped plot");
})();

/** A 12 ft by 10 ft rectangle drawn around (0, 0), in inches. */
const rect: Point[] = [
  { x: -72, y: -60 },
  { x: 72, y: -60 },
  { x: 72, y: 60 },
  { x: -72, y: 60 },
];

function drawn(id: string, outline = rect, at: Point = { x: 0, y: 0 }): Bubble {
  const s = outlineShape(outline.map((p) => ({ x: p.x + at.x, y: p.y + at.y })));
  return { id, label: "Nook", shape: "free", ...s, rotation: 0, color: FREE_COLOR };
}

function circle(id: string, x: number, y: number, label = id): Bubble {
  return { id, label, shape: "circle", x, y, rx: 60, ry: 60, rotation: 0, color: FREE_COLOR };
}

function diagram(bubbles: Bubble[]): BubbleDiagram {
  return { ...emptyDiagram(), bubbles };
}

let n = 0;
function room(type: string, extra: Partial<ChosenRoom> = {}): ChosenRoom {
  return { id: `t${++n}`, type, name: roomType(type).label, description: "", ...extra };
}

function context(plot: Plot | null = flat): SketchContext {
  const rooms = [room("entry"), room("kitchen"), room("dining"), room("living"), room("primary-bedroom"), room("bathroom"), room("garage")];
  const brief = buildRuleBrief({ answers: DiscoveryAnswers.parse({ rooms, floorsAbove: 1, floorsBelow: 0 }), profile: { mustHaves: [], dislikes: [] }, plot });
  return { brief, plot, levels: levelsFor(brief.floors, brief.floorsBelow) };
}

describe("rooms drawn in any shape", () => {
  it("measure their size from the drawn outline", () => {
    const b = drawn("a");
    expect(isDrawn(b)).toBe(true);
    expect(bubbleSqft(b)).toBe(120);
    expect(b.rx).toBe(72);
    expect(b.ry).toBe(60);
  });

  it("measure an L shape by its real area, not its box", () => {
    const l: Point[] = [
      { x: 0, y: 0 },
      { x: 240, y: 0 },
      { x: 240, y: 120 },
      { x: 120, y: 120 },
      { x: 120, y: 240 },
      { x: 0, y: 240 },
    ];
    expect(bubbleSqft(drawn("l", l))).toBe(300);
  });

  it("keep their proportions when given a new size", () => {
    const b = resized(drawn("a"), 480);
    expect(bubbleSqft(b)).toBe(480);
    expect(b.outline![1].x / b.outline![2].y).toBeCloseTo(72 / 60, 5);
    expect(b.rx).toBeCloseTo(144, 0);
  });

  it("stretch with the resize handles", () => {
    const b = scaledOutline(drawn("a"), 2, 1);
    expect(bubbleSqft(b)).toBe(240);
    expect(b.rx).toBe(144);
    expect(b.ry).toBe(60);
  });

  it("can become a circle or oval of the same size, but not back", () => {
    const b = drawn("a");
    const round = reshaped(b, "circle");
    expect(round.shape).toBe("circle");
    expect(round.outline).toBeUndefined();
    expect(bubbleSqft(round)).toBe(120);
    const long = reshaped(b, "oval");
    expect(long.shape).toBe("oval");
    expect(Math.abs(bubbleSqft(long) - 120)).toBeLessThanOrEqual(1);
    expect(reshaped(round, "free")).toBe(round);
  });

  it("are tidied: shaky points smoothed and thinned, the shape kept", () => {
    const wobbly: Point[] = [];
    for (let i = 0; i < 200; i++) {
      const t = (i / 200) * Math.PI * 2;
      wobbly.push({ x: Math.cos(t) * 100 + (i % 2 ? 1.5 : -1.5), y: Math.sin(t) * 70 });
    }
    const tidy = tidyOutline(wobbly, 2.5);
    expect(tidy.length).toBeLessThan(80);
    expect(tidy.length).toBeGreaterThanOrEqual(8);
    const want = Math.PI * 100 * 70;
    expect(Math.abs(polygonArea(tidy) - want) / want).toBeLessThan(0.05);
  });

  it("sit around their middle, with rx and ry as half the width and height", () => {
    const s = outlineShape(rect.map((p) => ({ x: p.x + 500, y: p.y + 300 })));
    expect(s.x).toBe(500);
    expect(s.y).toBe(300);
    expect(s.outline[0]).toEqual({ x: -72, y: -60 });
  });

  it("are cleaned when loaded: off-center outlines re-centered, broken ones turned into ovals", () => {
    const off: Bubble = { ...drawn("a"), outline: rect.map((p) => ({ x: p.x + 24, y: p.y })) };
    const fixed = cleanDiagram(diagram([off])).bubbles[0];
    expect(fixed.x).toBe(24);
    expect(fixed.outline![0]).toEqual({ x: -72, y: -60 });
    const broken: Bubble = { ...drawn("b"), outline: [{ x: 0, y: 0 }] };
    expect(cleanDiagram(diagram([broken])).bubbles[0].shape).toBe("oval");
    const stray = { ...circle("c", 0, 0), outline: rect };
    expect(cleanDiagram(diagram([stray])).bubbles[0].outline).toBeUndefined();
  });

  it("keep their shape when a new suggestion or an alternative moves them", () => {
    const ctx = context();
    const kitchen = ctx.brief.rooms.find((r) => r.type === "kitchen")!;
    const first = suggestDiagrams(ctx);
    const main = Object.keys(first).find((k) => first[k].bubbles.length)!;
    const id = bubbleIdFor(kitchen.id);
    const old = first[main].bubbles.find((b) => b.id === id)!;
    const shaped = { ...old, ...drawn(id, rect, old), label: old.label, roomId: old.roomId };
    const current: Diagrams = { ...first, [main]: { ...first[main], bubbles: first[main].bubbles.map((b) => (b.id === id ? shaped : b)) } };

    const again = suggestDiagrams(ctx, new Map(), 3, current)[main].bubbles.find((b) => b.id === id)!;
    expect(again.shape).toBe("free");
    expect(again.outline).toEqual(shaped.outline);

    for (const alt of ruleAlternatives(ctx, current)) {
      const b = alt.diagrams[main].bubbles.find((x) => x.id === id)!;
      expect(b.outline).toEqual(shaped.outline);
    }
    const moved = moveToSpots(ctx, current, new Map([[id, "N"]]))[main].bubbles.find((b) => b.id === id)!;
    expect(moved.outline).toEqual(shaped.outline);
  });
});

describe("working with several things at once", () => {
  const a = circle("a", 0, 0);
  const b = circle("b", 300, 0);
  const c = circle("c", 0, 300);
  let d = diagram([a, b, c]);
  d = addFlow(addFlow(d, "a", "b"), "b", "c");
  d = { ...d, notes: [{ id: "n", x: 10, y: 10, text: "hi" }], strokes: [{ id: "s", points: [0, 0, 10, 10], width: 2 }] };

  it("removes everything picked, and the lines to removed rooms", () => {
    const out = removeMany(d, ["a", "n", "s"]);
    expect(out.bubbles.map((x) => x.id)).toEqual(["b", "c"]);
    expect(out.flows).toHaveLength(1);
    expect(out.notes).toHaveLength(0);
    expect(out.strokes).toHaveLength(0);
  });

  it("moves rooms, notes and pen marks together", () => {
    const out = moveMany(d, ["a", "b", "n", "s"], 24, -12);
    expect(out.bubbles.find((x) => x.id === "a")).toMatchObject({ x: 24, y: -12 });
    expect(out.bubbles.find((x) => x.id === "c")).toMatchObject({ x: 0, y: 300 });
    expect(out.notes[0]).toMatchObject({ x: 34, y: -2 });
    expect(out.strokes[0].points).toEqual([24, -12, 34, -2]);
  });

  it("connects and disconnects rooms either way round", () => {
    expect(connected(d, "b", "a")).toBe(true);
    const off = toggleFlow(d, "b", "a");
    expect(connected(off, "a", "b")).toBe(false);
    const on = toggleFlow(off, "a", "c");
    expect(connected(on, "c", "a")).toBe(true);
    expect(toggleFlow(on, "a", "a")).toBe(on);
  });

  it("moves several rooms to another floor, keeping the lines between them", () => {
    const ds: Diagrams = { main: d, upper: diagram([circle("u", 0, 0)]) };
    const out = moveBubblesToLevel(ds, ["a", "b"], "main", "upper");
    expect(out.main.bubbles.map((x) => x.id)).toEqual(["c"]);
    expect(out.main.flows).toHaveLength(0);
    expect(out.upper.bubbles.map((x) => x.id)).toEqual(["u", "a", "b"]);
    expect(out.upper.flows).toHaveLength(1);
  });
});

describe("Start blank", () => {
  const levels = [{ id: "main" }, { id: "upper" }, { id: "basement" }];

  it("leaves every floor completely empty", () => {
    const ds = blankSketch(levels);
    expect(Object.keys(ds)).toEqual(["main", "upper", "basement"]);
    expect(hasContent(ds)).toBe(false);
    for (const d of Object.values(ds)) expect(d).toEqual(emptyDiagram());
  });
});

describe("the land under the sketch", () => {
  it("has no contours or downhill arrow on a flat lot", () => {
    const land = landDrawing(flat);
    expect(land.contours).toHaveLength(0);
    expect(land.downhill).toBeNull();
    expect(land.outline).toBe(flat.outline);
  });

  it("draws contour lines and a downhill arrow on a sloped lot", () => {
    const land = landDrawing(sloped);
    expect(land.contours.length).toBeGreaterThan(40);
    expect(land.contours.length % 4).toBe(0);
    expect([2, 5, 10]).toContain(land.contourFt);
    const arrow = land.downhill!;
    expect(arrow.percent).toBeCloseTo(sloped.slope.percent, 0);
    const d = bearingVector(sloped.slope.downhillDeg);
    const along = (arrow.to.x - arrow.from.x) * d.x + (arrow.to.y - arrow.from.y) * d.y;
    expect(along).toBeGreaterThan(0);
    expect(contours(sloped, 40).segments.length).toBeLessThan(land.contours.length);
  });

  it("marks the lot edge along the road, with the label outside the lot", () => {
    for (const plot of [flat, sloped]) {
      const road = landDrawing(plot).road!;
      expect(road).not.toBeNull();
      expect(pointInPolygon(road.label, plot.outline)).toBe(false);
      const mid = { x: (road.a.x + road.b.x) / 2, y: (road.a.y + road.b.y) / 2 };
      const c = lotCenter(plot);
      const side = { N: c.y - mid.y, S: mid.y - c.y, E: mid.x - c.x, W: c.x - mid.x }[plot.roadSide];
      expect(side).toBeGreaterThan(0);
    }
  });

  it("puts the middle of the lot under the middle of the main floor", () => {
    const rooms = [circle("a", 100, 0), circle("b", 300, 200)];
    const offset = defaultLotOffset(flat, rooms);
    const middle = houseCenter(rooms);
    expect(Math.abs(middle.x + offset.x - flat.widthIn / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(middle.y + offset.y - flat.depthIn / 2)).toBeLessThanOrEqual(1);
    expect(defaultLotOffset(flat, [])).toEqual({ x: Math.round(flat.widthIn / 2), y: Math.round(flat.depthIn / 2) });
  });

  it("draws Boise's sun paths around the house, summer outside winter", () => {
    const center = { x: 50, y: -40 };
    const { paths, noon } = sunPaths(center, 30 * FT, DEFAULT_PLACE.latitudeDeg);
    const summer = paths.find((p) => p.season === "summer")!;
    const winter = paths.find((p) => p.season === "winter")!;
    const dist = (p: Point) => Math.hypot(p.x - center.x, p.y - center.y);
    expect(dist(summer.sunrise)).toBeCloseTo(30 * FT, 5);
    expect(dist(winter.sunrise)).toBeLessThan(dist(summer.sunrise));
    // June sunrise is north of east; noon is due south.
    const rise = bearingVector(dayArc(SUMMER_SOLSTICE, DEFAULT_PLACE.latitudeDeg).sunrise.azimuthDeg);
    expect(summer.sunrise.x - center.x).toBeCloseTo(rise.x * 30 * FT, 5);
    expect(summer.sunrise.y).toBeLessThan(center.y);
    expect(noon.x).toBeCloseTo(center.x, 5);
    expect(noon.y).toBeGreaterThan(center.y);
    expect(summer.points).toHaveLength(49);
  });
});

describe("saved projects", () => {
  it("open older projects with the land overlays off and no placement yet", () => {
    const old = { ...createProject("Old"), schemaVersion: 2 } as Record<string, unknown>;
    delete old.sketch;
    const p = migrateProject(old);
    expect(p.schemaVersion).toBe(SCHEMA_VERSION);
    expect(p.sketch).toEqual({ overlays: { property: false, sun: false, land: false, arrow: true }, lotOffset: null });
  });

  it("keep drawn rooms and sketch settings", () => {
    const p = createProject("New");
    const saved = Project.parse(
      JSON.parse(
        JSON.stringify({
          ...p,
          bubbles: { main: diagram([drawn("a")]) },
          sketch: { overlays: { property: true, sun: false, land: true, arrow: false }, lotOffset: { x: 120, y: -48 } },
        }),
      ),
    );
    expect(saved.bubbles.main.bubbles[0].outline).toHaveLength(4);
    expect(bubbleSqft(saved.bubbles.main.bubbles[0])).toBe(120);
    expect(saved.sketch.overlays.arrow).toBe(false);
    expect(saved.sketch.lotOffset).toEqual({ x: 120, y: -48 });
  });

  it("ignore rooms drawn too small to count", () => {
    const tiny = outlineShape(rect.map((p) => ({ x: p.x / 5, y: p.y / 5 })));
    expect(polygonArea(tiny.outline)).toBeLessThan(MIN_SQFT * 144);
  });
});
