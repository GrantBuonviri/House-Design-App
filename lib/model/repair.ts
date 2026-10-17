import { createProject, migrateRaw, newId } from "./project";
import { Project, SCHEMA_VERSION } from "./schema";

type Raw = Record<string, unknown>;
type Path = PropertyKey[];

/** What "Try to repair" changed: values put back to the defaults, and broken pieces (a room, a wall) taken out. */
export type RepairResult = { project: Project; reset: string[]; removed: string[] };

/** Rounds of fixing before giving up on a piece and resetting the whole part it sits in. */
const MAX_ROUNDS = 1000;

/**
 * Open saved data that `migrateProject` refuses: each value that fails the
 * check goes back to a new house's value (or is left out, so its default
 * applies). If that isn't enough, the piece around it goes: an item in a list
 * is taken out, anything else is reset one level up, up to a whole part of the
 * house (like the floor plans). The id, name and everything that reads are kept.
 * Throws for data saved by a newer app, which a repair would only damage.
 */
export function repairProjectData(raw: unknown, now = new Date()): RepairResult {
  const input: Raw = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Raw) : {};
  let data: Raw;
  try {
    data = structuredClone(migrateRaw(input));
  } catch (e) {
    if (e instanceof Error && e.message.includes("newer version")) throw e;
    // A migration step tripped on the damage: check the data as it is.
    data = structuredClone({ ...input, schemaVersion: SCHEMA_VERSION });
  }
  const name = typeof data.name === "string" && data.name.trim() ? data.name : "Repaired house";
  const fresh = createProject(name) as unknown as Raw;
  if (typeof data.id !== "string" || !data.id) data.id = newId();
  fresh.id = data.id;

  // Changes by path. A change one level up replaces the ones under it.
  const changes = new Map<string, { path: Path; kind: "reset" | "removed" }>();
  const note = (path: Path, kind: "reset" | "removed") => {
    const k = keyOf(path);
    for (const old of [...changes.keys()]) if (old === k || old.startsWith(k + SEP)) changes.delete(old);
    // Two list items taken out at the same place are two changes.
    changes.set(kind === "removed" ? `${k}\u0001${changes.size}` : k, { path, kind });
  };
  const list = (kind: "reset" | "removed") => [...changes.values()].filter((c) => c.kind === kind).map((c) => describePath(c.path));
  const tries = new Map<string, number>();
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const check = Project.safeParse(data);
    if (check.success) return { project: { ...check.data, updatedAt: now.toISOString() }, reset: list("reset"), removed: list("removed") };
    // One issue at a time: taking a list item out moves the paths after it.
    const path = check.error.issues[0].path as Path;
    const key = keyOf(path);
    const n = tries.get(key) ?? 0;
    tries.set(key, n + 1);
    const at = path.slice(0, Math.max(0, path.length - n));
    if (at.length === 0) break;
    const parent = valueAt(data, at.slice(0, -1));
    const last = at[at.length - 1];
    if (Array.isArray(parent) && typeof last === "number") {
      parent.splice(last, 1);
      note(at, "removed");
      // The next item now sits at this place: it starts with fresh tries.
      const list = keyOf(at.slice(0, -1));
      for (const k of [...tries.keys()]) if (k.startsWith(list + SEP)) tries.delete(k);
      continue;
    }
    if (!parent || typeof parent !== "object") continue;
    const own = valueAt(fresh, at);
    const was = (parent as Raw)[last as string];
    if (own === undefined) delete (parent as Raw)[last as string];
    else (parent as Raw)[last as string] = structuredClone(own);
    note(at, own === undefined && was && typeof was === "object" ? "removed" : "reset");
  }
  // Nothing smaller worked: start the house over, keeping its id and name.
  return { project: { ...(Project.parse(fresh) as Project), updatedAt: now.toISOString() }, reset: ["the whole house"], removed: [] };
}

const SEP = "\u0000";
const keyOf = (path: Path) => path.map(String).join(SEP);

function valueAt(data: unknown, path: Path): unknown {
  let v = data;
  for (const k of path) {
    if (!v || typeof v !== "object") return undefined;
    v = (v as Record<PropertyKey, unknown>)[k];
  }
  return v;
}

/** A path in plain words, like "floor plans › floor-1 › rooms › 3rd". */
export function describePath(path: Path): string {
  return path
    .map((k) => {
      if (typeof k === "number") return ordinal(k + 1);
      const s = String(k);
      return /^[a-z][a-zA-Z0-9]*$/.test(s) ? s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase() : s;
    })
    .join(" › ");
}

function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}
