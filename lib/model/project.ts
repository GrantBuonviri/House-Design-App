import { LEGACY_LEVEL_IDS, MAIN_LEVEL_ID, levelFor } from "@/lib/brief/levels";
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
    levels: [levelFor(MAIN_LEVEL_ID)],
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
  const migrated = version < 2 ? migrateV1(data) : data;
  // Version 2 to 3 added drawn room shapes and saved sketch settings. Both
  // are optional with defaults, so older data needs no changes.
  return Project.parse({ ...migrated, schemaVersion: SCHEMA_VERSION });
}

export function duplicateProject(p: Project): Project {
  const now = new Date().toISOString();
  return { ...structuredClone(p), id: newId(), name: `${p.name} (copy)`, createdAt: now, updatedAt: now };
}

type Raw = Record<string, unknown>;

/**
 * Version 1 to 2: the rooms page replaced the old questions, and levels are
 * made from floor counts. Old level ids are renamed, an existing brief is
 * kept, and the old question answers go back to defaults.
 */
function migrateV1(data: Raw): Raw {
  const id = (old: unknown) => (typeof old === "string" ? (LEGACY_LEVEL_IDS[old] ?? old) : old);
  const rekey = (rec: unknown) =>
    rec && typeof rec === "object" ? Object.fromEntries(Object.entries(rec).map(([k, v]) => [id(k), v])) : rec;

  const out: Raw = { ...data, discovery: {} };
  if (Array.isArray(data.levels)) {
    out.levels = (data.levels as Raw[]).map((l) => {
      const next = id(l.id) as string;
      return Object.values(LEGACY_LEVEL_IDS).includes(next) ? { ...l, ...levelFor(next) } : l;
    });
  }
  out.bubbles = rekey(data.bubbles);
  out.floorPlans = rekey(data.floorPlans);
  const brief = data.brief as Raw | null | undefined;
  if (brief && typeof brief === "object") {
    const { basement, ...rest } = brief;
    out.brief = {
      ...rest,
      floorsBelow: basement ? 1 : 0,
      primarySuiteLevel: id(brief.primarySuiteLevel),
      rooms: Array.isArray(brief.rooms) ? (brief.rooms as Raw[]).map((r) => ({ ...r, levelId: id(r.levelId) })) : brief.rooms,
    };
  }
  return out;
}
