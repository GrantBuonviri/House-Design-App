import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { createProject } from "@/lib/model/project";
import {
  BACKUPS_KEPT,
  deleteForever,
  deleteProject,
  listBackups,
  listDeleted,
  listProjects,
  loadProject,
  restoreBackup,
  restoreDeleted,
  saveBackup,
  saveProject,
} from "@/lib/storage/db";
import { exportAllJson, exportProjectJson, importAnyJson } from "@/lib/storage/exchange";
import { BACKUP_MS, useProjectStore } from "@/lib/store/projectStore";

const day = 86_400_000;
/** Run the autosave timer, then wait for the save (IndexedDB runs on real ticks). */
async function settle() {
  await vi.advanceTimersByTimeAsync(1000);
  for (let i = 0; i < 200 && useProjectStore.getState().saveState !== "saved"; i++) await new Promise((r) => setImmediate(r));
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}
const at = (ms: number) => new Date(Date.UTC(2026, 9, 1) + ms);

describe("backups", () => {
  it("keeps the last 10 per house, newest first", async () => {
    const p = createProject("Backed up");
    const other = createProject("Other");
    await saveBackup(other, at(0));
    for (let i = 0; i < BACKUPS_KEPT + 3; i++) await saveBackup({ ...p, name: `v${i}` }, at(i * 60_000));
    const list = await listBackups(p.id);
    expect(list).toHaveLength(BACKUPS_KEPT);
    expect(list[0].name).toBe(`v${BACKUPS_KEPT + 2}`);
    expect(list.at(-1)!.name).toBe("v3");
    expect(await listBackups(other.id)).toHaveLength(1);
  });

  it("restores a backup and keeps the version it replaces as a backup", async () => {
    const p = createProject("Restore me");
    await saveProject({ ...p, name: "Now" });
    await saveBackup({ ...p, name: "Then" }, at(0));
    const [then] = await listBackups(p.id);
    const restored = await restoreBackup(then.id, at(day));
    expect(restored?.name).toBe("Then");
    expect((await loadProject(p.id))?.name).toBe("Then");
    expect((await listBackups(p.id)).map((b) => b.name)).toEqual(["Now", "Then"]);
  });

  it("keeps one when a house is closed after a change, and every 15 minutes of editing", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      const p = createProject("Edited");
      await saveProject(p);
      const store = useProjectStore.getState();
      await store.open(p.id);
      await store.close();
      expect(await listBackups(p.id)).toHaveLength(0); // opened and closed with no change

      await store.open(p.id);
      useProjectStore.getState().update((d) => ({ ...d, name: "Edit 1" }));
      await settle();
      expect(await listBackups(p.id)).toHaveLength(0);
      vi.setSystemTime(Date.now() + BACKUP_MS);
      useProjectStore.getState().update((d) => ({ ...d, name: "Edit 2" }));
      await settle();
      expect((await listBackups(p.id)).map((b) => b.name)).toEqual(["Edit 2"]);

      useProjectStore.getState().update((d) => ({ ...d, name: "Edit 3" }));
      await useProjectStore.getState().close();
      expect((await listBackups(p.id)).map((b) => b.name)).toEqual(["Edit 3", "Edit 2"]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("recently deleted", () => {
  it("moves a deleted house there and restores it", async () => {
    const p = createProject("Oops");
    await saveProject(p);
    await deleteProject(p.id, new Date());
    expect((await listProjects()).some((s) => s.id === p.id)).toBe(false);
    expect((await listDeleted()).map((d) => d.name)).toContain("Oops");
    expect((await restoreDeleted(p.id))?.id).toBe(p.id);
    expect(await loadProject(p.id)).toEqual(p);
    expect((await listDeleted()).some((d) => d.id === p.id)).toBe(false);
  });

  it("removes houses deleted more than 30 days ago, with their backups", async () => {
    const p = createProject("Old");
    await saveProject(p);
    await saveBackup(p, at(0));
    await deleteProject(p.id, at(0));
    expect((await listDeleted(at(29 * day))).some((d) => d.id === p.id)).toBe(true);
    expect((await listDeleted(at(31 * day))).some((d) => d.id === p.id)).toBe(false);
    expect(await listBackups(p.id)).toHaveLength(0);
  });

  it("restores as a copy when that id is in use again, and deletes forever", async () => {
    const p = createProject("Twin");
    await saveProject(p);
    await deleteProject(p.id);
    await saveProject(p); // imported again since
    const copy = await restoreDeleted(p.id);
    expect(copy?.id).not.toBe(p.id);
    expect(copy?.name).toBe("Twin (restored)");

    const q = createProject("Gone");
    await saveProject(q);
    await saveBackup(q);
    await deleteProject(q.id);
    await deleteForever(q.id);
    expect((await listDeleted()).some((d) => d.id === q.id)).toBe(false);
    expect(await listBackups(q.id)).toHaveLength(0);
  });
});

describe("export all houses", () => {
  it("round-trips every house in one file", () => {
    const a = createProject("A");
    const b = createProject("B");
    const { projects, skipped } = importAnyJson(exportAllJson([a, b]));
    expect(projects).toEqual([a, b]);
    expect(skipped).toBe(0);
    expect(JSON.parse(exportAllJson([a])).kind).toBe("house-design-app/all");
  });

  it("gives taken ids new ones, skips damaged houses and still reads one-house files", () => {
    const a = createProject("A");
    const text = JSON.stringify({ kind: "house-design-app/all", projects: [a, { id: "x" }, a] });
    const { projects, skipped } = importAnyJson(text, new Set([a.id]));
    expect(skipped).toBe(1);
    expect(projects).toHaveLength(2);
    expect(new Set(projects.map((p) => p.id)).size).toBe(2);
    expect(projects.every((p) => p.id !== a.id)).toBe(true);
    expect(importAnyJson(exportProjectJson(a)).projects).toEqual([a]);
    expect(() => importAnyJson('{"kind":"house-design-app/all","projects":[{"id":"x"}]}')).toThrow("damaged");
  });
});
