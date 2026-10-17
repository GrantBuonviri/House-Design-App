import { useEffect, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from "react";
import Konva from "konva";
import type { PlanCanvasProps } from "./PlanCanvas";
import type { LayerItem } from "@/lib/furnish/layer";
import type { FloorPlan, Opening, OpeningHost, PlanStairs, Point } from "@/lib/model/schema";
import { openingHeight, openingType } from "@/lib/plan/catalog";
import { dragItem, ghostAt, placeGhost, wallGaps } from "@/lib/furnish/stage";
import { trimOverlap } from "@/lib/plan/overlaps";
import { bendInfo, bendWall, bowFromPoint, planRadii, snapBow, type BendSnap, type BendTarget } from "@/lib/plan/bend";
import { savedHost } from "@/lib/plan/flatten";
import { arcBetween, leftBulge, pointOnEdge, projectOnEdge, roomEdgeLength } from "@/lib/plan/arcs";
import { makeRoundRoom } from "@/lib/plan/shapes";
import { splitWall } from "@/lib/plan/wallEdits";
import { curveRun, isRun, runInfo, runOf, sharesOf, startBow, type Run } from "@/lib/plan/curveRun";
import { lockedNote, unlocked } from "@/lib/plan/locks";
import { addRoom, insertGluedCorner, makeRoom, moveEdge, moveMany, moveOpeningTo, newPlanId, removeCorner, rotateMany, setCornerGlued } from "@/lib/plan/edit";
import { add, boundsOf, dist, polygonArea, project, rectangle, round1, roundPoint, scale as scaleV, sub, unit } from "@/lib/plan/geometry";
import { curvedOpeningGuides, distanceGuides, formatLength, openingGuides, wallSegments, type Guide } from "@/lib/plan/labels";
import { snapFrom, snapMove, snapNode, snapPush, snapTargets, type Guides, type SnapTargets } from "@/lib/plan/snap";
import { mergeTargets } from "@/lib/plan/support";
import { parseTypedLength } from "@/lib/model/units";
import { DEFAULT_STAIRS_WIDTH_IN } from "@/lib/plan/stairs";
import { drawThickness, clampOffset, hostSegment, nearestHost, sameHost, openingGeometries, type WallPiece } from "@/lib/plan/walls";
import { fillRoomAt, splitRoom, whyNotFill } from "@/lib/plan/partitions";
import { bowForTyped, curveBow, drawCurve } from "@/lib/plan/curveTool";
import type { View } from "@/components/canvas/CanvasBits";
import { dedupe, type Box } from "./canvasHelpers";
import { RUN_HANDLE_ID } from "./PlanCanvasLayers";
import { PIN_HIT_PX, pinAt } from "@/lib/plan/pins";
import { keyIsForPage } from "@/lib/keys";
import { isPicked, parseEdgeId, runTargets, type PlanItem, type PlanSelection } from "./types";

/**
 * The floor plan canvas's mouse gestures: pressing, dragging and letting go on the drawing,
 * double-click, right-click, the wheel and the turn handles, plus the keys for a line being
 * clicked out. PlanCanvas keeps the state; this works out what each gesture does to it.
 */

export type Gesture =
  | { type: "move"; start: Point; ids: string[]; moved: boolean }
  | { type: "corner"; roomId: string; i: number; start: Point; grab: Point; base?: FloorPlan; born?: boolean; moved: boolean }
  | { type: "edge"; roomId: string; edge: number; start: Point; moved: boolean }
  | { type: "bend"; target: BendTarget; alone: boolean; moved: boolean }
  | { type: "run"; run: Run; shares: number[]; alone: boolean; moved: boolean }
  | { type: "opening"; id: string; start: Point; grab: number; moved: boolean }
  | { type: "box"; start: Point; additive: boolean; base: PlanSelection }
  | { type: "lot"; start: Point }
  | { type: "rect"; start: Point; moved: boolean }
  | { type: "furn"; id: string; grab: Point; moved: boolean; ok: boolean; problem?: string; newId: string };

/** What to say beside the diamond while a wall is bent: radius and length, or that it snapped flat or to a half circle. */
/** What to say beside the diamond while a wall is bent: radius and length, or that it snapped flat or to a half circle. */
function bendReadout(plan: FloorPlan, target: BendTarget, snap: BendSnap): { at: Point; text: string } | null {
  const info = bendInfo(plan, target);
  if (!info) return null;
  const at = scaleV(add(info.a, info.b), 0.5);
  if (!info.radius) return { at, text: `Straight · ${formatLength(info.chord)}` };
  const note = snap === "half" ? "half circle · " : snap === "radius" ? "matches a curve · " : "";
  return { at, text: `${note}R ${formatLength(info.radius)} · arc ${formatLength(info.length)}` };
}

/** The same for several walls bent together: the one circle they're on. */
function runReadout(run: Run, left: number, snap: BendSnap): { at: Point; text: string } {
  const at = scaleV(add(run.a, run.b), 0.5);
  const arc = arcBetween(run.a, run.b, left);
  if (!arc) return { at, text: `Straight · ${formatLength(dist(run.a, run.b))}` };
  const note = snap === "half" ? "half circle · " : snap === "radius" ? "matches a curve · " : "";
  return { at, text: `${note}${run.pieces.length} walls · R ${formatLength(arc.radius)} · arc ${formatLength(arc.length)}` };
}

export const MIN_SCALE = 0.04;
export const MAX_SCALE = 5;
const MIN_ROOM_SIDE_IN = 24;
export const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

type State<T> = [T, Dispatch<SetStateAction<T>>];

/** Everything the gestures read and change: the canvas's props, view, refs and drawing state. */
export type GestureContext = Pick<
  PlanCanvasProps,
  "plan" | "level" | "levels" | "basics" | "tool" | "placeOpening" | "selection" | "snap" | "tape" | "land" | "lotMode" | "furnish" | "onLotMove" | "onSelect" | "onChange" | "onToolDone" | "onMessage" | "onContext"
> & {
  fillMode: boolean;
  roomShape: "box" | "round";
  roundDiameter: number;
  furnishing: boolean;
  /** The view: zoom (`s`), snap distance in inches (`tol`), and the canvas size in pixels. */
  view: View;
  setView: Dispatch<SetStateAction<View>>;
  s: number;
  tol: number;
  width: number;
  height: number;
  spaceDown: boolean;
  wrapRef: RefObject<HTMLDivElement | null>;
  layerRef: RefObject<Konva.Layer | null>;
  gesture: MutableRefObject<Gesture | null>;
  heldNote: MutableRefObject<{ note: string; start: Point } | null>;
  latest: MutableRefObject<{ plan: FloorPlan; preview: FloorPlan | null; selection: PlanSelection }>;
  altDown: MutableRefObject<boolean>;
  supportSnap: SnapTargets | null;
  fp: FloorPlan;
  pieces: WallPiece[];
  exteriorIn: number;
  baseItems: LayerItem[];
  drafting: boolean;
  preview: State<FloorPlan | null>;
  guides: State<Guides>;
  lotDelta: State<{ dx: number; dy: number } | null>;
  box: State<Box | null>;
  draft: State<Point[]>;
  cursor: State<Point | null>;
  rectEnd: State<Point | null>;
  typed: State<string>;
  bow: State<{ left: number; snap: BendSnap } | null>;
  selCorner: State<{ roomId: string; i: number } | null>;
  hoverWall: State<OpeningHost | null>;
  bendTip: State<{ at: Point; text: string } | null>;
  dragGuides: State<Guide[]>;
  tapePts: State<Point[]>;
  tapeEnd: State<Point | null>;
  pinMenu: State<{ id: string; x: number; y: number } | null>;
  dragCorner: State<{ roomId: string; i: number } | null>;
  badId: State<string | null>;
  reveal: State<string | null>;
};

export function useGestures(c: GestureContext) {
  const { plan, level, levels, basics, tool, placeOpening, selection, snap, tape, land, lotMode, furnish, onLotMove, onSelect, onChange, onToolDone, onMessage, onContext } = c;
  const { fillMode, roomShape, roundDiameter, furnishing, view, setView, s, tol, width, height, spaceDown } = c;
  const { wrapRef, layerRef, gesture, heldNote, latest, altDown, supportSnap, fp, pieces, exteriorIn, baseItems, drafting } = c;
  const [, setPreview] = c.preview;
  const [, setGuides] = c.guides;
  const [lotDelta, setLotDelta] = c.lotDelta;
  const [box, setBox] = c.box;
  const [draft, setDraft] = c.draft;
  const [cursor, setCursor] = c.cursor;
  const [rectEnd, setRectEnd] = c.rectEnd;
  const [typed, setTyped] = c.typed;
  const [bow, setBow] = c.bow;
  const [selCorner, setSelCorner] = c.selCorner;
  const [, setHoverWall] = c.hoverWall;
  const [, setBendTip] = c.bendTip;
  const [, setDragGuides] = c.dragGuides;
  const [tapePts, setTapePts] = c.tapePts;
  const [, setTapeEnd] = c.tapeEnd;
  const [, setPinMenu] = c.pinMenu;
  const [, setDragCorner] = c.dragCorner;
  const [, setBadId] = c.badId;
  const [reveal, setReveal] = c.reveal;
  const world = () => layerRef.current?.getRelativePointerPosition() ?? { x: 0, y: 0 };

  /** The plan element under a Konva node. */
  function elementOf(node: Konva.Node | null): (PlanItem & { corner?: number; mid?: number; bend?: string }) | null {
    if (!node) return null;
    const mid = furnishing ? null : node.findAncestor(".mid", true);
    if (mid) {
      const { roomId, edge } = parseEdgeId(mid.id());
      return { kind: "room", id: roomId, mid: edge };
    }
    const bend = furnishing ? null : node.findAncestor(".bend", true);
    if (bend) return bend.id().includes("#") ? { kind: "room", id: bend.id().split("#")[0], bend: bend.id() } : { kind: "wall", id: bend.id(), bend: bend.id() };
    const corner = furnishing ? null : node.findAncestor(".corner", true);
    if (corner) {
      const { roomId, edge } = parseEdgeId(corner.id());
      return { kind: "room", id: roomId, corner: edge };
    }
    const furn = node.findAncestor(".furnish", true);
    if (furn) return { kind: "furnish", id: furn.id() };
    const rail = furnishing ? node.findAncestor(".railing", true) : null;
    if (rail) return { kind: "railing", id: rail.id() };
    const faucet = furnishing ? node.findAncestor(".faucet", true) : null;
    if (faucet) return { kind: "faucet", id: faucet.id() };
    // On the Furnish page the rooms and walls are locked: only furnishings, doors and windows answer to the mouse.
    if (furnishing) {
      const op = node.findAncestor(".opening", true);
      return op ? { kind: "opening", id: op.id() } : null;
    }
    for (const kind of ["opening", "stairs", "edge", "wall", "room"] as const) {
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
      heightIn: openingHeight(t.id, basics?.doorHeightIn),
      ...(t.sillIn !== undefined ? { sillIn: t.sillIn } : {}),
      side: near.side,
      hinge: "start",
    };
    onChange({ ...plan, openings: [...plan.openings, o] });
    onSelect([{ kind: "opening", id: o.id }]);
    onToolDone();
  }

  /** Where the catalog item being placed would land with the mouse at `p`, and whether it fits. */
  function ghostFor(p: Point) {
    return furnish?.pick ? ghostAt(plan, furnish.pick, p, furnish.turn, baseItems, furnish.ceilingIn, furnish.closetSize) : null;
  }

  function placeFurnishAt(p: Point) {
    const g = ghostFor(p);
    if (!g) return;
    if (!g.check.ok) return onMessage(g.check.problem ?? "It doesn't fit there.");
    const out = placeGhost(plan, g, furnish?.ceilingIn);
    if (!out.id) return;
    onChange(out.plan);
    onSelect([{ kind: "furnish", id: out.id }]);
    if (g.check.blocksDoors.length) onMessage("That's in front of a door. It's allowed, and shows in Things to check.");
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
    const height = furnishing && furnish && furnish.wallHeight !== "full" ? { height: furnish.wallHeight } : {};
    const walls = pts.slice(1).map((b, i) => ({ id: newPlanId("w"), a: roundPoint(pts[i]), b: roundPoint(b), thicknessIn: 4.5, ...height }));
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
      if (!keyIsForPage(e, { here: wrapRef.current })) return;
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
      if (!keyIsForPage(e, { here: wrapRef.current })) return;
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
    setPinMenu(null);
    if (tape || tool === "select") {
      const hit = pinAt(plan, p, PIN_HIT_PX / s);
      if (hit) {
        setPinMenu({ id: hit.id, x: e.evt.clientX, y: e.evt.clientY });
        return;
      }
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
    if (tool === "place") return placeFurnishAt(p);
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
    if (el.bend === RUN_HANDLE_ID) {
      // The run's diamond: bend every picked wall as one curve. Corners keep their share of the length.
      const targets = runTargets(selection);
      const r = targets ? runOf(plan, targets) : null;
      if (!r || !isRun(r)) return;
      const shares = runInfo(plan, r).together ? sharesOf(plan, r) : startBow(plan, r).shares;
      gesture.current = { type: "run", run: r, shares, alone: e.evt.altKey, moved: false };
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
      const at = born.plan.rooms.find((r) => r.id === el.id)?.polygon[born.index] ?? p;
      gesture.current = { type: "corner", roomId: el.id, i: born.index, start: p, grab: sub(at, p), base: born.plan, born: true, moved: false };
      setSelCorner({ roomId: el.id, i: born.index });
      setDragCorner({ roomId: el.id, i: born.index });
      return;
    }
    if (el.corner !== undefined) {
      const at = plan.rooms.find((r) => r.id === el.id)?.polygon[el.corner] ?? p;
      gesture.current = { type: "corner", roomId: el.id, i: el.corner, start: p, grab: sub(at, p), moved: false };
      setSelCorner({ roomId: el.id, i: el.corner });
      setDragCorner({ roomId: el.id, i: el.corner });
      return;
    }
    if (el.kind === "railing" || el.kind === "faucet") {
      onSelect([el]);
      return;
    }
    if (el.kind === "furnish") {
      onSelect([el]);
      const item = baseItems.find((x) => x.id === el.id);
      if (item) gesture.current = { type: "furn", id: el.id, grab: sub(p, item), moved: false, ok: true, newId: el.id };
      return;
    }
    if (shift) {
      onSelect(isPicked(selection, el.id) ? selection.filter((x) => x.id !== el.id) : [...selection, el]);
      return;
    }
    const next = isPicked(selection, el.id) ? selection : [el];
    if (next !== selection) onSelect(next);
    if (el.kind === "opening") {
      // Where along its wall the door or window was grabbed, so it doesn't jump to center under the pointer.
      const o = plan.openings.find((x) => x.id === el.id);
      const seg = o && hostSegment(plan, o.host);
      const grab = o && seg ? projectOnEdge(p, seg.a, seg.b, seg.bulge).t - o.offsetIn : 0;
      gesture.current = { type: "opening", id: el.id, start: p, grab, moved: false };
    } else if (el.kind === "edge") {
      const { roomId, edge } = parseEdgeId(el.id);
      gesture.current = { type: "edge", roomId, edge, start: p, moved: false };
    } else {
      const all = next.filter((x) => x.kind !== "edge" && x.kind !== "opening").map((x) => x.id);
      // Anchored stairs stay put; anything else picked with them still moves.
      const ids = unlocked(plan, all);
      const note = ids.length < all.length ? lockedNote(plan, all) : null;
      heldNote.current = note ? { note, start: p } : null;
      if (ids.length) gesture.current = { type: "move", start: p, ids, moved: false };
    }
  }

  function onMouseMove(e: Konva.KonvaEventObject<MouseEvent>) {
    const p = world();
    const shift = e.evt.shiftKey;
    if (tool === "door" || tool === "place" || tool === "stairs" || drafting) setCursor(p);
    const g = gesture.current;
    if (heldNote.current && e.evt.buttons && dist(p, heldNote.current.start) * s > 3) {
      onMessage(heldNote.current.note);
      heldNote.current = null;
    }
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
      if (!g.moved && dist(p, g.start) * s < 3) return;
      const glue = !e.evt.altKey;
      // Corners of other rooms sitting right here are glued to this one, so they aren't snap targets.
      const others = { ...mergeTargets(snapTargets(from, [g.roomId]), supportSnap) };
      others.points = [...others.points.filter((q) => !glue || dist(q, here) > 1), ...room.polygon.filter((_, k) => k !== g.i)];
      const sp = snapNode(add(p, g.grab), [room.polygon[(g.i - 1 + n) % n], room.polygon[(g.i + 1) % n]], others, tol, snap, shift);
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
      if (!g.moved && dist(p, g.start) * s < 3) return;
      g.moved = true;
      const next = moveOpeningTo(base, g.id, p, Math.max(18, 14 / s), g.grab);
      setPreview(next);
      const moved = next.openings.find((x) => x.id === g.id);
      const seg = moved && hostSegment(next, moved.host);
      if (moved && seg?.bulge) setDragGuides(curvedOpeningGuides(seg, moved));
      else {
        const og = openingGeometries(next).find((x) => x.opening.id === g.id);
        setDragGuides(og ? openingGuides(og) : []);
      }
    } else if (g.type === "furn") {
      const item = baseItems.find((x) => x.id === g.id);
      if (!item) return;
      const to = sub(p, g.grab);
      if (!g.moved && Math.hypot(to.x - item.x, to.y - item.y) * s < 3) return;
      g.moved = true;
      const out = dragItem(base, item, to, baseItems);
      g.ok = out.check.ok;
      g.problem = out.check.problem;
      g.newId = out.id;
      setBadId(out.check.ok ? null : out.id);
      setPreview(out.plan);
      setDragGuides(wallGaps(out.plan, out.item).map((w) => w.guide));
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
    } else if (g.type === "run") {
      const raw = bowFromPoint(g.run.a, g.run.b, p);
      const sn = snapBow(dist(g.run.a, g.run.b), raw, planRadii(base, g.run.pieces.map((x) => x.target)), s, shift);
      const out = curveRun(base, g.run, sn.left, { alone: g.alone || e.evt.altKey, shares: g.shares });
      if ("why" in out) {
        setBendTip({ at: scaleV(add(g.run.a, g.run.b), 0.5), text: out.why });
        return;
      }
      g.moved = true;
      setPreview(out.plan);
      setBendTip(runReadout(g.run, sn.left, sn.snap));
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
    setBadId(null);
    if (!g) return;
    const { preview: pv } = latest.current;
    if (g.type === "furn") {
      // Dropped where it doesn't fit: it goes back, and the reason is said.
      if (pv && g.moved) {
        if (g.ok) {
          onChange(pv);
          onSelect([{ kind: "furnish", id: g.newId }]);
        } else onMessage(`${g.problem ?? "It doesn't fit there."} It went back.`);
      }
      setPreview(null);
      return;
    }
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
    if (tool !== "select" || tape || lotMode || spaceDown || !onContext) return;
    const stage = e.target.getStage()!;
    const el = elementOf(e.target === stage ? null : e.target);
    if (el && el.mid === undefined && !el.bend) {
      if (el.corner !== undefined) setSelCorner({ roomId: el.id, i: el.corner });
      if (el.corner !== undefined || !isPicked(selection, el.id)) onSelect([el.corner !== undefined ? { kind: "room", id: el.id } : { kind: el.kind, id: el.id }]);
    }
    onContext({ x: e.evt.clientX, y: e.evt.clientY, el: el && el.mid === undefined && !el.bend ? el : null, at: world() });
  }

  function onDblClick(e: Konva.KonvaEventObject<MouseEvent>) {
    // Rooms and walls being clicked out finish on a second click on the same spot (see onMouseDown).
    if (tool !== "select") return;
    const stage = e.target.getStage()!;
    const el = elementOf(e.target === stage ? null : e.target);
    if (!el || el.bend) return;
    // A corner dot does nothing here (Delete or the right-click menu removes it).
    if (el.corner !== undefined) return;
    if (el.kind === "edge") {
      const { roomId, edge } = parseEdgeId(el.id);
      const room = plan.rooms.find((r) => r.id === roomId);
      if (!room) return;
      // The first double-click only shows the room's corner dots; a second one, while they show, adds a corner.
      if (reveal !== roomId) {
        setReveal(roomId);
        onSelect([{ kind: "room", id: roomId }]);
        return;
      }
      const a = room.polygon[edge];
      const b = room.polygon[(edge + 1) % room.polygon.length];
      onChange(insertGluedCorner(plan, roomId, edge, projectOnEdge(world(), a, b, leftBulge(room, edge)).point).plan);
      onSelect([{ kind: "room", id: roomId }]);
    }
    if (el.kind === "wall" && !furnishing) {
      // A loose wall: the first double-click picks it (its end dots show); a second one splits it there.
      if (reveal !== el.id) {
        setReveal(el.id);
        onSelect([{ kind: "wall", id: el.id }]);
        return;
      }
      const out = splitWall(plan, el.id, world());
      if ("why" in out) onMessage(out.why);
      else {
        onChange(out.plan);
        if (out.note) onMessage(out.note);
        onSelect([{ kind: "wall", id: el.id }]);
      }
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
    for (const kind of furnishing ? (["furnish"] as const) : (["room", "wall", "stairs"] as const)) {
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

  /** Turning a room with the handles. */
  function onTransformEnd(e: Konva.KonvaEventObject<Event>) {
    const node = e.target;
    const m = node.getTransform().copy();
    node.setAttrs({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
    const id = node.id();
    const room = plan.rooms.find((r) => r.id === id);
    if (room) {
      // The handle turns the room about a point; find that point (the one the turn leaves in place)
      // and turn the room with everything in it: fixtures, furniture, cabinets, devices and open walls.
      const [a, b, , , tx, ty] = m.getMatrix();
      const dRot = Konva.Util.radToDeg(Math.atan2(b, a));
      const det = (1 - a) * (1 - a) + b * b;
      if (det < 1e-9) return;
      const pivot = { x: ((1 - a) * tx - b * ty) / det, y: (b * tx + (1 - a) * ty) / det };
      onChange(rotateMany(plan, [id], dRot, pivot));
      return;
    }
  }

  return { ghostFor, onMouseDown, onMouseMove, onMouseUp, onContextMenu, onDblClick, onWheel, zoomBy, onStageDrag, onTransformEnd };
}
