import { LEGACY_LEVEL_IDS, MAIN_LEVEL_ID, levelFor } from "@/lib/brief/levels";
import { cityById, placeFromCity } from "@/lib/location/cities";
import { answersFromBrief } from "@/lib/brief/live";
import { DesignBrief, Discovery, DiscoveryAnswers, LOCATION_FIELDS, Location, Profile, Project, SCHEMA_VERSION, type LocationField } from "./schema";

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
  return Project.parse(migrateRaw(raw));
}

/** The migration steps of `migrateProject`, without the final check. Throws for data from a newer app. */
export function migrateRaw(raw: unknown): Record<string, unknown> {
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
  // Version 20 to 21 added the walkthrough's floor label settings (`house3d.walkLabels`),
  // all with defaults, so older projects need no change beyond the version.
  // Version 21 to 22 added `locked` on doors (left out means unlocked), so the
  // same goes: no change beyond the version.
  // Version 22 to 23 added the 3D Top view's label settings (`house3d.topLabels`), all with
  // defaults, so again no change beyond the version.
  // Version 23 to 24 added `plan.dismissed` (dismissed Things to check, empty by default), so
  // once more no change beyond the version.
  // Version 24 to 25 added Furnish: add-ons on each floor plan, rooms on
  // hand-placed cabinets and devices, hookup kinds, new cabinet kinds, the
  // Furnish stage and the Show furnishings switch. All optional or with
  // defaults, so no change beyond the version.
  // Version 25 to 26 added railing changes on stairs (`railings`, left out
  // means automatic), so no change beyond the version.
  // Version 26 to 27 added the floor above and overhang label switches, color and
  // strength (`plan.labels`, all with defaults), so no change beyond the version.
  // Version 27 to 28 added stair stacks and anchoring (`PlanStairs.stackId`,
  // `PlanStairs.anchored`, `PlanRoom.stairStack`, `PlanRoom.anchored`, all optional), so no change
  // beyond the version.
  // Version 28 to 29 added `house3d.walkLabels.locked` (default off), so no change beyond the version.
  if (version < 30) migrated = migrateV29(migrated);
  // Version 30 to 31 added faucet changes on fixtures (`Fixture.faucet`, optional), so no change beyond the version.
  if (version < 32) migrated = migrateV31(migrated);
  // Version 32 to 33 added pinned tape measurements (`FloorPlan.pins`, optional; `house3d.walkPins`, default none), so no change beyond the version.
  // Version 33 to 34 removed the inside door style (`plan.basics.doorStyle`), which nothing read.
  if (version < 34) migrated = migrateV33(migrated);
  // Version 34 to 35 added saved camera spots in the walkthrough (`house3d.walkViews`, default none), so no change beyond the version.
  // Version 35 to 36 added `RealLot.coverageLimitPct` (optional, empty by default), so no change beyond the version.
  if (version < 37) migrated = migrateV36(migrated);
  return repairProject({ ...migrated, schemaVersion: SCHEMA_VERSION });
}

/**
 * Version 36 to 37: the brief is worked out from the rooms page's answers
 * instead of being a second copy, so edits made on the old brief page are
 * copied back into the answers (rooms with their names, sizes, floors and
 * notes; connections; open kitchen; priorities; accessibility; the feel).
 */
function migrateV36(data: Raw): Raw {
  const brief = DesignBrief.safeParse(data.brief);
  if (!brief.success) return data;
  const discovery = Discovery.safeParse(data.discovery ?? {});
  const prev = discovery.success ? discovery.data.answers : DiscoveryAnswers.parse({});
  const profile = Profile.safeParse(data.profile ?? {});
  const location = Location.safeParse(data.location);
  const answers = answersFromBrief(brief.data, prev, {
    profile: profile.success ? profile.data : Profile.parse({}),
    costIndex: location.success ? location.data.costIndex : undefined,
  });
  return { ...data, discovery: { ...(discovery.success ? discovery.data : {}), answers } };
}

/** Version 33 to 34: drop `plan.basics.doorStyle`. */
function migrateV33(data: Raw): Raw {
  const plan = data.plan as Raw | undefined;
  const basics = plan?.basics as Raw | null | undefined;
  if (!plan || !basics || typeof basics !== "object") return data;
  const { doorStyle: _d, ...rest } = basics;
  void _d;
  return { ...data, plan: { ...plan, basics: rest } };
}

/** The longest house name the saved file allows. */
export const NAME_MAX = 120;

/** `name` with `suffix` added, shortened first so the whole stays within NAME_MAX. */
export function withSuffix(name: string, suffix: string): string {
  return `${name.slice(0, NAME_MAX - suffix.length).trimEnd()}${suffix}`;
}

export function duplicateProject(p: Project): Project {
  const now = new Date().toISOString();
  return { ...structuredClone(p), id: newId(), name: withSuffix(p.name, " (copy)"), createdAt: now, updatedAt: now };
}

/**
 * Fix the few values older versions of the app could save out of range, so
 * the house still opens: a name over NAME_MAX letters, and a place number
 * typed outside its range (it goes back to the place's own number).
 */
function repairProject(data: Raw): Raw {
  const out = { ...data };
  if (typeof out.name === "string" && out.name.length > NAME_MAX) out.name = out.name.slice(0, NAME_MAX);
  const loc = out.location;
  if (!loc || typeof loc !== "object") return out;
  const check = Location.safeParse(loc);
  if (check.success) return out;
  const bad = new Set(check.error.issues.map((i) => i.path[0]).filter((k): k is LocationField => LOCATION_FIELDS.includes(k as LocationField)));
  if (bad.size === 0) return out;
  const raw = loc as Raw;
  const city = typeof raw.cityId === "string" ? cityById(raw.cityId) : undefined;
  const own: Raw = city ? placeFromCity(city) : placeFromCity(cityById("boise-id")!);
  const fixed: Raw = { ...raw };
  for (const k of bad) fixed[k] = own[k];
  if (Array.isArray(raw.edited)) fixed.edited = raw.edited.filter((k) => !bad.has(k as LocationField));
  out.location = fixed;
  return out;
}

type Raw = Record<string, unknown>;

/** Version 29 to 30: projects got a place to build. Older ones were all Boise, so they are set to Boise and nothing changes. */
function migrateV29(data: Raw): Raw {
  return data.location ? data : { ...data, location: placeFromCity(cityById("boise-id")!) };
}

/**
 * Version 31 to 32: stair halls are gone. Rooms lose `stairStack` and
 * `anchored` and become ordinary rooms with the same name, outline, walls,
 * doors and windows. Stairs keep their `stackId` and `anchored`.
 */
function migrateV31(data: Raw): Raw {
  const plans = data.floorPlans;
  if (!plans || typeof plans !== "object") return data;
  const plain = (r: unknown) => {
    if (!r || typeof r !== "object") return r;
    const { stairStack: _s, anchored: _a, ...rest } = r as Raw;
    void _s;
    void _a;
    return rest;
  };
  const fix = (v: unknown) => (v && typeof v === "object" && Array.isArray((v as Raw).rooms) ? { ...(v as Raw), rooms: ((v as Raw).rooms as unknown[]).map(plain) } : v);
  return { ...data, floorPlans: Object.fromEntries(Object.entries(plans as Raw).map(([k, v]) => [k, fix(v)])) };
}

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
