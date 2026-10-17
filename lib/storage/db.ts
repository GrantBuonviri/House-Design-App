import Dexie, { type EntityTable, type Table } from "dexie";
import { migrateProject, newId, withSuffix } from "@/lib/model/project";
import { CustomLand, type Project } from "@/lib/model/schema";

/** Projects are saved in the browser's IndexedDB under the name "house-design-app". */
class HouseDb extends Dexie {
  projects!: EntityTable<Project, "id">;
  /** Earlier and later versions of each project, for undo and redo after reopening it. */
  history!: Table<HistoryRow, [string, number]>;
  /** Where each project's undo history is up to. */
  historyMeta!: EntityTable<HistoryMeta, "projectId">;
  /** "My land": custom plots saved for use in any house. */
  myLand!: EntityTable<MyLandRow, "id">;
  /** Backup copies of each house, kept automatically (the last BACKUPS_KEPT per house). */
  backups!: EntityTable<BackupRow, "id">;
  /** Deleted houses, kept for DELETED_DAYS so they can be restored. */
  deleted!: EntityTable<DeletedRow, "id">;

  constructor() {
    super("house-design-app");
    this.version(1).stores({ projects: "id, updatedAt, name" });
    this.version(2).stores({ history: "[projectId+n], projectId", historyMeta: "projectId" });
    this.version(3).stores({ myLand: "id, updatedAt, name" });
    this.version(4).stores({ backups: "++id, projectId, [projectId+at]", deleted: "id, deletedAt" });
  }
}

/** One saved custom plot: the designer's settings, keyed by their id. */
export type MyLandRow = { id: string; name: string; updatedAt: string; land: CustomLand };

/** One saved version of a project. Versions are numbered in order; `n` only grows. */
export type HistoryRow = { projectId: string; n: number; project: Project };
/** The version that's open now (`current`), and the saved range around it. */
export type HistoryMeta = { projectId: string; current: number; first: number; last: number };

/** Backups kept per house; the oldest go first. */
export const BACKUPS_KEPT = 10;
/** Days a deleted house can still be restored. */
export const DELETED_DAYS = 30;

/** One backup copy of a house. `project` is stored as saved, and checked when it's restored. */
export type BackupRow = { id?: number; projectId: string; at: string; name: string; project: Project };
export type BackupSummary = { id: number; projectId: string; at: string; name: string };
/** A deleted house, its undo history dropped. Its backups stay until it's gone for good. */
export type DeletedRow = { id: string; name: string; deletedAt: string; project: Project };
export type DeletedSummary = Omit<DeletedRow, "project">;

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

/**
 * Delete a house: it moves to Recently deleted for DELETED_DAYS (with its
 * backups), and its undo history is dropped.
 */
export async function deleteProject(id: string, now = new Date()): Promise<void> {
  const d = getDb();
  await d.transaction("rw", [d.projects, d.history, d.historyMeta, d.deleted], async () => {
    const project = await d.projects.get(id);
    if (project) await d.deleted.put({ id, name: project.name, deletedAt: now.toISOString(), project });
    await d.projects.delete(id);
    await d.history.where("projectId").equals(id).delete();
    await d.historyMeta.delete(id);
  });
}

/** Houses deleted in the last DELETED_DAYS, newest first. Older ones are removed for good first. */
export async function listDeleted(now = new Date()): Promise<DeletedSummary[]> {
  const d = getDb();
  const cutoff = new Date(now.getTime() - DELETED_DAYS * 86_400_000).toISOString();
  const old = await d.deleted.where("deletedAt").below(cutoff).primaryKeys();
  for (const id of old) await deleteForever(id);
  const rows = await d.deleted.orderBy("deletedAt").reverse().toArray();
  return rows.map(({ id, name, deletedAt }) => ({ id, name, deletedAt }));
}

/**
 * Put a deleted house back on the home screen. If a house with its id is
 * there again (imported since), it comes back as a copy with a new id.
 */
export async function restoreDeleted(id: string): Promise<Project | null> {
  const d = getDb();
  const row = await d.deleted.get(id);
  if (!row) return null;
  let project = migrateProject(row.project);
  if (await projectExists(id)) project = { ...project, id: newId(), name: withSuffix(project.name, " (restored)") };
  await d.transaction("rw", d.projects, d.deleted, async () => {
    await d.projects.put(project);
    await d.deleted.delete(id);
  });
  return project;
}

/** Remove a deleted house and its backups for good. */
export async function deleteForever(id: string): Promise<void> {
  const d = getDb();
  await d.transaction("rw", [d.deleted, d.backups, d.projects], async () => {
    await d.deleted.delete(id);
    if (!(await d.projects.get(id))) await d.backups.where("projectId").equals(id).delete();
  });
}

/** Keep a backup copy of a house, dropping all but the newest BACKUPS_KEPT. */
export async function saveBackup(project: Project, now = new Date()): Promise<void> {
  const d = getDb();
  await d.transaction("rw", d.backups, async () => {
    await d.backups.add({ projectId: project.id, at: now.toISOString(), name: project.name, project });
    const ids = await d.backups.where("[projectId+at]").between([project.id, Dexie.minKey], [project.id, Dexie.maxKey]).primaryKeys();
    if (ids.length > BACKUPS_KEPT) await d.backups.bulkDelete(ids.slice(0, ids.length - BACKUPS_KEPT));
  });
}

/** A house's backups, newest first. */
export async function listBackups(projectId: string): Promise<BackupSummary[]> {
  const rows = await getDb().backups.where("[projectId+at]").between([projectId, Dexie.minKey], [projectId, Dexie.maxKey]).reverse().toArray();
  return rows.map(({ id, projectId, at, name }) => ({ id: id!, projectId, at, name }));
}

/**
 * Put a backup back as the house's saved version. The version it replaces is
 * kept as a backup first, so a restore can be taken back.
 */
export async function restoreBackup(backupId: number, now = new Date()): Promise<Project | null> {
  const d = getDb();
  const row = await d.backups.get(backupId);
  if (!row) return null;
  const project = { ...migrateProject(row.project), id: row.projectId, updatedAt: now.toISOString() };
  const current = await d.projects.get(row.projectId);
  if (current) await saveBackup(current, now);
  await d.projects.put(project);
  return project;
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

/** Saved custom plots, most recently changed first. Rows that no longer read are left out. */
export async function listMyLand(): Promise<MyLandRow[]> {
  const rows = await getDb().myLand.orderBy("updatedAt").reverse().toArray();
  const out: MyLandRow[] = [];
  for (const row of rows) {
    const land = CustomLand.safeParse(row.land);
    if (land.success) out.push({ ...row, land: land.data });
  }
  return out;
}

/** Save (or update) a custom plot in "My land". */
export async function saveMyLand(land: CustomLand): Promise<MyLandRow> {
  const row: MyLandRow = { id: land.id, name: land.name, updatedAt: new Date().toISOString(), land: CustomLand.parse(land) };
  await getDb().myLand.put(row);
  return row;
}

export async function deleteMyLand(id: string): Promise<void> {
  await getDb().myLand.delete(id);
}
