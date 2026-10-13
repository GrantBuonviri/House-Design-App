import Dexie, { type EntityTable } from "dexie";
import { migrateProject } from "@/lib/model/project";
import type { Project } from "@/lib/model/schema";

/** Projects are saved in the browser's IndexedDB under the name "house-design-app". */
class HouseDb extends Dexie {
  projects!: EntityTable<Project, "id">;

  constructor() {
    super("house-design-app");
    this.version(1).stores({ projects: "id, updatedAt, name" });
  }
}

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
  await getDb().projects.delete(id);
}

export async function projectExists(id: string): Promise<boolean> {
  return (await getDb().projects.get(id)) !== undefined;
}
