"use client";

import type { DesignBrief } from "@/lib/model/schema";
import { ROOM_TYPES, isHeated, roomType } from "@/lib/brief/rooms";
import { BRIEF_LEVELS, levelIdsFor, levelName, nearestLevel } from "@/lib/brief/levels";
import { briefTotals, roomIdFromName } from "@/lib/brief/rules";
import { Choice, Field, Stepper, TagEditor } from "./controls";

type Room = DesignBrief["rooms"][number];
type Strength = DesignBrief["adjacencies"][number]["strength"];

/** Square feet, already in feet (the brief stores sizes that way). */
function formatSqFt(sqft: number): string {
  return `${Math.round(sqft).toLocaleString("en-US")} sq ft`;
}

const STRENGTH_LABEL: Record<Strength, string> = {
  must: "must be next to",
  nice: "is nice near",
  avoid: "should be away from",
};

/** The Design Brief, fully editable. Every later stage reads from it. */
export default function BriefEditor({
  brief,
  onChange,
}: {
  brief: DesignBrief;
  onChange: (brief: DesignBrief, key: string) => void;
}) {
  const levels = levelIdsFor(brief.floors, brief.basement);
  const totals = briefTotals(brief);
  const set = (patch: Partial<DesignBrief>, key: string) => onChange({ ...brief, ...patch }, key);

  const setHouse = (patch: Partial<Pick<DesignBrief, "floors" | "basement">>, key: string) => {
    const next = { ...brief, ...patch };
    const allowed = levelIdsFor(next.floors, next.basement);
    const rooms = next.rooms.map((r) => ({ ...r, levelId: nearestLevel(r.levelId, allowed) }));
    onChange({ ...next, rooms, primarySuiteLevel: rooms.find((r) => r.type === "primary-bedroom")?.levelId }, key);
  };

  const setRoom = (id: string, patch: Partial<Room>, key: string) => {
    const rooms = brief.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r));
    onChange({ ...brief, rooms, primarySuiteLevel: rooms.find((r) => r.type === "primary-bedroom")?.levelId }, `${key}.${id}`);
  };

  const removeRoom = (id: string) =>
    onChange(
      {
        ...brief,
        rooms: brief.rooms.filter((r) => r.id !== id),
        adjacencies: brief.adjacencies.filter((e) => e.a !== id && e.b !== id),
      },
      `remove.${id}`,
    );

  const addRoom = (levelId: string) => {
    const t = roomType("bedroom");
    const name = uniqueName("New room", brief.rooms);
    const id = roomIdFromName(name, new Set(brief.rooms.map((r) => r.id)));
    set({ rooms: [...brief.rooms, { id, type: t.id, name, targetSqFt: t.sqft, levelId }] }, `add.${id}`);
  };

  return (
    <div className="space-y-6">
      <section className="card space-y-5 p-6">
        <div className="grid grid-cols-4 gap-6">
          <Field label="Floors above ground">
            <Choice
              label="Floors"
              value={String(brief.floors)}
              options={[1, 2, 3].map((n) => ({ value: String(n), label: String(n) }))}
              onChange={(v) => setHouse({ floors: Number(v) }, "floors")}
            />
          </Field>
          <Field label="Basement">
            <Choice
              label="Basement"
              value={brief.basement ? "yes" : "no"}
              options={[
                { value: "yes", label: "Yes" },
                { value: "no", label: "No" },
              ]}
              onChange={(v) => setHouse({ basement: v === "yes" }, "basement")}
            />
          </Field>
          <Field label="Garage (cars)">
            <Stepper label="garage bays" max={4} value={brief.garageBays} onChange={(garageBays) => set({ garageBays }, "garageBays")} />
          </Field>
          <Field label="Kitchen">
            <Choice
              label="Kitchen"
              value={brief.openKitchen ? "open" : "closed"}
              options={[
                { value: "open", label: "Open" },
                { value: "closed", label: "Closed" },
              ]}
              onChange={(v) => set({ openKitchen: v === "open" }, "openKitchen")}
            />
          </Field>
        </div>
        <dl className="grid grid-cols-3 gap-4 rounded-lg bg-paper px-4 py-3 text-sm">
          <div>
            <dt className="text-xs text-muted">Living space</dt>
            <dd className="font-semibold">about {formatSqFt(totals.heated)}</dd>
            <dd className="text-xs text-muted">rooms plus ~15% for halls, stairs and walls</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Garage</dt>
            <dd className="font-semibold">{totals.garage ? formatSqFt(totals.garage) : "None"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Outdoor living</dt>
            <dd className="font-semibold">{totals.outdoor ? formatSqFt(totals.outdoor) : "None"}</dd>
          </div>
        </dl>
      </section>

      <section className="card p-6">
        <h3 className="font-semibold">Rooms</h3>
        <p className="mb-4 text-sm text-muted">Sizes are targets in square feet. The flow sketch uses them for bubble sizes.</p>
        <div className="space-y-6">
          {BRIEF_LEVELS.filter((l) => levels.includes(l.id)).map((level) => {
            const rooms = brief.rooms.filter((r) => (r.levelId ?? "main") === level.id);
            const area = rooms.filter((r) => isHeated(r.type)).reduce((s, r) => s + r.targetSqFt, 0);
            return (
              <div key={level.id}>
                <div className="mb-2 flex items-baseline justify-between border-b border-line pb-1">
                  <h4 className="text-sm font-semibold">{level.name}</h4>
                  <span className="text-xs text-muted">{formatSqFt(area)} of rooms</span>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="w-[22%] pb-1 font-normal">Name</th>
                      <th className="w-[18%] pb-1 font-normal">Type</th>
                      <th className="w-[11%] pb-1 font-normal">Sq ft</th>
                      <th className="w-[14%] pb-1 font-normal">Floor</th>
                      <th className="pb-1 font-normal">Notes</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {rooms.map((r) => (
                      <tr key={r.id} className="align-top">
                        <td className="py-1 pr-2">
                          <input
                            className="input py-1.5"
                            aria-label="Room name"
                            value={r.name}
                            maxLength={60}
                            onChange={(e) => setRoom(r.id, { name: e.target.value }, "name")}
                          />
                        </td>
                        <td className="py-1 pr-2">
                          <select
                            className="input py-1.5"
                            aria-label={`${r.name} type`}
                            value={r.type}
                            onChange={(e) => setRoom(r.id, { type: e.target.value }, "type")}
                          >
                            {ROOM_TYPES.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-1 pr-2">
                          <input
                            className="input py-1.5 tabular-nums"
                            type="number"
                            min={5}
                            max={5000}
                            step={5}
                            aria-label={`${r.name} size in square feet`}
                            value={r.targetSqFt}
                            onChange={(e) => {
                              const n = Number(e.target.value);
                              if (n > 0) setRoom(r.id, { targetSqFt: Math.min(5000, n) }, "size");
                            }}
                          />
                        </td>
                        <td className="py-1 pr-2">
                          <select
                            className="input py-1.5"
                            aria-label={`${r.name} floor`}
                            value={r.levelId ?? "main"}
                            onChange={(e) => setRoom(r.id, { levelId: e.target.value }, "level")}
                          >
                            {levels.map((id) => (
                              <option key={id} value={id}>
                                {levelName(id)}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-1 pr-2">
                          <input
                            className="input py-1.5"
                            aria-label={`${r.name} notes`}
                            value={r.notes ?? ""}
                            maxLength={200}
                            onChange={(e) => setRoom(r.id, { notes: e.target.value || undefined }, "notes")}
                          />
                        </td>
                        <td className="py-1">
                          <button
                            type="button"
                            className="px-2 py-1.5 text-lg leading-none text-muted hover:text-red-700"
                            aria-label={`Remove ${r.name}`}
                            title="Remove"
                            onClick={() => removeRoom(r.id)}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button type="button" className="mt-1 text-sm text-accent hover:underline" onClick={() => addRoom(level.id)}>
                  + Add a room to the {level.name.toLowerCase()}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <Connections brief={brief} onChange={(adjacencies, key) => set({ adjacencies }, key)} />

      <section className="card grid grid-cols-2 gap-6 p-6">
        <div className="col-span-2">
          <Field label="The feel">
            <TagEditor label="Vibe words" value={brief.vibe} onChange={(vibe) => set({ vibe }, "vibe")} />
          </Field>
        </div>
        <Field label="Priorities" hint="Most important first.">
          <TagEditor label="Priorities" value={brief.priorities} onChange={(priorities) => set({ priorities }, "priorities")} />
        </Field>
        <Field label="Accessibility">
          <TagEditor label="Accessibility" value={brief.accessibility} onChange={(accessibility) => set({ accessibility }, "accessibility")} />
        </Field>
        <div className="col-span-2">
          <label className="field-label" htmlFor="brief-notes">
            Notes in your own words
          </label>
          <textarea
            id="brief-notes"
            className="input min-h-24"
            maxLength={6000}
            value={brief.freeText ?? ""}
            onChange={(e) => set({ freeText: e.target.value || undefined }, "freeText")}
          />
        </div>
      </section>
    </div>
  );
}

function Connections({
  brief,
  onChange,
}: {
  brief: DesignBrief;
  onChange: (adjacencies: DesignBrief["adjacencies"], key: string) => void;
}) {
  const rooms = brief.rooms;
  const edit = (i: number, patch: Partial<DesignBrief["adjacencies"][number]>) =>
    onChange(
      brief.adjacencies.map((e, j) => (j === i ? { ...e, ...patch } : e)),
      `adj.${i}`,
    );
  return (
    <section className="card p-6">
      <h3 className="font-semibold">How rooms connect</h3>
      <p className="mb-4 text-sm text-muted">Which rooms should sit together, and which should stay apart.</p>
      <ul className="space-y-2">
        {brief.adjacencies.map((e, i) => (
          <li key={`${e.a}-${e.b}-${i}`} className="flex items-center gap-2 text-sm">
            <RoomSelect rooms={rooms} value={e.a} label="First room" onChange={(a) => edit(i, { a })} />
            <select
              className="input w-48 py-1.5"
              aria-label="How they connect"
              value={e.strength}
              onChange={(ev) => edit(i, { strength: ev.target.value as Strength })}
            >
              {(Object.keys(STRENGTH_LABEL) as Strength[]).map((s) => (
                <option key={s} value={s}>
                  {STRENGTH_LABEL[s]}
                </option>
              ))}
            </select>
            <RoomSelect rooms={rooms} value={e.b} label="Second room" onChange={(b) => edit(i, { b })} />
            <button
              type="button"
              className="px-2 text-lg leading-none text-muted hover:text-red-700"
              aria-label="Remove this connection"
              onClick={() => onChange(brief.adjacencies.filter((_, j) => j !== i), `adj.remove.${i}`)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      {rooms.length >= 2 && (
        <button
          type="button"
          className="mt-3 text-sm text-accent hover:underline"
          onClick={() => onChange([...brief.adjacencies, { a: rooms[0].id, b: rooms[1].id, strength: "nice" }], "adj.add")}
        >
          + Add a connection
        </button>
      )}
    </section>
  );
}

function RoomSelect({
  rooms,
  value,
  onChange,
  label,
}: {
  rooms: Room[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  return (
    <select className="input w-52 py-1.5" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {rooms.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name}
        </option>
      ))}
    </select>
  );
}

function uniqueName(base: string, rooms: Room[]): string {
  const taken = new Set(rooms.map((r) => r.name.toLowerCase()));
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}`;
  return name;
}
