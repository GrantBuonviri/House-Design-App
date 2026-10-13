"use client";

import { useEffect, useRef } from "react";
import type { BubbleDiagram, DesignBrief, Level } from "@/lib/model/schema";
import { CATEGORY_COLOR, FREE_COLOR, MAX_SQFT, MIN_SQFT, bubbleSqft, reshaped, resized } from "@/lib/bubbles/shapes";
import { removeAny, updateBubble, updateNote } from "@/lib/bubbles/edit";
import { roomType } from "@/lib/brief/rooms";
import type { Selection } from "./types";

type Props = {
  diagram: BubbleDiagram;
  level: Level;
  levels: Level[];
  brief: DesignBrief | null;
  selection: Selection;
  /** A note to put the cursor in, right after it's placed or double-clicked. */
  focusNote: string | null;
  onChange: (d: BubbleDiagram, coalesce?: string) => void;
  onSelect: (s: Selection) => void;
  onMoveToLevel: (bubbleId: string, levelId: string) => void;
};

/** Details of whatever is selected on the drawing, or a summary of the level. */
export default function SidePanel(props: Props) {
  const { diagram, level, levels, brief, selection, focusNote, onChange, onSelect, onMoveToLevel } = props;
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const labelRef = useRef<HTMLInputElement>(null);

  // Focus after the click that placed the note has finished, or the click takes the focus back.
  useEffect(() => {
    if (!focusNote || selection?.id !== focusNote) return;
    const t = setTimeout(() => noteRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [focusNote, selection]);

  const bubble = selection?.kind === "bubble" ? diagram.bubbles.find((b) => b.id === selection.id) : undefined;
  const note = selection?.kind === "note" ? diagram.notes.find((n) => n.id === selection.id) : undefined;
  const flow = selection?.kind === "flow" ? diagram.flows.find((f) => f.id === selection.id) : undefined;
  const stroke = selection?.kind === "stroke" ? diagram.strokes.find((s) => s.id === selection.id) : undefined;

  // A new bubble arrives labelled "New room": put the cursor in its name.
  useEffect(() => {
    if (bubble?.label !== "New room") return;
    const t = setTimeout(() => labelRef.current?.select(), 0);
    return () => clearTimeout(t);
  }, [bubble?.id, bubble?.label]);

  const remove = (id: string) => {
    onChange(removeAny(diagram, id));
    onSelect(null);
  };

  if (bubble) {
    const room = brief?.rooms.find((r) => r.id === bubble.roomId);
    const setB = (patch: Parameters<typeof updateBubble>[2], key: string) => onChange(updateBubble(diagram, bubble.id, patch), `${key}.${bubble.id}`);
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
          <input
            id="bubble-size"
            type="number"
            className="input w-28 tabular-nums"
            min={MIN_SQFT}
            max={MAX_SQFT}
            step={5}
            value={bubbleSqft(bubble)}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (n > 0) onChange(updateBubble(diagram, bubble.id, resized(bubble, n)), `size.${bubble.id}`);
            }}
          />
          <span className="text-sm text-muted">sq ft</span>
        </div>
        {room && <p className="field-hint">Your brief says about {Math.round(room.targetSqFt).toLocaleString("en-US")} sq ft.</p>}

        <p className="field-label mt-4">Shape</p>
        <div className="inline-flex rounded-md border border-line bg-white p-0.5" role="radiogroup" aria-label="Shape">
          {(["circle", "oval"] as const).map((shape) => (
            <button
              key={shape}
              role="radio"
              aria-checked={bubble.shape === shape}
              className={`rounded px-3 py-1 text-sm ${bubble.shape === shape ? "bg-accent text-white" : "text-muted hover:text-ink"}`}
              onClick={() => onChange(updateBubble(diagram, bubble.id, reshaped(bubble, shape)))}
            >
              {shape === "circle" ? "Circle" : "Oval"}
            </button>
          ))}
        </div>

        {levels.length > 1 && (
          <>
            <label className="field-label mt-4" htmlFor="bubble-level">
              Floor
            </label>
            <select id="bubble-level" className="input" value={level.id} onChange={(e) => onMoveToLevel(bubble.id, e.target.value)}>
              {[...levels].reverse().map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </>
        )}

        <p className="mt-4 text-xs text-muted">Drag the corner handles to resize{bubble.shape === "oval" ? " or turn it" : ""}.</p>
        <button className="mt-4 text-sm text-red-700 hover:underline" onClick={() => remove(bubble.id)}>
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
        <button className="mt-4 text-sm text-red-700 hover:underline" onClick={() => remove(note.id)}>
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
        <button className="mt-4 text-sm text-red-700 hover:underline" onClick={() => remove(flow.id)}>
          Delete this line
        </button>
      </Panel>
    );
  }

  if (stroke) {
    return (
      <Panel title="Pen mark">
        <button className="text-sm text-red-700 hover:underline" onClick={() => remove(stroke.id)}>
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
              <button className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-stone-100" onClick={() => onSelect({ kind: "bubble", id: b.id })}>
                <span className="size-3 shrink-0 rounded-full border border-black/20" style={{ background: b.color ?? FREE_COLOR }} />
                <span className="min-w-0 flex-1 truncate">{b.label}</span>
                <span className="text-xs text-muted tabular-nums">{bubbleSqft(b)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs text-muted">Click a room on the drawing to rename, resize or move it to another floor.</p>
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
