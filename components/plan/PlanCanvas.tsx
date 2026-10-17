"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Circle, Group, Layer, Line, Stage, Text, Transformer } from "react-konva";
import Konva from "konva";
import type { BubbleDiagram, FloorPlan, Level, OpeningHost, PlanBasics, PlanLabels, PlanStairs, Point, WallHeight } from "@/lib/model/schema";
import { exteriorWallIn, riseBetween } from "@/lib/plan/basics";
import { catalogEntry } from "@/lib/furnish/catalog";
import { stageItems, type Layouts } from "@/lib/furnish/stage";
import { FurnishClearance, FurnishGhost, FurnishItems, SnapMarks } from "@/components/furnish/FurnishLayers";
import { clearanceNote, clearanceZones } from "@/lib/furnish/clearance";
import type { SnapLine } from "@/lib/furnish/snapping";
import type { ClosetSize } from "@/lib/furnish/closets";
import { type BendSnap, type BendTarget } from "@/lib/plan/bend";
import { DRAW_STEP_DEG, flatPlan, roomOutline, savedHost } from "@/lib/plan/flatten";
import { isRun, runOf } from "@/lib/plan/curveRun";
import { emptyPlan, type Plans } from "@/lib/plan/edit";
import { railingsOn, type Railing, type RailingSlot } from "@/lib/plan/railings";
import { faucetsOn, type Faucet } from "@/lib/furnish/faucets";
import { boundsOf, polygonsOverlap, project } from "@/lib/plan/geometry";
import { labelOn, type Guide } from "@/lib/plan/labels";
import { type Guides } from "@/lib/plan/snap";
import { overhangsOf, supportTargets } from "@/lib/plan/support";
import { roofFootprint, type Region } from "@/lib/house3d/footprint";
import { DEFAULT_STAIRS_WIDTH_IN, stairsCut, stairsDrawing } from "@/lib/plan/stairs";
import { drawThickness, hostSegment, openingGeometries, solidWalls, wallPieces, type OpeningGeometry } from "@/lib/plan/walls";
import LandLayer from "@/components/bubbles/LandLayer";
import type { LandView, Side } from "@/components/bubbles/types";
import { Grid, ScaleBar, SideLabels, useSpacePan, type View } from "@/components/canvas/CanvasBits";
import { ACCENT, OpeningSymbol, StairsSymbol } from "./PlanShapes";
import { flat, ghostOpeningAt, roomFill, type Box } from "./canvasHelpers";
import { BendHandles, BendTip, RunHandle, DraftPreview, GuidesAndBox, MidNodes, NodeReadout, OverhangLayer, PlanWalls, RailingLines, FaucetSymbols, ReferenceLayer, ZoomButtons } from "./PlanCanvasLayers";
import { addPin, PIN_HIT_PX, pinAt, removePin } from "@/lib/plan/pins";
import { newId } from "@/lib/model/project";
import { DistanceGuides, OutsideDims, PinnedTape, RoomLabels, TapeLine, ThingLabels } from "./PlanMeasureLayers";
import { keyIsForPage } from "@/lib/keys";
import { clampScale, useGestures, type Gesture } from "./useGestures";
import { edgeId, isPicked, parseEdgeId, runTargets, type PlanItem, type PlanSelection, type PlanTool } from "./types";

/**
 * The floor plan drawing for one level, at real scale: 1 unit is 1 inch.
 * While something is being dragged, the drawing shows a preview; letting go
 * sends the whole new plan up so the project store can save it and undo it.
 */

const SNAP_PX = 9;

export type PlanCanvasProps = {
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
  /** What the Doors and windows tool places. */
  placeOpening: string;
  /** The floor plan editor, or the Furnish page: rooms are locked there, and furnish items are drawn full and can be moved. */
  mode?: "plan" | "furnish";
  /** The floor plan shows furnish items faded (the Show furnishings switch). */
  showFurnishings?: boolean;
  /** The Furnish page: the app's own cabinets and devices, the catalog entry being placed, how far it is turned, the wall the Wall tool draws, and the ceiling. */
  furnish?: { faucets?: Faucet[]; railings?: Railing[]; bareRailings?: RailingSlot[]; layouts?: Layouts; pick: string | null; turn: number; wallHeight: WallHeight; ceilingIn: number; closetSize?: ClosetSize; here?: { p: Point; dir: Point } };
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

export default function PlanCanvas(props: PlanCanvasProps) {
  const { plan, level, levels, basics, below, support, above, sketch, tool, placeOpening, selection, snap, labels, tape, sides, height, land, lotMode, onLotMove } = props;
  const { onSelect, onChange, onToolDone, onDrafting, onMessage, fillMode = false, roomShape = "box", roundDiameter = 144, mode = "plan", showFurnishings = true, furnish } = props;
  const furnishing = mode === "furnish";
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
  /** Pressed on anchored stairs: what to say if it's dragged. */
  const heldNote = useRef<{ note: string; start: Point } | null>(null);
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
  const [pinMenu, setPinMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [dragCorner, setDragCorner] = useState<{ roomId: string; i: number } | null>(null);
  const [badId, setBadId] = useState<string | null>(null);
  const [furnSnap, setFurnSnap] = useState<{ id: string; lines: SnapLine[] } | null>(null);
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
    setTapePts([]);
    setTapeEnd(null);
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
      if (e.key !== "Escape" || !keyIsForPage(e, { here: wrapRef.current })) return;
      e.preventDefault();
      e.stopPropagation();
      setTapePts([]);
      setTapeEnd(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [tape, tapePts.length]);

  /** Pin the finished tape line: it stays after the tape is turned off. */
  function pinTape() {
    if (tapePts.length !== 2) return;
    onChange(addPin(plan, { id: newId(), a: tapePts[0], b: tapePts[1] }));
    setTapePts([]);
    setTapeEnd(null);
    props.onMessage("Pinned. Click it to delete.");
  }
  const pinRef = useRef(pinTape);
  pinRef.current = pinTape;
  useEffect(() => {
    if (!tape || tapePts.length !== 2) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== "p" && e.key !== "P") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!keyIsForPage(e, { here: wrapRef.current })) return;
      e.preventDefault();
      e.stopPropagation();
      pinRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [tape, tapePts.length]);

  const drafting = draft.length > 0;
  useEffect(() => onDrafting(drafting), [drafting, onDrafting]);

  // ---- Fit ----
  const propertyPoints = land?.show.property ? land.drawing.outline.map((p) => ({ x: p.x - land.offset.x, y: p.y - land.offset.y })) : [];
  const fitView = useCallback((withLot: boolean) => {
    if (!width) return;
    const pts: Point[] = [
      ...plan.rooms.flatMap((r) => r.polygon),
      ...plan.walls.flatMap((w) => [w.a, w.b]),
      ...(below?.plan.rooms.flatMap((r) => r.polygon) ?? []),
      ...(sketch?.bubbles.flatMap((b) => [
        { x: b.x - b.rx, y: b.y - b.ry },
        { x: b.x + b.rx, y: b.y + b.ry },
      ]) ?? []),
      ...(withLot ? propertyPoints : []),
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
  // Fit keeps to the house; Fit lot adds the lot line. The first fit on opening includes the lot when it's showing.
  const fit = useCallback(() => fitView(false), [fitView]);
  const fitLot = useCallback(() => fitView(true), [fitView]);
  const firstFit = useCallback(() => fitView(true), [fitView]);

  useEffect(() => {
    if (width && !fitted.current) {
      fitted.current = true;
      firstFit();
    }
  }, [width, firstFit]);

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
  const layouts = furnish?.layouts;
  const ceilingIn = furnish?.ceilingIn;
  const baseItems = useMemo(() => stageItems(plan, layouts, ceilingIn), [plan, layouts, ceilingIn]);
  const shownItems = useMemo(() => (preview ? stageItems(preview, layouts, ceilingIn) : baseItems), [preview, layouts, ceilingIn, baseItems]);
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
  // Railings on this floor's stairs and around stairwells coming up into it (worked out, faded; changed in Furnish).
  const railings = useMemo(() => {
    if (!shown.stairs.length && !stairsComingUp.length) return [];
    const byId = new Map(levels.map((l) => [l.id, l]));
    const plansHere: Plans = { [level.id]: fp, ...(below && stairsComingUp.length ? { [below.level.id]: { ...emptyPlan(), stairs: stairsComingUp } } : {}) };
    return railingsOn(plansHere, level.id, (st, from) => {
      const lv = byId.get(from);
      return lv ? riseFor(st, lv) : null;
    });
    // riseFor only reads levels and basics.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fp, shown.stairs.length, below, level.id, levels, basics]);

  // Faucets on the floor plan are faded symbols; the Furnish page passes its own (with the room picks).
  const faucetsHere = useMemo(() => (showFurnishings && !furnish?.faucets ? faucetsOn(fp, level.id, [], { exteriorIn }) : []), [fp, level.id, showFurnishings, furnish?.faucets, exteriorIn]);

  const single = selection.length === 1 ? selection[0] : null;
  const selRoom = single?.kind === "room" && tool === "select" ? shown.rooms.find((r) => r.id === single.id) : undefined;
  const selRoomId = selRoom?.id;
  // The room whose corner dots show: the picked room, and still that room while one of its walls is picked (so a second double-click can add a corner).
  const [reveal, setReveal] = useState<string | null>(null);
  useEffect(() => {
    setReveal((r) =>
      single?.kind === "room" && tool === "select" ? single.id : tool === "select" && ((single?.kind === "edge" && parseEdgeId(single.id).roomId === r) || (single?.kind === "wall" && single.id === r)) ? r : null,
    );
  }, [single, tool]);
  const nodeRoom = selRoom ?? (single?.kind === "edge" && reveal && parseEdgeId(single.id).roomId === reveal ? shown.rooms.find((r) => r.id === reveal) : undefined);
  // The diamonds: every side of a picked room, the picked side of a room, or a picked wall.
  const bendTargets: BendTarget[] = useMemo(() => {
    if (!single) return [];
    if (single.kind === "room" && selRoom) return selRoom.polygon.map((_, edge) => ({ roomId: selRoom.id, edge }));
    if (single.kind === "edge") return [{ roomId: parseEdgeId(single.id).roomId, edge: parseEdgeId(single.id).edge }];
    if (single.kind === "wall") return [{ wallId: single.id }];
    return [];
  }, [single, selRoom]);
  // Two or more picked walls that meet end to end: one diamond bends them together.
  const pickedRun = useMemo(() => {
    const targets = !furnishing && tool === "select" ? runTargets(selection) : null;
    const r = targets ? runOf(shown, targets) : null;
    return r && isRun(r) ? r : null;
  }, [furnishing, tool, selection, shown]);
  useEffect(() => {
    setSelCorner((c) => (c && c.roomId === selRoomId ? c : null));
  }, [selRoomId]);
  const transformTarget = !lotMode && !preview && selRoom ? selRoom.id : undefined;

  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const node = transformTarget ? layerRef.current?.findOne(`#${CSS.escape(transformTarget)}`) : undefined;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [transformTarget, shown]);

  const { ghostFor, onMouseDown, onMouseMove, onMouseUp, onContextMenu, onDblClick, onWheel, zoomBy, onStageDrag, onTransformEnd } = useGestures({
    plan, level, levels, basics, tool, placeOpening, selection, snap, tape, land, lotMode, furnish, onLotMove, onSelect, onChange, onToolDone, onMessage, onContext: props.onContext,
    fillMode, roomShape, roundDiameter, furnishing, view, setView, s, tol, width, height, spaceDown,
    wrapRef, layerRef, gesture, heldNote, latest, altDown, supportSnap, fp, pieces, exteriorIn, baseItems, drafting,
    preview: [preview, setPreview], guides: [guides, setGuides], lotDelta: [lotDelta, setLotDelta], box: [box, setBox], draft: [draft, setDraft],
    cursor: [cursor, setCursor], rectEnd: [rectEnd, setRectEnd], typed: [typed, setTyped], bow: [bow, setBow], selCorner: [selCorner, setSelCorner],
    hoverWall: [hoverWall, setHoverWall], bendTip: [bendTip, setBendTip], dragGuides: [dragGuides, setDragGuides], tapePts: [tapePts, setTapePts],
    tapeEnd: [tapeEnd, setTapeEnd], pinMenu: [pinMenu, setPinMenu], dragCorner: [dragCorner, setDragCorner], badId: [badId, setBadId], furnSnap: [furnSnap, setFurnSnap], reveal: [reveal, setReveal],
  });

  // ---- Drawing ----
  const panning = tool === "pan" || spaceDown;
  const overPin = !!cursor && (tape || tool === "select") && !!pinAt(plan, cursor, PIN_HIT_PX / s);
  const cursorStyle = panning ? "grab" : lotMode ? "move" : overPin ? "pointer" : tape || tool !== "select" ? "crosshair" : "default";
  const hoverSeg = hoverWall ? hostSegment(shown, hoverWall) : null;
  const selectedEdge = single?.kind === "edge" ? parseEdgeId(single.id) : null;
  const ghostOpening = tool === "door" && cursor ? ghostOpeningAt(plan, cursor, placeOpening, s) : null;
  const ghost = tool === "place" && cursor ? ghostFor(cursor) : null;
  const ghostEntry = ghost ? catalogEntry(ghost.entryId) : undefined;
  // Room to move: shaded around what's being placed, dragged or picked on the Furnish page.
  const focusItem = !furnishing
    ? undefined
    : ghost && ghostEntry && !ghost.closet
      ? { ...ghost, id: "ghost", mount: ghostEntry.mount }
      : shownItems.find((it) => it.id === (furnSnap?.id ?? (single?.kind === "furnish" ? single.id : undefined)));
  const clearance = focusItem ? clearanceZones(preview ?? plan, focusItem, shownItems) : [];
  const snapLines = ghost?.snaps ?? furnSnap?.lines ?? [];
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

          {(sketch || below || above) && <ReferenceLayer sketch={sketch} below={below} support={support?.regions} above={labels.aboveOutlines ? above?.plan : null} s={s} />}

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
              <StairsSymbol key={`down-${st.id}`} d={stairsDrawing(st, riseFor(st, below!.level))} cut={stairsCut(st, riseFor(st, below!.level))} scale={s} down anchored={st.anchored} />
            ))}
            {shown.stairs.map((st) => {
              const d = stairsDrawing(st, riseFor(st, level));
              const under = stairsComingUp.some((b) => polygonsOverlap(stairsDrawing(b, riseFor(b, below!.level)).footprint, d.footprint));
              return <StairsSymbol key={st.id} id={st.id} d={d} cut={stairsCut(st, riseFor(st, level))} hideAbove={under} selected={isPicked(selection, st.id)} scale={s} anchored={st.anchored} />;
            })}

            <RailingLines
              railings={furnishing && furnish?.railings ? furnish.railings : railings}
              bare={furnishing ? furnish?.bareRailings : undefined}
              selectedKey={single?.kind === "railing" ? single.id : undefined}
              pickable={furnishing && tool === "select"}
              s={s}
            />

            {clearance.length > 0 && <FurnishClearance zones={clearance} />}
            {(furnishing || showFurnishings) && <FurnishItems items={shownItems} selectedId={single?.kind === "furnish" ? single.id : undefined} badId={badId ?? undefined} s={s} faded={!furnishing} names={labelOn(labels, "fixtureNames")} />}
            {(furnishing || showFurnishings) && (
              <FaucetSymbols faucets={furnishing && furnish?.faucets ? furnish.faucets : faucetsHere} selectedId={single?.kind === "faucet" ? single.id : undefined} pickable={furnishing && tool === "select"} s={s} />
            )}

            <PlanWalls exteriorIn={exteriorIn} solids={solids} selection={selection} s={s} toSaved={(h) => savedHost(fp, h)} />

            {geos.map((g) => (
              <OpeningSymbol key={g.opening.id} g={g} thickness={thicknessAt(g)} selected={isPicked(selection, g.opening.id)} scale={s} name="opening" />
            ))}

            <OutsideDims plan={shown} labels={labels} s={s} />
            <ThingLabels plan={shown} geos={geos} labels={labels} s={s} />
            <RoomLabels plan={shown} labels={labels} selectedEdge={selectedEdge} selectedRoomId={selRoom?.id} hoverWall={hoverSeg ? { a: hoverSeg.a, b: hoverSeg.b, bulge: hoverSeg.bulge } : null} s={s} />
            {!!shown.pins?.length && <PinnedTape pins={shown.pins} labels={labels} s={s} />}
            {dragGuides.length > 0 && <DistanceGuides guides={dragGuides} labels={labels} s={s} />}
            {tape && tapePts.length > 0 && <TapeLine a={tapePts[0]} b={tapePts[1] ?? tapeEnd} labels={labels} s={s} />}

            {/* "+" nodes in the middle of each edge, and corner dots, on the selected room. */}
            {nodeRoom && !dragCorner && <MidNodes room={nodeRoom} s={s} />}
            {furnish?.here && (
              <Group x={furnish.here.p.x} y={furnish.here.p.y} listening={false} name="you-are-here">
                <Line points={[0, 0, (furnish.here.dir.x * 26) / s, (furnish.here.dir.y * 26) / s]} stroke="#2f7fd1" strokeWidth={4} strokeScaleEnabled={false} lineCap="round" />
                <Circle radius={8 / s} fill="#2f7fd1" stroke="#fff" strokeWidth={2} strokeScaleEnabled={false} />
                <Text text="You are here" x={12 / s} y={-20 / s} fontSize={13 / s} fontStyle="bold" fill="#1d5fa3" />
              </Group>
            )}
            {tool === "select" && !dragCorner && !lotMode && <BendHandles targets={bendTargets} plan={shown} s={s} />}
            {pickedRun && !dragCorner && !lotMode && <RunHandle run={pickedRun} plan={shown} s={s} />}
            {bendTip && <BendTip at={bendTip.at} text={bendTip.text} s={s} />}
            {nodeRoom &&
              nodeRoom.polygon.map((p, i) => (
                <Circle
                  key={i}
                  id={edgeId(nodeRoom.id, i)}
                  name="corner"
                  x={p.x}
                  y={p.y}
                  radius={5.5 / s}
                  fill={selCorner?.roomId === nodeRoom.id && selCorner.i === i ? ACCENT : "#fff"}
                  stroke={ACCENT}
                  strokeWidth={2}
                  strokeScaleEnabled={false}
                  hitStrokeWidth={10}
                />
              ))}
            {dragCorner && preview && <NodeReadout plan={preview} roomId={dragCorner.roomId} i={dragCorner.i} s={s} />}

            <DraftPreview rectStart={rectPreview} rectEnd={rectEnd} draft={draft} cursor={cursor} tool={tool} typed={typed} bow={bow} s={s} round={tool === "room" && roomShape === "round"} />

            {ghostOpening && <OpeningSymbol g={ghostOpening.g} thickness={ghostOpening.thickness} selected scale={s} ghost />}
            {ghost && ghostEntry && <FurnishGhost ghost={ghost} label={ghostEntry.label} mount={ghostEntry.mount} s={s} />}
            {snapLines.length > 0 && <SnapMarks lines={snapLines} s={s} />}
            {focusItem && clearanceNote(clearance) && (!ghost || ghost.check.ok) && (
              <Text x={focusItem.x - 120 / s} y={focusItem.y + (Math.max(focusItem.depthIn, focusItem.widthIn) / 2 + 10 / s)} width={240 / s} align="center" text={clearanceNote(clearance)!} fontSize={11 / s} fill={clearance.some((z) => z.blocked) ? "#b3261e" : "#2f6f5a"} listening={false} name="clearance-note" />
            )}
            {ghost && !ghost.check.ok && ghost.check.problem && (
              <Text x={ghost.x - 90 / s} y={ghost.y + (Math.max(ghost.depthIn, ghost.widthIn) / 2 + 10 / s)} width={180 / s} align="center" text={ghost.check.problem} fontSize={11 / s} fill="#b3261e" listening={false} />
            )}
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
              enabledAnchors={[]}
              anchorSize={9}
              borderStroke={ACCENT}
              anchorStroke={ACCENT}
              borderDash={[4, 3]}
              ignoreStroke
              keepRatio={false}
            />
          </Layer>
          {overhangs.length > 0 && <OverhangLayer overhangs={overhangs} s={s} shading={labels.overhangShading} text={labelOn(labels, "overhangText")} color={labels.overhangColor} strength={labels.overhangStrength} textSize={labels.textSize} />}
          {aboveOver.length > 0 && <OverhangLayer overhangs={aboveOver} s={s} past="this floor's wall (upstairs)" shading={labels.aboveShading} text={labelOn(labels, "aboveText")} color={labels.overhangColor} strength={labels.overhangStrength} textSize={labels.textSize} />}
        </Stage>
      )}

      <SideLabels sides={sides} />
      {tape && tapePts.length === 2 && (
        <button
          className="absolute z-10 -translate-x-1/2 rounded border border-[var(--color-accent)] bg-white px-2 py-0.5 text-xs font-medium text-[var(--color-accent)] shadow hover:bg-stone-50"
          style={{ left: ((tapePts[0].x + tapePts[1].x) / 2) * s + view.x, top: ((tapePts[0].y + tapePts[1].y) / 2) * s + view.y + 24 }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={pinTape}
          title="Keep this measurement after the tape is off (key P)"
          data-testid="pin-tape"
        >
          Pin (P)
        </button>
      )}
      {pinMenu && (
        <div className="fixed z-50 rounded border border-line bg-white py-1 text-sm shadow-lg" style={{ left: pinMenu.x, top: pinMenu.y }} onMouseDown={(e) => e.stopPropagation()} data-testid="pin-menu">
          <button
            className="block w-full px-4 py-1 text-left text-red-700 hover:bg-stone-50"
            onClick={() => {
              onChange(removePin(plan, pinMenu.id));
              setPinMenu(null);
            }}
          >
            Delete
          </button>
        </div>
      )}
      {(below || sketch || (above && labels.aboveOutlines)) && (
        <p className="pointer-events-none absolute top-2 left-3 rounded bg-white/80 px-2 py-0.5 text-xs text-muted">
          {[sketch ? "Faint bubbles: your flow sketch" : null, below ? `Dashed: ${below.name}` : null, support ? `Solid: its outside walls` : null, above && labels.aboveOutlines ? `Dotted: ${above.name}` : null].filter(Boolean).join(" · ")}
        </p>
      )}
      <ScaleBar scale={s} />
      <ZoomButtons percent={Math.round((s / 0.6) * 100)} onZoom={zoomBy} onFit={fit} onFitLot={land?.show.property ? fitLot : undefined} />
    </div>
  );
}
