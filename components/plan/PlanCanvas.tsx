"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Circle, Group, Layer, Line, Rect, Stage, Text, Transformer } from "react-konva";
import Konva from "konva";
import type { BubbleDiagram, Fixture, FloorPlan, Level, Opening, PlanBasics, PlanStairs, Point } from "@/lib/model/schema";
import { CATEGORY_COLOR } from "@/lib/bubbles/shapes";
import { roomType } from "@/lib/brief/rooms";
import { formatFeetInches } from "@/lib/model/units";
import { exteriorWallIn, riseBetween } from "@/lib/plan/basics";
import { fixtureType, openingType } from "@/lib/plan/catalog";
import { addRoom, insertCorner, makeRoom, moveEdge, moveMany, moveOpeningTo, newPlanId, removeCorner, setCorner } from "@/lib/plan/edit";
import { add, angleOf, boundsOf, dist, edgesOf, leftNormal, polygonArea, polygonCenter, project, rectangle, round1, roundPoint, scale as scaleV, sub, unit } from "@/lib/plan/geometry";
import { roomSqft } from "@/lib/plan/measure";
import { snapFrom, snapMove, snapPush, snapTargets, type Guides } from "@/lib/plan/snap";
import { DEFAULT_STAIRS_WIDTH_IN, stairsDrawing } from "@/lib/plan/stairs";
import { clampOffset, nearestHost, openingGeometries, openingGeometry, solidWalls, wallPieces, type OpeningGeometry } from "@/lib/plan/walls";
import BubbleShape from "@/components/bubbles/BubbleShape";
import LandLayer from "@/components/bubbles/LandLayer";
import type { LandView, Side } from "@/components/bubbles/types";
import { Grid, ScaleBar, SideLabels, useSpacePan, type View } from "@/components/canvas/CanvasBits";
import { ACCENT, FixtureSymbol, INK, OpeningSymbol, StairsSymbol } from "./PlanShapes";
import { edgeId, isPicked, parseEdgeId, type PlanItem, type PlanSelection, type PlanTool } from "./types";

/**
 * The floor plan drawing for one level, at real scale: 1 unit is 1 inch.
 * While something is being dragged, the drawing shows a preview; letting go
 * sends the whole new plan up so the project store can save it and undo it.
 */

type Gesture =
  | { type: "move"; start: Point; ids: string[]; moved: boolean }
  | { type: "corner"; roomId: string; i: number }
  | { type: "edge"; roomId: string; edge: number; start: Point; moved: boolean }
  | { type: "opening"; id: string; moved: boolean }
  | { type: "box"; start: Point; additive: boolean; base: PlanSelection }
  | { type: "lot"; start: Point }
  | { type: "rect"; start: Point; moved: boolean };

type Box = { x0: number; y0: number; x1: number; y1: number };

const MIN_SCALE = 0.04;
const MAX_SCALE = 5;
const SNAP_PX = 9;
const MIN_ROOM_SIDE_IN = 24;
const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
const flat = (pts: Point[]) => pts.flatMap((p) => [p.x, p.y]);

type Props = {
  plan: FloorPlan;
  level: Level;
  levels: Level[];
  basics: PlanBasics | null;
  /** The level below, drawn faintly, and the stairs that come up from it. */
  below: { name: string; plan: FloorPlan; level: Level } | null;
  /** The flow sketch for this level, drawn faintly to trace over. */
  sketch: BubbleDiagram | null;
  tool: PlanTool;
  /** What the Doors and windows tool and the Fixtures tool place. */
  placeOpening: string;
  placeFixture: string;
  selection: PlanSelection;
  snap: boolean;
  showDims: boolean;
  sides: Record<Side, string[]>;
  height: number;
  land: LandView | null;
  lotMode: boolean;
  onLotMove: (offset: Point) => void;
  onSelect: (s: PlanSelection) => void;
  onChange: (p: FloorPlan, coalesce?: string) => void;
  /** Placing tools hand back to Select after one use. */
  onToolDone: () => void;
  onDrafting: (drafting: boolean) => void;
  onMessage: (text: string) => void;
};

function roomFill(type?: string): string {
  return type ? CATEGORY_COLOR[roomType(type).category] : "#e6dfd2";
}

/** Text that reads left to right whichever way its wall runs. */
function uprightAngle(d: Point): number {
  let a = angleOf(d);
  if (a > 90) a -= 180;
  if (a <= -90) a += 180;
  return a;
}

export default function PlanCanvas(props: Props) {
  const { plan, level, levels, basics, below, sketch, tool, placeOpening, placeFixture, selection, snap, showDims, sides, height, land, lotMode, onLotMove } = props;
  const { onSelect, onChange, onToolDone, onDrafting, onMessage } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<Konva.Layer>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const [width, setWidth] = useState(0);
  const [view, setView] = useState<View>({ scale: 0.6, x: 0, y: 0 });
  const fitted = useRef(false);
  const gesture = useRef<Gesture | null>(null);
  const [preview, setPreview] = useState<FloorPlan | null>(null);
  const [guides, setGuides] = useState<Guides>({});
  const [lotDelta, setLotDelta] = useState<{ dx: number; dy: number } | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [draft, setDraft] = useState<Point[]>([]);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [rectEnd, setRectEnd] = useState<Point | null>(null);
  const { spaceDown, hovering } = useSpacePan();
  const shown = preview ?? plan;
  const latest = useRef({ plan, preview, selection });
  latest.current = { plan, preview, selection };

  const s = view.scale;
  const tol = SNAP_PX / s;
  const exteriorIn = exteriorWallIn(basics);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // A drawing in progress is dropped when the tool or level changes.
  useEffect(() => {
    setDraft([]);
    setRectEnd(null);
    gesture.current = null;
    setPreview(null);
  }, [tool, level.id]);

  const drafting = draft.length > 0;
  useEffect(() => onDrafting(drafting), [drafting, onDrafting]);

  // ---- Fit ----
  const propertyPoints = land?.show.property ? land.drawing.outline.map((p) => ({ x: p.x - land.offset.x, y: p.y - land.offset.y })) : [];
  const fit = useCallback(() => {
    if (!width) return;
    const pts: Point[] = [
      ...plan.rooms.flatMap((r) => r.polygon),
      ...plan.walls.flatMap((w) => [w.a, w.b]),
      ...(below?.plan.rooms.flatMap((r) => r.polygon) ?? []),
      ...(sketch?.bubbles.flatMap((b) => [
        { x: b.x - b.rx, y: b.y - b.ry },
        { x: b.x + b.rx, y: b.y + b.ry },
      ]) ?? []),
      ...propertyPoints,
    ];
    const b = boundsOf(pts);
    if (!b) {
      setView({ scale: 0.6, x: width / 2, y: height / 2 });
      return;
    }
    const pad = 70;
    const sc = clampScale(Math.min((width - pad * 2) / Math.max(1, b.x1 - b.x0), (height - pad * 2) / Math.max(1, b.y1 - b.y0), 1.2));
    setView({ scale: sc, x: width / 2 - ((b.x0 + b.x1) / 2) * sc, y: height / 2 - ((b.y0 + b.y1) / 2) * sc });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, plan, below, sketch, JSON.stringify(propertyPoints)]);

  useEffect(() => {
    if (width && !fitted.current) {
      fitted.current = true;
      fit();
    }
  }, [width, fit]);

  // ---- What's drawn ----
  const pieces = useMemo(() => wallPieces(shown, exteriorIn), [shown, exteriorIn]);
  const geos = useMemo(() => openingGeometries(shown), [shown]);
  const solids = useMemo(() => solidWalls(pieces, geos), [pieces, geos]);
  const thicknessAt = useCallback(
    (g: OpeningGeometry) => {
      let best = { d: Infinity, t: 4.5 };
      for (const p of pieces) {
        const pr = project(g.center, p.a, p.b);
        if (pr.d < best.d) best = { d: pr.d, t: p.thicknessIn };
      }
      return best.t;
    },
    [pieces],
  );

  const riseFor = (st: Pick<PlanStairs, "toLevelId">, from: Level) => {
    const to = levels.find((l) => l.id === st.toLevelId);
    return to ? riseBetween(basics, from, to) : 108 + 13;
  };
  const stairsComingUp = below ? below.plan.stairs.filter((st) => st.toLevelId === level.id) : [];

  const single = selection.length === 1 ? selection[0] : null;
  const selRoom = single?.kind === "room" && tool === "select" ? shown.rooms.find((r) => r.id === single.id) : undefined;
  const selFixture = single?.kind === "fixture" && tool === "select" ? shown.fixtures.find((f) => f.id === single.id) : undefined;
  const transformTarget = !lotMode && !preview ? (selFixture?.id ?? selRoom?.id) : undefined;

  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const node = transformTarget ? layerRef.current?.findOne(`#${CSS.escape(transformTarget)}`) : undefined;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [transformTarget, shown]);

  const world = () => layerRef.current?.getRelativePointerPosition() ?? { x: 0, y: 0 };

  /** The plan element under a Konva node. */
  function elementOf(node: Konva.Node | null): (PlanItem & { corner?: number }) | null {
    if (!node) return null;
    const corner = node.findAncestor(".corner", true);
    if (corner) {
      const { roomId, edge } = parseEdgeId(corner.id());
      return { kind: "room", id: roomId, corner: edge };
    }
    for (const kind of ["opening", "fixture", "stairs", "edge", "wall", "room"] as const) {
      const hit = node.findAncestor(`.${kind}`, true);
      if (hit) return { kind, id: hit.id() };
    }
    return null;
  }

  const pickTargets = (skip: string[]) => snapTargets(latest.current.plan, skip);

  // ---- Placing things ----
  function placeOpeningAt(p: Point) {
    const near = nearestHost(plan, p, Math.max(30, 24 / s));
    if (!near) {
      onMessage("Click on a wall to put it there.");
      return;
    }
    const t = openingType(placeOpening);
    const widthIn = t.widths[0];
    const o: Opening = {
      id: newPlanId("o"),
      host: near.seg.host,
      offsetIn: round1(clampOffset(near.t, widthIn, near.seg.length)),
      kind: t.kind,
      style: t.id,
      widthIn,
      heightIn: t.id === "door-hinged" || t.id === "door-pocket" ? (basics?.doorHeightIn ?? t.heightIn) : t.heightIn,
      ...(t.sillIn !== undefined ? { sillIn: t.sillIn } : {}),
      side: near.side,
      hinge: "start",
    };
    onChange({ ...plan, openings: [...plan.openings, o] });
    onSelect([{ kind: "opening", id: o.id }]);
    onToolDone();
  }

  /** A fixture at a point, backed up against a wall when one is close. */
  function fixtureAt(p: Point): Fixture {
    const t = fixtureType(placeFixture);
    const f: Fixture = { id: newPlanId("f"), kind: t.id, x: Math.round(p.x), y: Math.round(p.y), rotation: 0, widthIn: t.widthIn, depthIn: t.depthIn };
    const near = nearestHost(plan, p, t.depthIn / 2 + 18);
    if (near) {
      const u = unit(sub(near.seg.b, near.seg.a));
      const inward = scaleV(leftNormal(u), near.side);
      const along = add(near.seg.a, scaleV(u, clampOffset(near.t, t.widthIn, near.seg.length)));
      const at = add(along, scaleV(inward, t.depthIn / 2 + 2.5));
      f.x = round1(at.x);
      f.y = round1(at.y);
      f.rotation = Math.round(angleOf(inward) - 90);
    }
    const room = plan.rooms.find((r) => pointIn(f, r.polygon));
    if (room) f.roomId = room.id;
    return f;
  }

  function placeStairsAt(p: Point) {
    const up = [...levels].sort((a, b) => a.elevationIn - b.elevationIn).find((l) => l.elevationIn > level.elevationIn);
    if (!up) {
      onMessage("There's no floor above this one for stairs to climb to. Add floors on the Rooms page, or a loft in the flow sketch.");
      return;
    }
    const st: PlanStairs = {
      id: newPlanId("st"),
      x: Math.round(p.x),
      y: Math.round(p.y),
      rotation: 0,
      widthIn: DEFAULT_STAIRS_WIDTH_IN,
      shape: basics?.stairs ?? "straight",
      flip: false,
      toLevelId: up.id,
    };
    onChange({ ...plan, stairs: [...plan.stairs, st] });
    onSelect([{ kind: "stairs", id: st.id }]);
    onToolDone();
  }

  function finishRoom(points: Point[]) {
    const pts = dedupe(points);
    if (pts.length < 3 || polygonArea(pts) < 10 * 144) {
      onMessage("That's too small for a room. Rooms need at least 10 sq ft.");
      return;
    }
    const room = makeRoom(pts);
    onChange(addRoom(plan, room));
    onSelect([{ kind: "room", id: room.id }]);
    setDraft([]);
    onToolDone();
  }

  function finishWalls(points: Point[]) {
    const pts = dedupe(points);
    setDraft([]);
    if (pts.length < 2) return;
    const walls = pts.slice(1).map((b, i) => ({ id: newPlanId("w"), a: roundPoint(pts[i]), b: roundPoint(b), thicknessIn: 4.5 }));
    onChange({ ...plan, walls: [...plan.walls, ...walls] });
    onSelect(walls.map((w) => ({ kind: "wall" as const, id: w.id })));
    onToolDone();
  }

  // Enter finishes a room or walls being clicked out; Escape drops it.
  useEffect(() => {
    if (!drafting) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      if (e.key === "Enter") {
        e.preventDefault();
        if (tool === "room") finishRoom(draft);
        else if (tool === "wall") finishWalls(draft);
      } else if (e.key === "Escape") {
        setDraft([]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---- Mouse ----
  function onMouseDown(e: Konva.KonvaEventObject<MouseEvent>) {
    if (e.evt.button !== 0 || spaceDown || tool === "pan") return;
    const stage = e.target.getStage()!;
    const p = world();
    const el = elementOf(e.target === stage ? null : e.target);
    const shift = e.evt.shiftKey;

    if (lotMode) {
      gesture.current = { type: "lot", start: p };
      return;
    }
    if (tool === "door") return placeOpeningAt(p);
    if (tool === "stairs") return placeStairsAt(p);
    if (tool === "fixture") {
      const f = fixtureAt(p);
      onChange({ ...plan, fixtures: [...plan.fixtures, f] });
      onSelect([{ kind: "fixture", id: f.id }]);
      onToolDone();
      return;
    }
    if (tool === "room" || tool === "wall") {
      const sp = snapFrom(draft[draft.length - 1] ?? null, p, pickTargets([]), tol, snap, shift).p;
      if (tool === "room" && draft.length === 0) {
        gesture.current = { type: "rect", start: sp, moved: false };
        return;
      }
      // Clicking the first corner again closes the room; clicking the last point again (a double-click) finishes.
      if (tool === "room" && draft.length >= 3 && dist(sp, draft[0]) <= tol) return finishRoom(draft);
      const last = draft[draft.length - 1];
      if (last && dist(sp, last) <= tol / 2) return tool === "room" ? finishRoom(draft) : finishWalls(draft);
      setDraft([...draft, sp]);
      return;
    }

    // Select tool.
    if (e.target.findAncestor("Transformer")) return;
    if (!el) {
      gesture.current = { type: "box", start: p, additive: shift, base: selection };
      setBox({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      return;
    }
    if (el.corner !== undefined) {
      gesture.current = { type: "corner", roomId: el.id, i: el.corner };
      return;
    }
    if (shift) {
      onSelect(isPicked(selection, el.id) ? selection.filter((x) => x.id !== el.id) : [...selection, el]);
      return;
    }
    const next = isPicked(selection, el.id) ? selection : [el];
    if (next !== selection) onSelect(next);
    if (el.kind === "opening") {
      gesture.current = { type: "opening", id: el.id, moved: false };
    } else if (el.kind === "edge") {
      const { roomId, edge } = parseEdgeId(el.id);
      gesture.current = { type: "edge", roomId, edge, start: p, moved: false };
    } else {
      const ids = next.filter((x) => x.kind !== "edge" && x.kind !== "opening").map((x) => x.id);
      if (ids.length) gesture.current = { type: "move", start: p, ids, moved: false };
    }
  }

  function onMouseMove(e: Konva.KonvaEventObject<MouseEvent>) {
    const p = world();
    const shift = e.evt.shiftKey;
    if (tool === "door" || tool === "fixture" || tool === "stairs" || drafting) setCursor(p);
    const g = gesture.current;
    if (!g) {
      if (drafting) setCursor(snapFrom(draft[draft.length - 1], p, pickTargets([]), tol, snap, shift).p);
      return;
    }
    const base = latest.current.plan;
    if (g.type === "rect") {
      const sp = snapFrom(null, p, pickTargets([]), tol, snap, false);
      if (!g.moved && dist(sp.p, g.start) * s < 5) return;
      g.moved = true;
      setRectEnd(sp.p);
      setGuides(sp.guides);
    } else if (g.type === "move") {
      const dx = p.x - g.start.x;
      const dy = p.y - g.start.y;
      if (!g.moved && Math.hypot(dx, dy) * s < 3) return;
      g.moved = true;
      const moving = base.rooms.filter((r) => g.ids.includes(r.id)).flatMap((r) => r.polygon);
      const still = pickTargets(g.ids).points;
      const m = snapMove(moving.length ? moving : [g.start], still, dx, dy, tol, snap);
      setGuides(m.guides);
      setPreview(moveMany(base, g.ids, m.dx, m.dy));
    } else if (g.type === "corner") {
      const room = base.rooms.find((r) => r.id === g.roomId);
      if (!room) return;
      const prev = room.polygon[(g.i - 1 + room.polygon.length) % room.polygon.length];
      const others = { ...pickTargets([g.roomId]) };
      others.points = [...others.points, ...room.polygon.filter((_, k) => k !== g.i)];
      const sp = snapFrom(prev, p, others, tol, snap, shift);
      setGuides(sp.guides);
      setPreview(setCorner(base, g.roomId, g.i, sp.p));
    } else if (g.type === "edge") {
      const room = base.rooms.find((r) => r.id === g.roomId);
      if (!room) return;
      const drag = sub(p, g.start);
      if (!g.moved && Math.hypot(drag.x, drag.y) * s < 3) return;
      g.moved = true;
      const a = room.polygon[g.edge];
      const b = room.polygon[(g.edge + 1) % room.polygon.length];
      const still = pickTargets([g.roomId]).points;
      const { d, n } = snapPush(a, b, drag, still, tol, snap);
      setPreview(moveEdge(base, g.roomId, g.edge, scaleV(n, d)));
    } else if (g.type === "opening") {
      g.moved = true;
      setPreview(moveOpeningTo(base, g.id, p, Math.max(18, 14 / s)));
    } else if (g.type === "box") {
      setBox({ x0: g.start.x, y0: g.start.y, x1: p.x, y1: p.y });
    } else if (g.type === "lot") {
      setLotDelta({ dx: p.x - g.start.x, dy: p.y - g.start.y });
    }
  }

  function onMouseUp() {
    const g = gesture.current;
    gesture.current = null;
    setGuides({});
    if (!g) return;
    const { preview: pv } = latest.current;
    if (g.type === "rect") {
      if (g.moved && rectEnd) {
        const w = Math.abs(rectEnd.x - g.start.x);
        const h = Math.abs(rectEnd.y - g.start.y);
        if (w >= MIN_ROOM_SIDE_IN && h >= MIN_ROOM_SIDE_IN) finishRoom(rectangle((g.start.x + rectEnd.x) / 2, (g.start.y + rectEnd.y) / 2, w, h));
        else onMessage("Drag a bigger rectangle, at least 2 ft on each side.");
      } else {
        // A click without a drag starts a room drawn corner by corner.
        setDraft([g.start]);
        setCursor(g.start);
      }
      setRectEnd(null);
      return;
    }
    if (g.type === "box") {
      finishBox(g);
      setBox(null);
      return;
    }
    if (g.type === "lot") {
      if (lotDelta && land) onLotMove({ x: Math.round(land.offset.x - lotDelta.dx), y: Math.round(land.offset.y - lotDelta.dy) });
      setLotDelta(null);
      return;
    }
    if (pv && (g.type === "corner" || ("moved" in g && g.moved))) onChange(pv);
    setPreview(null);
  }

  function onDblClick(e: Konva.KonvaEventObject<MouseEvent>) {
    // Rooms and walls being clicked out finish on a second click on the same spot (see onMouseDown).
    if (tool !== "select") return;
    const stage = e.target.getStage()!;
    const el = elementOf(e.target === stage ? null : e.target);
    if (!el) return;
    if (el.corner !== undefined) {
      const room = plan.rooms.find((r) => r.id === el.id);
      if (room && room.polygon.length > 3) onChange(removeCorner(plan, el.id, el.corner));
      return;
    }
    if (el.kind === "edge") {
      const { roomId, edge } = parseEdgeId(el.id);
      const room = plan.rooms.find((r) => r.id === roomId);
      if (!room) return;
      const a = room.polygon[edge];
      const b = room.polygon[(edge + 1) % room.polygon.length];
      onChange(insertCorner(plan, roomId, edge, project(world(), a, b).point));
      onSelect([{ kind: "room", id: roomId }]);
    }
  }

  /** Select everything the box touches. */
  function finishBox(g: Extract<Gesture, { type: "box" }>) {
    const rect = box ?? { x0: g.start.x, y0: g.start.y, x1: g.start.x, y1: g.start.y };
    const r = { x: Math.min(rect.x0, rect.x1), y: Math.min(rect.y0, rect.y1), width: Math.abs(rect.x1 - rect.x0), height: Math.abs(rect.y1 - rect.y0) };
    if (Math.max(r.width, r.height) * s < 4) {
      if (!g.additive && latest.current.selection.length) onSelect([]);
      return;
    }
    const layer = layerRef.current;
    if (!layer) return;
    const hits: PlanItem[] = [];
    for (const kind of ["room", "wall", "fixture", "stairs"] as const) {
      for (const node of layer.find(`.${kind}`)) {
        if (Konva.Util.haveIntersection(r, node.getClientRect({ relativeTo: layer }))) hits.push({ kind, id: node.id() });
      }
    }
    onSelect(g.additive ? [...g.base, ...hits.filter((h) => !isPicked(g.base, h.id))] : hits);
  }

  function onWheel(e: Konva.KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault();
    const stage = e.target.getStage()!;
    const pointer = stage.getPointerPosition() ?? { x: width / 2, y: height / 2 };
    if (e.evt.ctrlKey || e.evt.metaKey) {
      const sc = clampScale(s * Math.exp(-e.evt.deltaY * 0.01));
      const wx = (pointer.x - view.x) / s;
      const wy = (pointer.y - view.y) / s;
      setView({ scale: sc, x: pointer.x - wx * sc, y: pointer.y - wy * sc });
    } else {
      setView({ ...view, x: view.x - e.evt.deltaX, y: view.y - e.evt.deltaY });
    }
  }

  function zoomBy(factor: number) {
    const sc = clampScale(s * factor);
    const cx = width / 2;
    const cy = height / 2;
    setView({ scale: sc, x: cx - ((cx - view.x) / s) * sc, y: cy - ((cy - view.y) / s) * sc });
  }

  function onStageDrag(e: Konva.KonvaEventObject<DragEvent>) {
    const stage = e.target.getStage();
    if (e.target !== stage) return;
    setView({ scale: s, x: stage.x(), y: stage.y() });
  }

  /** Turning a room or fixture (or stretching a fixture) with the handles. */
  function onTransformEnd(e: Konva.KonvaEventObject<Event>) {
    const node = e.target;
    const m = node.getTransform().copy();
    const sx = node.scaleX();
    node.setAttrs({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
    const id = node.id();
    const room = plan.rooms.find((r) => r.id === id);
    if (room) {
      const dRot = Konva.Util.radToDeg(Math.atan2(m.getMatrix()[1], m.getMatrix()[0]));
      const tf = (p: Point) => roundPoint(m.point(p));
      onChange({
        ...plan,
        rooms: plan.rooms.map((r) => (r.id === id ? { ...r, polygon: r.polygon.map(tf) } : r)),
        fixtures: plan.fixtures.map((f) => (f.roomId === id ? { ...f, ...tf(f), rotation: Math.round(f.rotation + dRot) } : f)),
      });
      return;
    }
    const f = plan.fixtures.find((x) => x.id === id);
    if (f) {
      const at = m.point({ x: 0, y: 0 });
      const dec = m.decompose();
      onChange({
        ...plan,
        fixtures: plan.fixtures.map((x) =>
          x.id === id ? { ...x, x: round1(at.x), y: round1(at.y), rotation: Math.round(dec.rotation), widthIn: Math.max(12, Math.round(x.widthIn * Math.abs(sx))) } : x,
        ),
      });
    }
  }

  // ---- Drawing ----
  const panning = tool === "pan" || spaceDown;
  const cursorStyle = panning ? "grab" : lotMode ? "move" : tool === "select" ? "default" : "crosshair";
  const roomById = new Map(shown.rooms.map((r) => [r.id, r]));
  const selectedEdge = single?.kind === "edge" ? parseEdgeId(single.id) : null;
  const ghostOpening = tool === "door" && cursor ? ghostOpeningAt(plan, cursor, placeOpening, s) : null;
  const ghostFixture = tool === "fixture" && cursor ? fixtureAt(cursor) : null;
  const ghostStairs = tool === "stairs" && cursor ? { x: cursor.x, y: cursor.y, rotation: 0, widthIn: DEFAULT_STAIRS_WIDTH_IN, shape: basics?.stairs ?? "straight", flip: false } : null;
  const rectPreview = rectEnd && gesture.current?.type === "rect" ? gesture.current.start : null;

  return (
    <div
      ref={wrapRef}
      className="relative overflow-hidden rounded-lg border border-line bg-[#fbfaf7]"
      style={{ height, cursor: cursorStyle }}
      onMouseEnter={() => (hovering.current = true)}
      onMouseLeave={() => {
        hovering.current = false;
        setCursor(null);
      }}
    >
      {width > 0 && (
        <Stage
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
          onDblClick={onDblClick}
          onWheel={onWheel}
        >
          <Layer listening={false}>
            <Grid view={view} width={width} height={height} />
          </Layer>

          {land && <LandLayer land={land} scale={s} shift={lotDelta} />}

          {(sketch || below) && (
            <Layer listening={false}>
              {sketch?.bubbles.map((b) => (
                <Group key={b.id} opacity={0.35}>
                  <BubbleShape b={b} fill={b.color ?? "#ead9f0"} stroke={INK} strokeWidth={1} strokeScaleEnabled={false} dash={[5, 4]} />
                  <Text x={b.x} y={b.y - 6 / s} text={b.label} fontSize={11 / s} width={160 / s} offsetX={80 / s} align="center" fill={INK} />
                </Group>
              ))}
              {below?.plan.rooms.map((r) => (
                <Line key={r.id} points={flat(r.polygon)} closed stroke={INK} strokeWidth={1} strokeScaleEnabled={false} dash={[6, 4]} opacity={0.3} />
              ))}
            </Layer>
          )}

          <Layer ref={layerRef}>
            {shown.rooms.map((r) => (
              <Line
                key={r.id}
                id={r.id}
                name="room"
                points={flat(r.polygon)}
                closed
                fill={roomFill(r.type)}
                opacity={isPicked(selection, r.id) ? 0.85 : 0.55}
                onTransformEnd={onTransformEnd}
              />
            ))}

            {stairsComingUp.map((st) => (
              <StairsSymbol key={`down-${st.id}`} d={stairsDrawing(st, riseFor(st, below!.level))} scale={s} down />
            ))}
            {shown.stairs.map((st) => (
              <StairsSymbol key={st.id} id={st.id} d={stairsDrawing(st, riseFor(st, level))} selected={isPicked(selection, st.id)} scale={s} />
            ))}

            {shown.fixtures.map((f) => (
              <FixtureSymbol key={f.id} f={f} selected={isPicked(selection, f.id)} scale={s} onTransformEnd={onTransformEnd} />
            ))}

            {/* Walls, each room edge as its own hit target so it can be picked and pushed. */}
            {solids.map((w, i) => {
              const host = w.piece.host;
              const id = "roomId" in host ? edgeId(host.roomId, host.edge) : host.wallId;
              const on = isPicked(selection, id) || ("wallId" in host ? false : isPicked(selection, host.roomId) && selection.length === 1);
              if (w.open) {
                return (
                  <Line key={i} id={id} name="edge" points={[w.a.x, w.a.y, w.b.x, w.b.y]} stroke={on ? ACCENT : "#7d766a"} strokeWidth={1.5} strokeScaleEnabled={false} dash={[8, 5]} hitStrokeWidth={12 / s} />
                );
              }
              const u = unit(sub(w.b, w.a));
              const half = w.thicknessIn / 2;
              const a = w.capA ? add(w.a, scaleV(u, -half)) : w.a;
              const b = w.capB ? add(w.b, scaleV(u, half)) : w.b;
              return (
                <Line
                  key={i}
                  id={id}
                  name={"wallId" in host ? "wall" : "edge"}
                  points={[a.x, a.y, b.x, b.y]}
                  stroke={on ? ACCENT : w.exterior ? INK : "#4a463f"}
                  strokeWidth={w.thicknessIn}
                  hitStrokeWidth={Math.max(w.thicknessIn, 12 / s)}
                  lineCap="butt"
                />
              );
            })}

            {geos.map((g) => (
              <OpeningSymbol key={g.opening.id} g={g} thickness={thicknessAt(g)} selected={isPicked(selection, g.opening.id)} scale={s} name="opening" />
            ))}

            {/* Room names, sizes and wall lengths. */}
            <Group listening={false}>
              {shown.rooms.map((r) => {
                const c = polygonCenter(r.polygon);
                const wBox = 140 / s;
                return (
                  <Group key={`label-${r.id}`}>
                    <Text x={c.x} y={c.y - 10 / s} width={wBox} offsetX={wBox / 2} align="center" text={r.name} fontSize={12.5 / s} fontStyle="600" fill={INK} wrap="none" ellipsis />
                    <Text x={c.x} y={c.y + 5 / s} width={wBox} offsetX={wBox / 2} align="center" text={`${roomSqft(r).toLocaleString("en-US")} sq ft`} fontSize={10.5 / s} fill="#6b716c" />
                  </Group>
                );
              })}
              {showDims &&
                shown.rooms.flatMap((r) =>
                  edgesOf(r.polygon).map((e) => {
                    const L = dist(e.a, e.b);
                    if (L * s < 64) return null;
                    const u = unit(sub(e.b, e.a));
                    // Inside the room: corners run clockwise, so inside is to the right of each edge.
                    const inward = scaleV(leftNormal(u), -1);
                    const mid = add(scaleV(add(e.a, e.b), 0.5), scaleV(inward, 6 + 9 / s));
                    const w = 80 / s;
                    return (
                      <Text
                        key={`${r.id}-${e.i}`}
                        x={mid.x}
                        y={mid.y}
                        offsetX={w / 2}
                        offsetY={5 / s}
                        width={w}
                        align="center"
                        rotation={uprightAngle(u)}
                        text={formatFeetInches(L)}
                        fontSize={9.5 / s}
                        fill="#7a6f5e"
                      />
                    );
                  }),
                )}
              {showDims &&
                shown.walls.map((w) => {
                  const L = dist(w.a, w.b);
                  if (L * s < 64) return null;
                  const u = unit(sub(w.b, w.a));
                  const mid = add(scaleV(add(w.a, w.b), 0.5), scaleV(leftNormal(u), 6 + 9 / s));
                  const bw = 80 / s;
                  return <Text key={`wl-${w.id}`} x={mid.x} y={mid.y} offsetX={bw / 2} offsetY={5 / s} width={bw} align="center" rotation={uprightAngle(u)} text={formatFeetInches(L)} fontSize={9.5 / s} fill="#7a6f5e" />;
                })}
            </Group>

            {/* The selected wall's length, larger. */}
            {selectedEdge &&
              (() => {
                const r = roomById.get(selectedEdge.roomId);
                if (!r) return null;
                const a = r.polygon[selectedEdge.edge];
                const b = r.polygon[(selectedEdge.edge + 1) % r.polygon.length];
                const u = unit(sub(b, a));
                const mid = add(scaleV(add(a, b), 0.5), scaleV(leftNormal(u), 10 + 12 / s));
                const w = 100 / s;
                return <Text x={mid.x} y={mid.y} offsetX={w / 2} offsetY={7 / s} width={w} align="center" rotation={uprightAngle(u)} text={formatFeetInches(dist(a, b))} fontSize={13 / s} fontStyle="600" fill={ACCENT} listening={false} />;
              })()}

            {/* Corner dots on the selected room. */}
            {selRoom &&
              selRoom.polygon.map((p, i) => (
                <Circle key={i} id={edgeId(selRoom.id, i)} name="corner" x={p.x} y={p.y} radius={5.5 / s} fill="#fff" stroke={ACCENT} strokeWidth={2} strokeScaleEnabled={false} hitStrokeWidth={10} />
              ))}

            {/* Drawing in progress. */}
            {rectPreview && rectEnd && (
              <Rect
                x={Math.min(rectPreview.x, rectEnd.x)}
                y={Math.min(rectPreview.y, rectEnd.y)}
                width={Math.abs(rectEnd.x - rectPreview.x)}
                height={Math.abs(rectEnd.y - rectPreview.y)}
                fill="rgba(47,107,79,0.12)"
                stroke={ACCENT}
                strokeWidth={2}
                strokeScaleEnabled={false}
                dash={[6, 4]}
                listening={false}
              />
            )}
            {rectPreview && rectEnd && (
              <Text
                x={(rectPreview.x + rectEnd.x) / 2}
                y={(rectPreview.y + rectEnd.y) / 2}
                width={160 / s}
                offsetX={80 / s}
                offsetY={6 / s}
                align="center"
                text={`${formatFeetInches(Math.abs(rectEnd.x - rectPreview.x))} × ${formatFeetInches(Math.abs(rectEnd.y - rectPreview.y))}`}
                fontSize={12 / s}
                fontStyle="600"
                fill={ACCENT}
                listening={false}
              />
            )}
            {drafting && (
              <Group listening={false}>
                <Line
                  points={flat(cursor ? [...draft, cursor] : draft)}
                  closed={tool === "room"}
                  fill={tool === "room" ? "rgba(47,107,79,0.1)" : undefined}
                  stroke={ACCENT}
                  strokeWidth={tool === "wall" ? 4.5 : 2}
                  strokeScaleEnabled={tool !== "wall"}
                  dash={tool === "room" ? [6 / s, 4 / s] : undefined}
                  opacity={tool === "wall" ? 0.7 : 1}
                />
                {draft.map((p, i) => (
                  <Circle key={i} x={p.x} y={p.y} radius={(i === 0 && tool === "room" ? 6 : 3.5) / s} fill={i === 0 ? ACCENT : "#fff"} stroke={ACCENT} strokeWidth={1.5} strokeScaleEnabled={false} />
                ))}
                {cursor && (
                  <Text
                    x={cursor.x + 10 / s}
                    y={cursor.y + 10 / s}
                    text={formatFeetInches(dist(draft[draft.length - 1], cursor))}
                    fontSize={11.5 / s}
                    fontStyle="600"
                    fill={ACCENT}
                  />
                )}
              </Group>
            )}

            {ghostOpening && <OpeningSymbol g={ghostOpening.g} thickness={ghostOpening.thickness} selected scale={s} ghost />}
            {ghostFixture && <FixtureSymbol f={ghostFixture} selected={false} scale={s} ghost />}
            {ghostStairs && (
              <Group opacity={0.5} listening={false}>
                <StairsSymbol d={stairsDrawing(ghostStairs, 121)} scale={s} />
              </Group>
            )}

            {/* Lining-up guides while snapping. */}
            {guides.x !== undefined && <Line points={[guides.x, -1e5, guides.x, 1e5]} stroke={ACCENT} strokeWidth={1} strokeScaleEnabled={false} dash={[4, 4]} opacity={0.6} listening={false} />}
            {guides.y !== undefined && <Line points={[-1e5, guides.y, 1e5, guides.y]} stroke={ACCENT} strokeWidth={1} strokeScaleEnabled={false} dash={[4, 4]} opacity={0.6} listening={false} />}

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
              rotateEnabled
              rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
              rotationSnapTolerance={4}
              enabledAnchors={selFixture && fixtureType(selFixture.kind).stretch ? ["middle-left", "middle-right"] : []}
              anchorSize={9}
              borderStroke={ACCENT}
              anchorStroke={ACCENT}
              borderDash={[4, 3]}
              ignoreStroke
              keepRatio={false}
            />
          </Layer>
        </Stage>
      )}

      <SideLabels sides={sides} />
      {(below || sketch) && (
        <p className="pointer-events-none absolute top-2 left-3 rounded bg-white/80 px-2 py-0.5 text-xs text-muted">
          {[sketch ? "Faint bubbles: your flow sketch" : null, below ? `Dashed: ${below.name}` : null].filter(Boolean).join(" · ")}
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

function pointIn(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function dedupe(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) if (!out.length || dist(out[out.length - 1], p) > 1) out.push(p);
  if (out.length > 2 && dist(out[0], out[out.length - 1]) <= 1) out.pop();
  return out;
}

/** Where a door or window would land if placed at this point. */
function ghostOpeningAt(plan: FloorPlan, p: Point, style: string, s: number): { g: OpeningGeometry; thickness: number } | null {
  const near = nearestHost(plan, p, Math.max(30, 24 / s));
  if (!near) return null;
  const t = openingType(style);
  const o: Opening = {
    id: "ghost",
    host: near.seg.host,
    offsetIn: clampOffset(near.t, t.widths[0], near.seg.length),
    kind: t.kind,
    style: t.id,
    widthIn: t.widths[0],
    heightIn: t.heightIn,
    side: near.side,
    hinge: "start",
  };
  const g = openingGeometry(plan, o);
  return g ? { g, thickness: 6 } : null;
}
