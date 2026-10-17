"use client";

import { useState } from "react";
import type { Adjacency, ChosenRoom, DesignBrief, DiscoveryAnswers, Plot, Point, Profile } from "@/lib/model/schema";
import { CATEGORIES, BRIEF_ROOM_TYPES, sqftFromDims } from "@/lib/brief/rooms";
import { MAX_ABOVE, MAX_BELOW, levelIdsFor, levelName } from "@/lib/brief/levels";
import { addRoomOfType, duplicateRoom, removeType, roomsByFloor, uncheckQuestion, type RoomRowInfo } from "@/lib/brief/checklist";
import { feelWords, guessOpenKitchen, mainFloorPicks } from "@/lib/brief/rules";
import { PRIORITIES } from "@/lib/brief/priorities";
import { plotImplications } from "@/lib/land/implications";
import { Choice, FeetInput, Field, Stepper } from "./controls";
import Connections from "./Connections";

type SetAnswers = (patch: Partial<DiscoveryAnswers>, key: string) => void;

const STRENGTH_LABEL: Record<Adjacency["strength"], string> = {
  must: "Must connect",
  nice: "Nice to be close",
  avoid: "Keep apart",
};

/** Step 3, "Your rooms and brief": floors, the room checklist with a row per room, connections, the feel, priorities and accessibility. */
export default function RoomsPage({
  answers: a,
  brief,
  setAnswers,
  editConnections,
  plot,
  spot,
  profile,
  setProfile,
  tips,
}: {
  answers: DiscoveryAnswers;
  brief: DesignBrief | null;
  setAnswers: SetAnswers;
  /** Writes an edit to the brief's whole connection list (the app's obvious ones included) back to the answers. */
  editConnections: (adjacencies: Adjacency[], key: string) => void;
  plot: Plot | null;
  spot?: Point;
  profile: Profile;
  setProfile: (patch: Partial<Profile>, key: string) => void;
  /** Tips from the feel and the land, shown under the priorities. */
  tips: string[];
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const levels = levelIdsFor(a.floorsAbove, a.floorsBelow);
  const foundation = plot ? plotImplications(plot, spot).foundation : null;
  const suitsWalkout = foundation?.type === "walkout" || foundation?.type === "stepped";
  const adjacencies = brief?.adjacencies ?? a.connections;
  const groups = roomsByFloor(a, brief);
  const moved = mainFloorPicks(a).map((id) => a.rooms.find((r) => r.id === id)?.name ?? "").filter(Boolean);

  const toggleOpen = (id: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const setRooms = (rooms: ChosenRoom[], key: string) => {
    const ids = new Set(rooms.map((r) => r.id));
    setAnswers(
      {
        rooms,
        connections: a.connections.filter((e) => ids.has(e.a) && ids.has(e.b)),
        removedConnections: a.removedConnections.filter((e) => ids.has(e.a) && ids.has(e.b)),
      },
      key,
    );
  };
  const setRoom = (id: string, patch: Partial<ChosenRoom>, key: string) =>
    setAnswers({ rooms: a.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)) }, `${key}.${id}`);
  const setFloors = (patch: Partial<Pick<DiscoveryAnswers, "floorsAbove" | "floorsBelow">>, key: string) => {
    const allowed = levelIdsFor(patch.floorsAbove ?? a.floorsAbove, patch.floorsBelow ?? a.floorsBelow);
    const rooms = a.rooms.map((r) => (r.levelId && !allowed.includes(r.levelId) ? { ...r, levelId: undefined } : r));
    setAnswers({ ...patch, rooms }, key);
  };

  const checkType = (type: string, on: boolean) => {
    if (on) return setRooms(addRoomOfType(a.rooms, type), `type.${type}`);
    const q = uncheckQuestion(a.rooms, type);
    if (q && !window.confirm(q)) return;
    setAnswers(removeType(a, type), `type.${type}`);
  };

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <div className="grid grid-cols-2 gap-6">
          <Field label="Floors above ground">
            <Stepper label="floors above ground" min={1} max={MAX_ABOVE} value={a.floorsAbove} onChange={(floorsAbove) => setFloors({ floorsAbove }, "floorsAbove")} />
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
            <Stepper label="floors below ground" max={MAX_BELOW} value={a.floorsBelow} onChange={(floorsBelow) => setFloors({ floorsBelow }, "floorsBelow")} />
          </Field>
        </div>
      </section>

      <section className="card p-6">
        <h3 className="font-semibold">Who it&apos;s for</h3>
        <p className="mb-4 text-sm text-muted">Optional. Room sizes you don&apos;t type in fit the number of people and the budget.</p>
        <div className="grid grid-cols-3 gap-6">
          <Field label="Adults">
            <Stepper label="adults" max={20} value={profile.adults ?? 0} onChange={(adults) => setProfile({ adults: adults || undefined }, "adults")} />
          </Field>
          <Field label="Kids">
            <Stepper label="kids" max={20} value={profile.kids ?? 0} onChange={(kids) => setProfile({ kids: kids || undefined }, "kids")} />
          </Field>
          <Field label="Materials budget ($)" hint="Materials only, as in the cost panel. Not counting the land or labor.">
            <input
              className="input"
              inputMode="numeric"
              aria-label="Materials budget in dollars"
              placeholder="For example 300,000"
              value={profile.budget?.high ? profile.budget.high.toLocaleString("en-US") : ""}
              onChange={(e) => {
                const n = Number(e.target.value.replace(/[^0-9]/g, ""));
                setProfile({ budget: n > 0 ? { high: Math.min(n, 100_000_000) } : undefined }, "budget");
              }}
            />
          </Field>
        </div>
      </section>

      <section className="card p-6" data-testid="room-checklist">
        <h3 className="font-semibold">Rooms</h3>
        <p className="mb-5 text-sm text-muted">Check every kind of room you want. Each one shows up below, where you can open it to set its size, floor and more.</p>
        <div className="grid grid-cols-3 gap-x-6 gap-y-5">
          {CATEGORIES.map((cat) => (
            <div key={cat.id}>
              <h4 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">{cat.label}</h4>
              <div className="space-y-1.5">
                {BRIEF_ROOM_TYPES.filter((t) => t.category === cat.id && t.id !== "other").map((t) => {
                  const n = a.rooms.filter((r) => r.type === t.id).length;
                  return (
                    <label key={t.id} className="flex cursor-pointer items-center gap-2 text-sm">
                      <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={n > 0} onChange={(e) => checkType(t.id, e.target.checked)} />
                      {t.label}
                      {n > 1 && <span className="text-xs text-muted">×{n}</span>}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <button type="button" className="mt-4 text-sm text-accent hover:underline" onClick={() => setRooms(addRoomOfType(a.rooms, "other"), "custom.add")}>
          + Add your own room
        </button>
      </section>

      {groups.length > 0 && (
        <section className="card p-6" data-testid="room-rows">
          <h3 className="font-semibold">Your rooms</h3>
          <p className="mb-4 text-sm text-muted">
            Grey means the app picked it. Open a room to change it; anything you type wins.
          </p>
          <div className="space-y-5">
            {groups.map((g) => (
              <div key={g.level.id}>
                <h4 className="mb-2 border-b border-line pb-1 text-sm font-semibold">{g.level.name}</h4>
                <ul className="space-y-2">
                  {g.rows.map((row) => (
                    <RoomRow
                      key={row.room.id}
                      row={row}
                      open={open.has(row.room.id)}
                      onToggle={() => toggleOpen(row.room.id)}
                      levels={levels}
                      rooms={a.rooms}
                      onChange={setRoom}
                      onDuplicate={() => setRooms(duplicateRoom(a.rooms, row.room.id), `duplicate.${row.room.id}`)}
                      onRemove={() => setRooms(a.rooms.filter((x) => x.id !== row.room.id), `remove.${row.room.id}`)}
                      adjacencies={adjacencies}
                      editConnections={editConnections}
                      kitchen={
                        row.room.type === "kitchen"
                          ? { open: a.openKitchen ?? guessOpenKitchen(a.feel), picked: a.openKitchen !== undefined, onChange: (openKitchen) => setAnswers({ openKitchen }, "openKitchen") }
                          : undefined
                      }
                      cars={row.room.type === "garage" ? { value: a.garageCars, onChange: (garageCars) => setAnswers({ garageCars }, "garageCars") } : undefined}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      <Connections
        rooms={a.rooms}
        connections={adjacencies}
        onChange={editConnections}
        intro="Which rooms should sit together, and which should stay apart. The app adds the usual ones (kitchen and dining...); take out any you don't want."
        emptyText="Check at least two rooms above to connect them."
      />

      <section className="card p-6">
        <label className="field-label" htmlFor="feel">
          How it should feel
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
        {feelWords(a.feel).length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Key words">
            {feelWords(a.feel).map((v) => (
              <span key={v} className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs text-accent">
                {v}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="card grid grid-cols-2 gap-6 p-6">
        <Field label="Priorities" hint="Ticked ones change how sketches and plans are ranked.">
          <div className="space-y-1.5">
            {PRIORITIES.map((pr) => (
              <label key={pr.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--color-accent)]"
                  checked={a.priorities.includes(pr.id)}
                  onChange={(e) => setAnswers({ priorities: e.target.checked ? [...a.priorities, pr.id] : a.priorities.filter((x) => x !== pr.id) }, "priorities")}
                />
                {pr.label}
              </label>
            ))}
          </div>
          {tips.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-muted">
              {tips.map((t) => (
                <li key={t}>Tip: {t}</li>
              ))}
            </ul>
          )}
        </Field>
        <Field label="Accessibility">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={a.accessible} onChange={(e) => setAnswers({ accessible: e.target.checked }, "accessible")} />
            Easy to get around with a wheelchair or walker
          </label>
          {a.accessible && (
            <p className="mt-2 text-xs text-muted">
              Doors on the main floor are 36&quot; wide.
              {moved.length > 0 && ` Moved to the main floor so there's a bedroom and bathroom on it: ${moved.join(", ")}.`}
            </p>
          )}
        </Field>
      </section>
    </div>
  );
}

function RoomRow({
  row,
  open,
  onToggle,
  levels,
  rooms,
  onChange,
  onDuplicate,
  onRemove,
  adjacencies,
  editConnections,
  kitchen,
  cars,
}: {
  row: RoomRowInfo;
  open: boolean;
  onToggle: () => void;
  levels: string[];
  rooms: ChosenRoom[];
  onChange: (id: string, patch: Partial<ChosenRoom>, key: string) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  adjacencies: Adjacency[];
  editConnections: (adjacencies: Adjacency[], key: string) => void;
  kitchen?: { open: boolean; picked: boolean; onChange: (open: boolean) => void };
  cars?: { value: number; onChange: (n: number) => void };
}) {
  const r = row.room;
  const label = r.name.trim() || "Unnamed room";
  return (
    <li className="rounded-md border border-line bg-white" data-testid="room-row">
      <div className="flex items-center gap-3 px-3 py-2">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={open} onClick={onToggle}>
          <span className={`inline-block w-3 text-xs text-muted transition-transform ${open ? "rotate-90" : ""}`} aria-hidden>
            ▶
          </span>
          <span className="font-medium">{label}</span>
          <span className="truncate text-xs">
            <span className={row.sizeTyped ? "" : "text-muted"}>{row.dims ? `${row.dims}, ` : ""}{row.sqft.toLocaleString("en-US")} sq ft</span>
            <span className="text-muted"> · </span>
            <span className={row.levelTyped ? "" : "text-muted"}>
              {levelName(row.levelId)}
              {!row.levelTyped && " (app's pick)"}
            </span>
          </span>
        </button>
        <button type="button" className="text-sm text-accent hover:underline" onClick={onDuplicate} aria-label={`Duplicate ${label}`}>
          Duplicate
        </button>
        <button type="button" className="px-1 text-lg leading-none text-muted hover:text-red-700" aria-label={`Remove ${label}`} title="Remove" onClick={onRemove}>
          ×
        </button>
      </div>
      {open && (
        <RoomDetails
          row={row}
          levels={levels}
          rooms={rooms}
          onChange={onChange}
          adjacencies={adjacencies}
          editConnections={editConnections}
          kitchen={kitchen}
          cars={cars}
        />
      )}
    </li>
  );
}

function RoomDetails({
  row,
  levels,
  rooms,
  onChange,
  adjacencies,
  editConnections,
  kitchen,
  cars,
}: {
  row: RoomRowInfo;
  levels: string[];
  rooms: ChosenRoom[];
  onChange: (id: string, patch: Partial<ChosenRoom>, key: string) => void;
  adjacencies: Adjacency[];
  editConnections: (adjacencies: Adjacency[], key: string) => void;
  kitchen?: { open: boolean; picked: boolean; onChange: (open: boolean) => void };
  cars?: { value: number; onChange: (n: number) => void };
}) {
  const r = row.room;
  const fromDims = sqftFromDims(r.lengthIn, r.widthIn);
  const mine = adjacencies.map((e, i) => ({ e, i })).filter(({ e }) => e.a === r.id || e.b === r.id);
  const others = rooms.filter((x) => x.id !== r.id);
  const free = others.filter((x) => !mine.some(({ e }) => e.a === x.id || e.b === x.id));
  const editEdge = (i: number, patch: Partial<Adjacency>) => editConnections(adjacencies.map((e, j) => (j === i ? { ...e, ...patch } : e)), `adj.${i}`);

  return (
    <div className="space-y-4 border-t border-line bg-paper/50 px-4 py-4 text-sm" data-testid="room-details">
      <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-4">
        <Field label="Name">
          <input className="input py-1.5" aria-label="Room name" value={r.name} maxLength={60} onChange={(e) => onChange(r.id, { name: e.target.value }, "name")} />
        </Field>
        <Field label="Type">
          <select className="input py-1.5" aria-label={`${r.name} type`} value={r.type} onChange={(e) => onChange(r.id, { type: e.target.value }, "type")}>
            {BRIEF_ROOM_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Floor">
          <select
            className="input py-1.5"
            aria-label={`${r.name} floor`}
            value={row.levelTyped ? r.levelId : ""}
            onChange={(e) => onChange(r.id, { levelId: e.target.value || undefined }, "level")}
          >
            <option value="">App&apos;s pick: {levelName(row.levelId)}</option>
            {levels
              .slice()
              .reverse()
              .map((id) => (
                <option key={id} value={id}>
                  {levelName(id)}
                </option>
              ))}
          </select>
        </Field>
      </div>

      <div className="flex flex-wrap items-end gap-6">
        <Field label="Length × width (ft)">
          <div className="flex items-center gap-1">
            <FeetInput className="w-16" label={`${r.name} length in feet`} value={r.lengthIn} onChange={(lengthIn) => onChange(r.id, { lengthIn }, "length")} />
            <span className="text-muted">×</span>
            <FeetInput className="w-16" label={`${r.name} width in feet`} value={r.widthIn} onChange={(widthIn) => onChange(r.id, { widthIn }, "width")} />
          </div>
        </Field>
        <Field label="Or the size in sq ft">
          {fromDims ? (
            <p className="py-1.5 text-muted">{fromDims.toLocaleString("en-US")} sq ft, from length × width</p>
          ) : (
            <SqftInput label={`${r.name} size in square feet`} value={r.sqft} guess={row.sqft} onChange={(sqft) => onChange(r.id, { sqft }, "sqft")} />
          )}
        </Field>
        {kitchen && (
          <Field label={kitchen.picked ? "Kitchen" : "Kitchen (app's pick)"}>
            <Choice
              label="Kitchen"
              value={kitchen.open ? "open" : "closed"}
              options={[
                { value: "open", label: "Open" },
                { value: "closed", label: "Closed" },
              ]}
              onChange={(v) => kitchen.onChange(v === "open")}
            />
          </Field>
        )}
        {cars && (
          <Field label="Cars">
            <Stepper label="cars" max={4} value={cars.value} onChange={cars.onChange} />
          </Field>
        )}
      </div>

      <Field label="Notes">
        <input
          className="input py-1.5"
          aria-label={`${r.name} notes`}
          maxLength={1000}
          placeholder="Ideas for how you'll use it, or how it could be laid out"
          value={r.description}
          onChange={(e) => onChange(r.id, { description: e.target.value }, "description")}
        />
      </Field>

      <Field label="Next to">
        {others.length === 0 ? (
          <p className="text-muted">Check another room to connect this one.</p>
        ) : (
          <div className="space-y-2">
            {mine.map(({ e, i }) => {
              const other = e.a === r.id ? e.b : e.a;
              return (
                <div key={`${e.a}-${e.b}-${i}`} className="flex items-center gap-2">
                  <select className="input w-44 py-1.5" aria-label="How they connect" value={e.strength} onChange={(ev) => editEdge(i, { strength: ev.target.value as Adjacency["strength"] })}>
                    {(Object.keys(STRENGTH_LABEL) as Adjacency["strength"][]).map((s) => (
                      <option key={s} value={s}>
                        {STRENGTH_LABEL[s]}
                      </option>
                    ))}
                  </select>
                  <select
                    className="input w-48 py-1.5"
                    aria-label="Next to which room"
                    value={other}
                    onChange={(ev) => editEdge(i, e.a === r.id ? { b: ev.target.value } : { a: ev.target.value })}
                  >
                    {others.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name || "Unnamed room"}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="px-2 text-lg leading-none text-muted hover:text-red-700"
                    aria-label="Remove this connection"
                    onClick={() => editConnections(adjacencies.filter((_, j) => j !== i), `adj.remove.${i}`)}
                  >
                    ×
                  </button>
                </div>
              );
            })}
            {free.length > 0 && (
              <select
                className="input w-60 py-1.5 text-accent"
                aria-label={`Add a room next to ${r.name}`}
                value=""
                onChange={(ev) => ev.target.value && editConnections([...adjacencies, { a: r.id, b: ev.target.value, strength: "nice" }], "adj.add")}
              >
                <option value="">+ Next to another room…</option>
                {free.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name || "Unnamed room"}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </Field>
    </div>
  );
}

/** A size in sq ft that can be left blank for the app's pick, shown as the placeholder. */
function SqftInput({ value, guess, onChange, label }: { value: number | undefined; guess: number; onChange: (n: number | undefined) => void; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <input
        className="input w-24 px-2 py-1.5 text-right tabular-nums"
        inputMode="numeric"
        aria-label={label}
        placeholder={String(guess)}
        value={value ? String(value) : ""}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/[^0-9]/g, ""));
          onChange(n > 0 ? Math.min(n, 5000) : undefined);
        }}
      />
      <span className="text-xs text-muted">{value ? "sq ft" : "sq ft (app's pick)"}</span>
    </div>
  );
}
