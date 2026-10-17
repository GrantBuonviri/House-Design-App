import { describe, expect, it } from "vitest";
import { FLAT_PLOT_SEED, feedPlotSeed, generatePlot } from "@/lib/land/generate";
import { buildCustomPlot, newCustomLand } from "@/lib/land/custom";
import { NAME_MAX, createProject, duplicateProject, migrateProject } from "@/lib/model/project";
import { Project, SCHEMA_VERSION, type DesignBrief } from "@/lib/model/schema";
import { briefFrom, sameBrief } from "@/lib/brief/live";
import { house, RANCH, TWO_STORY } from "./samples";
import { cityById, placeFromCity } from "@/lib/location/cities";

describe("createProject", () => {
  it("makes a valid project with a main floor and the setup stage", () => {
    const p = createProject("  Foothills cabin  ", { adults: 2 });
    expect(Project.safeParse(p).success).toBe(true);
    expect(p.name).toBe("Foothills cabin");
    expect(p.stage).toBe("setup");
    expect(p.levels).toHaveLength(1);
    expect(p.profile.adults).toBe(2);
    expect(p.profile.mustHaves).toEqual([]);
    expect(p.plot).toBeNull();
  });

  it("keeps the owner's name", () => {
    expect(createProject("Cabin", { ownerName: "Grant" }).profile.ownerName).toBe("Grant");
  });

  it("names an unnamed project", () => {
    expect(createProject("   ").name).toBe("Untitled house");
  });

  it("gives every project a unique id", () => {
    expect(createProject("a").id).not.toBe(createProject("a").id);
  });
});

describe("migrateProject", () => {
  it("round-trips a project through JSON", () => {
    const p = createProject("Round trip", { mustHaves: ["pantry"], budget: { low: 400000, high: 600000 } });
    expect(migrateProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it("fills defaults for fields missing in older saves", () => {
    const p = createProject("Old");
    const older: Partial<typeof p> = { ...p };
    delete older.bubbles;
    delete older.floorPlans;
    delete older.plot;
    const migrated = migrateProject(older);
    expect(migrated.bubbles).toEqual({});
    expect(migrated.floorPlans).toEqual({});
    expect(migrated.plot).toBeNull();
  });

  it("turns version 17 plots into made-up plots with no custom land extras", () => {
    const plot = generatePlot(feedPlotSeed(321, 4));
    const { source, custom, features, roads, lanes, ground, rolls, ...v17Plot } = plot;
    void [source, custom, features, roads, lanes, ground, rolls];
    const v17 = { ...createProject("Old land"), schemaVersion: 17, plot: v17Plot };
    const migrated = migrateProject(JSON.parse(JSON.stringify(v17)));
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.plot).toEqual(plot);
    expect(migrated.plot?.source).toBe("made-up");
    const flat = generatePlot(FLAT_PLOT_SEED, { flat: true });
    const { source: s2, custom: c2, features: f2, roads: r2, lanes: l2, ground: g2, rolls: o2, ...v17Flat } = flat;
    void [s2, c2, f2, r2, l2, g2, o2];
    expect(migrateProject({ ...v17, plot: v17Flat }).plot).toEqual(flat);
  });

  it("gives every room on a version 18 plan no overhang", () => {
    const p = createProject("Old rooms");
    const v18 = { ...p, schemaVersion: 18, floorPlans: { "floor-1": { rooms: [{ id: "r", name: "Room", polygon: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] }], walls: [], openings: [], stairs: [], fixtures: [], furniture: [] } } };
    const migrated = migrateProject(JSON.parse(JSON.stringify(v18)));
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.floorPlans["floor-1"].rooms[0].overhang).toBe("none");
  });

  it("fills the overhang label switches on a version 26 project", () => {
    const p = createProject("Old labels");
    const v26 = JSON.parse(JSON.stringify({ ...p, schemaVersion: 26 }));
    for (const k of ["aboveOutlines", "aboveShading", "aboveText", "overhangShading", "overhangText", "overhangColor", "overhangStrength"]) delete v26.plan?.labels?.[k];
    const migrated = migrateProject(v26);
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    expect(JSON.stringify(migrated)).toContain("overhangStrength");
  });

  it("round-trips a custom plot", () => {
    const plot = buildCustomPlot({
      ...newCustomLand("Creek lot"),
      northDeg: 30,
      water: [{ kind: "river", points: [{ x: 0, y: 600 }, { x: 1800, y: 900 }] }],
      features: [{ id: "t", kind: "tree", at: { x: 400, y: 400 }, sizeFt: 30 }],
      ground: [{ id: "g", kind: "flatter", at: { x: 900, y: 1200 }, radiusFt: 40, amount: 1 }],
    });
    const p = { ...createProject("Custom"), plot };
    expect(migrateProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it("refuses projects from a newer app version", () => {
    const p = { ...createProject("Future"), schemaVersion: SCHEMA_VERSION + 1 };
    expect(() => migrateProject(p)).toThrow(/newer version/);
  });

  it("rejects bad data", () => {
    expect(() => migrateProject({ name: "" })).toThrow();
    const p = createProject("Bad");
    expect(() => migrateProject({ ...p, profile: { ...p.profile, adults: -1 } })).toThrow();
  });
});

describe("version 36 houses with their own brief", () => {
  /** A v36 save whose brief was edited on the old brief page, while the rooms page answers stayed as first picked. */
  function v36(p: Project, edit: (b: DesignBrief) => DesignBrief) {
    return JSON.parse(JSON.stringify({ ...p, schemaVersion: 36, brief: edit(p.brief!) }));
  }
  const pair = (b: DesignBrief, ta: string, tb: string) => [b.rooms.find((r) => r.type === ta)!.id, b.rooms.find((r) => r.type === tb)!.id];

  for (const [name, sample, floors] of [["ranch", RANCH, 1], ["two-story", TWO_STORY, 2]] as const) {
    it(`gives back the same brief for the ${name} sample, edits and all`, () => {
      const p = house([...sample], floors);
      expect(sameBrief(briefFrom(migrateProject(v36(p, (b) => b))), p.brief!)).toBe(true);
      const edited = (b: DesignBrief): DesignBrief => {
        const [k, d] = pair(b, "kitchen", b.rooms.some((r) => r.type === "dining") ? "dining" : "family");
        return {
          ...b,
          rooms: b.rooms.map((r, i) => (i === 0 ? { ...r, name: "Front hall", targetSqFt: 95 } : r.type === "garage" ? { ...r, lengthIn: 288, widthIn: 264, targetSqFt: 528 } : r.type === "bathroom" ? { ...r, levelId: "floor-1", notes: "Tub" } : r)),
          adjacencies: [...b.adjacencies.filter((e) => !(e.a === k && e.b === d)), { a: b.rooms[0].id, b: b.rooms[1].id, strength: "avoid" }],
          openKitchen: false,
          priorities: ["Bring in winter light", "Keep the trees for shade and privacy"],
          accessibility: ["wheelchair access"],
          freeText: "Warm and cozy",
        };
      };
      const m = migrateProject(v36(p, edited));
      const a = m.discovery.answers;
      expect(sameBrief(briefFrom(m), edited(p.brief!))).toBe(true);
      expect(a.priorities).toEqual(["sun"]);
      expect(a.accessible).toBe(true);
      expect(a.feel).toBe("Warm and cozy");
      expect(a.openKitchen).toBe(false);
      expect(a.rooms[0]).toMatchObject({ name: "Front hall", sqft: 95 });
      expect(a.rooms.find((r) => r.type === "bathroom")).toMatchObject({ description: "Tub" });
      expect(a.removedConnections).toHaveLength(1);
      // The saved brief stays as it was until the next edit works it out again.
      expect(m.brief?.freeText).toBe("Warm and cozy");
    });
  }

  it("leaves sizes and floors to the app where the brief had the app's picks", () => {
    const m = migrateProject(v36(house([...RANCH]), (b) => b));
    expect(m.discovery.answers.rooms.every((r) => r.sqft === undefined && r.levelId === undefined)).toBe(true);
  });

  it("opens houses with no brief as before", () => {
    const p = createProject("No brief");
    expect(migrateProject(JSON.parse(JSON.stringify({ ...p, schemaVersion: 36 }))).discovery.answers.rooms).toEqual([]);
  });
});

describe("duplicateProject", () => {
  it("copies everything except id, name and dates", () => {
    const p = createProject("Original", { pets: "dog" });
    const d = duplicateProject(p);
    expect(d.id).not.toBe(p.id);
    expect(d.name).toBe("Original (copy)");
    expect(d.profile).toEqual(p.profile);
    d.profile.mustHaves.push("x");
    expect(p.profile.mustHaves).toEqual([]);
  });
});

describe("houses that would not open", () => {
  it("keeps a long name within the limit when duplicating", () => {
    const p = createProject("x".repeat(NAME_MAX));
    const copy = duplicateProject(p);
    expect(copy.name.length).toBeLessThanOrEqual(NAME_MAX);
    expect(copy.name.endsWith(" (copy)")).toBe(true);
    expect(() => Project.parse(copy)).not.toThrow();
  });

  it("puts a place number saved out of range back to the place's own number", () => {
    const p = { ...createProject("T"), location: placeFromCity(cityById("denver-co")!) };
    const bad = { ...p, name: "y".repeat(130), location: { ...p.location, costIndex: 0, windMph: 900, edited: ["costIndex", "windMph", "frostDepthIn"] } };
    const fixed = migrateProject(bad);
    expect(fixed.name.length).toBe(NAME_MAX);
    expect(fixed.location!.costIndex).toBe(p.location.costIndex);
    expect(fixed.location!.windMph).toBe(p.location.windMph);
    expect(fixed.location!.edited).toEqual(["frostDepthIn"]);
  });
});
