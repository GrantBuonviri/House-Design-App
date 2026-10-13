import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createProject } from "@/lib/model/project";
import { deleteProject, listProjects, loadProject, saveProject } from "@/lib/storage/db";
import { exportProjectJson, importProjectJson } from "@/lib/storage/exchange";

describe("IndexedDB save and load", () => {
  it("saves, lists newest first, loads and deletes", async () => {
    const a = { ...createProject("A"), updatedAt: "2026-01-01T00:00:00.000Z" };
    const b = { ...createProject("B"), updatedAt: "2026-02-01T00:00:00.000Z" };
    await saveProject(a);
    await saveProject(b);

    const list = await listProjects();
    expect(list.map((p) => p.name).slice(0, 2)).toEqual(["B", "A"]);

    expect(await loadProject(a.id)).toEqual(a);
    await deleteProject(a.id);
    expect(await loadProject(a.id)).toBeNull();
  });
});

describe("export and import", () => {
  it("round-trips a project", () => {
    const p = createProject("Export me", { dislikes: ["carpet"] });
    expect(importProjectJson(exportProjectJson(p))).toEqual(p);
  });

  it("gives an import a new id when that id is already used", () => {
    const p = createProject("Twin");
    const imported = importProjectJson(exportProjectJson(p), new Set([p.id]));
    expect(imported.id).not.toBe(p.id);
    expect(imported.name).toBe("Twin (imported)");
  });

  it("explains what's wrong with a bad file", () => {
    expect(() => importProjectJson("not json")).toThrow("isn't valid JSON");
    expect(() => importProjectJson('{"hello":1}')).toThrow("isn't a House Design App");
    expect(() =>
      importProjectJson('{"kind":"house-design-app/project","project":{"id":"x"}}'),
    ).toThrow("damaged");
  });
});
