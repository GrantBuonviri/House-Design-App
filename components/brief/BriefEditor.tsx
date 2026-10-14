"use client";

import type { DesignBrief } from "@/lib/model/schema";
import { BRIEF_ROOM_TYPES, isHeated, newRoomId, roomType, sqftFromDims } from "@/lib/brief/rooms";
import { MAX_ABOVE, MAX_BELOW, levelIdsFor, levelName, levelsFor, nearestLevel } from "@/lib/brief/levels";
import { briefTotals } from "@/lib/brief/rules";
import { Choice, FeetInput, Field, Stepper, TagEditor } from "./controls";
import Connections from "./Connections";

type Room = DesignBrief["rooms"][number];

/** Square feet, already in feet (the brief stores sizes that way). */
function formatSqFt(sqft: number): string {
  return `${Math.round(sqft).toLocaleString("en-US")} sq ft`;
}

/** The Design Brief, fully editable. Every later stage reads from it. */
export default function BriefEditor({
  brief,
  onChange,
}: {
  brief: DesignBrief;
  onChange: (brief: DesignBrief, key: string) => void;
}) {
  const levels = levelIdsFor(brief.floors, brief.floorsBelow);
  const totals = briefTotals(brief);
  const set = (patch: Partial<DesignBrief>, key: string) => onChange({ ...brief, ...patch }, key);

  const setFloors = (patch: Partial<Pick<DesignBrief, "floors" | "floorsBelow">>, key: string) => {
    const next = { ...brief, ...patch };
    const allowed = levelIdsFor(next.floors, next.floorsBelow);
    const rooms = next.rooms.map((r) => ({ ...r, levelId: nearestLevel(r.levelId, allowed) }));
    onChange({ ...next, rooms, primarySuiteLevel: rooms.find((r) => r.type === "primary-bedroom")?.levelId }, key);
  };

  const setRoom = (id: string, patch: Partial<Room>, key: string) => {
    const rooms = brief.rooms.map((r) => {
      if (r.id !== id) return r;
      const next = { ...r, ...patch };
      // With both dimensions, the area comes from them.
      const fromDims = sqftFromDims(next.lengthIn, next.widthIn);
      return fromDims ? { ...next, targetSqFt: fromDims } : next;
    });
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
    const t = roomType("other");
    const id = newRoomId();
    set({ rooms: [...brief.rooms, { id, type: t.id, name: uniqueName("New room", brief.rooms), targetSqFt: t.sqft, levelId }] }, `add.${id}`);
  };

  return (
    <div className="space-y-6">
      <section className="card space-y-5 p-6">
        <div className="grid grid-cols-4 gap-6">
          <Field label="Floors above ground">
            <Stepper label="floors above ground" min={1} max={MAX_ABOVE} value={brief.floors} onChange={(floors) => setFloors({ floors }, "floors")} />
          </Field>
          <Field label="Floors below ground">
            <Stepper
              label="floors below ground"
              max={MAX_BELOW}
              value={brief.floorsBelow}
              onChange={(floorsBelow) => setFloors({ floorsBelow }, "floorsBelow")}
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
        <p className="mb-4 text-sm text-muted">
          Sizes are targets. Fill in length × width in feet to set a size exactly. The flow sketch uses them for bubble sizes.
        </p>
        <div className="space-y-6">
          {levelsFor(brief.floors, brief.floorsBelow)
            .slice()
            .reverse()
            .map((level) => {
              const rooms = brief.rooms.filter((r) => nearestLevel(r.levelId, levels) === level.id);
              const area = rooms.filter((r) => isHeated(r.type)).reduce((s, r) => s + r.targetSqFt, 0);
              return (
                <div key={level.id}>
                  <div className="mb-2 flex items-baseline justify-between border-b border-line pb-1">
                    <h4 className="text-sm font-semibold">{level.name}</h4>
                    <span className="text-xs text-muted">{formatSqFt(area)} of rooms</span>
                  </div>
                  {rooms.length > 0 && (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-muted">
                          <th className="w-[18%] pb-1 font-normal">Name</th>
                          <th className="w-[15%] pb-1 font-normal">Type</th>
                          <th className="w-[15%] pb-1 font-normal">Length × width (ft)</th>
                          <th className="w-[9%] pb-1 font-normal">Sq ft</th>
                          <th className="w-[13%] pb-1 font-normal">Floor</th>
                          <th className="pb-1 font-normal">Notes</th>
                          <th className="w-8" />
                        </tr>
                      </thead>
                      <tbody>
                        {rooms.map((r) => {
                          const fixed = Boolean(r.lengthIn && r.widthIn);
                          return (
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
                                  {BRIEF_ROOM_TYPES.map((t) => (
                                    <option key={t.id} value={t.id}>
                                      {t.label}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="py-1 pr-2">
                                <div className="flex items-center gap-1">
                                  <FeetInput label={`${r.name} length in feet`} value={r.lengthIn} onChange={(lengthIn) => setRoom(r.id, { lengthIn }, "length")} />
                                  <span className="text-muted">×</span>
                                  <FeetInput label={`${r.name} width in feet`} value={r.widthIn} onChange={(widthIn) => setRoom(r.id, { widthIn }, "width")} />
                                </div>
                              </td>
                              <td className="py-1 pr-2">
                                <input
                                  className={`input py-1.5 tabular-nums ${fixed ? "bg-paper text-muted" : ""}`}
                                  type="number"
                                  min={5}
                                  max={5000}
                                  step={5}
                                  readOnly={fixed}
                                  title={fixed ? "Worked out from length × width" : undefined}
                                  aria-label={`${r.name} size in square feet`}
                                  value={r.targetSqFt}
                                  onChange={(e) => {
                                    const n = Number(e.target.value);
                                    if (!fixed && n > 0) setRoom(r.id, { targetSqFt: Math.min(5000, n) }, "size");
                                  }}
                                />
                              </td>
                              <td className="py-1 pr-2">
                                <select
                                  className="input py-1.5"
                                  aria-label={`${r.name} floor`}
                                  value={level.id}
                                  onChange={(e) => setRoom(r.id, { levelId: e.target.value }, "level")}
                                >
                                  {levels
                                    .slice()
                                    .reverse()
                                    .map((id) => (
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
                                  maxLength={1000}
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
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                  <button type="button" className="mt-1 text-sm text-accent hover:underline" onClick={() => addRoom(level.id)}>
                    + Add a room to the {level.name.toLowerCase()}
                  </button>
                </div>
              );
            })}
        </div>
      </section>

      <Connections rooms={brief.rooms} connections={brief.adjacencies} onChange={(adjacencies, key) => set({ adjacencies }, key)} />

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
            How the house should feel, in your words
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

function uniqueName(base: string, rooms: Room[]): string {
  const taken = new Set(rooms.map((r) => r.name.toLowerCase()));
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}`;
  return name;
}
