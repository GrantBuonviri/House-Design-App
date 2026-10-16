"use client";

import { useEffect, useRef, useState } from "react";
import { WINDOW_OPERATIONS, type WindowOperation } from "@/lib/model/schema";
import { defaultOperation, operationOf, OPERATION_HINT, OPERATION_LABEL } from "@/lib/codes/openings";
import type { DesignBrief, FloorPlan, Level, PlanBasics, PlanStairs, WallHeight } from "@/lib/model/schema";
import { formatFeetInches, parseFeetInches } from "@/lib/model/units";
import { ceilingFor, riseBetween, STAIRS_LABEL } from "@/lib/plan/basics";
import { FIXTURE_GROUPS, FIXTURE_TYPES, OPENING_TYPES, fixtureType, openingType } from "@/lib/plan/catalog";
import { centerOfMany, insertCorner, removeMany, rotateMany, setEdgeLength, setWallLength, updateOpening, updateRoom } from "@/lib/plan/edit";
import { dist, isRectangle, lerp, polygonCenter } from "@/lib/plan/geometry";
import { planTotals, roomSqft, totalsText } from "@/lib/plan/measure";
import { MIN_STAIRS_WIDTH_IN, stairsDrawing } from "@/lib/plan/stairs";
import { clampOffset, hostSegment } from "@/lib/plan/walls";
import { combineRooms, edgeWalls, removeWall, restoreWall, roomsAlong, whyNotCombine, whyWallStays } from "@/lib/plan/openWalls";
import { newOpening } from "@/lib/plan/connect";
import { canPreview } from "@/lib/house3d/windowView";
import { ROOM_TYPES, roomType } from "@/lib/brief/rooms";
import { parseEdgeId, type PlanSelection, type PlanTool } from "./types";

/** Room types a plan can have that a brief doesn't: hallways and closets. */
const PLAN_ONLY = ROOM_TYPES.filter((t) => t.planOnly).map((t) => t.id);

type Props = {
  plan: FloorPlan;
  level: Level;
  levels: Level[];
  brief: DesignBrief | null;
  basics: PlanBasics | null;
  selection: PlanSelection;
  tool: PlanTool;
  /** The Room tool fills a space closed in by walls, instead of drawing an outline. */
  fillMode?: boolean;
  onFillMode?: (on: boolean) => void;
  placeOpening: string;
  placeFixture: string;
  onPlaceOpening: (id: string) => void;
  onPlaceFixture: (id: string) => void;
  onChange: (p: FloorPlan, coalesce?: string) => void;
  onSelect: (s: PlanSelection) => void;
  /** Open the Preview window popup for a window or sliding glass door on an outside wall. */
  onPreviewWindow?: (openingId: string) => void;
};

/** Details of whatever is selected on the plan, the catalog for the placing tools, or a summary of the floor. */
export default function PlanSidePanel(props: Props) {
  const { plan, level, levels, brief, basics, selection, tool, placeOpening, placeFixture, onPlaceOpening, onPlaceFixture, onChange, onSelect } = props;
  const nameRef = useRef<HTMLInputElement>(null);
  const only = selection.length === 1 ? selection[0] : null;
  const room = only?.kind === "room" ? plan.rooms.find((r) => r.id === only.id) : undefined;
  // Rooms just combined into this one: ask for a name for the bigger room.
  const [combined, setCombined] = useState<string | null>(null);

  // A new room arrives as "New room" (or "Room 2" when split off another), and a combined room wants a new name: put the cursor in its name.
  const askName = !!room && (room.name === "New room" || /^Room \d+$/.test(room.name) || combined === room.id);
  useEffect(() => {
    if (!askName) return;
    const t = setTimeout(() => nameRef.current?.select(), 0);
    return () => clearTimeout(t);
  }, [room?.id, askName]);

  useEffect(() => {
    if (combined && only?.id !== combined) setCombined(null);
  }, [only?.id, combined]);

  const combine = (ids: string[]) => {
    const out = combineRooms(plan, ids);
    if (!out) return;
    onChange(out.plan);
    onSelect([{ kind: "room", id: out.keptId }]);
    setCombined(out.keptId);
  };

  const remove = (ids: string[]) => {
    onChange(removeMany(plan, ids));
    onSelect([]);
  };

  // ---- The Room tool: draw an outline, or fill a space walls close in ----
  if (tool === "room" && props.onFillMode) {
    return (
      <Panel title="Room">
        <Choices
          items={[
            { id: "draw", label: "Draw a room" },
            { id: "fill", label: "Fill a space" },
          ]}
          value={props.fillMode ? "fill" : "draw"}
          onPick={(id) => props.onFillMode?.(id === "fill")}
        />
        <p className="field-hint mt-2">
          {props.fillMode
            ? "Draw the walls first with the Wall tool, then click inside the space they close in. It becomes a room shaped to those walls."
            : "Drag a rectangle, or click corner by corner for any shape."}
        </p>
      </Panel>
    );
  }

  // ---- Catalogs for the placing tools ----
  if (tool === "door") {
    return (
      <Panel title="Doors and windows">
        <p className="mb-2 text-xs text-muted">Pick one, then click a wall. Doors swing toward the side you click on.</p>
        <Choices items={OPENING_TYPES.map((t) => ({ id: t.id, label: t.label, note: `${formatFeetInches(t.widths[0])} wide` }))} value={placeOpening} onPick={onPlaceOpening} />
      </Panel>
    );
  }
  if (tool === "fixture") {
    return (
      <Panel title="Fixtures">
        <p className="mb-2 text-xs text-muted">Pick one, then click inside a room. Close to a wall, it backs up against it.</p>
        {FIXTURE_GROUPS.map((g) => (
          <div key={g} className="mb-2">
            <p className="field-label">{g}</p>
            <Choices
              items={FIXTURE_TYPES.filter((t) => t.group === g).map((t) => ({ id: t.id, label: t.label, note: `${formatFeetInches(t.widthIn)} × ${formatFeetInches(t.depthIn)}` }))}
              value={placeFixture}
              onPick={onPlaceFixture}
            />
          </div>
        ))}
      </Panel>
    );
  }

  // ---- Several things ----
  if (selection.length > 1) {
    const turnable = selection.filter((s) => s.kind !== "edge" && s.kind !== "opening").map((s) => s.id);
    return (
      <Panel title={`${selection.length} selected`}>
        <p className="text-xs text-muted">Drag any of them to move them together. Shift-click to add or remove one.</p>
        {selection.every((s) => s.kind === "room") && <CombineButton plan={plan} ids={selection.map((s) => s.id)} label="Combine into one room" onCombine={combine} />}
        {turnable.length > 0 && <TurnButtons onTurn={(deg) => onChange(rotateMany(plan, turnable, deg, centerOfMany(plan, turnable)))} />}
        <button className="btn mt-4 w-full text-red-700" onClick={() => remove(selection.filter((s) => s.kind !== "edge").map((s) => s.id))}>
          Delete {selection.filter((s) => s.kind !== "edge").length} things
        </button>
      </Panel>
    );
  }

  // ---- A room ----
  if (room) {
    const brRoom = brief?.rooms.find((r) => r.id === room.briefRoomId);
    const rect = isRectangle(room.polygon);
    const set = (patch: Parameters<typeof updateRoom>[2], key: string) => onChange(updateRoom(plan, room.id, patch), `${key}.${room.id}`);
    return (
      <Panel title="Room">
        {combined === room.id && <p className="mb-3 rounded bg-accent/10 p-2 text-xs">Rooms combined. Give the new room a name.</p>}
        <label className="field-label" htmlFor="room-name">
          Name
        </label>
        <input id="room-name" ref={nameRef} className="input" value={room.name} maxLength={60} onChange={(e) => set({ name: e.target.value }, "name")} />

        <label className="field-label mt-4" htmlFor="room-brief">
          {brief ? "Room in your brief" : "What it is"}
        </label>
        <select
          id="room-brief"
          className="input"
          value={room.briefRoomId ?? (room.type && PLAN_ONLY.includes(room.type) ? `type:${room.type}` : "")}
          onChange={(e) => {
            const v = e.target.value;
            const r = brief?.rooms.find((x) => x.id === v);
            if (r) set({ briefRoomId: r.id, type: r.type, name: room.name === "New room" ? r.name : room.name }, "brief");
            else if (v.startsWith("type:")) {
              const type = v.slice(5);
              set({ briefRoomId: undefined, type, name: room.name === "New room" ? roomType(type).label : room.name }, "brief");
            } else set({ briefRoomId: undefined, type: undefined }, "brief");
          }}
        >
          <option value="">{brief ? "Not one of your rooms" : "A room"}</option>
          {brief && brief.rooms.length > 0 && (
            <optgroup label="Your rooms">
              {brief.rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Not in your brief">
            {PLAN_ONLY.map((t) => (
              <option key={t} value={`type:${t}`}>
                {roomType(t).label}
              </option>
            ))}
          </optgroup>
        </select>

        <p className="field-label mt-4">Size</p>
        <p className="text-sm">
          <span className="font-semibold tabular-nums">{roomSqft(room).toLocaleString("en-US")} sq ft</span>
          {brRoom && <span className="text-muted"> · your brief says about {Math.round(brRoom.targetSqFt).toLocaleString("en-US")}</span>}
        </p>
        {rect && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <LengthField label="Width" value={dist(room.polygon[0], room.polygon[1])} onCommit={(v) => onChange(setEdgeLength(plan, room.id, 0, v))} />
            <LengthField label="Depth" value={dist(room.polygon[1], room.polygon[2])} onCommit={(v) => onChange(setEdgeLength(plan, room.id, 1, v))} />
          </div>
        )}
        <p className="field-hint">
          {rect ? "Type a size, drag a wall to push it, or drag a corner dot." : `${room.polygon.length} corners. Drag a wall to push it, or a corner dot to reshape it.`} Drag the + on a wall to add a
          corner; double-click a corner (or pick it and press Delete) to take it away.
        </p>

        <TurnButtons onTurn={(deg) => onChange(rotateMany(plan, [room.id], deg, polygonCenter(room.polygon)))} />

        <button className="mt-4 text-sm text-red-700 hover:underline" onClick={() => remove([room.id])}>
          Delete this room
        </button>
      </Panel>
    );
  }

  // ---- One wall of a room ----
  if (only?.kind === "edge") {
    const { roomId, edge } = parseEdgeId(only.id);
    const r = plan.rooms.find((x) => x.id === roomId);
    const seg = hostSegment(plan, { roomId, edge });
    if (!r || !seg) return <FloorSummary {...props} />;
    const addHere = (style: string) => {
      const t = openingType(style);
      const o = newOpening(style, { roomId, edge }, clampOffset(seg.length / 2, t.widths[0], seg.length), -1);
      onChange({ ...plan, openings: [...plan.openings, o] });
      onSelect([{ kind: "opening", id: o.id }]);
    };
    return (
      <Panel title={`Wall of ${r.name}`}>
        <LengthField label="Length" value={seg.length} onCommit={(v) => onChange(setEdgeLength(plan, roomId, edge, v))} />
        <p className="field-hint">The far end moves; drag the wall on the drawing to push it in or out.</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button className="btn text-sm" onClick={() => addHere("door-hinged")}>
            Add a door
          </button>
          <button className="btn text-sm" onClick={() => addHere("window")}>
            Add a window
          </button>
        </div>
        <button
          className="btn mt-2 w-full text-sm"
          onClick={() => {
            onChange(insertCorner(plan, roomId, edge, lerp(seg.a, seg.b, 0.5)));
            onSelect([{ kind: "room", id: roomId }]);
          }}
        >
          Add a corner in the middle
        </button>
        <WallRemoval plan={plan} roomId={roomId} edge={edge} onChange={onChange} onCombine={combine} />
      </Panel>
    );
  }

  // ---- A wall drawn on its own ----
  if (only?.kind === "wall") {
    const w = plan.walls.find((x) => x.id === only.id);
    if (!w) return <FloorSummary {...props} />;
    return (
      <Panel title="Wall">
        <LengthField label="Length" value={dist(w.a, w.b)} onCommit={(v) => onChange(setWallLength(plan, w.id, v))} />
        <label className="field-label mt-4" htmlFor="wall-thick">
          Thickness
        </label>
        <select
          id="wall-thick"
          className="input"
          value={w.thicknessIn}
          onChange={(e) => onChange({ ...plan, walls: plan.walls.map((x) => (x.id === w.id ? { ...x, thicknessIn: Number(e.target.value) } : x)) })}
        >
          <option value={4.5}>4 1/2&quot; (2x4 inside wall)</option>
          <option value={6.5}>6 1/2&quot; (2x6, for plumbing)</option>
          <option value={3.5}>3 1/2&quot; (thin, half wall)</option>
        </select>
        <label className="field-label mt-4" htmlFor="wall-height">
          Height
        </label>
        <select
          id="wall-height"
          className="input"
          value={w.height ?? "full"}
          onChange={(e) => onChange({ ...plan, walls: plan.walls.map((x) => (x.id === w.id ? { ...x, height: e.target.value as WallHeight } : x)) })}
        >
          <option value="full">Full height</option>
          <option value="half">Half wall (42&quot;)</option>
          <option value="half-cap">Half wall with a counter cap</option>
        </select>
        <p className="field-hint">
          {w.height && w.height !== "full"
            ? "Stops at 42\" so the rooms stay open above it. Shows in 3D, the walkthrough, the cost and the PDF floor plan."
            : "Runs up to the ceiling."}
        </p>
        <button className="mt-4 text-sm text-red-700 hover:underline" onClick={() => remove([w.id])}>
          Delete this wall
        </button>
      </Panel>
    );
  }

  // ---- A door, window or opening ----
  if (only?.kind === "opening") {
    const o = plan.openings.find((x) => x.id === only.id);
    if (!o) return <FloorSummary {...props} />;
    const t = openingType(o.style);
    const set = (patch: Parameters<typeof updateOpening>[2]) => onChange(updateOpening(plan, o.id, patch));
    const widths = [...new Set([...t.widths, o.widthIn])].sort((a, b) => a - b);
    const previewable = props.onPreviewWindow && canPreview(plan, o, basics);
    return (
      <Panel title={t.label}>
        {previewable && (
          <button className="btn-primary mb-4 w-full text-sm" onClick={() => props.onPreviewWindow?.(o.id)} title="See the view out of this window, and the window from outside">
            Preview window
          </button>
        )}
        <label className="field-label" htmlFor="op-type">
          Type
        </label>
        <select
          id="op-type"
          className="input"
          value={o.style}
          onChange={(e) => {
            const nt = openingType(e.target.value);
            set({ style: nt.id, kind: nt.kind, widthIn: nt.widths.includes(o.widthIn) ? o.widthIn : nt.widths[0], heightIn: nt.heightIn, sillIn: nt.sillIn });
          }}
        >
          {OPENING_TYPES.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
        </select>
        <label className="field-label mt-4" htmlFor="op-width">
          Width
        </label>
        <select id="op-width" className="input" value={o.widthIn} onChange={(e) => set({ widthIn: Number(e.target.value) })}>
          {widths.map((w) => (
            <option key={w} value={w}>
              {formatFeetInches(w)}
            </option>
          ))}
        </select>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <LengthField label="Height" value={o.heightIn} onCommit={(v) => set({ heightIn: Math.max(12, v) })} />
          {o.kind === "window" && <LengthField label="Off the floor" value={o.sillIn ?? 30} onCommit={(v) => set({ sillIn: Math.max(0, v) })} />}
        </div>
        {o.kind === "window" && (
          <>
            <label className="field-label mt-4" htmlFor="op-operation">
              Opens as
            </label>
            <select
              id="op-operation"
              className="input"
              value={operationOf(o)}
              onChange={(e) => {
                const v = e.target.value as WindowOperation;
                set({ operation: v === defaultOperation(o.style) ? undefined : v });
              }}
            >
              {WINDOW_OPERATIONS.map((x) => (
                <option key={x} value={x}>
                  {OPERATION_LABEL[x]}: {OPERATION_HINT[x].toLowerCase()}
                </option>
              ))}
            </select>
            <p className="field-hint">Used for the window schedule and the bedroom escape-window check.</p>
          </>
        )}
        {t.swings && (
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button className="btn text-sm" onClick={() => set({ side: o.side === 1 ? -1 : 1 })}>
              Swing other way
            </button>
            {!t.double && (
              <button className="btn text-sm" onClick={() => set({ hinge: o.hinge === "start" ? "end" : "start" })}>
                Hinge other side
              </button>
            )}
          </div>
        )}
        {t.id === "door-barn" && (
          <button className="btn mt-4 w-full text-sm" onClick={() => set({ side: o.side === 1 ? -1 : 1 })}>
            Slide on the other side
          </button>
        )}
        <p className="field-hint">Drag it along the wall, or onto another wall.</p>
        <button className="mt-4 text-sm text-red-700 hover:underline" onClick={() => remove([o.id])}>
          Delete this {o.kind === "window" ? "window" : o.kind === "door" ? "door" : "opening"}
        </button>
      </Panel>
    );
  }

  // ---- Stairs ----
  if (only?.kind === "stairs") {
    const st = plan.stairs.find((x) => x.id === only.id);
    if (!st) return <FloorSummary {...props} />;
    const set = (patch: Partial<PlanStairs>) => onChange({ ...plan, stairs: plan.stairs.map((x) => (x.id === st.id ? { ...x, ...patch } : x)) });
    const ups = levels.filter((l) => l.elevationIn > level.elevationIn);
    const to = levels.find((l) => l.id === st.toLevelId);
    const d = to ? stairsDrawing(st, riseBetween(basics, level, to)) : null;
    return (
      <Panel title="Stairs">
        <label className="field-label" htmlFor="st-shape">
          Shape
        </label>
        <select id="st-shape" className="input" value={st.shape} onChange={(e) => set({ shape: e.target.value as PlanStairs["shape"] })}>
          {(Object.keys(STAIRS_LABEL) as PlanStairs["shape"][]).map((k) => (
            <option key={k} value={k}>
              {STAIRS_LABEL[k]}
            </option>
          ))}
        </select>
        <div className="mt-4">
          <LengthField label="Width" value={st.widthIn} onCommit={(v) => set({ widthIn: Math.max(MIN_STAIRS_WIDTH_IN, Math.min(72, v)) })} />
        </div>
        {ups.length > 0 && (
          <>
            <label className="field-label mt-4" htmlFor="st-to">
              Climbs to
            </label>
            <select id="st-to" className="input" value={st.toLevelId ?? ""} onChange={(e) => set({ toLevelId: e.target.value })}>
              {ups.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </>
        )}
        {d && (
          <p className="field-hint">
            {d.risers} steps of {eighths(d.riserIn)} to climb {formatFeetInches(d.risers * d.riserIn)}, {formatFeetInches(d.runIn)} of treads. They show on the{" "}
            {to?.name.toLowerCase()} too.
          </p>
        )}
        <TurnButtons onTurn={(deg) => set({ rotation: (((st.rotation + deg) % 360) + 360) % 360 })} />
        {st.shape !== "straight" && (
          <button className="btn mt-2 w-full text-sm" onClick={() => set({ flip: !st.flip })}>
            Turn the other way
          </button>
        )}
        <button className="mt-4 text-sm text-red-700 hover:underline" onClick={() => remove([st.id])}>
          Delete these stairs
        </button>
      </Panel>
    );
  }

  // ---- A fixture ----
  if (only?.kind === "fixture") {
    const f = plan.fixtures.find((x) => x.id === only.id);
    if (!f) return <FloorSummary {...props} />;
    const t = fixtureType(f.kind);
    const set = (patch: Partial<typeof f>) => onChange({ ...plan, fixtures: plan.fixtures.map((x) => (x.id === f.id ? { ...x, ...patch } : x)) });
    return (
      <Panel title={t.label}>
        <div className="grid grid-cols-2 gap-2">
          {t.stretch ? <LengthField label="Width" value={f.widthIn} onCommit={(v) => set({ widthIn: Math.max(12, v) })} /> : <Static label="Width" value={formatFeetInches(f.widthIn)} />}
          <Static label="Depth" value={formatFeetInches(f.depthIn)} />
        </div>
        <TurnButtons onTurn={(deg) => set({ rotation: (((f.rotation + deg) % 360) + 360) % 360 })} />
        <p className="field-hint">Drag to move it{t.stretch ? ", or pull the side handles to stretch it" : ""}. The round handle turns it.</p>
        <button className="mt-4 text-sm text-red-700 hover:underline" onClick={() => remove([f.id])}>
          Delete this {t.label.toLowerCase()}
        </button>
      </Panel>
    );
  }

  return <FloorSummary {...props} />;
}

function FloorSummary(p: Props) {
  const totals = planTotals(p.plan);
  const ceiling = ceilingFor(p.basics, p.level);
  return (
    <Panel title={p.level.name}>
      <p className="text-sm text-muted">{p.plan.rooms.length === 0 ? "Nothing on this floor yet." : totalsText(totals)}</p>
      <p className="mt-1 text-xs text-muted">Ceilings {formatFeetInches(ceiling)}.</p>
      {p.plan.rooms.length > 0 && (
        <ul className="mt-3 max-h-80 space-y-0.5 overflow-y-auto text-sm">
          {[...p.plan.rooms]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((r) => (
              <li key={r.id}>
                <button className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-stone-100" onClick={() => p.onSelect([{ kind: "room", id: r.id }])}>
                  <span className="min-w-0 flex-1 truncate">{r.name}</span>
                  <span className="text-xs text-muted tabular-nums">{roomSqft(r)}</span>
                </button>
              </li>
            ))}
        </ul>
      )}
      <p className="mt-4 text-xs text-muted">Click a room or a wall on the drawing to change it. Sizes are measured to the middle of the walls.</p>
    </Panel>
  );
}

/** Inches to the nearest eighth, like 7 5/8". */
function eighths(inches: number): string {
  const e = Math.round(inches * 8);
  const whole = Math.floor(e / 8);
  let num = e % 8;
  let den = 8;
  while (num && num % 2 === 0) {
    num /= 2;
    den /= 2;
  }
  return num ? `${whole} ${num}/${den}"` : `${whole}"`;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {children}
    </div>
  );
}

function Choices({ items, value, onPick }: { items: { id: string; label: string; note?: string }[]; value: string; onPick: (id: string) => void }) {
  return (
    <ul className="space-y-0.5" role="radiogroup">
      {items.map((it) => (
        <li key={it.id}>
          <button
            role="radio"
            aria-checked={value === it.id}
            className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm ${value === it.id ? "bg-accent text-white" : "hover:bg-stone-100"}`}
            onClick={() => onPick(it.id)}
          >
            <span>{it.label}</span>
            {it.note && <span className={`text-xs ${value === it.id ? "text-white/80" : "text-muted"}`}>{it.note}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

function TurnButtons({ onTurn }: { onTurn: (deg: number) => void }) {
  return (
    <div className="mt-4">
      <p className="field-label">Turn</p>
      <div className="grid grid-cols-4 gap-1">
        {[-90, -15, 15, 90].map((d) => (
          <button key={d} className="btn px-0 py-1 text-xs" onClick={() => onTurn(d)} title={`Turn ${Math.abs(d)}° ${d < 0 ? "left" : "right"}`}>
            {d < 0 ? "↺" : "↻"} {Math.abs(d)}°
          </button>
        ))}
      </div>
    </div>
  );
}

function Static({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="field-label">{label}</p>
      <p className="py-1.5 text-sm tabular-nums">{value}</p>
    </div>
  );
}

/** A length typed in feet and inches (12' 6", 12.5, 150"), applied on Enter or when you click away. */
export function LengthField({ label, value, onCommit }: { label: string; value: number; onCommit: (inches: number) => void }) {
  const shown = formatFeetInches(value);
  const [text, setText] = useState(shown);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setText(shown);
    setBad(false);
  }, [shown]);
  const commit = () => {
    const v = parseFeetInches(text);
    if (v === null || v <= 0) {
      setBad(true);
      return;
    }
    setBad(false);
    if (Math.abs(v - value) >= 0.25) onCommit(Math.round(v * 4) / 4);
    else setText(shown);
  };
  const id = `len-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <div>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={`input tabular-nums ${bad ? "border-red-400" : ""}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setText(shown);
        }}
        title={`Feet and inches, like 12' 6"`}
      />
    </div>
  );
}

/** Take out (or put back) the wall along a room edge, and combine the rooms on either side. */
function WallRemoval({ plan, roomId, edge, onChange, onCombine }: { plan: FloorPlan; roomId: string; edge: number; onChange: Props["onChange"]; onCombine: (ids: string[]) => void }) {
  const walls = edgeWalls(plan, roomId, edge);
  const why = whyWallStays(plan, roomId, edge);
  const along = roomsAlong(plan, roomId, edge);
  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="grid grid-cols-2 gap-2">
        {walls.inside.length > 0 || !walls.removed.length ? (
          <button className="btn text-sm" disabled={!!why} title={why ?? undefined} onClick={() => {
            const out = removeWall(plan, roomId, edge);
            if (out) onChange(out.plan);
          }}>
            Remove wall
          </button>
        ) : (
          <button className="btn text-sm" onClick={() => onChange(restoreWall(plan, roomId, edge))}>
            Put wall back
          </button>
        )}
        {along.length > 1 && <CombineButton plan={plan} ids={along} label="Combine these rooms" onCombine={onCombine} bare />}
      </div>
      {walls.inside.length > 0 && walls.removed.length > 0 && (
        <button className="mt-2 text-sm text-accent hover:underline" onClick={() => onChange(restoreWall(plan, roomId, edge))}>
          Put the removed part back
        </button>
      )}
      <p className="field-hint">
        {why && !walls.removed.length
          ? why
          : walls.removed.length
            ? "The wall is out: the rooms are open to each other but keep their own names and floors."
            : "Removing the wall keeps both rooms (names, floors, finishes) with an open space between them. Combining makes them one room."}
      </p>
    </div>
  );
}

function CombineButton({ plan, ids, label, onCombine, bare }: { plan: FloorPlan; ids: string[]; label: string; onCombine: (ids: string[]) => void; bare?: boolean }) {
  const why = whyNotCombine(plan, ids);
  const button = (
    <button className={`btn text-sm ${bare ? "" : "mt-4 w-full"}`} disabled={!!why} title={why ?? undefined} onClick={() => onCombine(ids)}>
      {label}
    </button>
  );
  if (bare) return button;
  return (
    <>
      {button}
      {why && <p className="field-hint">{why}</p>}
    </>
  );
}
