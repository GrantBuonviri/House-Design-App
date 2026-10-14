"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Group, Layer, Line, Rect, Stage, Text, Transformer } from "react-konva";
import Konva from "konva";
import type { BubbleDiagram, Point } from "@/lib/model/schema";
import { FREE_COLOR, MAX_SQFT, MIN_SQFT, bubbleSqft, isDrawn, outlineShape, polygonArea, radiiFor, resized, scaledOutline, tidyOutline, type Bubble } from "@/lib/bubbles/shapes";
import { addBubble, addNote, addStroke, connected, moveMany, newElementId, removeAny, updateBubble } from "@/lib/bubbles/edit";
import BubbleShape from "./BubbleShape";
import LandLayer from "./LandLayer";
import { Grid, ScaleBar, SideLabels, useSpacePan, type View } from "@/components/canvas/CanvasBits";
import { isSelected, type LandView, type SelectedItem, type Selection, type Side, type Tool } from "./types";

/**
 * The flow sketch drawing for one level, at real scale: 1 unit is 1 inch.
 * Konva draws it; every change goes back up as a whole new diagram so the
 * project store can save it and undo it.
 */

type Delta = { dx: number; dy: number };
type Box = { x0: number; y0: number; x1: number; y1: number };

/** What a press-and-drag on the drawing is doing. */
type Gesture =
  | { type: "move"; start: Point; ids: string[]; ref: Point; moved: boolean }
  | { type: "box"; start: Point; additive: boolean; base: Selection }
  | { type: "lot"; start: Point }
  | { type: "draw" }
  | { type: "erase"; key: string };

const SNAP_IN = 12;
const NEW_SQFT = 150;
const MIN_SCALE = 0.04;
const MAX_SCALE = 5;
const MIN_RADIUS_IN = 18;
const INK = "#3d3a35";
const ACCENT = "#2f6b4f";
const NOTE_W = 170;
const SQ_IN_PER_SQ_FT = 144;

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
  /** The land under the sketch, when any of it is turned on. */
  land: LandView | null;
  /** "Move on lot": dragging slides the land under the sketch. */
  lotMode: boolean;
  onLotMove: (offset: Point) => void;
  /** "Pick on drawing": clicking a room connects it to this one, or disconnects it. */
  connectFrom: string | null;
  onToggleConnection: (id: string) => void;
  onSelect: (s: Selection) => void;
  onChange: (d: BubbleDiagram, coalesce?: string) => void;
  /** The one-shot tools (circle, oval, draw room, note) hand back to Select after use. */
  onToolDone: () => void;
  onEditNote: (id: string) => void;
};

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
const snapTo = (n: number) => Math.round(n / SNAP_IN) * SNAP_IN;

function boundsOf(diagrams: BubbleDiagram[], extra: Point[] = []) {
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
      const r = Math.hypot(b.rx, b.ry);
      add(b.x - r, b.y - r);
      add(b.x + r, b.y + r);
    }
    for (const n of d.notes) add(n.x, n.y);
    for (const s of d.strokes) for (let i = 0; i < s.points.length; i += 2) add(s.points[i], s.points[i + 1]);
  }
  for (const p of extra) add(p.x, p.y);
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

const pairs = (flat: number[]): Point[] => Array.from({ length: flat.length / 2 }, (_, i) => ({ x: flat[2 * i], y: flat[2 * i + 1] }));

export default function SketchCanvas(props: Props) {
  const { diagram, below, tool, selection, snap, sides, height, land, lotMode, onLotMove, connectFrom, onToggleConnection } = props;
  const { onSelect, onChange, onToolDone, onEditNote } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const layerRef = useRef<Konva.Layer>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const [width, setWidth] = useState(0);
  const [view, setView] = useState<View>({ scale: 0.6, x: 0, y: 0 });
  const fitted = useRef(false);
  const gesture = useRef<Gesture | null>(null);
  const [moveDelta, setMoveDelta] = useState<Delta | null>(null);
  const [lotDelta, setLotDelta] = useState<Delta | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [draft, setDraft] = useState<number[] | null>(null);
  // Always the latest values, for handlers that fire many times in one gesture.
  const latest = useRef({ diagram, selection, moveDelta, lotDelta });
  latest.current = { diagram, selection, moveDelta, lotDelta };

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const propertyPoints = land?.show.property ? land.drawing.outline.map((p) => ({ x: p.x - land.offset.x, y: p.y - land.offset.y })) : [];
  const fit = useCallback(() => {
    if (!width) return;
    const b = boundsOf(below ? [diagram, below.diagram] : [diagram], propertyPoints);
    if (!b) {
      setView({ scale: 0.6, x: width / 2, y: height / 2 });
      return;
    }
    const pad = 70;
    const scale = clampScale(Math.min((width - pad * 2) / Math.max(1, b.x1 - b.x0), (height - pad * 2) / Math.max(1, b.y1 - b.y0), 1.2));
    setView({ scale, x: width / 2 - ((b.x0 + b.x1) / 2) * scale, y: height / 2 - ((b.y0 + b.y1) / 2) * scale });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, diagram, below, JSON.stringify(propertyPoints)]);

  useEffect(() => {
    if (width && !fitted.current) {
      fitted.current = true;
      fit();
    }
  }, [width, fit]);

  const { spaceDown, hovering } = useSpacePan();

  const byId = new Map(diagram.bubbles.map((b) => [b.id, b]));
  const single = selection.length === 1 && selection[0].kind === "bubble" ? byId.get(selection[0].id) : undefined;
  const transforming = single && tool === "select" && !connectFrom && !lotMode ? single : undefined;

  // Hand the transformer to the one selected room.
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const node = transforming ? layerRef.current?.findOne(`#${transforming.id}`) : undefined;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [transforming, diagram]);

  const world = () => layerRef.current?.getRelativePointerPosition() ?? { x: 0, y: 0 };
  const s = view.scale;
  const moving = (id: string) => moveDelta !== null && gesture.current?.type === "move" && gesture.current.ids.includes(id);
  const pos = (b: Bubble) => (moving(b.id) ? { x: b.x + moveDelta!.dx, y: b.y + moveDelta!.dy } : { x: b.x, y: b.y });

  /** The sketch element under a Konva node: a bubble, flow, stroke or note. */
  function elementOf(node: Konva.Node | null): SelectedItem | null {
    if (!node) return null;
    for (const kind of ["bubble", "flow", "stroke", "note"] as const) {
      const hit = node.findAncestor(`.${kind}`, true);
      if (hit) return { kind, id: hit.id() };
    }
    return null;
  }

  /** Where an element sits, for snapping a group move to the grid. */
  function refPoint(id: string): Point {
    const d = latest.current.diagram;
    const b = d.bubbles.find((x) => x.id === id);
    if (b) return { x: b.x, y: b.y };
    const n = d.notes.find((x) => x.id === id);
    if (n) return { x: n.x, y: n.y };
    const st = d.strokes.find((x) => x.id === id);
    return st ? { x: st.points[0], y: st.points[1] } : { x: 0, y: 0 };
  }

  function erase(node: Konva.Node | null, allowBubbles: boolean) {
    const el = elementOf(node);
    if (!el || (el.kind === "bubble" && !allowBubbles)) return;
    const { diagram: d, selection: sel } = latest.current;
    if (isSelected(sel, el.id)) onSelect(sel.filter((x) => x.id !== el.id));
    onChange(removeAny(d, el.id), gesture.current?.type === "erase" ? gesture.current.key : undefined);
  }

  function onMouseDown(e: Konva.KonvaEventObject<MouseEvent>) {
    if (e.evt.button !== 0 || spaceDown || tool === "pan") return;
    const stage = e.target.getStage()!;
    const p = world();
    const el = elementOf(e.target === stage ? null : e.target);

    if (lotMode) {
      gesture.current = { type: "lot", start: p };
      return;
    }
    if (connectFrom) {
      if (el?.kind === "bubble" && el.id !== connectFrom) onToggleConnection(el.id);
      return;
    }
    if (tool === "circle" || tool === "oval") {
      const { rx, ry } = radiiFor(NEW_SQFT, tool === "oval" ? 1.7 : 1);
      const at = snap ? { x: snapTo(p.x), y: snapTo(p.y) } : { x: Math.round(p.x), y: Math.round(p.y) };
      const b: Bubble = { id: newElementId("b"), label: "New room", shape: tool, ...at, rx, ry, rotation: 0, color: FREE_COLOR };
      onChange(addBubble(diagram, b));
      onSelect([{ kind: "bubble", id: b.id }]);
      onToolDone();
    } else if (tool === "note") {
      const id = newElementId("n");
      onChange(addNote(diagram, { id, x: Math.round(p.x), y: Math.round(p.y), text: "" }));
      onSelect([{ kind: "note", id }]);
      onToolDone();
      onEditNote(id);
    } else if (tool === "pen" || tool === "room") {
      gesture.current = { type: "draw" };
      setDraft([p.x, p.y]);
    } else if (tool === "eraser") {
      gesture.current = { type: "erase", key: newElementId("erase") };
      erase(e.target === stage ? null : e.target, true);
    } else if (tool === "select") {
      // Grabbing a resize handle keeps the room selected.
      if (e.target.findAncestor("Transformer")) return;
      const shift = e.evt.shiftKey;
      if (!el) {
        gesture.current = { type: "box", start: p, additive: shift, base: selection };
        setBox({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
        return;
      }
      if (shift) {
        onSelect(isSelected(selection, el.id) ? selection.filter((x) => x.id !== el.id) : [...selection, el]);
        return;
      }
      const next = isSelected(selection, el.id) ? selection : [el];
      if (next !== selection) onSelect(next);
      const ids = next.filter((x) => x.kind !== "flow").map((x) => x.id);
      if (el.kind !== "flow" && ids.length) gesture.current = { type: "move", start: p, ids, ref: refPoint(el.id), moved: false };
    }
  }

  function onMouseMove() {
    const g = gesture.current;
    if (!g) return;
    const p = world();
    if (g.type === "move") {
      let dx = p.x - g.start.x;
      let dy = p.y - g.start.y;
      if (!g.moved && Math.hypot(dx, dy) * s < 3) return;
      g.moved = true;
      if (snap) {
        dx = snapTo(g.ref.x + dx) - g.ref.x;
        dy = snapTo(g.ref.y + dy) - g.ref.y;
      }
      setMoveDelta({ dx, dy });
    } else if (g.type === "box") {
      setBox({ x0: g.start.x, y0: g.start.y, x1: p.x, y1: p.y });
    } else if (g.type === "lot") {
      setLotDelta({ dx: p.x - g.start.x, dy: p.y - g.start.y });
    } else if (g.type === "draw" && draft) {
      const lx = draft[draft.length - 2];
      const ly = draft[draft.length - 1];
      if (Math.hypot(p.x - lx, p.y - ly) * s > 3) setDraft([...draft, p.x, p.y]);
    } else if (g.type === "erase") {
      const stage = stageRef.current!;
      const pointer = stage.getPointerPosition();
      erase(pointer ? stage.getIntersection(pointer) : null, false);
    }
  }

  function onMouseUp() {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    const { moveDelta: delta, lotDelta: lot } = latest.current;
    if (g.type === "move") {
      if (g.moved && delta && (delta.dx || delta.dy)) onChange(moveMany(diagram, g.ids, delta.dx, delta.dy));
      setMoveDelta(null);
    } else if (g.type === "box") {
      finishBox(g);
      setBox(null);
    } else if (g.type === "lot") {
      if (lot && land) onLotMove({ x: Math.round(land.offset.x - lot.dx), y: Math.round(land.offset.y - lot.dy) });
      setLotDelta(null);
    } else if (g.type === "draw") {
      if (draft && tool === "pen" && draft.length >= 4) {
        const points = draft.map((n) => Math.round(n * 2) / 2);
        onChange(addStroke(diagram, { id: newElementId("s"), points, width: Math.round((3 / s) * 10) / 10 }));
      } else if (draft && tool === "room") {
        finishRoom(draft);
      }
      setDraft(null);
    }
  }

  /** Select everything the box touches: rooms, notes and pen marks. */
  function finishBox(g: Extract<Gesture, { type: "box" }>) {
    const b = latest.current;
    const rect = box ?? { x0: g.start.x, y0: g.start.y, x1: g.start.x, y1: g.start.y };
    const r = { x: Math.min(rect.x0, rect.x1), y: Math.min(rect.y0, rect.y1), width: Math.abs(rect.x1 - rect.x0), height: Math.abs(rect.y1 - rect.y0) };
    if (Math.max(r.width, r.height) * s < 4) {
      // A click on empty space lets go of everything (unless Shift is held).
      if (!g.additive && b.selection.length) onSelect([]);
      return;
    }
    const layer = layerRef.current;
    if (!layer) return;
    const hits: SelectedItem[] = [];
    for (const kind of ["bubble", "note", "stroke"] as const) {
      for (const node of layer.find(`.${kind}`)) {
        if (Konva.Util.haveIntersection(r, node.getClientRect({ relativeTo: layer }))) hits.push({ kind, id: node.id() });
      }
    }
    onSelect(g.additive ? [...g.base, ...hits.filter((h) => !isSelected(g.base, h.id))] : hits);
  }

  /** Close a drawn outline into a room, if it's big enough to be one. */
  function finishRoom(flat: number[]) {
    const pts = pairs(flat);
    if (pts.length < 3) return;
    const tidy = tidyOutline(pts, 2.5 / s);
    if (tidy.length < 3 || polygonArea(tidy) < MIN_SQFT * SQ_IN_PER_SQ_FT) return;
    let b: Bubble = { id: newElementId("b"), label: "New room", shape: "free", ...outlineShape(tidy), rotation: 0, color: FREE_COLOR };
    if (bubbleSqft(b) > MAX_SQFT) b = resized(b, MAX_SQFT);
    onChange(addBubble(diagram, b));
    onSelect([{ kind: "bubble", id: b.id }]);
    onToolDone();
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

  function onTransformEnd(e: Konva.KonvaEventObject<Event>, b: Bubble) {
    const node = e.target;
    const sx = Math.abs(node.scaleX());
    const sy = Math.abs(node.scaleY());
    node.scaleX(1);
    node.scaleY(1);
    const at = { x: Math.round(node.x()), y: Math.round(node.y()), rotation: Math.round(node.rotation()) };
    if (isDrawn(b)) {
      onChange(updateBubble(diagram, b.id, { ...scaledOutline(b, sx, sy), ...at }));
      return;
    }
    let rx = Math.max(MIN_RADIUS_IN, b.rx * sx);
    let ry = Math.max(MIN_RADIUS_IN, b.ry * sy);
    if (b.shape === "circle") rx = ry = (rx + ry) / 2;
    onChange(updateBubble(diagram, b.id, { ...at, rx, ry }));
  }

  const panning = tool === "pan" || spaceDown;
  const cursorStyle = panning
    ? "grab"
    : lotMode
      ? "move"
      : connectFrom
        ? "pointer"
        : tool === "select"
          ? "default"
          : tool === "eraser"
            ? "cell"
            : "crosshair";
  const linked = (id: string) => connectFrom !== null && id !== connectFrom && connected(diagram, connectFrom, id);
  const shiftNotes = (id: string) => (moving(id) ? moveDelta! : { dx: 0, dy: 0 });

  return (
    <div
      ref={wrapRef}
      className="relative overflow-hidden rounded-lg border border-line bg-[#fbfaf7]"
      style={{ height, cursor: cursorStyle }}
      onMouseEnter={() => (hovering.current = true)}
      onMouseLeave={() => (hovering.current = false)}
    >
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
          onMouseLeave={onMouseUp}
          onWheel={onWheel}
        >
          <Layer listening={false}>
            <Grid view={view} width={width} height={height} />
          </Layer>

          {land && <LandLayer land={land} scale={s} shift={lotDelta} />}

          {below && (
            <Layer listening={false} opacity={0.3}>
              {below.diagram.bubbles.map((b) => (
                <Group key={b.id}>
                  <BubbleShape b={b} stroke={INK} strokeWidth={1} strokeScaleEnabled={false} dash={[6, 4]} dashEnabled fill="#e9e5dc" />
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
              const on = isSelected(selection, f.id);
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
              const on = isSelected(selection, b.id);
              const source = connectFrom === b.id;
              const fill = b.color ?? FREE_COLOR;
              const p = pos(b);
              return (
                <BubbleShape
                  key={b.id}
                  id={b.id}
                  name="bubble"
                  b={b}
                  x={p.x}
                  y={p.y}
                  fill={fill}
                  stroke={on || source || linked(b.id) ? ACCENT : edgeColor(fill)}
                  strokeWidth={source ? 4.5 : on ? 3 : linked(b.id) ? 2.5 : 1.5}
                  strokeScaleEnabled={false}
                  shadowColor={ACCENT}
                  shadowBlur={source ? 14 : 0}
                  shadowOpacity={source ? 0.6 : 0}
                  dash={b.stairs ? [5, 4] : undefined}
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

            {diagram.strokes.map((st) => {
              const d = shiftNotes(st.id);
              return (
                <Line
                  key={st.id}
                  id={st.id}
                  name="stroke"
                  x={d.dx}
                  y={d.dy}
                  points={st.points}
                  stroke={isSelected(selection, st.id) ? ACCENT : INK}
                  strokeWidth={st.width}
                  hitStrokeWidth={Math.max(st.width, 14 / s)}
                  tension={0.4}
                  lineCap="round"
                  lineJoin="round"
                />
              );
            })}
            {draft && tool === "pen" && <Line points={draft} stroke={INK} strokeWidth={3 / s} tension={0.4} lineCap="round" lineJoin="round" listening={false} />}
            {draft && tool === "room" && (
              <Line points={draft} closed fill="rgba(234,217,240,0.6)" stroke={ACCENT} strokeWidth={2} strokeScaleEnabled={false} dash={[6, 4]} lineJoin="round" listening={false} />
            )}

            {diagram.notes.map((n) => {
              const h = noteHeight(n.text, s);
              const on = isSelected(selection, n.id);
              const d = shiftNotes(n.id);
              return (
                <Group key={n.id} id={n.id} name="note" x={n.x + d.dx} y={n.y + d.dy} onDblClick={() => onEditNote(n.id)}>
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

            {box && (
              <Rect
                x={Math.min(box.x0, box.x1)}
                y={Math.min(box.y0, box.y1)}
                width={Math.abs(box.x1 - box.x0)}
                height={Math.abs(box.y1 - box.y0)}
                fill="rgba(47,107,79,0.08)"
                stroke={ACCENT}
                strokeWidth={1}
                strokeScaleEnabled={false}
                dash={[4, 3]}
                listening={false}
              />
            )}

            <Transformer
              ref={trRef}
              rotateEnabled={transforming?.shape === "oval" || transforming?.shape === "free"}
              keepRatio={transforming?.shape === "circle"}
              enabledAnchors={
                transforming?.shape === "circle"
                  ? ["top-left", "top-right", "bottom-left", "bottom-right"]
                  : ["top-left", "top-center", "top-right", "middle-right", "middle-left", "bottom-left", "bottom-center", "bottom-right"]
              }
              anchorSize={9}
              borderStroke={ACCENT}
              anchorStroke={ACCENT}
              ignoreStroke
              boundBoxFunc={(oldBox, next) => (Math.abs(next.width) < MIN_RADIUS_IN * 2 * s || Math.abs(next.height) < MIN_RADIUS_IN * 2 * s ? oldBox : next)}
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
