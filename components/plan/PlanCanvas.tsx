"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Circle, Group, Layer, Line, Stage, Transformer } from "react-konva";
import Konva from "konva";
import type { BubbleDiagram, Fixture, FloorPlan, Level, Opening, OpeningHost, PlanBasics, PlanLabels, PlanStairs, Point } from "@/lib/model/schema";
import { exteriorWallIn, riseBetween } from "@/lib/plan/basics";
import { fixtureType, openingType } from "@/lib/plan/catalog";
import { trimOverlap } from "@/lib/plan/overlaps";
import { bendInfo, bendWall, bowFromPoint, planRadii, snapBow, type BendSnap, type BendTarget } from "@/lib/plan/bend";
import { DRAW_STEP_DEG, flatPlan, roomOutline, savedHost } from "@/lib/plan/flatten";
import { leftBulge, pointOnEdge, projectOnEdge, roomEdgeLength } from "@/lib/plan/arcs";
import { makeRoundRoom } from "@/lib/plan/shapes";
import { addRoom, insertCorner, insertGluedCorner, makeRoom, moveEdge, moveMany, moveOpeningTo, newPlanId, removeCorner, setCornerGlued } from "@/lib/plan/edit";
import { add, angleOf, boundsOf, dist, leftNormal, polygonArea, polygonsOverlap, project, rectangle, round1, roundPoint, scale as scaleV, sub, unit } from "@/lib/plan/geometry";
import { curvedOpeningGuides, distanceGuides, formatLength, labelOn, openingGuides, wallSegments, type Guide } from "@/lib/plan/labels";
import { snapFrom, snapMove, snapNode, snapPush, snapTargets, type Guides } from "@/lib/plan/snap";
import { mergeTargets, overhangsOf, supportTargets } from "@/lib/plan/support";
import { roofFootprint, type Region } from "@/lib/house3d/footprint";
import { parseTypedLength } from "@/lib/model/units";
import { DEFAULT_STAIRS_WIDTH_IN, stairsCut, stairsDrawing } from "@/lib/plan/stairs";
import { drawThickness, clampOffset, hostSegment, nearestHost, sameHost, openingGeometries, solidWalls, wallPieces, type OpeningGeometry } from "@/lib/plan/walls";
import { fillRoomAt, splitRoom, whyNotFill } from "@/lib/plan/partitions";
import { bowForTyped, curveBow, drawCurve } from "@/lib/plan/curveTool";
import LandLayer from "@/components/bubbles/LandLayer";
import type { LandView, Side } from "@/components/bubbles/types";
import { Grid, ScaleBar, SideLabels, useSpacePan, type View } from "@/components/canvas/CanvasBits";
import { ACCENT, FixtureSymbol, OpeningSymbol, StairsSymbol } from "./PlanShapes";
import { dedupe, flat, ghostOpeningAt, pointIn, roomFill, type Box } from "./canvasHelpers";
import { BendHandles, BendTip, DraftPreview, FurnitureOutlines, GuidesAndBox, MidNodes, NodeReadout, OverhangLayer, PlanWalls, ReferenceLayer, ZoomButtons } from "./PlanCanvasLayers";
import { DistanceGuides, OutsideDims, RoomLabels, TapeLine, ThingLabels } from "./PlanMeasureLayers";
import { edgeId, isPicked, parseEdgeId, type PlanItem, type PlanSelection, type PlanTool } from "./types";

/**
 * The floor plan drawing for one level, at real scale: 1 unit is 1 inch.
 * While something is being dragged, the drawing shows a preview; letting go
 * sends the whole new plan up so the project store can save it and undo it.
 */

type Gesture =
  | { type: "move"; start: Point; ids: string[]; moved: boolean }
  | { type: "corner"; roomId: string; i: number; base?: FloorPlan; born?: boolean; moved: boolean }
  | { type: "edge"; roomId: string; edge: number; start: Point; moved: boolean }
  | { type: "bend"; target: BendTarget; alone: boolean; moved: boolean }
  | { type: "opening"; id: string; moved: boolean }
  | { type: "box"; start: Point; additive: boolean; base: PlanSelection }
  | { type: "lot"; start: Point }
  | { type: "rect"; start: Point; moved: boolean };

/** What to say beside the diamond while a wall is bent: radius and length, or that it snapped flat or to a half circle. */
function bendReadout(plan: FloorPlan, target: BendTarget, snap: BendSnap): { at: Point; text: string } | null {
  const info = bendInfo(plan, target);
  if (!info) return null;
  const at = scaleV(add(info.a, info.b), 0.5);
  if (!info.radius) return { at, text: `Straight · ${formatLength(info.chord)}` };
  const note = snap === "half" ? "half circle · " : snap === "radius" ? "matches a curve · " : "";
  return { at, text: `${note}R ${formatLength(info.radius)} · arc ${formatLength(info.length)}` };
}

const MIN_SCALE = 0.04;
const MAX_SCALE = 5;
const SNAP_PX = 9;
const MIN_ROOM_SIDE_IN = 24;
const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

type Props = {
  plan: FloorPlan;
  level: Level;
  levels: Level[];
  basics: PlanBasics | null;
  /** The level below, drawn faintly, and the stairs that come up from it. */
  below: { name: string; plan: FloorPlan; level: Level } | null;
  /** What holds this floor up (the floor below's outline), for the overhang shading and snapping. */
  support?: { name: string; regions: Region[] } | null;
  /** The floor above, drawn faintly, with the parts of it that hang past this floor shaded. */
  above?: { name: string; plan: FloorPlan } | null;
  /** The flow sketch for this level, drawn faintly to trace over. */
  sketch: BubbleDiagram | null;
  tool: PlanTool;
  /** The Room tool fills a space closed in by walls with a click, instead of drawing a new outline. */
  fillMode?: boolean;
  /** The Room tool draws a round room: click for the typed diameter, or drag out from the middle. */
  roomShape?: "box" | "round";
  roundDiameter?: number;
  /** What the Doors and windows tool and the Fixtures tool place. */
  placeOpening: string;
  placeFixture: string;
  selection: PlanSelection;
  snap: boolean;
  labels: PlanLabels;
  /** The measuring tape is on: clicks measure instead of select. */
  tape: boolean;
  sides: Record<Side, string[]>;
  height: number;
  land: LandView | null;
  lotMode: boolean;
  /** Center the drawing on this spot (a new key each time it's asked). */
  focus?: { at: Point; key: number } | null;
  onLotMove: (offset: Point) => void;
  onSelect: (s: PlanSelection) => void;
  onChange: (p: FloorPlan, coalesce?: string) => void;
  /** Placing tools hand back to Select after one use. */
  onToolDone: () => void;
  onDrafting: (drafting: boolean) => void;
  onMessage: (text: string) => void;
  /** Right-click on the drawing: where, and what was under the pointer (a corner has `corner` set). */
  onContext?: (c: { x: number; y: number; el: (PlanItem & { corner?: number }) | null; at: Point }) => void;
  /** The plan as it looks mid-drag (null once let go), for views that follow along. */
  onPreview?: (p: FloorPlan | null) => void;
};

export default function PlanCanvas(props: Props) {
  const { plan, level, levels, basics, below, support, above, sketch, tool, placeOpening, placeFixture, selection, snap, labels, tape, sides, height, land, lotMode, onLotMove } = props;
  const { onSelect, onChange, onToolDone, onDrafting, onMessage, fillMode = false, roomShape = "box", roundDiameter = 144 } = props;
  // Option (Alt) held while finishing a wall keeps it a divider wall, even right across a room.
  const altDown = useRef(false);
  useEffect(() => {
    const track = (e: KeyboardEvent) => (altDown.current = e.altKey);
    window.addEventListener("keydown", track);
    window.addEventListener("keyup", track);
    return () => {
      window.removeEventListener("keydown", track);
      window.removeEventListener("keyup", track);
    };
  }, []);
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
  const [typed, setTyped] = useState("");
  // The Curve tool, once its two ends are in: how far it bows (left of start→end).
  const [bow, setBow] = useState<{ left: number; snap: BendSnap } | null>(null);
  const [selCorner, setSelCorner] = useState<{ roomId: string; i: number } | null>(null);
  const [hoverWall, setHoverWall] = useState<OpeningHost | null>(null);
  const [bendTip, setBendTip] = useState<{ at: Point; text: string } | null>(null);
  const [dragGuides, setDragGuides] = useState<Guide[]>([]);
  const [tapePts, setTapePts] = useState<Point[]>([]);
  const [tapeEnd, setTapeEnd] = useState<Point | null>(null);
  const [dragCorner, setDragCorner] = useState<{ roomId: string; i: number } | null>(null);
  const { spaceDown, hovering } = useSpacePan();
  const shown = preview ?? plan;
  const overhangs = useMemo(() => (support ? overhangsOf(shown.rooms, support.regions) : []), [shown, support]);
  const aboveOver = useMemo(() => (above ? overhangsOf(above.plan.rooms, roofFootprint(shown)) : []), [shown, above]);
  const supportSnap = useMemo(() => (support ? supportTargets(support.regions) : null), [support]);
  const onPreview = props.onPreview;
  useEffect(() => onPreview?.(preview), [preview, onPreview]);
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
    setTyped("");
    setBow(null);
    setRectEnd(null);
    gesture.current = null;
    setPreview(null);
    setSelCorner(null);
    setDragCorner(null);
  }, [tool, level.id]);

  // Leaving the measuring tape clears its line; Escape clears it while staying in tape mode.
  useEffect(() => {
    if (!tape) {
      setTapePts([]);
      setTapeEnd(null);
    }
  }, [tape]);
  useEffect(() => {
    if (!tape || !tapePts.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setTapePts([]);
      setTapeEnd(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [tape, tapePts.length]);

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

  // Center on a spot when asked (a warning was clicked), zooming in a little if far out.
  const focus = props.focus;
  useEffect(() => {
    if (!focus || !width) return;
    setView((v) => {
      const sc = clampScale(Math.max(v.scale, 0.6));
      return { scale: sc, x: width / 2 - focus.at.x * sc, y: height / 2 - focus.at.y * sc };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.key]);

  // ---- What's drawn ----
  // Curves are drawn as many short straight pieces; the saved plan keeps them as single curved walls.
  const fp = useMemo(() => flatPlan(shown, DRAW_STEP_DEG), [shown]);
  const pieces = useMemo(() => wallPieces(fp, exteriorIn), [fp, exteriorIn]);
  const geos = useMemo(() => openingGeometries(fp), [fp]);
  const solids = useMemo(() => solidWalls(pieces, geos), [pieces, geos]);
  const thicknessAt = useCallback(
    (g: OpeningGeometry) => {
      let best = { d: Infinity, t: 4.5 };
      for (const p of pieces) {
        const pr = project(g.center, p.a, p.b);
        if (pr.d < best.d) best = { d: pr.d, t: drawThickness(p, exteriorIn) || p.thicknessIn };
      }
      return best.t;
    },
    [pieces, exteriorIn],
  );

  const riseFor = (st: Pick<PlanStairs, "toLevelId">, from: Level) => {
    const to = levels.find((l) => l.id === st.toLevelId);
    return to ? riseBetween(basics, from, to) : 108 + 13;
  };
  const stairsComingUp = below ? below.plan.stairs.filter((st) => st.toLevelId === level.id) : [];

  const single = selection.length === 1 ? selection[0] : null;
  const selRoom = single?.kind === "room" && tool === "select" ? shown.rooms.find((r) => r.id === single.id) : undefined;
  const selFixture = single?.kind === "fixture" && tool === "select" ? shown.fixtures.find((f) => f.id === single.id) : undefined;
  const selRoomId = selRoom?.id;
  // The diamonds: every side of a picked room, the picked side of a room, or a picked wall.
  const bendTargets: BendTarget[] = useMemo(() => {
    if (!single) return [];
    if (single.kind === "room" && selRoom) return selRoom.polygon.map((_, edge) => ({ roomId: selRoom.id, edge }));
    if (single.kind === "edge") return [{ roomId: parseEdgeId(single.id).roomId, edge: parseEdgeId(single.id).edge }];
    if (single.kind === "wall") return [{ wallId: single.id }];
    return [];
  }, [single, selRoom]);
  useEffect(() => {
    setSelCorner((c) => (c && c.roomId === selRoomId ? c : null));
  }, [selRoomId]);
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
  function elementOf(node: Konva.Node | null): (PlanItem & { corner?: number; mid?: number; bend?: string }) | null {
    if (!node) return null;
    const mid = node.findAncestor(".mid", true);
    if (mid) {
      const { roomId, edge } = parseEdgeId(mid.id());
      return { kind: "room", id: roomId, mid: edge };
    }
    const bend = node.findAncestor(".bend", true);
    if (bend) return bend.id().includes("#") ? { kind: "room", id: bend.id().split("#")[0], bend: bend.id() } : { kind: "wall", id: bend.id(), bend: bend.id() };
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

  const pickTargets = (skip: string[]) => mergeTargets(snapTargets(latest.current.plan, skip), supportSnap);

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
      const u = near.u;
      const inward = scaleV(leftNormal(u), near.side);
      const along = pointOnEdge(near.seg.a, near.seg.b, near.seg.bulge ?? 0, clampOffset(near.t, t.widthIn, near.seg.length));
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

  function finishRoundRoom(center: Point, diameter: number) {
    if (diameter < MIN_ROOM_SIDE_IN * 2) return onMessage("Drag a bigger circle, at least 4 ft across.");
    const room = makeRoundRoom(center, diameter);
    onChange(addRoom(plan, room));
    onSelect([{ kind: "room", id: room.id }]);
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

  function finishWalls(points: Point[], divider = altDown.current) {
    const pts = dedupe(points);
    setDraft([]);
    if (pts.length < 2) return;
    // From one wall of a room to another: the room splits in two along it.
    const split = divider ? null : splitRoom(plan, pts.map(roundPoint));
    if (split) {
      const was = plan.rooms.find((r) => r.id === split.roomId);
      const made = split.plan.rooms.find((r) => r.id === split.newRoomId);
      onChange(split.plan);
      onSelect([{ kind: "room", id: split.newRoomId }]);
      onMessage(`Split ${was?.name || "the room"} in two. Name the new ${made?.name ?? "room"} on the right. (Hold Option while drawing for a wall that doesn't split.)`);
      onToolDone();
      return;
    }
    const walls = pts.slice(1).map((b, i) => ({ id: newPlanId("w"), a: roundPoint(pts[i]), b: roundPoint(b), thicknessIn: 4.5 }));
    onChange({ ...plan, walls: [...plan.walls, ...walls] });
    onSelect(walls.map((w) => ({ kind: "wall" as const, id: w.id })));
    onToolDone();
  }

  function finishCurve(a: Point, b: Point, left: number, divider = altDown.current) {
    setDraft([]);
    setBow(null);
    setTyped("");
    const out = drawCurve(plan, a, b, left, divider);
    if (!out) return onMessage("That's too short for a wall. Click farther apart.");
    onChange(out.plan);
    if (out.split) {
      const was = plan.rooms.find((r) => r.id === out.split!.roomId);
      const made = out.plan.rooms.find((r) => r.id === out.split!.newRoomId);
      onSelect([{ kind: "room", id: out.split.newRoomId }]);
      onMessage(`Split ${was?.name || "the room"} in two along the curve. Name the new ${made?.name ?? "room"} on the right. (Hold Option while clicking for a curved wall that doesn't split.)`);
    } else if (out.wallId) onSelect([{ kind: "wall", id: out.wallId }]);
    onToolDone();
  }

  /** The next point for a line from `last`: `length` inches toward the cursor (east when the cursor is on top of it). */
  function pointAtLength(last: Point, length: number): Point {
    const toward = cursor && dist(cursor, last) > 0.5 ? unit(sub(cursor, last)) : { x: 1, y: 0 };
    return roundPoint(add(last, scaleV(toward, length)));
  }

  // While a room or walls are being clicked out: Enter finishes (or places a typed length), Escape drops it.
  // Digits, ' and " type a length for the line being drawn, e.g. 12'6 or 150 (inches).
  useEffect(() => {
    if (!drafting) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      // Option+Enter finishes too (as a divider wall that doesn't split the room).
      if (e.metaKey || e.ctrlKey || (e.altKey && e.key !== "Enter")) return;
      const stop = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (/^[0-9'".]$/.test(e.key) || (e.key === " " && typed)) {
        stop();
        setTyped(typed + e.key);
      } else if (e.key === "Backspace" && typed) {
        stop();
        setTyped(typed.slice(0, -1));
      } else if (e.key === "Enter") {
        stop();
        if (tool === "curve" && draft.length === 2) {
          // With both ends in, a typed number is the radius; Enter alone keeps the bow as it is.
          if (!typed) return finishCurve(draft[0], draft[1], bow?.left ?? 0, e.altKey || altDown.current);
          const r = parseTypedLength(typed);
          const left = r === null ? null : bowForTyped(draft[0], draft[1], r, bow?.left ?? 1);
          setTyped("");
          if (r === null) onMessage(`I couldn't read "${typed}" as a radius. Try 8' or 96 (inches).`);
          else if (left === null) onMessage(`That radius is too small to reach. It needs to be at least ${formatLength(dist(draft[0], draft[1]) / 2)}.`);
          else finishCurve(draft[0], draft[1], left, e.altKey || altDown.current);
          return;
        }
        if (typed) {
          const len = parseTypedLength(typed);
          if (len === null) {
            onMessage(`I couldn't read "${typed}" as a length. Try 12'6 or 150 (inches).`);
          } else {
            setDraft([...draft, pointAtLength(draft[draft.length - 1], len)]);
            setTyped("");
          }
        } else if (tool === "room") finishRoom(draft);
        else if (tool === "wall") finishWalls(draft);
      } else if (e.key === "Escape") {
        stop();
        if (typed) setTyped("");
        else {
          setDraft([]);
          setBow(null);
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  // Delete takes away the corner dot that's picked (before the room itself would go).
  useEffect(() => {
    if (!selCorner || tool !== "select") return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== "Delete" && e.key !== "Backspace") || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) return;
      e.preventDefault();
      e.stopPropagation();
      const room = plan.rooms.find((r) => r.id === selCorner.roomId);
      if (!room) return;
      if (room.polygon.length <= 3) onMessage("A room needs at least three corners.");
      else onChange(removeCorner(plan, selCorner.roomId, selCorner.i));
      setSelCorner(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  /** Distances from what is being moved (rooms, fixtures, walls) to the nearest walls on each side. */
  function movedGuides(moved: FloorPlan, ids: string[]): Guide[] {
    const pts: Point[] = [
      ...moved.rooms.filter((r) => ids.includes(r.id)).flatMap((r) => r.polygon),
      ...moved.fixtures.filter((f) => ids.includes(f.id)).flatMap((f) => rectangle(f.x, f.y, f.widthIn, f.depthIn, f.rotation)),
      ...moved.walls.filter((w) => ids.includes(w.id)).flatMap((w) => [w.a, w.b]),
    ];
    const box = boundsOf(pts);
    if (!box) return [];
    return distanceGuides(box, wallSegments(moved, ids, ids));
  }

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
    if (tape) {
      const sp = snapFrom(tapePts.length === 1 ? tapePts[0] : null, p, pickTargets([]), tol, snap, shift).p;
      if (tapePts.length === 1) {
        setTapePts([tapePts[0], sp]);
        setTapeEnd(null);
      } else {
        setTapePts([sp]);
        setTapeEnd(sp);
      }
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
    if (tool === "room" && fillMode) {
      const why = whyNotFill(plan, p);
      const out = why ? null : fillRoomAt(plan, p);
      if (!out) return onMessage(why ?? "There's no closed space there.");
      onChange(out.plan);
      onSelect([{ kind: "room", id: out.roomId }]);
      onToolDone();
      return;
    }
    if (tool === "curve") {
      if (draft.length === 2) return finishCurve(draft[0], draft[1], bow?.left ?? 0, e.evt.altKey);
      const sp = snapFrom(draft[0] ?? null, p, pickTargets([]), tol, snap, shift).p;
      if (draft.length === 1 && dist(sp, draft[0]) <= tol / 2) return;
      setDraft([...draft, sp]);
      if (draft.length === 1) setBow({ left: 0, snap: "flat" });
      return;
    }
    if (tool === "room" || tool === "wall") {
      const sp = snapFrom(draft[draft.length - 1] ?? null, p, pickTargets([]), tol, snap, shift, tool === "room" && draft.length >= 2 ? [draft[0]] : []).p;
      if (tool === "room" && draft.length === 0) {
        gesture.current = { type: "rect", start: sp, moved: false };
        return;
      }
      // Clicking the first corner again closes the room; clicking the last point again (a double-click) finishes.
      if (tool === "room" && draft.length >= 3 && dist(sp, draft[0]) <= tol) return finishRoom(draft);
      const last = draft[draft.length - 1];
      if (last && dist(sp, last) <= tol / 2) return tool === "room" ? finishRoom(draft) : finishWalls(draft, e.evt.altKey);
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
    if (el.bend !== undefined) {
      // The diamond: pull the wall into a curve. Option bends one room's side alone.
      const target: BendTarget = el.bend.includes("#") ? { roomId: parseEdgeId(el.bend).roomId, edge: parseEdgeId(el.bend).edge } : { wallId: el.bend };
      gesture.current = { type: "bend", target, alone: e.evt.altKey, moved: false };
      return;
    }
    if (el.mid !== undefined) {
      // A new corner is born in the middle of the edge and pulled out with the mouse.
      const room = plan.rooms.find((r) => r.id === el.id);
      if (!room) return;
      const a = room.polygon[el.mid];
      const b = room.polygon[(el.mid + 1) % room.polygon.length];
      const born = insertGluedCorner(plan, el.id, el.mid, pointOnEdge(a, b, leftBulge(room, el.mid), roomEdgeLength(room, el.mid) / 2));
      gesture.current = { type: "corner", roomId: el.id, i: born.index, base: born.plan, born: true, moved: false };
      setSelCorner({ roomId: el.id, i: born.index });
      setDragCorner({ roomId: el.id, i: born.index });
      return;
    }
    if (el.corner !== undefined) {
      gesture.current = { type: "corner", roomId: el.id, i: el.corner, moved: false };
      setSelCorner({ roomId: el.id, i: el.corner });
      setDragCorner({ roomId: el.id, i: el.corner });
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
    if (tape) {
      if (tapePts.length === 1) setTapeEnd(snapFrom(tapePts[0], p, pickTargets([]), tol, snap, shift).p);
      return;
    }
    if (!g) {
      // Hovering a wall shows its length, even when wall lengths are hidden.
      if (tool === "select" && !drafting) {
        let best: { host: OpeningHost; d: number } | null = null;
        for (const pc of pieces) {
          if (pc.open) continue;
          const d = project(p, pc.a, pc.b).d;
          if (d > Math.max(drawThickness(pc, exteriorIn) / 2 + 2, 7 / s) || (best && d >= best.d)) continue;
          // A curved wall is one wall: measure it end to end, not by its short pieces.
          best = { host: savedHost(fp, pc.host), d };
        }
        const hit = best;
        setHoverWall((h) => (hit ? (h && sameHost(h, hit.host) ? h : hit.host) : null));
      }
      if (tool === "curve" && draft.length === 2) {
        setCursor(p);
        setBow(curveBow(plan, draft[0], draft[1], p, s, shift));
      } else if (drafting) setCursor(snapFrom(draft[draft.length - 1], p, pickTargets([]), tol, snap, shift, tool === "room" && draft.length >= 2 ? [draft[0]] : []).p);
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
      const moved = moveMany(base, g.ids, m.dx, m.dy);
      setPreview(moved);
      setDragGuides(movedGuides(moved, g.ids));
    } else if (g.type === "corner") {
      const from = g.base ?? base;
      const room = from.rooms.find((r) => r.id === g.roomId);
      if (!room) return;
      const n = room.polygon.length;
      const here = room.polygon[g.i];
      const glue = !e.evt.altKey;
      // Corners of other rooms sitting right here are glued to this one, so they aren't snap targets.
      const others = { ...mergeTargets(snapTargets(from, [g.roomId]), supportSnap) };
      others.points = [...others.points.filter((q) => !glue || dist(q, here) > 1), ...room.polygon.filter((_, k) => k !== g.i)];
      const sp = snapNode(p, [room.polygon[(g.i - 1 + n) % n], room.polygon[(g.i + 1) % n]], others, tol, snap, shift);
      g.moved = true;
      setGuides(sp.guides);
      setPreview(setCornerGlued(from, g.roomId, g.i, sp.p, glue));
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
      setPreview(moveEdge(base, g.roomId, g.edge, scaleV(n, d), !e.evt.altKey));
    } else if (g.type === "opening") {
      g.moved = true;
      const next = moveOpeningTo(base, g.id, p, Math.max(18, 14 / s));
      setPreview(next);
      const moved = next.openings.find((x) => x.id === g.id);
      const seg = moved && hostSegment(next, moved.host);
      if (moved && seg?.bulge) setDragGuides(curvedOpeningGuides(seg, moved));
      else {
        const og = openingGeometries(next).find((x) => x.opening.id === g.id);
        setDragGuides(og ? openingGuides(og) : []);
      }
    } else if (g.type === "bend") {
      const info = bendInfo(base, g.target);
      if (!info) return;
      const alone = g.alone || e.evt.altKey;
      const raw = bowFromPoint(info.a, info.b, p);
      const sn = snapBow(info.chord, raw, planRadii(base, [g.target]), s, shift);
      g.moved = true;
      const next = bendWall(base, g.target, sn.left, alone);
      setPreview(next);
      setBendTip(bendReadout(next, g.target, sn.snap));
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
    setDragGuides([]);
    setDragCorner(null);
    setBendTip(null);
    if (!g) return;
    const { preview: pv } = latest.current;
    if (g.type === "rect") {
      if (tool === "room" && roomShape === "round") {
        finishRoundRoom(g.start, g.moved && rectEnd ? Math.round(dist(rectEnd, g.start) * 2) : roundDiameter);
      } else if (g.moved && rectEnd) {
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
    if (g.type === "corner") {
      // A click on a "+" without pulling still adds the corner, in the middle.
      if (pv) onChange(pv);
      else if (g.born && g.base) onChange(g.base);
    } else if (pv && "moved" in g && g.moved) {
      // A room dropped onto another one trims the one that stayed put, so they share a wall.
      const fit = g.type === "move" ? trimOverlap(pv, g.ids) : null;
      if (fit && fit.trims.length) {
        onChange(fit.plan);
        const name = (id: string) => pv.rooms.find((r) => r.id === id)?.name ?? "a room";
        const first = fit.trims[0];
        onMessage(`Trimmed ${name(first.roomId)}${fit.trims.length > 1 ? ` and ${fit.trims.length - 1} more` : ""} to fit ${name(first.byId)}. Undo puts it back.`);
      } else onChange(pv);
    }
    setPreview(null);
  }

  /** Right-click: pick what's under the pointer, then ask the page for its menu. */
  function onContextMenu(e: Konva.KonvaEventObject<MouseEvent>) {
    e.evt.preventDefault();
    if (tool !== "select" || tape || lotMode || spaceDown || !props.onContext) return;
    const stage = e.target.getStage()!;
    const el = elementOf(e.target === stage ? null : e.target);
    if (el && el.mid === undefined && !el.bend) {
      if (el.corner !== undefined) setSelCorner({ roomId: el.id, i: el.corner });
      if (el.corner !== undefined || !isPicked(selection, el.id)) onSelect([el.corner !== undefined ? { kind: "room", id: el.id } : { kind: el.kind, id: el.id }]);
    }
    props.onContext({ x: e.evt.clientX, y: e.evt.clientY, el: el && el.mid === undefined && !el.bend ? el : null, at: world() });
  }

  function onDblClick(e: Konva.KonvaEventObject<MouseEvent>) {
    // Rooms and walls being clicked out finish on a second click on the same spot (see onMouseDown).
    if (tool !== "select") return;
    const stage = e.target.getStage()!;
    const el = elementOf(e.target === stage ? null : e.target);
    if (!el || el.bend) return;
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
      onChange(insertCorner(plan, roomId, edge, projectOnEdge(world(), a, b, leftBulge(room, edge)).point));
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
        furniture: plan.furniture.map((f) => (f.roomId === id ? { ...f, ...tf(f), rotation: Math.round(f.rotation + dRot) } : f)),
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
  const cursorStyle = panning ? "grab" : lotMode ? "move" : tape || tool !== "select" ? "crosshair" : "default";
  const hoverSeg = hoverWall ? hostSegment(shown, hoverWall) : null;
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
        setHoverWall(null);
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
          onMouseLeave={() => {
            setHoverWall(null);
            onMouseUp();
          }}
          onDblClick={onDblClick}
          onContextMenu={onContextMenu}
          onWheel={onWheel}
        >
          <Layer listening={false}>
            <Grid view={view} width={width} height={height} />
          </Layer>

          {land && <LandLayer land={land} scale={s} shift={lotDelta} />}

          {(sketch || below || above) && <ReferenceLayer sketch={sketch} below={below} support={support?.regions} above={above?.plan} s={s} />}

          <Layer ref={layerRef}>
            {shown.rooms.map((r) => (
              <Line
                key={r.id}
                id={r.id}
                name="room"
                points={flat(roomOutline(r))}
                closed
                fill={roomFill(r.type)}
                opacity={isPicked(selection, r.id) ? 0.85 : 0.55}
                onTransformEnd={onTransformEnd}
              />
            ))}

            {stairsComingUp.map((st) => (
              <StairsSymbol key={`down-${st.id}`} d={stairsDrawing(st, riseFor(st, below!.level))} cut={stairsCut(st, riseFor(st, below!.level))} scale={s} down />
            ))}
            {shown.stairs.map((st) => {
              const d = stairsDrawing(st, riseFor(st, level));
              const under = stairsComingUp.some((b) => polygonsOverlap(stairsDrawing(b, riseFor(b, below!.level)).footprint, d.footprint));
              return <StairsSymbol key={st.id} id={st.id} d={d} cut={stairsCut(st, riseFor(st, level))} hideAbove={under} selected={isPicked(selection, st.id)} scale={s} />;
            })}

            {shown.fixtures.map((f) => (
              <FixtureSymbol key={f.id} f={f} selected={isPicked(selection, f.id)} scale={s} onTransformEnd={onTransformEnd} />
            ))}

            <FurnitureOutlines furniture={shown.furniture ?? []} s={s} names={labelOn(labels, "fixtureNames")} />

            <PlanWalls exteriorIn={exteriorIn} solids={solids} selection={selection} s={s} toSaved={(h) => savedHost(fp, h)} />

            {geos.map((g) => (
              <OpeningSymbol key={g.opening.id} g={g} thickness={thicknessAt(g)} selected={isPicked(selection, g.opening.id)} scale={s} name="opening" />
            ))}

            <OutsideDims plan={shown} labels={labels} s={s} />
            <ThingLabels plan={shown} geos={geos} labels={labels} s={s} />
            <RoomLabels plan={shown} labels={labels} selectedEdge={selectedEdge} selectedRoomId={selRoom?.id} hoverWall={hoverSeg ? { a: hoverSeg.a, b: hoverSeg.b, bulge: hoverSeg.bulge } : null} s={s} />
            {dragGuides.length > 0 && <DistanceGuides guides={dragGuides} labels={labels} s={s} />}
            {tape && tapePts.length > 0 && <TapeLine a={tapePts[0]} b={tapePts[1] ?? tapeEnd} labels={labels} s={s} />}

            {/* "+" nodes in the middle of each edge, and corner dots, on the selected room. */}
            {selRoom && !dragCorner && <MidNodes room={selRoom} s={s} />}
            {tool === "select" && !dragCorner && !lotMode && <BendHandles targets={bendTargets} plan={shown} s={s} />}
            {bendTip && <BendTip at={bendTip.at} text={bendTip.text} s={s} />}
            {selRoom &&
              selRoom.polygon.map((p, i) => (
                <Circle
                  key={i}
                  id={edgeId(selRoom.id, i)}
                  name="corner"
                  x={p.x}
                  y={p.y}
                  radius={5.5 / s}
                  fill={selCorner?.roomId === selRoom.id && selCorner.i === i ? ACCENT : "#fff"}
                  stroke={ACCENT}
                  strokeWidth={2}
                  strokeScaleEnabled={false}
                  hitStrokeWidth={10}
                />
              ))}
            {dragCorner && preview && <NodeReadout plan={preview} roomId={dragCorner.roomId} i={dragCorner.i} s={s} />}

            <DraftPreview rectStart={rectPreview} rectEnd={rectEnd} draft={draft} cursor={cursor} tool={tool} typed={typed} bow={bow} s={s} round={tool === "room" && roomShape === "round"} />

            {ghostOpening && <OpeningSymbol g={ghostOpening.g} thickness={ghostOpening.thickness} selected scale={s} ghost />}
            {ghostFixture && <FixtureSymbol f={ghostFixture} selected={false} scale={s} ghost />}
            {ghostStairs && (
              <Group opacity={0.5} listening={false}>
                <StairsSymbol d={stairsDrawing(ghostStairs, 121)} scale={s} />
              </Group>
            )}

            <GuidesAndBox guides={guides} box={box} />

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
          {overhangs.length > 0 && <OverhangLayer overhangs={overhangs} s={s} />}
          {aboveOver.length > 0 && <OverhangLayer overhangs={aboveOver} s={s} past="this floor's wall (upstairs)" />}
        </Stage>
      )}

      <SideLabels sides={sides} />
      {(below || sketch || above) && (
        <p className="pointer-events-none absolute top-2 left-3 rounded bg-white/80 px-2 py-0.5 text-xs text-muted">
          {[sketch ? "Faint bubbles: your flow sketch" : null, below ? `Dashed: ${below.name}` : null, support ? `Solid: its outside walls` : null, above ? `Dotted: ${above.name}` : null].filter(Boolean).join(" · ")}
        </p>
      )}
      <ScaleBar scale={s} />
      <ZoomButtons percent={Math.round((s / 0.6) * 100)} onZoom={zoomBy} onFit={fit} />
    </div>
  );
}
