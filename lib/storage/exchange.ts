import { migrateProject, newId, withSuffix } from "@/lib/model/project";
import type { Project } from "@/lib/model/schema";

/** Export/import file format. The wrapper lets us recognize our own files. */
const FILE_KIND = "house-design-app/project";

export function exportProjectJson(project: Project): string {
  return JSON.stringify(
    { kind: FILE_KIND, exportedAt: new Date().toISOString(), project },
    null,
    2,
  );
}

export function exportFileName(project: Project): string {
  const slug = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug || "house"}.house.json`;
}

/**
 * Read an exported file. Throws an Error with a friendly message if it isn't
 * a valid project. If `takenIds` already contains the project id, the import
 * gets a fresh id so it never overwrites an existing project.
 */
export function importProjectJson(text: string, takenIds: Set<string> = new Set()): Project {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  const wrapper = data as { kind?: unknown; project?: unknown };
  if (!wrapper || wrapper.kind !== FILE_KIND || !wrapper.project) {
    throw new Error("That file isn't a House Design App project export.");
  }
  let project: Project;
  try {
    project = migrateProject(wrapper.project);
  } catch (e) {
    if (e instanceof Error && e.message.includes("newer version")) throw e;
    throw new Error("That project file is damaged or incomplete.");
  }
  if (takenIds.has(project.id)) {
    project = { ...project, id: newId(), name: withSuffix(project.name, " (imported)") };
  }
  return project;
}
