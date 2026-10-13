import { describe, expect, it } from "vitest";
import { DiscoveryAnswers, SCHEMA_VERSION, type ChosenRoom, type DesignBrief, type Profile } from "@/lib/model/schema";
import { createProject, migrateProject } from "@/lib/model/project";
import { FLAT_PLOT_SEED, generatePlot } from "@/lib/land/generate";
import { buildRuleBrief, briefTotals, missingEssentials, type BriefContext } from "@/lib/brief/rules";
import { briefFromAi, type AiBrief } from "@/lib/brief/ai";
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

describe("merging Claude's brief", () => {
  const rooms = [
    room("kitchen", { lengthIn: 180, widthIn: 144, description: "Island" }),
    room("dining"),
    room("bedroom", { levelId: "floor-1" }),
    room("media"),
    room("bathroom"),
  ];
  const c = ctx({ rooms, floorsAbove: 2, floorsBelow: 1, connections: [{ a: rooms[1].id, b: rooms[2].id, strength: "avoid" }] });
  const draft = buildRuleBrief(c);
  const ai = (over: Partial<AiBrief> = {}): AiBrief => ({
    summary: "A calm house.",
    rooms: rooms.map((r) => ({ id: r.id, sqft: 200, level: "floor-2", notes: "From Claude" })),
    connections: [],
    openKitchen: false,
    vibe: ["Calm", "calm ", "Warm"],
    priorities: ["Quiet bedrooms"],
    accessibility: [],
    ...over,
  });

  it("keeps the user's rooms, sizes, floors and descriptions", () => {
    const b = briefFromAi(ai(), draft, rooms);
    expectConsistent(b);
    expect(b.source).toBe("ai");
    expect(b.rooms.map((r) => r.id)).toEqual(rooms.map((r) => r.id));
    expect(b.rooms.map((r) => r.name)).toEqual(draft.rooms.map((r) => r.name));
    expect(b.rooms[0]).toMatchObject({ targetSqFt: 180, notes: "Island" });
    expect(b.rooms[2].levelId).toBe("floor-1");
    // Rooms left to Claude take its size, floor and note.
    expect(b.rooms[1]).toMatchObject({ targetSqFt: 200, levelId: "floor-2", notes: "From Claude" });
    expect(b.vibe).toEqual(["Calm", "Warm"]);
    expect(b.openKitchen).toBe(false);
    expect(b.summary).toBe("A calm house.");
  });

  it("ignores rooms Claude made up, floors that don't exist and silly sizes", () => {
    const answer = ai({
      rooms: [
        { id: rooms[1].id, sqft: 9000, level: "floor-5", notes: "" },
        { id: rooms[3].id, sqft: 1, level: "basement-1", notes: "" },
        { id: "invented", sqft: 300, level: "floor-1", notes: "A spa" },
      ],
    });
    const b = briefFromAi(answer, draft, rooms);
    expectConsistent(b);
    expect(b.rooms).toHaveLength(rooms.length);
    expect(b.rooms[1].targetSqFt).toBe(roomType("dining").max);
    expect(b.rooms[1].levelId).toBe(draft.rooms[1].levelId);
    expect(b.rooms[3]).toMatchObject({ targetSqFt: roomType("media").min, levelId: "basement-1" });
    // Rooms Claude skipped keep the draft's values.
    expect(b.rooms[4]).toEqual(draft.rooms[4]);
  });

  it("keeps a garage sized for its number of cars", () => {
    const withGarage = [...rooms, room("garage")];
    const d = buildRuleBrief(ctx({ rooms: withGarage, garageCars: 3 }));
    const b = briefFromAi(ai({ rooms: [{ id: withGarage.at(-1)!.id, sqft: 480, level: "floor-1", notes: "" }] }), d, withGarage);
    expect(b.rooms.at(-1)?.targetSqFt).toBe(GARAGE_SQFT[3]);
  });

  it("adds Claude's connections on top of the user's, never replacing them", () => {
    const [kitchen, dining, bedroom, media] = rooms;
    const answer = ai({
      connections: [
        { a: bedroom.id, b: dining.id, strength: "must" },
        { a: media.id, b: bedroom.id, strength: "avoid" },
        { a: media.id, b: "nowhere", strength: "nice" },
        { a: kitchen.id, b: kitchen.id, strength: "must" },
      ],
    });
    const b = briefFromAi(answer, draft, rooms);
    expectConsistent(b);
    expect(b.adjacencies.slice(0, draft.adjacencies.length)).toEqual(draft.adjacencies);
    expect(b.adjacencies[0]).toEqual({ a: dining.id, b: bedroom.id, strength: "avoid" });
    expect(b.adjacencies.slice(draft.adjacencies.length)).toEqual([{ a: media.id, b: bedroom.id, strength: "avoid" }]);
  });

  it("makes sure missing essentials are mentioned", () => {
    const noBath = rooms.filter((r) => r.type !== "bathroom");
    const d = buildRuleBrief(ctx({ rooms: noBath }));
    expect(briefFromAi(ai(), d, noBath).summary).toBe("A calm house. Heads up: there are bedrooms but no full bathroom.");
    expect(briefFromAi(ai({ summary: "Note: no bathroom yet." }), d, noBath).summary).toBe("Note: no bathroom yet.");
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
