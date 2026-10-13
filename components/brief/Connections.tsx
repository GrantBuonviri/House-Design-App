"use client";

import type { Adjacency } from "@/lib/model/schema";

type Strength = Adjacency["strength"];

const STRENGTH_LABEL: Record<Strength, string> = {
  must: "must connect to",
  nice: "is nice to be close to",
  avoid: "should be kept apart from",
};

/**
 * Which rooms should sit together and which should stay apart. Used on the
 * rooms page and in the Design Brief.
 */
export default function Connections({
  rooms,
  connections,
  onChange,
  intro = "Which rooms should sit together, and which should stay apart.",
  emptyText,
}: {
  rooms: { id: string; name: string }[];
  connections: Adjacency[];
  onChange: (connections: Adjacency[], key: string) => void;
  intro?: string;
  emptyText?: string;
}) {
  const edit = (i: number, patch: Partial<Adjacency>) =>
    onChange(
      connections.map((e, j) => (j === i ? { ...e, ...patch } : e)),
      `adj.${i}`,
    );
  return (
    <section className="card p-6">
      <h3 className="font-semibold">How rooms connect</h3>
      <p className="mb-4 text-sm text-muted">{intro}</p>
      {rooms.length < 2 ? (
        <p className="text-sm text-muted">{emptyText ?? "Add at least two rooms to connect them."}</p>
      ) : (
        <>
          <ul className="space-y-2">
            {connections.map((e, i) => (
              <li key={`${e.a}-${e.b}-${i}`} className="flex items-center gap-2 text-sm">
                <RoomSelect rooms={rooms} value={e.a} label="First room" onChange={(a) => edit(i, { a })} />
                <select
                  className="input w-52 py-1.5"
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
                  onClick={() => onChange(connections.filter((_, j) => j !== i), `adj.remove.${i}`)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="mt-3 text-sm text-accent hover:underline"
            onClick={() => onChange([...connections, { a: rooms[0].id, b: rooms[1].id, strength: "nice" }], "adj.add")}
          >
            + Add a connection
          </button>
        </>
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
  rooms: { id: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  return (
    <select className="input w-52 py-1.5" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {rooms.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name || "Unnamed room"}
        </option>
      ))}
    </select>
  );
}
