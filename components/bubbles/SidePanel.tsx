"use client";

import { useEffect, useRef } from "react";
import type { BubbleDiagram, DesignBrief, Level } from "@/lib/model/schema";
import { CATEGORY_COLOR, FREE_COLOR, MAX_SQFT, MIN_SQFT, bubbleSqft, isDrawn, reshaped, resized } from "@/lib/bubbles/shapes";
import { connected, removeMany, toggleFlow, updateBubble, updateNote } from "@/lib/bubbles/edit";
import { roomType } from "@/lib/brief/rooms";
import type { Selection } from "./types";
import { CommitNumber } from "@/components/brief/controls";

type Props = {
  diagram: BubbleDiagram;
  level: Level;
  levels: Level[];
  brief: DesignBrief | null;
  selection: Selection;
  /** A note to put the cursor in, right after it's placed or double-clicked. */
  focusNote: string | null;
  /** The room being connected by clicking on the drawing, if any. */
  connectFrom: string | null;
  onChange: (d: BubbleDiagram, coalesce?: string) => void;
  onSelect: (s: Selection) => void;
  onMoveToLevel: (bubbleIds: string[], levelId: string) => void;
  onPickConnections: (from: string | null) => void;
};

const SHAPE_NAME = { circle: "Circle", oval: "Oval", free: "Drawn" } as const;

/** Details of whatever is selected on the drawing, or a summary of the level. */
export default function SidePanel(props: Props) {
  const { diagram, level, levels, brief, selection, focusNote, connectFrom, onChange, onSelect, onMoveToLevel, onPickConnections } = props;
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const labelRef = useRef<HTMLInputElement>(null);
  const only = selection.length === 1 ? selection[0] : null;

  // Focus after the click that placed the note has finished, or the click takes the focus back.
  useEffect(() => {
    if (!focusNote || only?.id !== focusNote) return;
    const t = setTimeout(() => noteRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [focusNote, only]);

  const bubble = only?.kind === "bubble" ? diagram.bubbles.find((b) => b.id === only.id) : undefined;
  const note = only?.kind === "note" ? diagram.notes.find((n) => n.id === only.id) : undefined;
  const flow = only?.kind === "flow" ? diagram.flows.find((f) => f.id === only.id) : undefined;
  const stroke = only?.kind === "stroke" ? diagram.strokes.find((s) => s.id === only.id) : undefined;

  // A new bubble arrives labelled "New room": put the cursor in its name.
  useEffect(() => {
    if (bubble?.label !== "New room") return;
    const t = setTimeout(() => labelRef.current?.select(), 0);
    return () => clearTimeout(t);
  }, [bubble?.id, bubble?.label]);

  const remove = (ids: string[]) => {
    onChange(removeMany(diagram, ids));
    onSelect([]);
  };

  if (selection.length > 1) {
    const count = (kind: Selection[number]["kind"]) => selection.filter((s) => s.kind === kind).length;
    const rooms = count("bubble");
    const parts = [
      [rooms, "room", "rooms"],
      [count("note"), "note", "notes"],
      [count("stroke"), "pen mark", "pen marks"],
      [count("flow"), "line", "lines"],
    ] as const;
    const roomIds = selection.filter((s) => s.kind === "bubble").map((s) => s.id);
    return (
      <Panel title={`${selection.length} selected`}>
        <p className="text-sm text-muted">
          {parts
            .filter(([n]) => n > 0)
            .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`)
            .join(", ")}
          .
        </p>
        <p className="mt-2 text-xs text-muted">Drag any of them to move them together. Shift-click to add or remove one.</p>
        {rooms > 0 && levels.length > 1 && (
          <>
            <label className="field-label mt-4" htmlFor="group-level">
              Move to floor
            </label>
            <select
              id="group-level"
              className="input"
              value={level.id}
              onChange={(e) => onMoveToLevel(roomIds, e.target.value)}
            >
              {[...levels].reverse().map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            {rooms < selection.length && <p className="field-hint">Only the rooms move; notes and pen marks stay on this floor.</p>}
          </>
        )}
        <button className="btn mt-4 w-full text-red-700" onClick={() => remove(selection.map((s) => s.id))}>
          Delete {selection.length} things
        </button>
      </Panel>
    );
  }

  if (bubble) {
    const room = brief?.rooms.find((r) => r.id === bubble.roomId);
    const setB = (patch: Parameters<typeof updateBubble>[2], key: string) => onChange(updateBubble(diagram, bubble.id, patch), `${key}.${bubble.id}`);
    const others = diagram.bubbles.filter((b) => b.id !== bubble.id).sort((a, b) => a.label.localeCompare(b.label));
    const picking = connectFrom === bubble.id;
    const shapes = isDrawn(bubble) ? (["free", "circle", "oval"] as const) : (["circle", "oval"] as const);
    return (
      <Panel title={bubble.stairs ? "Stairs" : "Room"}>
        <label className="field-label" htmlFor="bubble-label">
          Name
        </label>
        <input
          id="bubble-label"
          ref={labelRef}
          className="input"
          value={bubble.label}
          maxLength={60}
          onChange={(e) => setB({ label: e.target.value }, "label")}
        />

        {brief && !bubble.stairs && (
          <>
            <label className="field-label mt-4" htmlFor="bubble-room">
              Room in your brief
            </label>
            <select
              id="bubble-room"
              className="input"
              value={bubble.roomId ?? ""}
              onChange={(e) => {
                const r = brief.rooms.find((x) => x.id === e.target.value);
                setB(
                  r
                    ? { roomId: r.id, label: bubble.label === "New room" ? r.name : bubble.label, color: CATEGORY_COLOR[roomType(r.type).category] }
                    : { roomId: undefined, color: FREE_COLOR },
                  "room",
                );
              }}
            >
              <option value="">Not one of your rooms</option>
              {brief.rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </>
        )}

        <label className="field-label mt-4" htmlFor="bubble-size">
          Size
        </label>
        <div className="flex items-center gap-2">
          <CommitNumber
            id="bubble-size"
            className="w-28"
            min={MIN_SQFT}
            max={MAX_SQFT}
            step={5}
            value={bubbleSqft(bubble)}
            onCommit={(n) => onChange(updateBubble(diagram, bubble.id, resized(bubble, n)), `size.${bubble.id}`)}
          />
          <span className="text-sm text-muted">sq ft</span>
        </div>
        {room && <p className="field-hint">Your brief says about {Math.round(room.targetSqFt).toLocaleString("en-US")} sq ft.</p>}

        <p className="field-label mt-4">Shape</p>
        <div className="inline-flex rounded-md border border-line bg-white p-0.5" role="radiogroup" aria-label="Shape">
          {shapes.map((shape) => (
            <button
              key={shape}
              role="radio"
              aria-checked={bubble.shape === shape}
              className={`rounded px-3 py-1 text-sm ${bubble.shape === shape ? "bg-accent text-white" : "text-muted hover:text-ink"}`}
              onClick={() => {
                if (shape === bubble.shape) return;
                if (isDrawn(bubble) && !window.confirm(`Turn ${bubble.label} into ${shape === "circle" ? "a circle" : "an oval"} of the same size? Its drawn outline goes away (Undo brings it back).`)) return;
                onChange(updateBubble(diagram, bubble.id, reshaped(bubble, shape)));
              }}
            >
              {SHAPE_NAME[shape]}
            </button>
          ))}
        </div>

        <p className="field-label mt-4">Connects to</p>
        {others.length === 0 ? (
          <p className="text-sm text-muted">There are no other rooms on this floor yet.</p>
        ) : (
          <ul className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border border-line bg-white p-1 text-sm" aria-label={`Rooms connected to ${bubble.label}`}>
            {others.map((o) => (
              <li key={o.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-stone-100">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--color-accent)]"
                    checked={connected(diagram, bubble.id, o.id)}
                    onChange={() => onChange(toggleFlow(diagram, bubble.id, o.id))}
                  />
                  <span className="size-3 shrink-0 rounded-full border border-black/20" style={{ background: o.color ?? FREE_COLOR }} />
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {others.length > 0 && (
          <button className={`btn mt-2 w-full ${picking ? "border-accent text-accent" : ""}`} aria-pressed={picking} onClick={() => onPickConnections(picking ? null : bubble.id)}>
            {picking ? "Done picking" : "Pick on drawing"}
          </button>
        )}

        {levels.length > 1 && (
          <>
            <label className="field-label mt-4" htmlFor="bubble-level">
              Floor
            </label>
            <select id="bubble-level" className="input" value={level.id} onChange={(e) => onMoveToLevel([bubble.id], e.target.value)}>
              {[...levels].reverse().map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </>
        )}

        <p className="mt-4 text-xs text-muted">
          {bubble.shape === "circle" ? "Drag the corner handles to resize." : bubble.shape === "oval" ? "Drag the handles to resize or turn it." : "Drag the handles to stretch or turn it."}
        </p>
        <button className="mt-4 text-sm text-red-700 hover:underline" onClick={() => remove([bubble.id])}>
          Delete this {bubble.stairs ? "bubble" : "room"}
        </button>
      </Panel>
    );
  }

  if (note) {
    return (
      <Panel title="Note">
        <textarea
          ref={noteRef}
          aria-label="Note text"
          className="input min-h-32"
          maxLength={500}
          placeholder="Write anything: ideas, questions, reminders."
          value={note.text}
          onChange={(e) => onChange(updateNote(diagram, note.id, { text: e.target.value }), `note.${note.id}`)}
        />
        <button className="mt-4 text-sm text-red-700 hover:underline" onClick={() => remove([note.id])}>
          Delete this note
        </button>
      </Panel>
    );
  }

  if (flow) {
    const name = (id: string) => diagram.bubbles.find((b) => b.id === id)?.label ?? "a room";
    return (
      <Panel title="Flow line">
        <p className="text-sm">
          You can walk between <strong>{name(flow.from)}</strong> and <strong>{name(flow.to)}</strong>.
        </p>
        <button className="mt-4 text-sm text-red-700 hover:underline" onClick={() => remove([flow.id])}>
          Delete this line
        </button>
      </Panel>
    );
  }

  if (stroke) {
    return (
      <Panel title="Pen mark">
        <button className="text-sm text-red-700 hover:underline" onClick={() => remove([stroke.id])}>
          Delete this mark
        </button>
      </Panel>
    );
  }

  const rooms = diagram.bubbles.filter((b) => !b.stairs);
  const total = rooms.reduce((s, b) => s + bubbleSqft(b), 0);
  return (
    <Panel title={level.name}>
      <p className="text-sm text-muted">
        {rooms.length === 0
          ? "Nothing on this floor yet."
          : `${rooms.length} ${rooms.length === 1 ? "room" : "rooms"}, about ${total.toLocaleString("en-US")} sq ft of bubbles.`}
      </p>
      {diagram.bubbles.length > 0 && (
        <ul className="mt-3 max-h-80 space-y-0.5 overflow-y-auto text-sm">
          {diagram.bubbles.map((b) => (
            <li key={b.id}>
              <button className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-stone-100" onClick={() => onSelect([{ kind: "bubble", id: b.id }])}>
                <span className="size-3 shrink-0 rounded-full border border-black/20" style={{ background: b.color ?? FREE_COLOR }} />
                <span className="min-w-0 flex-1 truncate">{b.label}</span>
                <span className="text-xs text-muted tabular-nums">{bubbleSqft(b)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs text-muted">Click a room on the drawing to rename it, resize it, connect it to other rooms or move it to another floor.</p>
    </Panel>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {children}
    </div>
  );
}
