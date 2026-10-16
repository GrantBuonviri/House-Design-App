import { describe, expect, it } from "vitest";
import { FLAT_PLOT_SEED, feedPlotSeed, generatePlot } from "@/lib/land/generate";
import { buildCustomPlot, newCustomLand } from "@/lib/land/custom";
import { createProject, duplicateProject, migrateProject } from "@/lib/model/project";
import { Project, SCHEMA_VERSION } from "@/lib/model/schema";

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
