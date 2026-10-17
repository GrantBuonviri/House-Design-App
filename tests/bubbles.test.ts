import { describe, expect, it } from "vitest";
import { DiscoveryAnswers, type ChosenRoom, type Plot, type Profile } from "@/lib/model/schema";
import { FLAT_PLOT_SEED, generatePlot } from "@/lib/land/generate";
import { plotImplications } from "@/lib/land/implications";
import { buildRuleBrief } from "@/lib/brief/rules";
import { levelsFor, newExtraLevel } from "@/lib/brief/levels";
import { roomType } from "@/lib/brief/rooms";
import {
  addMissingRooms,
  centerOf,
  compacted,
  currentSpots,
  howDifferent,
  missingRooms,
  moveToSpots,
  suggestDiagrams,
  type Diagrams,
  type SketchContext,
} from "@/lib/bubbles/arrange";
import { compareSketches, ruleAlternatives, scoreSketch, sketchTotal } from "@/lib/bubbles/alternatives";
import { priorityWeights } from "@/lib/plan/score";
import { freeSpot, layout, overlapAmount } from "@/lib/bubbles/layout";
import { bubbleIdFor, bubbleSqft, emptyDiagram, radiiFor, resized, reshaped, type Bubble } from "@/lib/bubbles/shapes";
import { mirroredSpot, oppositeSpot, ruleSpot, siteOf, spotFromVector, spotVector } from "@/lib/bubbles/site";
import { addFlow, cleanDiagram, copyBubbleFrom, moveBubbleToLevel, removeBubble, takeAlternative } from "@/lib/bubbles/edit";
import { suggestAlternatives, suggestSketch } from "@/lib/bubbles/suggest";

const profile: Profile = { mustHaves: [], dislikes: [] };
const flat = generatePlot(FLAT_PLOT_SEED, { flat: true });

let n = 0;
function room(type: string, extra: Partial<ChosenRoom> = {}): ChosenRoom {
  return { id: `r${++n}`, type, name: roomType(type).label, description: "", ...extra };
}

function ranch(): ChosenRoom[] {
  return [
    room("entry"),
    room("kitchen"),
    room("dining"),
    room("living"),
    room("primary-bedroom"),
    room("primary-bath"),
    room("bedroom", { name: "Bedroom 1" }),
    room("bedroom", { name: "Bedroom 2" }),
    room("bathroom"),
    room("laundry"),
    room("garage"),
  ];
}

function context(rooms: ChosenRoom[], plot: Plot | null = flat, floorsAbove = 1, floorsBelow = 0): SketchContext {
  const brief = buildRuleBrief({ answers: DiscoveryAnswers.parse({ rooms, floorsAbove, floorsBelow }), profile, plot });
  return { brief, plot, levels: levelsFor(brief.floors, brief.floorsBelow) };
}

function allBubbles(ds: Diagrams): Bubble[] {
  return Object.values(ds).flatMap((d) => d.bubbles);
}

function worstOverlap(ds: Diagrams): number {
  let worst = 0;
  for (const d of Object.values(ds)) {
    for (const a of d.bubbles) for (const b of d.bubbles) if (a.id < b.id) worst = Math.max(worst, overlapAmount(a, b));
  }
  return worst;
}

function byName(ds: Diagrams, name: string): Bubble {
  const b = allBubbles(ds).find((x) => x.label === name);
  if (!b) throw new Error(`no bubble called ${name}`);
  return b;
}

function plotWhere(test: (p: Plot) => boolean): Plot {
  for (let seed = 2; seed < 3000; seed++) {
    const p = generatePlot(seed);
    if (test(p)) return p;
  }
  throw new Error("no plot found");
}

describe("bubble shapes", () => {
  it("sizes bubbles so their area matches the square feet", () => {
    const { rx, ry } = radiiFor(200, 1.5);
    expect(rx / ry).toBeCloseTo(1.5);
    expect(bubbleSqft({ rx, ry })).toBe(200);
    const b = { id: "x", label: "x", shape: "oval" as const, x: 0, y: 0, rx, ry, rotation: 0 };
    expect(bubbleSqft(resized(b, 350))).toBe(350);
    const round = reshaped(b, "circle");
    expect(round.rx).toBeCloseTo(round.ry);
    expect(bubbleSqft(round)).toBe(200);
  });
});

describe("spots on the floor", () => {
  it("turns compass spots into directions and back", () => {
    expect(spotVector("N").y).toBeLessThan(0);
    expect(spotVector("E").x).toBeGreaterThan(0);
    expect(spotFromVector({ x: 0, y: -100 }, 30)).toBe("N");
    expect(spotFromVector({ x: 70, y: 70 }, 30)).toBe("SE");
    expect(spotFromVector({ x: 5, y: -5 }, 30)).toBe("center");
    expect(oppositeSpot("NE")).toBe("SW");
    expect(mirroredSpot("NE", "x")).toBe("NW");
    expect(mirroredSpot("NE", "y")).toBe("SE");
    expect(mirroredSpot("center", "x")).toBe("center");
  });

  it("puts the entry on the road and daylight rooms on the downhill side of a walkout", () => {
    const north = { roadSide: "N" as const, walkout: null, mirrorAxis: "x" as const };
    expect(ruleSpot("entry", "main", north)).toBe("N");
    expect(ruleSpot("living", "main", north)).toBe("S");
    const walkout = { ...north, walkout: "E" as const };
    expect(ruleSpot("family", "basement", walkout)).toBe("E");
    expect(ruleSpot("mechanical", "basement", walkout)).toBe("W");
    expect(siteOf(null).roadSide).toBe("N");
  });
});

describe("the starting sketch", () => {
  const ctx = context(ranch());
  const sketch = suggestDiagrams(ctx);
  const main = sketch["floor-1"];

  it("has every room once, at the brief's size", () => {
    for (const r of ctx.brief.rooms) {
      const matches = allBubbles(sketch).filter((b) => b.roomId === r.id);
      expect(matches).toHaveLength(1);
      expect(matches[0].id).toBe(bubbleIdFor(r.id));
      expect(Math.abs(bubbleSqft(matches[0]) - r.targetSqFt)).toBeLessThanOrEqual(1);
    }
    // One floor, so no stairs.
    expect(main.bubbles.some((b) => b.stairs)).toBe(false);
  });

  it("doesn't pile bubbles on top of each other", () => {
    expect(worstOverlap(sketch)).toBeLessThan(0.1);
  });

  it("keeps rooms that must connect close together", () => {
    for (const e of ctx.brief.adjacencies.filter((x) => x.strength === "must")) {
      const a = main.bubbles.find((b) => b.roomId === e.a)!;
      const b = main.bubbles.find((x) => x.roomId === e.b)!;
      const reach = Math.max(a.rx, a.ry) + Math.max(b.rx, b.ry);
      expect(Math.hypot(a.x - b.x, a.y - b.y), `${a.label} to ${b.label}`).toBeLessThan(reach * 1.35);
    }
  });

  it("puts the entry and garage toward the road and living spaces toward the sun", () => {
    const southRoad = plotWhere((p) => p.roadSide === "S" && plotImplications(p).foundation.type === "slab");
    const s = suggestDiagrams(context(ranch(), southRoad));
    const c = centerOf(s["floor-1"].bubbles);
    expect(byName(s, "Entry").y).toBeGreaterThan(c.y);
    expect(byName(s, "Garage").y).toBeGreaterThan(c.y);

    const northRoad = plotWhere((p) => p.roadSide === "N" && plotImplications(p).foundation.type === "slab");
    const n2 = suggestDiagrams(context(ranch(), northRoad));
    const c2 = centerOf(n2["floor-1"].bubbles);
    expect(byName(n2, "Entry").y).toBeLessThan(c2.y);
    expect(byName(n2, "Living room").y).toBeGreaterThan(c2.y);
  });

  it("is the same every time", () => {
    expect(suggestDiagrams(ctx)).toEqual(sketch);
  });

  it("lines up the stairs on every floor", () => {
    const two = context(ranch(), flat, 2, 1);
    const s = suggestDiagrams(two);
    const stairs = two.levels.map((l) => s[l.id].bubbles.find((b) => b.stairs));
    expect(stairs.every(Boolean)).toBe(true);
    for (const st of stairs) {
      expect(st!.x).toBe(stairs[0]!.x);
      expect(st!.y).toBe(stairs[0]!.y);
    }
    expect(worstOverlap(s)).toBeLessThan(0.1);
  });

  it("puts rooms in the spots asked for", () => {
    const living = ctx.brief.rooms.find((r) => r.type === "living")!;
    const s = suggestDiagrams(ctx, new Map([[living.id, "N" as const]]));
    const c = centerOf(s["floor-1"].bubbles);
    expect(byName(s, "Living room").y).toBeLessThan(c.y);
    expect(currentSpots(ctx, s).get(bubbleIdFor(living.id))?.spot).toMatch(/^N/);
  });
});

describe("changing the sketch", () => {
  const ctx = context(ranch(), flat, 2);
  const sketch = suggestDiagrams(ctx);

  it("moves only the rooms asked to move", () => {
    const kitchen = bubbleIdFor(ctx.brief.rooms.find((r) => r.type === "kitchen")!.id);
    const moved = moveToSpots(ctx, sketch, new Map([[kitchen, "NW" as const]]));
    const before = sketch["floor-1"].bubbles.find((b) => b.id === kitchen)!;
    const after = moved["floor-1"].bubbles.find((b) => b.id === kitchen)!;
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(50);
    expect(allBubbles(moved).map((b) => b.id).sort()).toEqual(allBubbles(sketch).map((b) => b.id).sort());
    expect(worstOverlap(moved)).toBeLessThan(0.1);
  });

  it("makes a more compact sketch", () => {
    const one = context(ranch());
    const roomy = suggestDiagrams(one);
    const small = compacted(one, roomy);
    const spread = (d: Diagrams) => {
      const bs = d["floor-1"].bubbles;
      const c = centerOf(bs);
      return bs.reduce((s, b) => s + Math.hypot(b.x - c.x, b.y - c.y), 0);
    };
    expect(spread(small)).toBeLessThan(spread(roomy) * 0.95);
  });

  it("adds missing rooms without moving the ones already drawn", () => {
    const dining = ctx.brief.rooms.find((r) => r.type === "dining")!;
    const without: Diagrams = { ...sketch, "floor-1": removeBubble(sketch["floor-1"], bubbleIdFor(dining.id)) };
    expect(missingRooms(ctx.brief, without).map((r) => r.id)).toEqual([dining.id]);
    const back = addMissingRooms(ctx, without, [dining.id]);
    expect(missingRooms(ctx.brief, back)).toEqual([]);
    for (const b of without["floor-1"].bubbles) expect(back["floor-1"].bubbles.find((x) => x.id === b.id)).toEqual(b);
    expect(worstOverlap(back)).toBeLessThan(0.1);
  });

  it("finds a free place next to bubbles that can't move", () => {
    const pinned = [0, 1, 2].map((i) => ({ x: i * 200, y: 0, rx: 100, ry: 100, rotation: 0 }));
    const b = { x: 200, y: 0, rx: 60, ry: 60, rotation: 0 };
    const p = freeSpot(b, pinned, { x: 200, y: 0 });
    for (const o of pinned) expect(overlapAmount({ ...b, ...p }, o)).toBeLessThanOrEqual(0.06);
  });

  it("lays out the same way every time", () => {
    const nodes = [
      { id: "a", rx: 100, ry: 100, rotation: 0, anchor: { x: 0, y: 0 }, anchorWeight: 1 },
      { id: "b", rx: 80, ry: 60, rotation: 30, anchor: { x: 0, y: 0 }, anchorWeight: 1 },
      { id: "c", rx: 50, ry: 50, rotation: 0, anchor: { x: 10, y: 0 }, anchorWeight: 1 },
    ];
    const one = layout(nodes, [{ a: "a", b: "c", strength: "must" }]);
    expect(layout(nodes, [{ a: "a", b: "c", strength: "must" }])).toEqual(one);
  });
});

describe("built-in alternatives", () => {
  it("gives three different designs that keep every room and the stairs", () => {
    for (const ctx of [context(ranch()), context(ranch(), flat, 2), context(ranch(), plotWhere((p) => p.roadSide === "W"), 2)]) {
      const sketch = suggestDiagrams(ctx);
      const alts = ruleAlternatives(ctx, sketch);
      expect(alts).toHaveLength(3);
      expect(new Set(alts.map((a) => a.title)).size).toBe(3);
      const ids = allBubbles(sketch).map((b) => b.id).sort();
      for (const alt of alts) {
        expect(allBubbles(alt.diagrams).map((b) => b.id).sort()).toEqual(ids);
        expect(howDifferent(sketch, alt.diagrams)).toBeGreaterThan(0.05);
        expect(worstOverlap(alt.diagrams)).toBeLessThan(0.1);
        for (const level of ctx.levels) {
          const before = sketch[level.id]?.bubbles.find((b) => b.stairs);
          const after = alt.diagrams[level.id]?.bubbles.find((b) => b.stairs);
          // "More compact" pulls the stairs in with everything else (still lined up floor to floor).
          if (before && alt.title !== "More compact") expect({ x: after?.x, y: after?.y }).toEqual({ x: before.x, y: before.y });
        }
      }
    }
  });

  it("measures how different two sketches are", () => {
    const ctx = context(ranch());
    const sketch = suggestDiagrams(ctx);
    expect(howDifferent(sketch, sketch)).toBe(0);
    expect(howDifferent(sketch, {})).toBe(1);
  });
});

describe("editing", () => {
  const b = (id: string, x = 0): Bubble => ({ id, label: id, shape: "circle", x, y: 0, rx: 50, ry: 50, rotation: 0 });

  it("cleans up a damaged sketch", () => {
    const d = cleanDiagram({
      bubbles: [b("a"), b("a", 10), { ...b("c"), x: Number.NaN }, { ...b("d"), rx: 1e9, ry: 1e9 }],
      flows: [
        { id: "f1", from: "a", to: "d" },
        { id: "f2", from: "a", to: "ghost" },
      ],
      strokes: [{ id: "s1", points: [0, 0], width: 2 }],
      notes: [{ id: "n1", x: 0, y: 0, text: "x".repeat(900) }],
    });
    expect(d.bubbles.map((x) => x.id)).toEqual(["a", "d"]);
    expect(bubbleSqft(d.bubbles[1])).toBeLessThanOrEqual(3000);
    expect(d.flows.map((f) => f.id)).toEqual(["f1"]);
    expect(d.strokes).toEqual([]);
    expect(d.notes[0].text.length).toBe(500);
  });

  it("removes a bubble's flow lines with it, and never links a bubble to itself", () => {
    let d = { ...emptyDiagram(), bubbles: [b("a"), b("b", 200)] };
    d = addFlow(d, "a", "b");
    expect(addFlow(d, "b", "a").flows).toHaveLength(1);
    expect(addFlow(d, "a", "a").flows).toHaveLength(1);
    expect(removeBubble(d, "a").flows).toEqual([]);
  });

  it("moves a bubble to another floor", () => {
    const ds = { one: { ...emptyDiagram(), bubbles: [b("a")] } };
    const moved = moveBubbleToLevel(ds, "a", "one", "two");
    expect(moved.one.bubbles).toEqual([]);
    expect(moved.two.bubbles.map((x) => x.id)).toEqual(["a"]);
  });

  it("takes an alternative but keeps the user's pen marks and notes", () => {
    const mine: Diagrams = {
      one: { ...emptyDiagram(), bubbles: [{ ...b("a"), label: "My den" }], strokes: [{ id: "s", points: [0, 0, 5, 5], width: 2 }], notes: [{ id: "n", x: 0, y: 0, text: "hi" }] },
    };
    const alt: Diagrams = { one: { ...emptyDiagram(), bubbles: [b("a", 300)] } };
    const taken = takeAlternative(mine, alt);
    expect(taken.one.bubbles[0].x).toBe(300);
    expect(taken.one.strokes).toHaveLength(1);
    expect(taken.one.notes).toHaveLength(1);

    const copied = copyBubbleFrom(mine, alt, "a");
    expect(copied.one.bubbles[0]).toMatchObject({ x: 300, label: "My den" });
    // Copying a room that the alternative has on another floor moves it there.
    const upstairs = copyBubbleFrom(mine, { two: alt.one }, "a");
    expect(upstairs.one.bubbles).toEqual([]);
    expect(upstairs.two.bubbles[0].label).toBe("My den");
  });
});

describe("extra levels", () => {
  it("adds a loft above the top floor and split levels between floors, once each", () => {
    const levels = levelsFor(2, 0);
    const loft = newExtraLevel("loft", levels)!;
    expect(loft.kind).toBe("loft");
    expect(loft.elevationIn).toBeGreaterThan(Math.max(...levels.map((l) => l.elevationIn)));
    expect(newExtraLevel("loft", [...levels, loft])).toBeNull();
    const split = newExtraLevel("split-up", levels)!;
    expect(split.kind).toBe("split");
    expect(split.elevationIn).toBeGreaterThan(0);
  });
});

// ---------- Suggestions ----------

describe("suggestions", () => {
  it("makes the starting sketch from the brief, and says so when there are no rooms", () => {
    const ctx = context(ranch());
    const s = suggestSketch(ctx);
    expect(s.note).toBeUndefined();
    expect(s.diagrams).toEqual(suggestDiagrams(ctx));
    expect(suggestSketch({ ...ctx, brief: { ...ctx.brief, rooms: [] } }).note).toMatch(/no rooms/);
  });

  it("gives three alternatives, and different ones when asked again", () => {
    const ctx = context(ranch());
    const sketch = suggestDiagrams(ctx);
    const first = suggestAlternatives(ctx, sketch);
    expect(first.alternatives).toHaveLength(3);
    const again = suggestAlternatives(ctx, sketch, first.alternatives.map((a) => a.title));
    expect(again.alternatives[0].title).not.toBe(first.alternatives[0].title);
    expect(suggestAlternatives(ctx, {}).note).toMatch(/sketch first/);
  });
});

describe("sketch scores", () => {
  it("counts sunny living rooms, the garage's side, quiet bedrooms and kept connections", () => {
    const ctx = context(ranch());
    const sketch = suggestDiagrams(ctx);
    const s = scoreSketch(ctx, sketch);
    expect(s.connections).toBe(ctx.brief.adjacencies.length);
    expect(s.kept).toBeGreaterThan(0);
    expect(s.kept).toBeLessThanOrEqual(s.connections);
    expect(s.bedroomsAway).toBeGreaterThan(0);
    // Every bubble piled in the middle: nothing on the sunny side, and no connection far apart.
    const piled = Object.fromEntries(Object.entries(sketch).map(([id, d]) => [id, { ...d, bubbles: d.bubbles.map((b) => ({ ...b, x: 0, y: 0 })) }]));
    const p = scoreSketch(ctx, piled);
    expect(p.sunnyLiving).toBe(0);
    expect(p.bedroomsAway).toBe(0);
    expect(compareSketches(s, p).join(" ")).toMatch(/closer to the garage and kitchen/);
  });

  it("puts the best alternative first, with numbers in its reason", () => {
    const ctx = context(ranch());
    const sketch = suggestDiagrams(ctx);
    const alts = ruleAlternatives(ctx, sketch);
    const before = scoreSketch(ctx, sketch);
    const { weights } = priorityWeights(ctx.brief.priorities);
    const gains = alts.map((a) => sketchTotal(scoreSketch(ctx, a.diagrams), weights) - sketchTotal(before, weights));
    // Distinct picks can skip a near copy, but the first one shown is the best scoring of those shown.
    expect(gains[0]).toBeGreaterThanOrEqual(Math.max(...gains) - 1e-9);
    expect(alts.some((a) => a.numbers && /\d|half/.test(a.numbers))).toBe(true);
  });
});
