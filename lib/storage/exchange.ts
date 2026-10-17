import { migrateProject, newId, withSuffix } from "@/lib/model/project";
import type { Project } from "@/lib/model/schema";

/** Export/import file format. The wrapper lets us recognize our own files. */
const FILE_KIND = "house-design-app/project";
/** One file holding every house. */
const ALL_KIND = "house-design-app/all";

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

export function exportAllJson(projects: Project[]): string {
  return JSON.stringify({ kind: ALL_KIND, exportedAt: new Date().toISOString(), projects }, null, 2);
}

export function exportAllFileName(date = new Date()): string {
  return `all-houses-${date.toISOString().slice(0, 10)}.houses.json`;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
}

/** Check one exported project and give it a fresh id if `takenIds` has its id. */
function readProject(raw: unknown, takenIds: Set<string>): Project {
  let project: Project;
  try {
    project = migrateProject(raw);
  } catch (e) {
    if (e instanceof Error && e.message.includes("newer version")) throw e;
    throw new Error("That project file is damaged or incomplete.");
  }
  if (takenIds.has(project.id)) {
    project = { ...project, id: newId(), name: withSuffix(project.name, " (imported)") };
  }
  return project;
}

/**
 * Read a file of one house or of every house ("Export all houses"). Houses
 * that don't read are counted in `skipped`; it throws only when none do.
 * Ids already in `takenIds` (or earlier in the file) get fresh ones.
 */
export function importAnyJson(text: string, takenIds: Set<string> = new Set()): { projects: Project[]; skipped: number } {
  const data = parseJson(text) as { kind?: unknown; projects?: unknown };
  if (data?.kind !== ALL_KIND) return { projects: [importProjectJson(text, takenIds)], skipped: 0 };
  if (!Array.isArray(data.projects)) throw new Error("That file is damaged or incomplete.");
  const taken = new Set(takenIds);
  const projects: Project[] = [];
  let skipped = 0;
  let firstError: Error | null = null;
  for (const raw of data.projects) {
    try {
      const p = readProject(raw, taken);
      taken.add(p.id);
      projects.push(p);
    } catch (e) {
      skipped++;
      firstError ??= e as Error;
    }
  }
  if (!projects.length && firstError) throw firstError;
  return { projects, skipped };
}

/**
 * Read an exported file. Throws an Error with a friendly message if it isn't
 * a valid project. If `takenIds` already contains the project id, the import
 * gets a fresh id so it never overwrites an existing project.
 */
export function importProjectJson(text: string, takenIds: Set<string> = new Set()): Project {
  const wrapper = parseJson(text) as { kind?: unknown; project?: unknown };
  if (!wrapper || wrapper.kind !== FILE_KIND || !wrapper.project) {
    throw new Error("That file isn't a House Design App project export.");
  }
  return readProject(wrapper.project, takenIds);
}
