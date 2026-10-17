import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { DiscoveryAnswers } from "@/lib/model/schema";
import { createProject } from "@/lib/model/project";
import { BUILT_IN_STARTS, SavedStart, allStarts, cleanStartName, startFromAnswers, startPatch } from "@/lib/brief/starts";
import { buildRuleBrief } from "@/lib/brief/rules";
import { levelIdsFor } from "@/lib/brief/levels";
import { deleteStart, listStarts, renameStart, saveStart } from "@/lib/storage/db";
import { exportAllJson, importAnyJson } from "@/lib/storage/exchange";

const base = () => DiscoveryAnswers.parse({});

describe("built-in quick starts", () => {
  it("each fills floors and rooms, with sizes left blank and connections pointing at its rooms", () => {
    for (const s of BUILT_IN_STARTS) {
      const patch = startPatch(s.answers);
      const ids = new Set(patch.rooms!.map((r) => r.id));
      expect(ids.size).toBe(s.answers.rooms.length);
      expect(patch.rooms!.every((r) => !r.lengthIn && !r.widthIn && !r.sqft)).toBe(true);
      expect(patch.connections!.length).toBeGreaterThan(0);
      expect(patch.connections!.every((e) => ids.has(e.a) && ids.has(e.b))).toBe(true);
      const allowed = levelIdsFor(patch.floorsAbove!, patch.floorsBelow!);
      expect(patch.rooms!.every((r) => !r.levelId || allowed.includes(r.levelId))).toBe(true);
      const brief = buildRuleBrief({ answers: { ...base(), ...patch } as DiscoveryAnswers, profile: { mustHaves: [], dislikes: [] }, plot: null });
      expect(brief.rooms).toHaveLength(s.answers.rooms.length);
    }
  });

  it("gives new room ids every time, and leaves the feel and priorities alone", () => {
    const ranch = BUILT_IN_STARTS[0].answers;
    const a = startPatch(ranch);
    const b = startPatch(ranch);
    expect(a.rooms![0].id).not.toBe(b.rooms![0].id);
    expect(a).not.toHaveProperty("feel");
    expect(a).not.toHaveProperty("priorities");
    expect(BUILT_IN_STARTS.map((s) => s.name)).toEqual(["3-bed ranch", "4-bed two-story", "Small cabin"]);
  });
});

describe("saved quick starts", () => {
  const mine = (): DiscoveryAnswers => ({
    ...base(),
    floorsAbove: 2,
    feel: "Warm and quiet",
    priorities: ["sun"],
    accessible: true,
    openKitchen: false,
    rooms: [
      { id: "k", type: "kitchen", name: "Kitchen", description: "Big island", lengthIn: 168, widthIn: 144, levelId: "floor-1" },
      { id: "d", type: "dining", name: "Dining", description: "" },
    ],
    connections: [{ a: "k", b: "d", strength: "must" }],
  });

  it("keeps what was typed and applies it with new ids", () => {
    const saved = startFromAnswers(mine());
    expect(saved).toMatchObject({ floorsAbove: 2, feel: "Warm and quiet", priorities: ["sun"], accessible: true, openKitchen: false });
    const patch = startPatch(saved);
    expect(patch.rooms![0]).toMatchObject({ name: "Kitchen", description: "Big island", lengthIn: 168, widthIn: 144, levelId: "floor-1" });
    expect(patch.rooms![0].id).not.toBe("k");
    expect(patch.connections![0]).toMatchObject({ a: patch.rooms![0].id, b: patch.rooms![1].id, strength: "must" });
    expect(patch.feel).toBe("Warm and quiet");
  });

  it("saves, lists newest first, renames and deletes", async () => {
    const a: SavedStart = { id: "s1", name: "Lake cabin", updatedAt: "2026-01-01T00:00:00.000Z", answers: startFromAnswers(mine()) };
    const b: SavedStart = { id: "s2", name: "Town house", updatedAt: "2026-02-01T00:00:00.000Z", answers: startFromAnswers(mine()) };
    await saveStart(a);
    await saveStart(b);
    expect((await listStarts()).map((s) => s.name)).toEqual(["Town house", "Lake cabin"]);
    expect(allStarts(await listStarts()).map((s) => s.name).slice(3)).toEqual(["Town house", "Lake cabin"]);
    await renameStart("s1", "Lake house", new Date("2026-03-01T00:00:00Z"));
    expect((await listStarts())[0].name).toBe("Lake house");
    await deleteStart("s1");
    await deleteStart("s2");
    expect(await listStarts()).toEqual([]);
  });

  it("goes out with Export all houses and comes back in on import", () => {
    const start: SavedStart = { id: "s9", name: "Mine", updatedAt: "2026-01-01T00:00:00.000Z", answers: startFromAnswers(mine()) };
    const text = exportAllJson([createProject("A")], [start]);
    const back = importAnyJson(text);
    expect(back.projects).toHaveLength(1);
    expect(back.starts).toEqual([start]);
    // Files from before saved starts, and broken starts, are fine.
    const old = JSON.parse(text);
    delete old.starts;
    expect(importAnyJson(JSON.stringify(old)).starts).toEqual([]);
    old.starts = [{ id: "x" }, start];
    expect(importAnyJson(JSON.stringify(old)).starts).toEqual([start]);
  });

  it("cleans names", () => {
    expect(cleanStartName("   ")).toBeNull();
    expect(cleanStartName("  Lake  ")).toBe("Lake");
  });
});
