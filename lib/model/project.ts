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
  let migrated = version < 2 ? migrateV1(data) : data;
  // Version 2 to 3 added drawn room shapes and saved sketch settings. Both
  // are optional with defaults, so older data needs no changes.
  if (version < 4) migrated = migrateV3(migrated);
  // Version 4 to 5 added the 3D house settings (the roof), with defaults.
  // Version 5 to 6 added the cost settings (water and sewer), with defaults.
  // Version 6 to 7 added interior picks per room ("house" for the whole
  // house) and product colors, all optional, so older data needs no changes.
  // Version 7 to 8 added furniture on floor plans and accent wall paint,
  // both optional with defaults, so older data needs no changes.
  // Version 9 to 10 added the building plan details (address, parcel,
  // designer, sheet size), all with defaults.
  // Version 10 to 11 added "My real lot" to the plan details, empty by default.
  // Version 11 to 12 added how each window opens (optional) and cabinet
  // changes on each floor plan (none by default).
  // Version 12 to 13 added the house systems (fuel, foundation, panel) to the
  // plan details, with defaults, and device changes on each floor plan (none).
  // Version 13 to 14 added the structure settings (soil, wind exposure,
  // lumber) to the plan details, with defaults.
  // Version 14 to 15 replaced the floor plan's "show wall lengths" switch with
  // label settings. The old choice carries over.
  if (version < 15) migrated = migrateV14(migrated);
  // Version 15 to 16 added removed walls on each floor plan (none by default).
  if (version < 16) migrated = migrateV15(migrated);
  // Version 16 to 17 added heights to walls drawn on their own (all full height before).
  if (version < 17) migrated = migrateV16(migrated);
  // Version 17 to 18 added custom land: every older plot is a made-up one,
  // with no rocks, trees, extra roads, lanes or ground shapes.
  if (version < 18) migrated = migrateV17(migrated);
  // Version 18 to 19 added how a room hanging past the floor below is held up
  // ("none" by default, so it's still a warning).
  if (version < 19) migrated = migrateV18(migrated);
  // Version 19 to 20 added curved walls (room `bulges`, wall `bulge`). Left out
  // means straight, so older projects need no change beyond the version.
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

/**
 * Version 3 to 4: floor plans became rooms, walls, doors, windows, stairs and
 * fixtures. There was no floor plan editor before, so older floor plans were
 * always empty; start them fresh.
 */
function migrateV3(data: Raw): Raw {
  return { ...data, floorPlans: {} };
}

/** Version 14 to 15: `plan.showDims` became `plan.labels.wallLengths`. */
function migrateV14(data: Raw): Raw {
  const plan = data.plan;
  if (!plan || typeof plan !== "object") return data;
  const { showDims, ...rest } = plan as Raw;
  const labels = (rest.labels && typeof rest.labels === "object" ? rest.labels : {}) as Raw;
  return { ...data, plan: { ...rest, labels: typeof showDims === "boolean" ? { wallLengths: showDims, ...labels } : labels } };
}

/** Version 15 to 16: each floor plan gets an empty list of removed walls. */
function migrateV15(data: Raw): Raw {
  const plans = data.floorPlans;
  if (!plans || typeof plans !== "object") return data;
  return {
    ...data,
    floorPlans: Object.fromEntries(Object.entries(plans as Raw).map(([k, v]) => [k, v && typeof v === "object" ? { openWalls: [], ...(v as Raw) } : v])),
  };
}

/** Version 16 to 17: walls drawn on their own get a height; every older one was full height. */
function migrateV16(data: Raw): Raw {
  const plans = data.floorPlans;
  if (!plans || typeof plans !== "object") return data;
  const withHeight = (v: unknown) => {
    if (!v || typeof v !== "object" || !Array.isArray((v as Raw).walls)) return v;
    return { ...(v as Raw), walls: ((v as Raw).walls as unknown[]).map((w) => (w && typeof w === "object" ? { height: "full", ...(w as Raw) } : w)) };
  };
  return { ...data, floorPlans: Object.fromEntries(Object.entries(plans as Raw).map(([k, v]) => [k, withHeight(v)])) };
}

/** Version 17 to 18: older plots were all made up, with none of the custom land extras. */
function migrateV17(data: Raw): Raw {
  const plot = data.plot;
  if (!plot || typeof plot !== "object") return data;
  return {
    ...data,
    plot: { source: "made-up", custom: null, features: [], roads: [], lanes: [], ground: [], rolls: "gentle", ...(plot as Raw) },
  };
}

/** Version 18 to 19: every room gets "none" for how it hangs over the floor below. */
function migrateV18(data: Raw): Raw {
  const plans = data.floorPlans;
  if (!plans || typeof plans !== "object") return data;
  const withOverhang = (v: unknown) => {
    if (!v || typeof v !== "object" || !Array.isArray((v as Raw).rooms)) return v;
    return { ...(v as Raw), rooms: ((v as Raw).rooms as unknown[]).map((r) => (r && typeof r === "object" ? { overhang: "none", ...(r as Raw) } : r)) };
  };
  return { ...data, floorPlans: Object.fromEntries(Object.entries(plans as Raw).map(([k, v]) => [k, withOverhang(v)])) };
}
