import type { BubbleDiagram, DesignChoices, FloorPlan, Project } from "@/lib/model/schema";
import { openingType, fixtureType } from "@/lib/plan/catalog";
import { furnitureType } from "@/lib/plan/furniture";

/**
 * A short, plain description of what changed between two versions of a
 * project, for the Undo and Redo buttons ("move Kitchen", "pick oak
 * flooring"). Worked out by comparing them, so every edit gets a label
 * without each screen having to name its changes.
 */
export function describeChange(before: Project, after: Project): string {
  const same = (k: keyof Project) => before[k] === after[k] || json(before[k]) === json(after[k]);

  if (!same("name")) return "rename the house";
  if (!same("profile")) return "change your name";
  if (!same("plot") && before.plot?.custom && after.plot?.custom && before.plot.custom.id === after.plot.custom.id) return "change the land";
  if (!same("plot")) return after.plot ? (before.plot ? "pick other land" : "pick land") : "clear the land";
  if (!same("discovery")) return describeRooms(before, after);
  if (!same("brief")) return after.brief && before.brief ? "change the design brief" : after.brief ? "make the design brief" : "clear the design brief";
  if (!same("bubbles")) return describeLevels(before, after, "bubbles", describeSketch) ?? "change the flow sketch";
  if (!same("sketch")) return "change the flow sketch settings";
  if (!same("floorPlans")) return describeLevels(before, after, "floorPlans", describePlan) ?? "change the floor plan";
  if (!same("plan")) return before.plan.basics === null && after.plan.basics ? "answer the plan basics" : "change the plan settings";
  if (!same("house3d")) {
    if (json(before.house3d.topLabels) !== json(after.house3d.topLabels)) return describeTopLabels(before, after);
    return json(before.house3d.walkLabels) !== json(after.house3d.walkLabels) ? "change the floor labels" : "change the roof";
  }
  if (!same("cost")) return "change the water and sewer setting";
  if (!same("plans")) return "change the plan details";
  if (!same("interior")) return describeDesign(before.interior, after.interior, "inside");
  if (!same("exterior")) return describeDesign(before.exterior, after.exterior, "outside");
  if (!same("levels")) return "change the floors";
  return "last change";
}

/** Names the one room whose 3D label was hidden, shown, renamed or moved, else the general "change the 3D labels". */
function describeTopLabels(before: Project, after: Project): string {
  const a = before.house3d.topLabels;
  const b = after.house3d.topLabels;
  const { rooms: ra, ...restA } = a;
  const { rooms: rb, ...restB } = b;
  if (json(restA) !== json(restB)) return "change the 3D labels";
  const ids = [...new Set([...Object.keys(ra), ...Object.keys(rb)])].filter((id) => json(ra[id]) !== json(rb[id]));
  if (ids.length !== 1) return "change the 3D labels";
  const id = ids[0];
  const name = Object.values(after.floorPlans).flatMap((f) => f.rooms).find((r) => r.id === id)?.name ?? "room";
  const x = ra[id];
  const y = rb[id];
  if (!!x?.hidden !== !!y?.hidden) return y?.hidden ? `hide the ${name} label` : `show the ${name} label`;
  if (x?.text !== y?.text) return `rename the ${name} label`;
  return `move the ${name} label`;
}

function json(v: unknown): string {
  return JSON.stringify(v ?? null);
}

/** The level with changes, then what changed on it. */
function describeLevels<K extends "bubbles" | "floorPlans">(
  before: Project,
  after: Project,
  key: K,
  describe: (a: NonNullable<Project[K][string]> | undefined, b: NonNullable<Project[K][string]> | undefined) => string | null,
): string | null {
  const ids = new Set([...Object.keys(before[key]), ...Object.keys(after[key])]);
  const changed = [...ids].filter((id) => json(before[key][id]) !== json(after[key][id]));
  if (changed.length !== 1) return changed.length > 1 ? (key === "bubbles" ? "change the flow sketch" : "change the floor plan") : null;
  return describe(
    before[key][changed[0]] as NonNullable<Project[K][string]> | undefined,
    after[key][changed[0]] as NonNullable<Project[K][string]> | undefined,
  );
}

type Named = { id: string };

/**
 * What happened to one list: something added, deleted, or changed. Returns
 * null when the list is the same.
 */
function describeList<T extends Named>(
  a: T[],
  b: T[],
  name: (item: T) => string,
  changed: (was: T, now: T) => string = (_, now) => `change ${name(now)}`,
): string | null {
  const before = new Map(a.map((x) => [x.id, x]));
  const after = new Map(b.map((x) => [x.id, x]));
  const added = b.filter((x) => !before.has(x.id));
  const removed = a.filter((x) => !after.has(x.id));
  const edited = b.filter((x) => before.has(x.id) && json(before.get(x.id)) !== json(x));
  if (added.length + removed.length + edited.length === 0) return null;
  if (added.length && !removed.length && !edited.length) return added.length === 1 ? `add ${name(added[0])}` : `add ${added.length} things`;
  if (removed.length && !added.length && !edited.length) return removed.length === 1 ? `delete ${name(removed[0])}` : `delete ${removed.length} things`;
  if (edited.length && !added.length && !removed.length) {
    if (edited.length === 1) return changed(before.get(edited[0].id)!, edited[0]);
    return edited.every((x) => moved(before.get(x.id)!, x)) ? `move ${edited.length} things` : `change ${edited.length} things`;
  }
  return null;
}

/** Only the position (and maybe turn) is different. */
function moved(a: object, b: object): boolean {
  const strip = (o: object) => json(Object.fromEntries(Object.entries(o).filter(([k]) => !["x", "y", "rotation", "polygon"].includes(k))));
  return strip(a) === strip(b);
}

function describePlan(a: FloorPlan | undefined, b: FloorPlan | undefined): string | null {
  if (!a || !b) return b ? "start the floor plan" : "clear the floor plan";
  const roomName = (r: FloorPlan["rooms"][number]) => r.name || "a room";
  const special = describeBend(a, b, roomName) ?? describeOpenWalls(a, b, roomName) ?? describeSplit(a, b, roomName) ?? describeTrim(a, b, roomName);
  if (special) return special;
  const rooms = describeList(a.rooms, b.rooms, roomName, (was, now) =>
    was.name !== now.name ? `rename ${roomName(was)}` : moved(was, now) ? `move ${roomName(now)}` : `change ${roomName(now)}`,
  );
  const lists = [
    // Moving a room carries its doors, windows and fixtures along, so the room comes first.
    rooms,
    describeList(a.walls, b.walls, () => "a wall", (was, now) =>
      (was.height ?? "full") !== (now.height ?? "full") ? (now.height === "half" ? "make a wall a half wall" : now.height === "half-cap" ? "give a half wall a counter cap" : "make a wall full height") : moved(was, now) ? "move a wall" : "change a wall",
    ),
    describeList(a.openings, b.openings, (o) => article(openingType(o.style).label), (was, now) =>
      !!was.locked !== !!now.locked ? (now.locked ? "lock a door" : "unlock a door") : was.host === now.host || json(was.host) === json(now.host) ? (was.offsetIn !== now.offsetIn && was.widthIn === now.widthIn ? `move ${article(openingType(now.style).label, true)}` : `change ${article(openingType(now.style).label, true)}`) : `move ${article(openingType(now.style).label, true)}`,
    ),
    describeList(a.stairs, b.stairs, () => "the stairs", (was, now) => (moved(was, now) ? "move the stairs" : "change the stairs")),
    describeList(a.fixtures, b.fixtures, (f) => article(fixtureType(f.kind).label), (was, now) =>
      moved(was, now) ? `move ${article(fixtureType(now.kind).label, true)}` : `change ${article(fixtureType(now.kind).label, true)}`,
    ),
    describeList(a.furniture, b.furniture, (f) => article(furnitureType(f.kind)?.label ?? "furniture"), (was, now) => {
      const label = article(furnitureType(now.kind)?.label ?? "furniture", true);
      return moved(was, now) ? `move ${label}` : was.color !== now.color ? `recolor ${label}` : `change ${label}`;
    }),
    json(a.cabinets ?? null) !== json(b.cabinets ?? null) ? (b.cabinets ? "change the cabinets" : "go back to the automatic cabinets") : null,
    json(a.devices ?? null) !== json(b.devices ?? null) ? (b.devices ? "change the outlets and lights" : "go back to the automatic outlets and lights") : null,
  ].filter((x): x is string => x !== null);
  if (rooms) return rooms;
  return lists.length === 1 ? lists[0] : lists.length ? "change the floor plan" : null;
}

function describeSketch(a: BubbleDiagram | undefined, b: BubbleDiagram | undefined): string | null {
  if (!a || !b) return b ? "start the flow sketch" : "clear the flow sketch";
  const label = (x: BubbleDiagram["bubbles"][number]) => x.label || "a room";
  const lists = [
    describeList(a.bubbles, b.bubbles, label, (was, now) =>
      was.label !== now.label ? `rename ${label(was)}` : moved(was, now) ? `move ${label(now)}` : `resize ${label(now)}`,
    ),
    describeList(a.flows, b.flows, () => "a connection"),
    describeList(a.strokes, b.strokes, () => "a pen mark"),
    describeList(a.notes, b.notes, () => "a note", (was, now) => (was.text !== now.text ? "edit a note" : "move a note")),
  ].filter((x): x is string => x !== null);
  return lists.length === 1 ? lists[0] : lists.length ? "change the flow sketch" : null;
}

function describeRooms(before: Project, after: Project): string {
  const a = before.discovery.answers;
  const b = after.discovery.answers;
  const name = (r: (typeof a.rooms)[number]) => r.name || "a room";
  const rooms = describeList(a.rooms, b.rooms, name);
  if (rooms) return rooms;
  if (a.floorsAbove !== b.floorsAbove || a.floorsBelow !== b.floorsBelow) return "change the number of floors";
  if (a.garageCars !== b.garageCars) return "change the garage size";
  if (json(a.connections) !== json(b.connections)) return "change the room connections";
  if (a.feel !== b.feel) return "edit how the house should feel";
  return "change the rooms";
}

function describeDesign(a: DesignChoices, b: DesignChoices, where: "inside" | "outside"): string {
  if (json(a.answers) !== json(b.answers)) return `change the ${where} style answers`;
  if (a.shuffle !== b.shuffle || json(a.moodBoard) !== json(b.moodBoard)) return "shuffle the mood board";
  if (a.accentPlace !== b.accentPlace) return "move the accent siding";
  const before = new Map(a.selections.map((s) => [s.id, s]));
  const after = new Map(b.selections.map((s) => [s.id, s]));
  const added = b.selections.filter((s) => !before.has(s.id) || json(before.get(s.id)) !== json(s));
  const removed = a.selections.filter((s) => !after.has(s.id));
  if (added.length === 1) return `pick ${added[0].product.name}`;
  if (added.length === 0 && removed.length === 1) return `remove ${removed[0].product.name}`;
  return `change the ${where} picks`;
}

/** Combining rooms, and taking out or putting back a wall (with any doors and windows that went with it). */
/** A wall bent or made straight: the room (or loose wall) is the same but its curves changed. */
function describeBend(a: FloorPlan, b: FloorPlan, roomName: (r: FloorPlan["rooms"][number]) => string): string | null {
  const curved = (n: number[] | undefined) => (n ?? []).filter((x) => x !== 0).length;
  for (const now of b.rooms) {
    const was = a.rooms.find((r) => r.id === now.id);
    if (!was || json(was.polygon) !== json(now.polygon) || json(was.bulges ?? null) === json(now.bulges ?? null)) continue;
    const before = curved(was.bulges);
    const after = curved(now.bulges);
    return after === 0 ? `straighten the ${roomName(now)} wall` : after < before ? `straighten a ${roomName(now)} wall` : before === 0 || after > before ? `curve the ${roomName(now)} wall` : `bend the ${roomName(now)} wall`;
  }
  for (const now of b.walls) {
    const was = a.walls.find((w) => w.id === now.id);
    if (!was || json(was.a) !== json(now.a) || json(was.b) !== json(now.b) || (was.bulge ?? 0) === (now.bulge ?? 0)) continue;
    return !now.bulge ? "straighten a wall" : !was.bulge ? "curve a wall" : "bend a wall";
  }
  return null;
}

function describeOpenWalls(a: FloorPlan, b: FloorPlan, roomName: (r: FloorPlan["rooms"][number]) => string): string | null {
  const ids = new Set(b.rooms.map((r) => r.id));
  const gone = a.rooms.filter((r) => !ids.has(r.id));
  const was = new Map(a.rooms.map((r) => [r.id, r]));
  const grown = b.rooms.filter((r) => was.has(r.id) && json(was.get(r.id)!.polygon) !== json(r.polygon));
  if (gone.length && grown.length === 1 && b.rooms.every((r) => was.has(r.id))) {
    const names = [was.get(grown[0].id)!, ...gone].map(roomName);
    return `combine ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }
  const before = a.openWalls ?? [];
  const after = b.openWalls ?? [];
  if (json(before) === json(after) || json(a.rooms) !== json(b.rooms)) return null;
  const now = new Set(b.openings.map((o) => o.id));
  const lost = a.openings.filter((o) => !now.has(o.id)).map((o) => article(openingType(o.style).label));
  const total = (list: typeof before) => list.reduce((t, w) => t + Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y), 0);
  const wall = total(after) > total(before) ? "remove a wall" : "put a wall back";
  return lost.length ? `${wall} and ${lost.length === 1 ? lost[0] : `${lost.length} doors and windows`}` : wall;
}

/** "a window", "an island"; with `the`, "the window". */
function article(label: string, the = false): string {
  const l = label.toLowerCase();
  if (the) return `the ${l}`;
  return /^[aeiou]/.test(l) ? `an ${l}` : `a ${l}`;
}

/** A wall drawn across a room split it: one room got smaller and a new one appeared. */
function describeSplit(a: FloorPlan, b: FloorPlan, roomName: (r: FloorPlan["rooms"][number]) => string): string | null {
  const was = new Map(a.rooms.map((r) => [r.id, r]));
  const added = b.rooms.filter((r) => !was.has(r.id));
  const shrunk = b.rooms.filter((r) => was.has(r.id) && json(was.get(r.id)!.polygon) !== json(r.polygon));
  if (added.length !== 1 || shrunk.length !== 1 || b.rooms.length !== a.rooms.length + 1) return null;
  return `split ${roomName(was.get(shrunk[0].id)!)}`;
}

/** A room dropped on another one trims it: "Trimmed Living to fit Kitchen". */
function describeTrim(a: FloorPlan, b: FloorPlan, roomName: (r: FloorPlan["rooms"][number]) => string): string | null {
  if (a.rooms.length !== b.rooms.length) return null;
  const was = new Map(a.rooms.map((r) => [r.id, r]));
  const changed = b.rooms.filter((r) => was.get(r.id) && json(was.get(r.id)!.polygon) !== json(r.polygon));
  const shift = (r: FloorPlan["rooms"][number]) => {
    const old = was.get(r.id)!.polygon;
    if (old.length !== r.polygon.length) return null;
    const dx = r.polygon[0].x - old[0].x;
    const dy = r.polygon[0].y - old[0].y;
    return r.polygon.every((p, i) => Math.abs(p.x - old[i].x - dx) < 0.2 && Math.abs(p.y - old[i].y - dy) < 0.2) ? true : null;
  };
  const slid = changed.filter(shift);
  const cut = changed.filter((r) => !shift(r));
  if (slid.length < 1 || cut.length !== 1) return null;
  return `trim ${roomName(cut[0])} to fit ${roomName(slid[0])}`;
}
