import Dexie, { type EntityTable, type Table } from "dexie";
import { migrateProject } from "@/lib/model/project";
import type { Project } from "@/lib/model/schema";

/** Projects are saved in the browser's IndexedDB under the name "house-design-app". */
class HouseDb extends Dexie {
  projects!: EntityTable<Project, "id">;
  /** Earlier and later versions of each project, for undo and redo after reopening it. */
  history!: Table<HistoryRow, [string, number]>;
  /** Where each project's undo history is up to. */
  historyMeta!: EntityTable<HistoryMeta, "projectId">;

  constructor() {
    super("house-design-app");
    this.version(1).stores({ projects: "id, updatedAt, name" });
    this.version(2).stores({ history: "[projectId+n], projectId", historyMeta: "projectId" });
  }
}

/** One saved version of a project. Versions are numbered in order; `n` only grows. */
export type HistoryRow = { projectId: string; n: number; project: Project };
/** The version that's open now (`current`), and the saved range around it. */
export type HistoryMeta = { projectId: string; current: number; first: number; last: number };

let db: HouseDb | null = null;
function getDb(): HouseDb {
  db ??= new HouseDb();
  return db;
}

export type ProjectSummary = Pick<Project, "id" | "name" | "createdAt" | "updatedAt" | "stage">;

export async function listProjects(): Promise<ProjectSummary[]> {
  const all = await getDb().projects.orderBy("updatedAt").reverse().toArray();
  return all.map(({ id, name, createdAt, updatedAt, stage }) => ({
    id,
    name,
    createdAt,
    updatedAt,
    stage,
  }));
}

export async function loadProject(id: string): Promise<Project | null> {
  const raw = await getDb().projects.get(id);
  return raw ? migrateProject(raw) : null;
}

export async function saveProject(project: Project): Promise<void> {
  await getDb().projects.put(project);
}

export async function deleteProject(id: string): Promise<void> {
  const d = getDb();
  await d.transaction("rw", d.projects, d.history, d.historyMeta, async () => {
    await d.projects.delete(id);
    await d.history.where("projectId").equals(id).delete();
    await d.historyMeta.delete(id);
  });
}

/**
 * A project's saved undo history, oldest first, with the open version's
 * place in it. Versions that no longer load (from an older app) are left out.
 */
export async function loadHistory(id: string): Promise<{ versions: HistoryRow[]; meta: HistoryMeta } | null> {
  const d = getDb();
  const meta = await d.historyMeta.get(id);
  if (!meta) return null;
  const rows = await d.history.where("[projectId+n]").between([id, meta.first], [id, meta.last], true, true).toArray();
  const versions: HistoryRow[] = [];
  for (const row of rows) {
    try {
      versions.push({ ...row, project: migrateProject(row.project) });
    } catch {
      // Too old to open; undo stops here.
    }
  }
  return { versions, meta };
}

/**
 * Save changes to a project's undo history: write the versions in `put`
 * (new ones, or the open one after a change) and drop everything outside
 * meta.first to meta.last.
 */
export async function saveHistory(meta: HistoryMeta, put: HistoryRow[]): Promise<void> {
  const d = getDb();
  const id = meta.projectId;
  await d.transaction("rw", d.history, d.historyMeta, async () => {
    await d.history.where("[projectId+n]").between([id, Dexie.minKey], [id, meta.first], true, false).delete();
    await d.history.where("[projectId+n]").between([id, meta.last], [id, Dexie.maxKey], false, true).delete();
    if (put.length) await d.history.bulkPut(put);
    await d.historyMeta.put(meta);
  });
}

export async function projectExists(id: string): Promise<boolean> {
  return (await getDb().projects.get(id)) !== undefined;
}
