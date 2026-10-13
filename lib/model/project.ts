import { Project, SCHEMA_VERSION, type Profile } from "./schema";

export function newId(): string {
  return crypto.randomUUID();
}

export function createProject(name: string, profile: Partial<Profile> = {}): Project {
  const now = new Date().toISOString();
  return Project.parse({
    schemaVersion: SCHEMA_VERSION,
    id: newId(),
    name: name.trim() || "Untitled house",
    createdAt: now,
    updatedAt: now,
    stage: "setup",
    profile: { mustHaves: [], dislikes: [], ...profile },
    levels: [{ id: "main", name: "Main floor", kind: "main", elevationIn: 0 }],
    interior: {},
    exterior: {},
  });
}

/**
 * Bring older saved data up to the current schema, then validate it.
 * Each future schema change adds a step here so old projects keep opening.
 */
export function migrateProject(raw: unknown): Project {
  const data = (raw ?? {}) as Record<string, unknown>;
  const version = typeof data.schemaVersion === "number" ? data.schemaVersion : 1;
  if (version > SCHEMA_VERSION) {
    throw new Error(
      `This project was saved by a newer version of the app (format ${version}).`,
    );
  }
  // No migrations yet: version 1 is the first format.
  return Project.parse({ ...data, schemaVersion: SCHEMA_VERSION });
}

export function duplicateProject(p: Project): Project {
  const now = new Date().toISOString();
  return { ...structuredClone(p), id: newId(), name: `${p.name} (copy)`, createdAt: now, updatedAt: now };
}
