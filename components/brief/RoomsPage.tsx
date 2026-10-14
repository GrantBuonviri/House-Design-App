"use client";

import type { ChosenRoom, DiscoveryAnswers, Plot } from "@/lib/model/schema";
import { CATEGORIES, MAX_PER_TYPE, BRIEF_ROOM_TYPES, newRoomId, setTypeCount, sqftFromDims } from "@/lib/brief/rooms";
import { MAX_ABOVE, MAX_BELOW, levelIdsFor, levelName } from "@/lib/brief/levels";
import { plotImplications } from "@/lib/land/implications";
import { FeetInput, Field, Stepper } from "./controls";
import Connections from "./Connections";

type SetAnswers = (patch: Partial<DiscoveryAnswers>, key: string) => void;

/** Connections that still point at rooms on the list. */
function keepConnections(answers: DiscoveryAnswers, rooms: ChosenRoom[]) {
  const ids = new Set(rooms.map((r) => r.id));
  return answers.connections.filter((e) => ids.has(e.a) && ids.has(e.b));
}

/** Step 3: one page to choose the floors and rooms, how they connect, and the feel. */
export default function RoomsPage({
  answers: a,
  setAnswers,
  plot,
}: {
  answers: DiscoveryAnswers;
  setAnswers: SetAnswers;
  plot: Plot | null;
}) {
  const levels = levelIdsFor(a.floorsAbove, a.floorsBelow);
  const foundation = plot ? plotImplications(plot).foundation : null;
  const suitsWalkout = foundation?.type === "walkout" || foundation?.type === "stepped";

  const setRooms = (rooms: ChosenRoom[], key: string) => setAnswers({ rooms, connections: keepConnections(a, rooms) }, key);
  const setRoom = (id: string, patch: Partial<ChosenRoom>, key: string) =>
    setAnswers({ rooms: a.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)) }, `${key}.${id}`);
  const setFloors = (patch: Partial<Pick<DiscoveryAnswers, "floorsAbove" | "floorsBelow">>, key: string) => {
    const allowed = levelIdsFor(patch.floorsAbove ?? a.floorsAbove, patch.floorsBelow ?? a.floorsBelow);
    const rooms = a.rooms.map((r) => (r.levelId && !allowed.includes(r.levelId) ? { ...r, levelId: undefined } : r));
    setAnswers({ ...patch, rooms }, key);
  };

  const custom = a.rooms.filter((r) => r.type === "other");

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <h3 className="mb-4 font-semibold">Floors</h3>
        <div className="grid grid-cols-2 gap-6">
          <Field label="Floors above ground">
            <Stepper
              label="floors above ground"
              min={1}
              max={MAX_ABOVE}
              value={a.floorsAbove}
              onChange={(floorsAbove) => setFloors({ floorsAbove }, "floorsAbove")}
            />
          </Field>
          <Field
            label="Floors below ground"
            hint={
              foundation
                ? suitsWalkout
                  ? "Your land slopes enough for a walkout basement with daylight and its own door."
                  : "Your land is fairly flat, so a basement would be fully underground."
                : undefined
            }
          >
            <Stepper
              label="floors below ground"
              max={MAX_BELOW}
              value={a.floorsBelow}
              onChange={(floorsBelow) => setFloors({ floorsBelow }, "floorsBelow")}
            />
          </Field>
        </div>
      </section>

      <section className="card p-6">
        <h3 className="font-semibold">Rooms</h3>
        <p className="mb-5 text-sm text-muted">
          Check every kind of room you want. Sizes and floors are optional; leave them for the app to suggest.
        </p>
        <div className="space-y-7">
          {CATEGORIES.map((cat) => {
            const types = BRIEF_ROOM_TYPES.filter((t) => t.category === cat.id && t.id !== "other");
            const checked = types.filter((t) => a.rooms.some((r) => r.type === t.id));
            return (
              <div key={cat.id}>
                <h4 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">{cat.label}</h4>
                <div className="grid grid-cols-4 gap-x-4 gap-y-1.5">
                  {types.map((t) => {
                    const on = a.rooms.some((r) => r.type === t.id);
                    return (
                      <label key={t.id} className="flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="size-4 accent-[var(--color-accent)]"
                          checked={on}
                          onChange={(e) => setRooms(setTypeCount(a.rooms, t.id, e.target.checked ? 1 : 0), `type.${t.id}`)}
                        />
                        {t.label}
                      </label>
                    );
                  })}
                </div>
                {checked.map((t) => {
                  const rooms = a.rooms.filter((r) => r.type === t.id);
                  return (
                    <div key={t.id} className="mt-3 rounded-lg border border-line bg-paper/60 p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <p className="text-sm font-semibold">{t.label}</p>
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-muted">How many?</span>
                          <Stepper
                            label={`${t.label} rooms`}
                            min={1}
                            max={MAX_PER_TYPE}
                            value={rooms.length}
                            onChange={(n) => setRooms(setTypeCount(a.rooms, t.id, n), `count.${t.id}`)}
                          />
                        </div>
                      </div>
                      <div className="space-y-3">
                        {rooms.map((r, i) => (
                          <RoomRow
                            key={r.id}
                            room={r}
                            levels={levels}
                            onChange={setRoom}
                            onRemove={() =>
                              setRooms(
                                a.rooms.filter((x) => x.id !== r.id),
                                `remove.${r.id}`,
                              )
                            }
                            cars={
                              t.id === "garage" && i === 0
                                ? {
                                    value: a.garageCars,
                                    onChange: (garageCars) => setAnswers({ garageCars }, "garageCars"),
                                  }
                                : undefined
                            }
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}

          <div>
            <h4 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">Your own rooms</h4>
            {custom.length > 0 && (
              <div className="mb-3 space-y-3 rounded-lg border border-line bg-paper/60 p-4">
                {custom.map((r) => (
                  <RoomRow
                    key={r.id}
                    room={r}
                    levels={levels}
                    onChange={setRoom}
                    onRemove={() =>
                      setRooms(
                        a.rooms.filter((x) => x.id !== r.id),
                        `remove.${r.id}`,
                      )
                    }
                  />
                ))}
              </div>
            )}
            <button
              type="button"
              className="text-sm text-accent hover:underline"
              onClick={() =>
                setRooms(
                  [
                    ...a.rooms,
                    {
                      id: newRoomId(),
                      type: "other",
                      name: uniqueName("My room", a.rooms),
                      description: "",
                    },
                  ],
                  "custom.add",
                )
              }
            >
              + Add your own room
            </button>
          </div>
        </div>
      </section>

      <Connections
        rooms={a.rooms}
        connections={a.connections}
        onChange={(connections, key) => setAnswers({ connections }, key)}
        intro="Optional. Which rooms should sit together, and which should stay apart. The app will suggest more."
        emptyText="Check at least two rooms above to connect them."
      />

      <section className="card p-6">
        <label className="field-label" htmlFor="feel">
          Describe how the house should feel
        </label>
        <p className="field-hint mt-0 mb-2">Optional. Mention anything else that matters here too.</p>
        <textarea
          id="feel"
          className="input min-h-24"
          maxLength={3000}
          placeholder="For example: warm and bright, with lots of wood. Quiet bedrooms away from the kitchen. We host big family dinners."
          value={a.feel}
          onChange={(e) => setAnswers({ feel: e.target.value }, "feel")}
        />
      </section>
    </div>
  );
}

function RoomRow({
  room: r,
  levels,
  onChange,
  onRemove,
  cars,
}: {
  room: ChosenRoom;
  levels: string[];
  onChange: (id: string, patch: Partial<ChosenRoom>, key: string) => void;
  onRemove: () => void;
  cars?: { value: number; onChange: (n: number) => void };
}) {
  const area = sqftFromDims(r.lengthIn, r.widthIn);
  return (
    <div className="rounded-md border border-line bg-white p-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          className="input min-w-40 flex-1 py-1.5"
          aria-label="Room name"
          value={r.name}
          maxLength={60}
          onChange={(e) => onChange(r.id, { name: e.target.value }, "name")}
        />
        <div className="flex items-center gap-1 text-sm">
          <FeetInput
            className="w-16"
            label={`${r.name} length in feet`}
            value={r.lengthIn}
            onChange={(lengthIn) => onChange(r.id, { lengthIn }, "length")}
          />
          <span className="text-muted">×</span>
          <FeetInput
            className="w-16"
            label={`${r.name} width in feet`}
            value={r.widthIn}
            onChange={(widthIn) => onChange(r.id, { widthIn }, "width")}
          />
          <span className="ml-1 w-16 text-xs text-muted">{area ? `${area.toLocaleString("en-US")} sq ft` : "optional"}</span>
        </div>
        <select
          className="input w-44 py-1.5"
          aria-label={`${r.name} floor`}
          value={r.levelId && levels.includes(r.levelId) ? r.levelId : ""}
          onChange={(e) => onChange(r.id, { levelId: e.target.value || undefined }, "level")}
        >
          <option value="">Let the app decide</option>
          {levels
            .slice()
            .reverse()
            .map((id) => (
              <option key={id} value={id}>
                {levelName(id)}
              </option>
            ))}
        </select>
        {cars && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted">Cars</span>
            <Stepper label="cars" max={4} value={cars.value} onChange={cars.onChange} />
          </div>
        )}
        <button
          type="button"
          className="px-1 text-lg leading-none text-muted hover:text-red-700"
          aria-label={`Remove ${r.name}`}
          title="Remove"
          onClick={onRemove}
        >
          ×
        </button>
      </div>
      <input
        className="input mt-2 py-1.5"
        aria-label={`${r.name} description`}
        maxLength={1000}
        placeholder="Ideas for how you'll use it, or how it could be laid out"
        value={r.description}
        onChange={(e) => onChange(r.id, { description: e.target.value }, "description")}
      />
    </div>
  );
}

function uniqueName(base: string, rooms: ChosenRoom[]): string {
  const taken = new Set(rooms.map((r) => r.name.toLowerCase()));
  let n = 1;
  while (taken.has(`${base} ${n}`.toLowerCase())) n++;
  return `${base} ${n}`;
}
