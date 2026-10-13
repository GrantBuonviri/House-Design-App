import { describe, expect, it } from "vitest";
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
