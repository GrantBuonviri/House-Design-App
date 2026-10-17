import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createProject, migrateProject } from "@/lib/model/project";
import { describePath, repairProjectData } from "@/lib/model/repair";
import { SCHEMA_VERSION, type Project } from "@/lib/model/schema";
import { loadHistory, loadProject, loadRawProject, repairSavedProject, saveHistory, saveProject } from "@/lib/storage/db";
import { watchOtherTabs } from "@/lib/storage/tabs";
import { house, RANCH } from "./samples";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test data damaged on purpose
type Loose = any;

/** Write raw data straight into the browser's database, the way a bad save would. */
async function putRaw(row: unknown) {
  await saveProject(row as Project);
}

describe("Try to repair", () => {
  it("resets a bad setting to its default and keeps everything else", () => {
    const p = house(RANCH);
    const raw = structuredClone(p) as unknown as Loose;
    raw.plan.basics.exteriorWall = "2x12";
    raw.plan.basics.doorHeightIn = "tall";
    expect(() => migrateProject(raw)).toThrow();
    const { project, reset, removed } = repairProjectData(raw, new Date("2026-10-17T00:00:00Z"));
    expect(project.plan.basics!.exteriorWall).toBe("2x6");
    expect(project.plan.basics!.doorHeightIn).toBe(80);
    expect(reset).toEqual(["plan › basics › exterior wall", "plan › basics › door height in"]);
    expect(removed).toEqual([]);
    expect(project.floorPlans).toEqual(p.floorPlans);
    expect(project.name).toBe(p.name);
    expect(project.id).toBe(p.id);
  });

  it("takes out a broken room but keeps the other rooms", () => {
    const p = house(RANCH);
    const raw = structuredClone(p) as unknown as Loose;
    const rooms = raw.floorPlans["floor-1"].rooms;
    const count = rooms.length;
    rooms[2].polygon = [{ x: 0, y: 0 }];
    rooms[3].polygon = "none";
    const { project, removed } = repairProjectData(raw);
    expect(project.floorPlans["floor-1"].rooms).toHaveLength(count - 2);
    // Both broken rooms sat in the 3rd place by the time they were taken out.
    expect(removed).toEqual(["floor plans › floor-1 › rooms › 3rd", "floor plans › floor-1 › rooms › 3rd"]);
  });

  it("starts from scratch only when nothing reads, keeping the id and name", () => {
    const { project } = repairProjectData({ id: "abc", name: "Odd", schemaVersion: SCHEMA_VERSION, levels: "x", plan: 5, stage: "nowhere" });
    expect(project.id).toBe("abc");
    expect(project.name).toBe("Odd");
    expect(project.stage).toBe("setup");
    expect(repairProjectData(null).project.name).toBe("Repaired house");
  });

  it("won't repair a house saved by a newer app", () => {
    expect(() => repairProjectData({ ...createProject("New"), schemaVersion: SCHEMA_VERSION + 1 })).toThrow(/newer version/);
  });

  it("saves the repaired house, keeps the raw data downloadable before, and drops its undo history", async () => {
    const p = createProject("Broken");
    const raw = { ...p, profile: { ...p.profile, budget: "lots" } };
    await putRaw(raw);
    await saveHistory({ projectId: p.id, current: 0, first: 0, last: 0 }, [{ projectId: p.id, n: 0, project: p }]);
    await expect(loadProject(p.id)).rejects.toThrow();
    expect(await loadRawProject(p.id)).toEqual(raw);
    const result = await repairSavedProject(p.id);
    expect(result!.reset).toEqual(["profile › budget"]);
    expect((await loadProject(p.id))!.profile.budget).toBeUndefined();
    expect(await loadHistory(p.id)).toBeNull();
    expect(await repairSavedProject("missing")).toBeNull();
  });

  it("words paths plainly", () => {
    expect(describePath(["floorPlans", "floor-1", "rooms", 0, "polygon"])).toBe("floor plans › floor-1 › rooms › 1st › polygon");
    expect(describePath(["x", 11, 21, 102])).toBe("x › 12th › 22nd › 103rd");
  });
});

describe("Two-tab warning", () => {
  const settle = () => new Promise((r) => setTimeout(r, 30));

  it("each tab with the house open counts the others, and a closed tab drops out", async () => {
    const a: number[] = [];
    const b: number[] = [];
    const other: number[] = [];
    const stopA = watchOtherTabs("h1", (n) => a.push(n));
    await settle();
    const stopB = watchOtherTabs("h1", (n) => b.push(n));
    const stopOther = watchOtherTabs("h2", (n) => other.push(n));
    await settle();
    expect(a).toEqual([1]);
    expect(b).toEqual([1]);
    stopB();
    await settle();
    expect(a).toEqual([1, 0]);
    expect(other).toEqual([]);
    stopA();
    stopOther();
  });

  it("does nothing without BroadcastChannel", () => {
    const stop = watchOtherTabs("h1", () => {}, () => null);
    expect(() => stop()).not.toThrow();
  });
});
