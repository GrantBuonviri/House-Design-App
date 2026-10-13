"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Ellipse, Group, Layer, Line, Rect, Shape, Stage, Text, Transformer } from "react-konva";
import type Konva from "konva";
import type { BubbleDiagram } from "@/lib/model/schema";
import { FREE_COLOR, bubbleSqft, radiiFor, type Bubble } from "@/lib/bubbles/shapes";
import { addBubble, addFlow, addNote, addStroke, newElementId, removeAny, updateBubble, updateNote } from "@/lib/bubbles/edit";
import type { Selection, Side, Tool } from "./types";

/**
 * The flow sketch drawing for one level, at real scale: 1 unit is 1 inch.
 * Konva draws it; every change goes back up as a whole new diagram so the
 * project store can save it and undo it.
 */

type View = { scale: number; x: number; y: number };

const SNAP_IN = 12;
const NEW_SQFT = 150;
const MIN_SCALE = 0.08;
const MAX_SCALE = 5;
const MIN_RADIUS_IN = 18;
const INK = "#3d3a35";
const ACCENT = "#2f6b4f";
const NOTE_W = 170;

type Props = {
  diagram: BubbleDiagram;
  /** The level below, drawn faintly for lining things up. */
  below: { name: string; diagram: BubbleDiagram } | null;
  tool: Tool;
  selection: Selection;
  snap: boolean;
  /** Labels for each edge of the drawing, like "Road" or "Sunny side". */
  sides: Record<Side, string[]>;
  height: number;
  onSelect: (s: Selection) => void;
  onChange: (d: BubbleDiagram, coalesce?: string) => void;
  /** The one-shot tools (circle, oval, note) hand back to Select after use. */
  onToolDone: () => void;
  onEditNote: (id: string) => void;
};

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
const snapTo = (n: number) => Math.round(n / SNAP_IN) * SNAP_IN;

function boundsOf(diagrams: BubbleDiagram[]) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  for (const d of diagrams) {
    for (const b of d.bubbles) {
      const r = Math.max(b.rx, b.ry);
      add(b.x - r, b.y - r);
      add(b.x + r, b.y + r);
    }
    for (const n of d.notes) add(n.x, n.y);
    for (const s of d.strokes) for (let i = 0; i < s.points.length; i += 2) add(s.points[i], s.points[i + 1]);
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

/** A darker edge color for a bubble's fill. */
function edgeColor(fill: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(fill);
  if (!m) return INK;
  const n = parseInt(m[1], 16);
  const ch = (shift: number) => Math.round(((n >> shift) & 255) * 0.55);
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

function noteHeight(text: string, scale: number): number {
  const lines = (text || " ").split("\n").reduce((s, line) => s + Math.max(1, Math.ceil(line.length / 24)), 0);
  return (lines * 17 + 16) / scale;
}

export default function SketchCanvas(props: Props) {
  const { diagram, below, tool, selection, snap, sides, height, onSelect, onChange, onToolDone, onEditNote } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const layerRef = useRef<Konva.Layer>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const [width, setWidth] = useState(0);
  const [view, setView] = useState<View>({ scale: 0.6, x: 0, y: 0 });
  const fitted = useRef(false);
  const [live, setLive] = useState<{ id: string; x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<number[] | null>(null);
  const [flowFrom, setFlowFrom] = useState<string | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const erasing = useRef<string | null>(null);
  // Always the latest diagram, for handlers that fire many times in one gesture.
  const latest = useRef(diagram);
  latest.current = diagram;

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    if (!width) return;
    const b = boundsOf(below ? [diagram, below.diagram] : [diagram]);
    if (!b) {
      setView({ scale: 0.6, x: width / 2, y: height / 2 });
      return;
    }
    const pad = 80;
    const scale = clampScale(Math.min((width - pad * 2) / Math.max(1, b.x1 - b.x0), (height - pad * 2) / Math.max(1, b.y1 - b.y0), 1.2));
    setView({ scale, x: width / 2 - ((b.x0 + b.x1) / 2) * scale, y: height / 2 - ((b.y0 + b.y1) / 2) * scale });
  }, [width, height, diagram, below]);

  useEffect(() => {
    if (width && !fitted.current) {
      fitted.current = true;
      fit();
    }
  }, [width, fit]);

  // Hand the transformer to the selected bubble.
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const node = selection?.kind === "bubble" && tool === "select" ? layerRef.current?.findOne(`#${selection.id}`) : undefined;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selection, tool, diagram]);

  // Leaving the flow tool drops a half-made flow line.
  useEffect(() => {
    if (tool !== "flow") setFlowFrom(null);
  }, [tool]);

  const world = () => layerRef.current?.getRelativePointerPosition() ?? { x: 0, y: 0 };
  const s = view.scale;
  const pos = (b: Bubble) => (live?.id === b.id ? { x: live.x, y: live.y } : { x: b.x, y: b.y });
  const byId = new Map(diagram.bubbles.map((b) => [b.id, b]));

  /** The sketch element under a Konva node: a bubble, flow, stroke or note. */
  function elementOf(node: Konva.Node | null): { kind: NonNullable<Selection>["kind"]; id: string } | null {
    if (!node) return null;
    for (const kind of ["bubble", "flow", "stroke", "note"] as const) {
      const hit = node.findAncestor(`.${kind}`, true);
      if (hit) return { kind, id: hit.id() };
    }
    return null;
  }

  function erase(node: Konva.Node | null, allowBubbles: boolean) {
    const el = elementOf(node);
    if (!el || (el.kind === "bubble" && !allowBubbles)) return;
    if (selection?.id === el.id) onSelect(null);
    onChange(removeAny(latest.current, el.id), erasing.current ?? undefined);
  }

  function onMouseDown(e: Konva.KonvaEventObject<MouseEvent>) {
    if (e.evt.button !== 0) return;
    const stage = e.target.getStage()!;
    const p = world();
    const el = elementOf(e.target === stage ? null : e.target);
    if (tool === "circle" || tool === "oval") {
      const { rx, ry } = radiiFor(NEW_SQFT, tool === "oval" ? 1.7 : 1);
      const at = snap ? { x: snapTo(p.x), y: snapTo(p.y) } : { x: Math.round(p.x), y: Math.round(p.y) };
      const b: Bubble = { id: newElementId("b"), label: "New room", shape: tool, ...at, rx, ry, rotation: 0, color: FREE_COLOR };
      onChange(addBubble(diagram, b));
      onSelect({ kind: "bubble", id: b.id });
      onToolDone();
    } else if (tool === "note") {
      const id = newElementId("n");
      onChange(addNote(diagram, { id, x: Math.round(p.x), y: Math.round(p.y), text: "" }));
      onSelect({ kind: "note", id });
      onToolDone();
      onEditNote(id);
    } else if (tool === "pen") {
      setDraft([p.x, p.y]);
    } else if (tool === "eraser") {
      erasing.current = newElementId("erase");
      erase(e.target === stage ? null : e.target, true);
    } else if (tool === "flow") {
      if (el?.kind !== "bubble") setFlowFrom(null);
      else if (!flowFrom) setFlowFrom(el.id);
      else {
        onChange(addFlow(diagram, flowFrom, el.id));
        setFlowFrom(null);
      }
    } else if (tool === "select") {
      // Grabbing a resize handle keeps the bubble selected.
      if (e.target.findAncestor("Transformer")) return;
      onSelect(el);
    }
  }

  function onMouseMove() {
    const p = world();
    if (tool === "flow" || tool === "pen") setCursor(p);
    if (tool === "pen" && draft) {
      const lx = draft[draft.length - 2];
      const ly = draft[draft.length - 1];
      if (Math.hypot(p.x - lx, p.y - ly) * s > 3) setDraft([...draft, p.x, p.y]);
    } else if (tool === "eraser" && erasing.current) {
      const stage = stageRef.current!;
      const pointer = stage.getPointerPosition();
      erase(pointer ? stage.getIntersection(pointer) : null, false);
    }
  }

  function onMouseUp() {
    if (tool === "pen" && draft) {
      if (draft.length >= 4) {
        const points = draft.map((n) => Math.round(n * 2) / 2);
        onChange(addStroke(diagram, { id: newElementId("s"), points, width: Math.round((3 / s) * 10) / 10 }));
      }
      setDraft(null);
    }
    erasing.current = null;
  }

  function onWheel(e: Konva.KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault();
    const stage = e.target.getStage()!;
    const pointer = stage.getPointerPosition() ?? { x: width / 2, y: height / 2 };
    if (e.evt.ctrlKey || e.evt.metaKey) {
      // Pinch on a trackpad, or Control + scroll: zoom around the pointer.
      const scale = clampScale(s * Math.exp(-e.evt.deltaY * 0.01));
      const wx = (pointer.x - view.x) / s;
      const wy = (pointer.y - view.y) / s;
      setView({ scale, x: pointer.x - wx * scale, y: pointer.y - wy * scale });
    } else {
      setView({ ...view, x: view.x - e.evt.deltaX, y: view.y - e.evt.deltaY });
    }
  }

  function zoomBy(factor: number) {
    const scale = clampScale(s * factor);
    const cx = width / 2;
    const cy = height / 2;
    setView({ scale, x: cx - ((cx - view.x) / s) * scale, y: cy - ((cy - view.y) / s) * scale });
  }

  function onStageDrag(e: Konva.KonvaEventObject<DragEvent>) {
    const stage = e.target.getStage();
    if (e.target !== stage) return;
    setView({ scale: s, x: stage.x(), y: stage.y() });
  }

  function onBubbleDragMove(e: Konva.KonvaEventObject<DragEvent>, b: Bubble) {
    const node = e.target;
    if (snap) node.position({ x: snapTo(node.x()), y: snapTo(node.y()) });
    setLive({ id: b.id, x: node.x(), y: node.y() });
  }

  function onBubbleDragEnd(e: Konva.KonvaEventObject<DragEvent>, b: Bubble) {
    const node = e.target;
    setLive(null);
    onChange(updateBubble(diagram, b.id, { x: Math.round(node.x()), y: Math.round(node.y()) }));
  }

  function onTransformEnd(e: Konva.KonvaEventObject<Event>, b: Bubble) {
    const node = e.target as Konva.Ellipse;
    let rx = Math.max(MIN_RADIUS_IN, node.radiusX() * Math.abs(node.scaleX()));
    let ry = Math.max(MIN_RADIUS_IN, node.radiusY() * Math.abs(node.scaleY()));
    if (b.shape === "circle") rx = ry = (rx + ry) / 2;
    node.scaleX(1);
    node.scaleY(1);
    onChange(updateBubble(diagram, b.id, { x: Math.round(node.x()), y: Math.round(node.y()), rx, ry, rotation: Math.round(node.rotation()) }));
  }

  const panning = tool === "pan" || tool === "select";
  const cursorStyle =
    tool === "pan" ? "grab" : tool === "select" ? "default" : tool === "eraser" ? "cell" : "crosshair";
  const selectedBubble = selection?.kind === "bubble" ? byId.get(selection.id) : undefined;

  return (
    <div ref={wrapRef} className="relative overflow-hidden rounded-lg border border-line bg-[#fbfaf7]" style={{ height, cursor: cursorStyle }}>
      {width > 0 && (
        <Stage
          ref={stageRef}
          width={width}
          height={height}
          scaleX={s}
          scaleY={s}
          x={view.x}
          y={view.y}
          draggable={panning}
          onDragMove={onStageDrag}
          onDragEnd={onStageDrag}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={() => {
            setCursor(null);
            onMouseUp();
          }}
          onWheel={onWheel}
        >
          <Layer listening={false}>
            <Grid view={view} width={width} height={height} />
          </Layer>

          {below && (
            <Layer listening={false} opacity={0.3}>
              {below.diagram.bubbles.map((b) => (
                <Group key={b.id}>
                  <Ellipse x={b.x} y={b.y} radiusX={b.rx} radiusY={b.ry} rotation={b.rotation} stroke={INK} strokeWidth={1} strokeScaleEnabled={false} dash={[6, 4]} dashEnabled fill="#e9e5dc" />
                  <Text x={b.x} y={b.y - 7 / s} text={b.label} fontSize={11 / s} width={160 / s} offsetX={80 / s} align="center" fill={INK} />
                </Group>
              ))}
            </Layer>
          )}

          <Layer ref={layerRef}>
            {diagram.flows.map((f) => {
              const a = byId.get(f.from);
              const b = byId.get(f.to);
              if (!a || !b) return null;
              const pa = pos(a);
              const pb = pos(b);
              const on = selection?.id === f.id;
              return (
                <Line
                  key={f.id}
                  id={f.id}
                  name="flow"
                  points={[pa.x, pa.y, pb.x, pb.y]}
                  stroke={on ? ACCENT : "#857a6a"}
                  strokeWidth={on ? 4 : 2.5}
                  strokeScaleEnabled={false}
                  hitStrokeWidth={14 / s}
                  lineCap="round"
                />
              );
            })}

            {diagram.bubbles.map((b) => {
              const on = selection?.id === b.id;
              const fill = b.color ?? FREE_COLOR;
              return (
                <Ellipse
                  key={b.id}
                  id={b.id}
                  name="bubble"
                  x={b.x}
                  y={b.y}
                  radiusX={b.rx}
                  radiusY={b.ry}
                  rotation={b.rotation}
                  fill={fill}
                  stroke={on || flowFrom === b.id ? ACCENT : edgeColor(fill)}
                  strokeWidth={on || flowFrom === b.id ? 3 : 1.5}
                  strokeScaleEnabled={false}
                  dash={b.stairs ? [5, 4] : undefined}
                  draggable={tool === "select"}
                  onDragMove={(e) => onBubbleDragMove(e, b)}
                  onDragEnd={(e) => onBubbleDragEnd(e, b)}
                  onTransformEnd={(e) => onTransformEnd(e, b)}
                />
              );
            })}

            {diagram.bubbles.map((b) => {
              const p = pos(b);
              const w = Math.max(2 * Math.min(b.rx, b.ry) * 1.6, 90 / s);
              return (
                <Group key={`label-${b.id}`} listening={false}>
                  <Text x={p.x} y={p.y - 10 / s} width={w} offsetX={w / 2} align="center" text={b.label} fontSize={13 / s} fontStyle="600" fill={INK} wrap="none" ellipsis />
                  <Text x={p.x} y={p.y + 5 / s} width={w} offsetX={w / 2} align="center" text={`${bubbleSqft(b).toLocaleString("en-US")} sq ft`} fontSize={11 / s} fill="#6b716c" wrap="none" />
                </Group>
              );
            })}

            {diagram.strokes.map((st) => (
              <Line
                key={st.id}
                id={st.id}
                name="stroke"
                points={st.points}
                stroke={selection?.id === st.id ? ACCENT : INK}
                strokeWidth={st.width}
                hitStrokeWidth={Math.max(st.width, 14 / s)}
                tension={0.4}
                lineCap="round"
                lineJoin="round"
              />
            ))}
            {draft && <Line points={draft} stroke={INK} strokeWidth={3 / s} tension={0.4} lineCap="round" lineJoin="round" listening={false} />}

            {diagram.notes.map((n) => {
              const h = noteHeight(n.text, s);
              const on = selection?.id === n.id;
              return (
                <Group
                  key={n.id}
                  id={n.id}
                  name="note"
                  x={n.x}
                  y={n.y}
                  draggable={tool === "select"}
                  onDragEnd={(e) => onChange(updateNote(diagram, n.id, { x: Math.round(e.target.x()), y: Math.round(e.target.y()) }))}
                  onDblClick={() => onEditNote(n.id)}
                >
                  <Rect width={NOTE_W / s} height={h} fill="#fff4b8" stroke={on ? ACCENT : "#e2cf72"} strokeWidth={on ? 2 : 1} strokeScaleEnabled={false} cornerRadius={4 / s} shadowColor="#000" shadowOpacity={0.12} shadowBlur={6} shadowOffsetY={2} />
                  <Text
                    x={8 / s}
                    y={8 / s}
                    width={(NOTE_W - 16) / s}
                    text={n.text || "Double-click to write"}
                    fontSize={13 / s}
                    lineHeight={1.3}
                    fill={n.text ? INK : "#9a8f5a"}
                  />
                </Group>
              );
            })}

            {flowFrom && cursor && byId.get(flowFrom) && (
              <Line points={[pos(byId.get(flowFrom)!).x, pos(byId.get(flowFrom)!).y, cursor.x, cursor.y]} stroke={ACCENT} strokeWidth={2} strokeScaleEnabled={false} dash={[6, 4]} listening={false} />
            )}

            <Transformer
              ref={trRef}
              rotateEnabled={selectedBubble?.shape === "oval"}
              keepRatio={selectedBubble?.shape !== "oval"}
              enabledAnchors={
                selectedBubble?.shape === "oval"
                  ? ["top-left", "top-center", "top-right", "middle-right", "middle-left", "bottom-left", "bottom-center", "bottom-right"]
                  : ["top-left", "top-right", "bottom-left", "bottom-right"]
              }
              anchorSize={9}
              borderStroke={ACCENT}
              anchorStroke={ACCENT}
              ignoreStroke
              boundBoxFunc={(oldBox, box) => (Math.abs(box.width) < MIN_RADIUS_IN * 2 * s || Math.abs(box.height) < MIN_RADIUS_IN * 2 * s ? oldBox : box)}
            />
          </Layer>
        </Stage>
      )}

      <SideLabels sides={sides} />
      {below && (
        <p className="pointer-events-none absolute top-2 left-3 rounded bg-white/80 px-2 py-0.5 text-xs text-muted">
          Faint shapes: {below.name}
        </p>
      )}
      <ScaleBar scale={s} />
      <div className="absolute right-3 bottom-3 flex items-center gap-1 rounded-md border border-line bg-white p-0.5 text-sm shadow-sm">
        <button className="rounded px-2 py-1 hover:bg-stone-100" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out" title="Zoom out">
          −
        </button>
        <span className="w-12 text-center text-xs tabular-nums text-muted">{Math.round((s / 0.6) * 100)}%</span>
        <button className="rounded px-2 py-1 hover:bg-stone-100" onClick={() => zoomBy(1.25)} aria-label="Zoom in" title="Zoom in">
          +
        </button>
        <button className="rounded px-2 py-1 text-xs hover:bg-stone-100" onClick={fit} title="Fit the drawing on screen">
          Fit
        </button>
      </div>
    </div>
  );
}

/** Light grid lines that follow the zoom: a line every 1, 2, 4, 10 or 20 feet, whatever is readable. */
function Grid({ view, width, height }: { view: View; width: number; height: number }) {
  const step = [12, 24, 48, 120, 240, 480].find((g) => g * view.scale >= 14) ?? 960;
  return (
    <Shape
      sceneFunc={(ctx) => {
        const x0 = -view.x / view.scale;
        const y0 = -view.y / view.scale;
        const x1 = x0 + width / view.scale;
        const y1 = y0 + height / view.scale;
        const line = (ax: number, ay: number, bx: number, by: number, major: boolean) => {
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.strokeStyle = major ? "rgba(60,55,45,0.13)" : "rgba(60,55,45,0.06)";
          ctx.lineWidth = 1 / view.scale;
          ctx.stroke();
        };
        for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) line(x, y0, x, y1, Math.round(x / step) % 5 === 0);
        for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) line(x0, y, x1, y, Math.round(y / step) % 5 === 0);
      }}
    />
  );
}

const SIDE_NAME: Record<Side, string> = { N: "North", E: "East", S: "South", W: "West" };

function SideLabels({ sides }: { sides: Record<Side, string[]> }) {
  const place: Record<Side, string> = {
    N: "top-2 left-1/2 -translate-x-1/2",
    S: "bottom-2 left-1/2 -translate-x-1/2",
    E: "right-2 top-1/2 -translate-y-1/2",
    W: "left-2 top-1/2 -translate-y-1/2",
  };
  return (
    <>
      {(Object.keys(place) as Side[]).map((side) => (
        <span
          key={side}
          className={`pointer-events-none absolute ${place[side]} rounded-full bg-white/85 px-2.5 py-0.5 text-xs text-muted shadow-sm ${
            side === "E" || side === "W" ? "[writing-mode:vertical-rl]" : ""
          } ${side === "W" ? "rotate-180" : ""}`}
        >
          <span className="font-semibold text-ink">{SIDE_NAME[side]}</span>
          {sides[side].length > 0 && ` · ${sides[side].join(" · ")}`}
        </span>
      ))}
    </>
  );
}

function ScaleBar({ scale }: { scale: number }) {
  const feet = [5, 10, 20, 25, 50, 100, 200].find((f) => f * 12 * scale >= 60) ?? 200;
  const px = feet * 12 * scale;
  return (
    <div className="pointer-events-none absolute bottom-4 left-10 text-xs text-muted">
      <div className="h-1.5 border-x border-b border-ink/60" style={{ width: px }} />
      <div className="mt-0.5">{feet} ft</div>
    </div>
  );
}
