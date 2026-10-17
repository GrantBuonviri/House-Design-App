import { describe, expect, it } from "vitest";
import { DiscoveryAnswers, SCHEMA_VERSION, type ChosenRoom, type DesignBrief, type Profile } from "@/lib/model/schema";
import { createProject, migrateProject } from "@/lib/model/project";
import { FLAT_PLOT_SEED, generatePlot } from "@/lib/land/generate";
import { buildRuleBrief, briefTotals, householdFactor, householdSizing, missingEssentials, sizingNote, type BriefContext } from "@/lib/brief/rules";
import { levelIdsFor, levelsFor, nearestLevel, syncLevels } from "@/lib/brief/levels";
import { GARAGE_SQFT, roomType, setTypeCount, sqftFromDims } from "@/lib/brief/rooms";

const profile: Profile = { mustHaves: [], dislikes: [] };
const flat = generatePlot(FLAT_PLOT_SEED, { flat: true });

let n = 0;
function room(type: string, extra: Partial<ChosenRoom> = {}): ChosenRoom {
  return { id: `r${++n}`, type, name: roomType(type).label, description: "", ...extra };
}

function ctx(answers: Partial<DiscoveryAnswers> = {}, extra: Partial<BriefContext> = {}): BriefContext {
  return { answers: DiscoveryAnswers.parse(answers), profile, plot: flat, ...extra };
}

/** A typical list from the rooms page. */
function typical(): ChosenRoom[] {
  return [
    room("kitchen"),
    room("dining"),
    room("living"),
    room("primary-bedroom"),
    room("primary-bath"),
    room("bedroom", { name: "Bedroom 1" }),
    room("bedroom", { name: "Bedroom 2" }),
    room("bathroom"),
    room("garage"),
  ];
}

function sloped(min: number, max: number) {
  for (let seed = 2; seed < 2000; seed++) {
    const p = generatePlot(seed);
    if (p.slope.percent >= min && p.slope.percent < max) return p;
  }
  throw new Error("no plot in range");
}

/** Every link points at real rooms and every room sits on a floor that exists. */
function expectConsistent(brief: DesignBrief) {
  const ids = new Set(brief.rooms.map((r) => r.id));
  expect(ids.size).toBe(brief.rooms.length);
  for (const e of brief.adjacencies) {
    expect(ids.has(e.a)).toBe(true);
    expect(ids.has(e.b)).toBe(true);
    expect(e.a).not.toBe(e.b);
  }
  const levels = levelIdsFor(brief.floors, brief.floorsBelow);
  for (const r of brief.rooms) expect(levels).toContain(r.levelId);
}

describe("the rooms page", () => {
  it("numbers rooms of one type and keeps other types where they were", () => {
    let rooms = setTypeCount([], "kitchen", 1);
    rooms = setTypeCount(rooms, "bedroom", 1);
    expect(rooms.map((r) => r.name)).toEqual(["Kitchen", "Bedroom"]);
    rooms = setTypeCount(rooms, "bedroom", 3);
    expect(rooms.map((r) => r.name)).toEqual(["Kitchen", "Bedroom 1", "Bedroom 2", "Bedroom 3"]);
    rooms = setTypeCount([...rooms, room("garage")], "kitchen", 2);
    expect(rooms.map((r) => r.name)).toEqual(["Kitchen 1", "Kitchen 2", "Bedroom 1", "Bedroom 2", "Bedroom 3", "Garage"]);
  });

  it("removes the last rooms of a type first, and all of them when unchecked", () => {
    const start = setTypeCount([], "bedroom", 3);
    start[0] = { ...start[0], name: "Kid's room" };
    const two = setTypeCount(start, "bedroom", 2);
    expect(two.map((r) => r.id)).toEqual(start.slice(0, 2).map((r) => r.id));
    expect(two[0].name).toBe("Kid's room");
    expect(setTypeCount(two, "bedroom", 0)).toEqual([]);
  });

  it("works out square feet from length and width", () => {
    expect(sqftFromDims(12 * 12, 14.5 * 12)).toBe(174);
    expect(sqftFromDims(120, undefined)).toBeNull();
  });
});

describe("rule-based brief", () => {
  it("keeps exactly the user's rooms, names and count", () => {
    const rooms = [...typical(), room("other", { name: "Pottery studio" }), room("bedroom", { name: "  " })];
    const b = buildRuleBrief(ctx({ rooms }));
    expectConsistent(b);
    expect(b.rooms.map((r) => r.id)).toEqual(rooms.map((r) => r.id));
    expect(b.rooms.map((r) => r.type)).toEqual(rooms.map((r) => r.type));
    expect(b.rooms.find((r) => r.name === "Pottery studio")?.type).toBe("other");
    // A blank name falls back to the kind of room.
    expect(b.rooms.at(-1)?.name).toBe("Bedroom");
    expect(b.source).toBe("rules");
    expect(b.summary).toMatch(/4 bedrooms, 2 baths/);
  });

  it("uses the user's dimensions for size and fills in the rest from typical sizes", () => {
    const rooms = [room("kitchen", { lengthIn: 15 * 12, widthIn: 12.5 * 12 }), room("dining"), room("garage")];
    const b = buildRuleBrief(ctx({ rooms, garageCars: 3 }));
    expect(b.rooms[0]).toMatchObject({ targetSqFt: 188, lengthIn: 180, widthIn: 150 });
    expect(b.rooms[1].targetSqFt).toBe(roomType("dining").sqft);
    expect(b.rooms[1].lengthIn).toBeUndefined();
    expect(b.rooms[2].targetSqFt).toBe(GARAGE_SQFT[3]);
    expect(b.garageBays).toBe(3);
  });

  it("turns each room's description into its notes", () => {
    const b = buildRuleBrief(ctx({ rooms: [room("kitchen", { description: " Big island for baking " }), room("dining")] }));
    expect(b.rooms[0].notes).toBe("Big island for baking");
    expect(b.rooms[1].notes).toBeUndefined();
  });

  it("keeps a chosen floor and places the rest", () => {
    const rooms = [
      room("kitchen"),
      room("bedroom", { levelId: "floor-1" }),
      room("bedroom"),
      room("media"),
      room("primary-bedroom", { levelId: "floor-4" }), // a floor that no longer exists
    ];
    const b = buildRuleBrief(ctx({ rooms, floorsAbove: 2, floorsBelow: 1 }));
    expectConsistent(b);
    expect(b.rooms.map((r) => r.levelId)).toEqual(["floor-1", "floor-1", "floor-2", "basement-1", "floor-2"]);
    expect(b.primarySuiteLevel).toBe("floor-2");
    expect(b.floors).toBe(2);
    expect(b.floorsBelow).toBe(1);
  });

  it("keeps the user's connections exactly and adds a few obvious ones", () => {
    const rooms = typical();
    const [kitchen, dining, living] = rooms;
    const garage = rooms.find((r) => r.type === "garage")!;
    const connections = [
      { a: dining.id, b: kitchen.id, strength: "avoid" as const },
      { a: living.id, b: garage.id, strength: "nice" as const },
      { a: living.id, b: "gone", strength: "must" as const },
    ];
    const b = buildRuleBrief(ctx({ rooms, connections }));
    expectConsistent(b);
    expect(b.adjacencies.slice(0, 2)).toEqual(connections.slice(0, 2));
    // The user said keep kitchen and dining apart, so that isn't overridden.
    expect(b.adjacencies.filter((e) => [e.a, e.b].includes(kitchen.id) && [e.a, e.b].includes(dining.id))).toHaveLength(1);
    const primary = rooms.find((r) => r.type === "primary-bedroom")!;
    const bath = rooms.find((r) => r.type === "primary-bath")!;
    expect(b.adjacencies).toContainEqual({ a: primary.id, b: bath.id, strength: "must" });
  });

  it("adds kitchen and dining when the user didn't connect them", () => {
    const b = buildRuleBrief(ctx({ rooms: typical() }));
    const [kitchen, dining] = b.rooms;
    expect(b.adjacencies).toContainEqual({ a: kitchen.id, b: dining.id, strength: "must" });
  });

  it("reads the feel for vibe words and priorities", () => {
    const b = buildRuleBrief(ctx({ rooms: typical(), feel: "Cozy and bright, lots of wood. We host big dinners." }));
    expect(b.vibe).toEqual(expect.arrayContaining(["Cozy", "Bright and sunny", "Natural materials"]));
    expect(b.priorities[0]).toBe("Room to host and entertain");
    expect(b.freeText).toBe("Cozy and bright, lots of wood. We host big dinners.");
    expect(b.openKitchen).toBe(true);
    expect(buildRuleBrief(ctx({ rooms: typical(), feel: "A closed kitchen please" })).openKitchen).toBe(false);
  });

  it("suggests a walkout when there's a basement on sloped land", () => {
    const hill = sloped(9, 14);
    const b = buildRuleBrief(ctx({ rooms: typical(), floorsBelow: 1 }, { plot: hill }));
    expect(b.priorities.some((p) => p.startsWith("Walkout basement"))).toBe(true);
    expect(buildRuleBrief(ctx({ rooms: typical() }, { plot: hill })).priorities.some((p) => p.startsWith("Walkout"))).toBe(false);
  });

  it("flags essentials that are missing without adding rooms", () => {
    const rooms = [room("kitchen"), room("bedroom")];
    const b = buildRuleBrief(ctx({ rooms }));
    expect(b.rooms).toHaveLength(2);
    expect(b.summary).toMatch(/Heads up: there are bedrooms but no full bathroom/);
    expect(missingEssentials([{ type: "living" }])).toEqual(["there's no kitchen yet", "there's no bathroom yet"]);
    expect(missingEssentials(typical())).toEqual([]);
  });

  it("totals living space with room for halls and walls", () => {
    const t = briefTotals(buildRuleBrief(ctx({ rooms: [room("kitchen", { lengthIn: 240, widthIn: 120 }), room("garage")], garageCars: 2 })));
    expect(t.rooms).toBe(200);
    expect(t.heated).toBe(230);
    expect(t.garage).toBe(GARAGE_SQFT[2]);
  });
});

describe("levels", () => {
  it("makes levels for 5 floors up and 3 down", () => {
    const levels = levelsFor(5, 3);
    expect(levels.map((l) => l.id)).toEqual([
      "basement-3",
      "basement-2",
      "basement-1",
      "floor-1",
      "floor-2",
      "floor-3",
      "floor-4",
      "floor-5",
    ]);
    expect(levels.map((l) => l.name)).toEqual([
      "Deep basement",
      "Lower basement",
      "Basement",
      "Main floor",
      "Second floor",
      "Third floor",
      "Fourth floor",
      "Fifth floor",
    ]);
    const elevations = levels.map((l) => l.elevationIn);
    expect(elevations).toEqual([...elevations].sort((a, b) => a - b));
    expect(levels.find((l) => l.id === "floor-1")?.elevationIn).toBe(0);
    expect(levels.find((l) => l.id === "basement-1")?.kind).toBe("basement");
    expect(levelIdsFor(1, 0)).toEqual(["floor-1"]);
  });

  it("moves rooms off floors that were taken away", () => {
    const allowed = levelIdsFor(2, 1);
    expect(nearestLevel("floor-4", allowed)).toBe("floor-2");
    expect(nearestLevel("basement-3", allowed)).toBe("basement-1");
    expect(nearestLevel("basement-2", levelIdsFor(1, 0))).toBe("floor-1");
    expect(nearestLevel(undefined, allowed)).toBe("floor-1");
  });

  it("matches the project's levels to the brief", () => {
    const project = createProject("Test");
    const brief = buildRuleBrief(ctx({ rooms: typical(), floorsAbove: 2, floorsBelow: 1 }));
    expect(syncLevels(project.levels, brief).map((l) => l.id)).toEqual(["basement-1", "floor-1", "floor-2"]);
    const one = buildRuleBrief(ctx({ rooms: typical() }));
    expect(syncLevels(project.levels, one).map((l) => l.id)).toEqual(["floor-1"]);
  });

  it("keeps a loft one story above the top floor when floors are added", () => {
    const one = buildRuleBrief(ctx({ rooms: typical() }));
    const loft = { id: "loft-a", name: "Loft", kind: "loft" as const, elevationIn: 126 };
    const two = buildRuleBrief(ctx({ rooms: typical(), floorsAbove: 2 }));
    const levels = syncLevels([...syncLevels(createProject("T").levels, one), loft], two);
    expect(levels.map((l) => [l.id, l.elevationIn])).toEqual([["floor-1", 0], ["floor-2", 126], ["loft-a", 252]]);
    expect(syncLevels(levels, one).find((l) => l.id === "loft-a")!.elevationIn).toBe(126);
  });
});

describe("opening projects saved before the rooms page", () => {
  const emptyDiagram = { bubbles: [], flows: [], strokes: [], notes: [] };

  /** A project as the app saved it before this change. */
  function versionOne() {
    const p = createProject("Old house") as Record<string, unknown>;
    return JSON.parse(
      JSON.stringify({
        ...p,
        schemaVersion: 1,
        levels: [
          { id: "basement", name: "Basement", kind: "basement", elevationIn: -108 },
          { id: "main", name: "Main floor", kind: "main", elevationIn: 0 },
          { id: "upper", name: "Upper floor", kind: "upper", elevationIn: 120 },
        ],
        discovery: {
          answers: { bedrooms: 4, floors: 2, basement: "yes", cozyAiry: 80, dailyRoutine: "Coffee on the porch" },
          followUps: [{ id: "x", question: "Host often?", options: [], answer: "Yes" }],
        },
        bubbles: { main: emptyDiagram, upper: emptyDiagram },
        brief: {
          rooms: [
            { id: "kitchen", type: "kitchen", name: "Kitchen", targetSqFt: 220, levelId: "main" },
            { id: "primary-bedroom", type: "primary-bedroom", name: "Primary bedroom", targetSqFt: 240, levelId: "upper" },
            { id: "media", type: "media", name: "Media room", targetSqFt: 300, levelId: "basement", notes: "Big screen" },
          ],
          adjacencies: [{ a: "kitchen", b: "media", strength: "nice" }],
          floors: 2,
          basement: true,
          garageBays: 2,
          openKitchen: true,
          primarySuiteLevel: "upper",
          vibe: ["Warm"],
          priorities: [],
          accessibility: [],
          summary: "My edited summary",
          source: "ai",
        },
      }),
    );
  }

  it("keeps the brief and renames the floors", () => {
    const p = migrateProject(versionOne());
    expect(p.schemaVersion).toBe(SCHEMA_VERSION);
    expect(p.levels.map((l) => l.id)).toEqual(["basement-1", "floor-1", "floor-2"]);
    expect(p.levels.map((l) => l.name)).toEqual(["Basement", "Main floor", "Second floor"]);
    expect(Object.keys(p.bubbles)).toEqual(["floor-1", "floor-2"]);
    const brief = p.brief!;
    expect(brief.floorsBelow).toBe(1);
    expect("basement" in brief).toBe(false);
    expect(brief.summary).toBe("My edited summary");
    expect(brief.primarySuiteLevel).toBe("floor-2");
    expect(brief.rooms.map((r) => r.levelId)).toEqual(["floor-1", "floor-2", "basement-1"]);
    expect(brief.rooms[2].notes).toBe("Big screen");
    expectConsistent(brief);
  });

  it("starts the rooms page fresh", () => {
    const p = migrateProject(versionOne());
    expect(p.discovery.answers).toEqual(DiscoveryAnswers.parse({}));
    expect("followUps" in p.discovery).toBe(false);
  });

  it("opens an old project that never had a brief", () => {
    const old = versionOne();
    delete old.brief;
    delete old.discovery;
    const p = migrateProject(old);
    expect(p.brief).toBeFalsy();
    expect(p.discovery.answers.rooms).toEqual([]);
    expect(p.discovery.answers.floorsAbove).toBe(1);
  });
});

describe("sizes that fit the household", () => {
  const size = (b: DesignBrief, type: string) => b.rooms.find((r) => r.type === type)!.targetSqFt;

  it("scales shared rooms with the number of people, inside each room type's limits", () => {
    expect(householdFactor(2)).toBe(0.85);
    expect(householdFactor(4)).toBe(1);
    expect(householdFactor(6)).toBeCloseTo(1.12);
    const rooms = typical();
    const four = buildRuleBrief(ctx({ rooms }, { profile: { ...profile, adults: 2, kids: 2 } }));
    const six = buildRuleBrief(ctx({ rooms }, { profile: { ...profile, adults: 2, kids: 4 } }));
    const two = buildRuleBrief(ctx({ rooms }, { profile: { ...profile, adults: 2 } }));
    expect(size(four, "living")).toBe(roomType("living").sqft);
    expect(size(six, "living")).toBe(Math.round((roomType("living").sqft * 1.12) / 5) * 5);
    expect(size(two, "kitchen")).toBe(Math.round((roomType("kitchen").sqft * 0.85) / 5) * 5);
    // Bedrooms and baths don't change with the head count.
    expect(size(six, "bedroom")).toBe(roomType("bedroom").sqft);
    const crowd = buildRuleBrief(ctx({ rooms }, { profile: { ...profile, adults: 20, kids: 20 } }));
    expect(size(crowd, "dining")).toBe(roomType("dining").max);
  });

  it("counts people from the bedrooms when the profile doesn't say", () => {
    const s = householdSizing({ rooms: typical() }, profile);
    expect(s.guessed).toBe(true);
    expect(s.people).toBe(typical().filter((r) => r.type === "bedroom").length + 2);
    expect(sizingNote({ rooms: typical() }, profile)).toMatch(/counted from the bedrooms/);
  });

  it("fits the rooms to the size the budget pays for, never below 110 sq ft for a bedroom", () => {
    const rooms = typical();
    const plain = buildRuleBrief(ctx({ rooms }));
    const tight = buildRuleBrief(ctx({ rooms }, { profile: { ...profile, budget: { high: 150_000 } } }));
    const roomy = buildRuleBrief(ctx({ rooms }, { profile: { ...profile, budget: { high: 750_000 } } }));
    const target = householdSizing({ rooms }, { ...profile, budget: { high: 150_000 } }).targetSqft!;
    expect(target).toBeGreaterThan(800);
    expect(briefTotals(tight).heated).toBeLessThan(briefTotals(plain).heated);
    expect(briefTotals(roomy).heated).toBeGreaterThan(briefTotals(plain).heated);
    for (const r of tight.rooms.filter((x) => x.type === "bedroom")) expect(r.targetSqFt).toBeGreaterThanOrEqual(110);
    expect(sizingNote({ rooms }, { ...profile, adults: 2, kids: 3, budget: { high: 150_000 } })).toBe(`Sizes fit 5 people and about ${target.toLocaleString("en-US")} sq ft. Rooms you gave a size keep it.`);
  });

  it("never changes a size the user typed", () => {
    const rooms = [room("living", { lengthIn: 240, widthIn: 180 }), room("kitchen"), room("bedroom")];
    const b = buildRuleBrief(ctx({ rooms }, { profile: { ...profile, adults: 6, kids: 4, budget: { high: 200_000 } } }));
    expect(size(b, "living")).toBe(300);
    expect(sizingNote({ rooms: [room("living", { lengthIn: 240, widthIn: 180 })] }, profile)).toBeNull();
  });
});
