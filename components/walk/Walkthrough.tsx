"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import type { FloorPlan, Opening, Point, Product, Project, Selection, WallHeight } from "@/lib/model/schema";
import { useProjectStore } from "@/lib/store/projectStore";
import type { Estimate } from "@/lib/cost/estimate";
import { buildHouse, type HouseContext } from "@/lib/house3d/build";
import { levelHeights } from "@/lib/house3d/levels";
import { IN_PER_UNIT, type Frame } from "@/lib/house3d/mesh";
import { lotOffsetFor, planBounds, siteFor } from "@/lib/house3d/site";
import { SEASONS, daylight, type SeasonId } from "@/lib/house3d/sun";
import { eyeRay, heading, sightBlocked, walkStep, walkWorld, whereAmI, type Spot, type Walker } from "@/lib/house3d/walk";
import { DOOR_MODES, aimDoor, newDoorStates, stepDoors, toggleDoor, type DoorInfo, type DoorMode, type DoorStates } from "@/lib/house3d/doors";
import { DoorLeaves } from "@/components/house3d/DoorLeaves";
import { planOf } from "@/lib/plan/edit";
import { defaultFurnitureColor } from "@/lib/plan/furniture";
import { ceilingFor, exteriorWallIn } from "@/lib/plan/basics";
import { fixtureType, openingType } from "@/lib/plan/catalog";
import { catalogEntry, type CatalogEntry } from "@/lib/furnish/catalog";
import { placeCheck, removeItem, roomAt, type LayerItem } from "@/lib/furnish/layer";
import { deleteItem, furnishLayouts, patchItem, placeGhost, stageItems, type Ghost } from "@/lib/furnish/stage";
import { addWall, liftable, openingOnWall, openingShape, slideOpening, walkGhost, walkMove, wallHeightIn, wallPoint, withOpening, type WalkSpot } from "@/lib/furnish/walk";
import { canAutoFurnish, furnishRoom, furnishSummary } from "@/lib/furnish/autoFurnish";
import { isClosetRod } from "@/lib/furnish/closets";
import { effectiveAnswers } from "@/lib/interior/style";
import { aimAt, type Aim } from "@/lib/interior/surfaces";
import { Ground } from "@/components/house3d/House3DView";
import { HouseMeshes, Sky, type AimTarget } from "@/components/house3d/Scene";
import { FinishPanel, OutsidePanel } from "./DesignPanel";
import { Player, type Look } from "./Player";
import { DesignTabs, FinishesHelp, PlaceTab, type DesignTab } from "./PlaceTab";
import { DevicePlates, ItemGhost, ItemHighlight, OpeningGhost, RailingHighlight, WallGhost } from "./WalkGhosts";
import RailingPanel from "@/components/furnish/RailingPanel";
import FaucetPanel, { type FaucetChangeIn } from "@/components/furnish/FaucetPanel";
import { applyFaucetChange, faucetById, pickFaucetProduct, pickPotFiller, potFillerPick, usedFor } from "@/lib/furnish/faucetPick";
import { addRailingIn, changeRailingIn, railingTarget, stageRailings, type RailingChange, type RailingTarget } from "@/lib/furnish/railings";
import { project as projectOnto } from "@/lib/plan/geometry";
import TopDown from "./TopDown";
import FurnishItemPanel from "@/components/furnish/FurnishItemPanel";
import PlanSidePanel from "@/components/plan/PlanSidePanel";
import { AimDot, WalkControls, WalkHelp, WalkTopBar } from "./WalkOverlays";
import { DesignWindow, ViewShift, type DesignWindowKind } from "./DesignWindow";
import { FloorLabels } from "./FloorLabels";
import LabelSettingsPanel from "./LabelSettingsPanel";
import { TapeMeasure } from "./TapeMeasure";
import { newId } from "@/lib/model/project";
import { lockAxis, pinMeasurement, pinUnderDot, snap, tapeCandidates, TAPE_KEEP, type Tape, type TapePoint } from "@/lib/house3d/tape";
import type { WalkLabels } from "@/lib/model/schema";
import { effectiveExterior } from "@/lib/exterior/style";
import { canvasSettings, useGraphics } from "@/lib/graphics";
import { useFrame } from "@react-three/fiber";
import { usePlace } from "@/lib/location/usePlace";

/** Moves the doors every frame: opens the ones you walk into, shuts the ones you left, and keeps the world's blockers in step. */
function DoorDriver({ world, walker, states, modeRef }: { world: ReturnType<typeof walkWorld>; walker: React.RefObject<Walker>; states: React.MutableRefObject<DoorStates>; modeRef: React.RefObject<DoorMode> }) {
  useFrame((_, dt) => {
    const w = walker.current;
    states.current = stepDoors(states.current, world.doors, { p: w.p, feet: w.feet }, Math.min(dt, 0.1), modeRef.current);
    for (const d of world.doors) world.doorAmount[d.id] = states.current[d.id].amount;
  });
  return null;
}

/**
 * What the panel on the right shows. All but the label settings are the
 * Design panel, with its Finishes and Place tabs on top: what you clicked
 * (a surface, the outside, a placed item, a door or window), or with nothing
 * clicked, the Finishes help or the Place list.
 */
type Panel =
  | { kind: "finish"; aim: Extract<Aim, { kind: "finish" }> }
  | { kind: "outside"; aim: Extract<Aim, { kind: "outside" }> }
  | { kind: "item"; levelId: string; id: string }
  | { kind: "opening"; levelId: string; id: string }
  | { kind: "railing"; levelId: string; key: string }
  | { kind: "faucet"; levelId: string; id: string }
  | { kind: "pin"; id: string }
  | { kind: "design" }
  | { kind: "labels" };

/**
 * What's being placed: a new catalog item or one picked up (both follow where
 * you look until you click), a door or window on the aimed wall, a door or
 * window slid along its wall, or a wall drawn from one floor spot to another.
 */
type Carry =
  | { kind: "new"; entryId: string; levelId: string; turn: number; lift: number; ghost: Ghost | null }
  | { kind: "move"; item: LayerItem; levelId: string; turn: number; lift: number; ghost: Ghost | null }
  | { kind: "door"; style: string; levelId: string; opening: Opening | null }
  | { kind: "slide"; id: string; levelId: string; opening: Opening | null }
  | { kind: "wall"; height: WallHeight; levelId: string; first: Point | null; hover: Point | null }
  | { kind: "railing"; levelId: string; target: RailingTarget | null };

/** The name of what's being placed, and whether it can go where it is now. */
function carryInfo(c: Carry, plan: FloorPlan): { label: string; ok: boolean; problem?: string; note?: string; keys: string } {
  switch (c.kind) {
    case "new":
    case "move": {
      const label = c.kind === "move" ? c.item.label : (catalogEntry(c.entryId)?.label ?? "It");
      const mount = c.kind === "move" ? c.item.mount : catalogEntry(c.entryId)?.mount;
      const lifts = c.kind === "move" ? liftable(c.item) : mount === "wall" && (c.entryId.startsWith("addon:") || c.entryId.startsWith("cabinet:"));
      const g = c.ghost;
      return {
        label,
        ok: Boolean(g?.check.ok),
        problem: g ? g.check.problem : mount === "wall" ? "aim at a wall" : "aim at the floor",
        note: g?.check.ok && g.check.blocksDoors.length ? "in front of a door" : undefined,
        keys: `R to turn${lifts ? " · scroll to raise or lower" : ""} · Esc to cancel`,
      };
    }
    case "door":
      return { label: openingType(c.style).label, ok: Boolean(c.opening), problem: c.opening ? undefined : "aim at a wall", keys: "Esc to cancel" };
    case "slide": {
      const o = plan.openings.find((x) => x.id === c.id);
      return { label: o ? openingType(o.style).label : "Door", ok: Boolean(c.opening), problem: c.opening ? undefined : "aim along its wall", keys: "Click to leave it there · Esc to cancel" };
    }
    case "railing":
      return { label: "Railing", ok: Boolean(c.target), problem: c.target ? undefined : "aim at a side of the stairs or stairwell with no railing", note: c.target ? "click to add one here" : undefined, keys: "Esc to cancel" };
    case "wall":
      return { label: c.height === "full" ? "Wall" : c.height === "half" ? "Half wall" : "Half wall with a cap", ok: Boolean(c.hover), problem: c.hover ? undefined : "aim at the floor", note: c.first ? "click where it ends" : "click where it starts", keys: "Esc to cancel" };
  }
}

const isDesignPanel = (p: Panel | null) => Boolean(p && p.kind !== "labels" && p.kind !== "pin");

/**
 * Walk through the house in first person, like a video game. Click to start,
 * the mouse looks around, W A S D or the arrow keys walk, Shift to go faster,
 * Esc to stop. Walls stop you, doors let you through, stairs take you up and
 * down, and you can walk out onto the land.
 *
 * With Design on (E), the dot in the middle aims: click a floor, wall,
 * counter, fixture or door to pick its finish in the panel on the right, or
 * add, move and turn furniture.
 */
export default function Walkthrough({ project, cost, onClose, startWindow }: { project: Project; cost?: Estimate | null; onClose: () => void; startWindow?: DesignWindowKind }) {
  const quality = useGraphics((g) => g.quality);
  const update = useProjectStore((s) => s.update);

  const levels = useMemo(() => [...project.levels].sort((a, b) => a.elevationIn - b.elevationIn), [project.levels]);
  const basics = project.plan.basics;
  const offset = useMemo(() => lotOffsetFor(project), [project]);
  const answers = useMemo(() => effectiveAnswers(project.interior.answers, project.discovery.answers.feel ?? ""), [project.interior.answers, project.discovery.answers.feel]);

  const [design, setDesign] = useState(false);
  // The Design panel's tab (Finishes or Place), the top-down view (M), and what Furnish for me last said.
  const [tab, setTab] = useState<DesignTab>("finishes");
  const [topDown, setTopDown] = useState<{ levelId: string; p: Point; dir: Point } | null>(null);
  const [autoNotes, setAutoNotes] = useState<string[]>([]);
  // Floor labels (L) and the tape measure (T). Measurements aren't saved.
  const [labelsOn, setLabelsOn] = useState(false);
  const [tapeOn, setTapeOn] = useState(false);
  const [tape, setTape] = useState<{ done: Tape[]; first: TapePoint | null; hover: TapePoint | null }>({ done: [], first: null, hover: null });
  const shiftDown = useRef(false);
  const labelSettings = project.house3d.walkLabels;
  const setLabelSettings = (next: WalkLabels) => update((p) => ({ ...p, house3d: { ...p.house3d, walkLabels: next } }));
  const labelSettingsRef = useRef(labelSettings);
  labelSettingsRef.current = labelSettings;
  // Doors: the Doors picker (not saved; each walkthrough starts on Normal), how open each is, and the door under the dot.
  const [doorMode, setDoorMode] = useState<DoorMode>("normal");
  const doorStates = useRef<DoorStates>({});
  const doorModeRef = useRef<DoorMode>("normal");
  doorModeRef.current = doorMode;
  const doorsGroup = useRef<THREE.Group | null>(null);
  const [doorHint, setDoorHint] = useState<string | null>(null);
  const [pinAim, setPinAim] = useState<string | null>(null);
  const [aim, setAim] = useState<Aim | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  // The Interior (I) or Exterior (X) design window, and the room you stood in when it opened.
  const [win, setWin] = useState<{ kind: DesignWindowKind; roomId: string | null } | null>(null);
  const [carry, setCarry] = useState<Carry | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = useCallback((text: string | null) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    if (text) toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  const walkPins = project.house3d.walkPins;
  const pinsRef = useRef(walkPins);
  pinsRef.current = walkPins;
  /** P or the Pin button: the newest (or the picked) finished measurement becomes a saved pin. */
  const pinTape = (index?: number) => {
    const { done } = latest.current.tape;
    if (!done.length) return;
    const r = pinMeasurement(done, pinsRef.current, newId(), index);
    setTape((t) => ({ ...t, done: r.done }));
    update((p) => ({ ...p, house3d: { ...p.house3d, walkPins: r.pins } }));
    say("Pinned. Aim at it and click to delete.");
  };
  const deletePin = (id: string) => {
    update((p) => ({ ...p, house3d: { ...p.house3d, walkPins: p.house3d.walkPins.filter((x) => x.id !== id) } }));
    setPanel(null);
  };
  /** The pin under the aim dot, if it's close on screen and no wall is in between. */
  const pinUnderAim = (w: Walker): string | null => {
    const pins = pinsRef.current;
    const c = canvasRef.current;
    if (!pins.length || !c) return null;
    const { eye, dir } = eyeRay(w);
    const world = worldRef.current;
    const view = { eye, dir, fovDeg: 70, width: c.clientWidth, height: c.clientHeight };
    return (
      pinUnderDot(pins, view, (p) => {
        // Walls between the eye and the pin's middle hide it.
        const m = { x: (p.a.x + p.b.x) / 2, y: (p.a.y + p.b.y) / 2, z: (p.a.z + p.b.z) / 2 };
        return sightBlocked(world, eye, m, m.z);
      })?.id ?? null
    );
  };

  // A piece being moved is left out of the house until it's put down (it's drawn on its own meanwhile).
  const moving = carry?.kind === "move" ? carry : null;
  const movingItem = moving?.item;
  const movingLevel = moving?.levelId;
  const plans = useMemo(() => {
    if (!movingItem || !movingLevel) return project.floorPlans;
    return { ...project.floorPlans, [movingLevel]: removeItem(planOf(project.floorPlans, movingLevel), movingItem) };
  }, [project.floorPlans, movingItem, movingLevel]);

  const [frame] = useState<Frame>(() => {
    const bb = planBounds(project.floorPlans);
    return bb ? { ox: (bb.x0 + bb.x1) / 2, oy: (bb.y0 + bb.y1) / 2 } : { ox: 0, oy: 0 };
  });
  const heights = useMemo(() => levelHeights(levels, basics), [levels, basics]);
  const ceilingOf = useCallback((levelId: string) => ceilingFor(basics, levels.find((l) => l.id === levelId) ?? { id: levelId, kind: "main" }), [basics, levels]);
  // Everything placed on each floor, the app's own cabinets and outlets too: what Design can aim at.
  const itemsOn = useMemo<Record<string, LayerItem[]>>(
    () => (design ? Object.fromEntries(levels.map((l) => [l.id, stageItems(planOf(project.floorPlans, l.id), furnishLayouts(project, l))])) : {}),
    [design, project, levels],
  );
  const site = useMemo(() => siteFor(project.plot, offset, plans), [project.plot, offset, plans]);
  const ctx: HouseContext = useMemo(
    () => ({ levels, basics, house3d: project.house3d, site, frame, interior: project.interior.selections, exterior: project.exterior, systems: project.plans.systems }),
    [levels, basics, project.house3d, site, frame, project.interior.selections, project.exterior, project.plans.systems],
  );
  const model = useMemo(() => buildHouse(plans, ctx), [plans, ctx]);
  const world = useMemo(() => walkWorld(plans, { ...ctx, heights }), [plans, ctx, heights]);
  const doorParts = useMemo(() => (doorMode === "none" ? [] : model.parts.filter((p) => p.door)), [model.parts, doorMode]);
  // The latest world, for the key and mouse handlers.
  const worldRef = useRef(world);
  worldRef.current = world;
  if (Object.keys(doorStates.current).length === 0) doorStates.current = newDoorStates(world.doors);

  const [season, setSeason] = useState<SeasonId>("summer");
  const seasonInfo = SEASONS.find((s) => s.id === season)!;
  const place = usePlace();
  const { sunrise, sunset } = daylight(seasonInfo.day, place.latitudeDeg);
  const [hour, setHour] = useState(14);
  const shownHour = Math.min(sunset, Math.max(sunrise, hour));

  const [locked, setLocked] = useState(false);
  const [where, setWhere] = useState({ levelName: "", roomName: "Outside" });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const walker = useRef<Walker>({ ...world.start, vz: 0, pitch: 0 });
  const unlockedAt = useRef(0);
  const aimTarget = useRef<AimTarget | null>(null);

  // The latest of everything, for the mouse and key handlers.
  const snapPoints = useMemo(() => tapeCandidates(project.floorPlans, heights, levels.map((l) => l.id)), [project.floorPlans, heights, levels]);
  const latest = useRef({ aim, carry, panel, design, tab, topDown, locked, plans: project.floorPlans, itemsOn, tapeOn, tape, snapPoints, pinAim, win });
  latest.current = { aim, carry, panel, design, tab, topDown, locked, plans: project.floorPlans, itemsOn, tapeOn, tape, snapPoints, pinAim, win };

  /** The door under the dot, if you're close enough and no wall is in between. */
  const doorUnderDot = useCallback((): DoorInfo | null => {
    const { eye, dir } = eyeRay(walker.current);
    const w = worldRef.current;
    return aimDoor(w.doors, eye, dir, 90, (a, b, z) => sightBlocked(w, a, b, z));
  }, []);

  /** Click a door: open it (it stays open) or close it. */
  const clickDoor = () => {
    const d = doorUnderDot();
    if (!d) return false;
    const w = walker.current;
    const r = toggleDoor(doorStates.current, d, { p: w.p, feet: w.feet }, doorModeRef.current);
    doorStates.current = r.states;
    if (r.said) say(r.said);
    return true;
  };

  /** K: lock or unlock the door under the dot (saved with the plan). */
  const lockDoor = () => {
    const d = doorUnderDot();
    if (!d) return say("Aim at a door and press K to lock it.");
    const nowLocked = !d.locked;
    setPlan(d.levelId, (pl) => ({ ...pl, openings: pl.openings.map((o) => (o.id === d.id ? { ...o, locked: nowLocked ? true : undefined } : o)) }));
    say(`${d.label} ${nowLocked ? "locked. It only opens when you click it." : "unlocked."}`);
  };

  function jump(spot: Spot, keepYaw = true) {
    walker.current = { ...walker.current, p: spot.p, feet: spot.feet, vz: 0, yaw: keepYaw ? walker.current.yaw : spot.yaw };
    setWhere(whereAmI(world, plans, walker.current));
  }

  const start = () => {
    const c = canvasRef.current;
    if (!c) return;
    const r = c.requestPointerLock() as unknown as Promise<void> | undefined;
    r?.catch?.(() => {});
  };
  const stopWalking = () => {
    if (document.pointerLockElement) document.exitPointerLock();
  };

  /** The floor you're on, by your feet. */
  const levelHere = useCallback((): string | undefined => {
    const used = levels.filter((l) => (project.floorPlans[l.id]?.rooms.length ?? 0) > 0 && heights[l.id]);
    return [...used].reverse().find((l) => heights[l.id].floorIn <= walker.current.feet + 12)?.id ?? used[0]?.id;
  }, [levels, heights, project.floorPlans]);

  const setPlan = useCallback(
    (levelId: string, change: (pl: FloorPlan) => FloorPlan) =>
      update((p) => ({ ...p, floorPlans: { ...p.floorPlans, [levelId]: change(planOf(p.floorPlans, levelId)) } })),
    [update],
  );
  const setSelections = (selections: Selection[]) => update((p) => ({ ...p, interior: { ...p.interior, selections } }));
  const setOutside = (selections: Selection[]) => update((p) => ({ ...p, exterior: { ...p.exterior, selections } }));
  const outsideAnswers = useMemo(() => effectiveExterior(project.exterior.answers, answers), [project.exterior.answers, answers]);

  const setLevelPlan = useCallback(
    (levelId: string, pl: FloorPlan, coalesce?: string) => update((p) => ({ ...p, floorPlans: { ...p.floorPlans, [levelId]: pl } }), coalesce ? { coalesce: `walk-furnish.${coalesce}` } : undefined),
    [update],
  );

  /** Start placing something, with the mouse captured so it follows where you look. */
  const carryThis = (c: Carry) => {
    setCarry(c);
    setPanel(null);
    say(null);
    start();
  };

  /** Pick something in the Place list. */
  const pickEntry = (e: CatalogEntry) => {
    const levelId = levelHere();
    if (!levelId) return;
    if (e.kind === "opening") carryThis({ kind: "door", style: e.type, levelId, opening: null });
    else if (e.kind === "wall") carryThis({ kind: "wall", height: e.type as WallHeight, levelId, first: null, hover: null });
    else carryThis({ kind: "new", entryId: e.id, levelId, turn: 0, lift: 0, ghost: null });
  };

  /** The Place tab's "Add a railing": aim at a bare side of the stairs or stairwell and click. */
  const addRailingMode = () => {
    const levelId = levelHere();
    if (levelId) carryThis({ kind: "railing", levelId, target: null });
  };

  const pickUp = (item: LayerItem, levelId: string) => carryThis({ kind: "move", item, levelId, turn: 0, lift: 0, ghost: null });

  /** Click while placing: put it down if it fits there (a wall takes two clicks). */
  const putDown = () => {
    const c = latest.current.carry;
    if (!c) return;
    const pl = planOf(latest.current.plans, c.levelId);
    if (c.kind === "railing") {
      if (!c.target) return say("Aim at a side of the stairs or stairwell that has no railing (it's drawn blue).");
      const out = addRailingIn(latest.current.plans, c.target);
      if (!out) return say("Those stairs are gone.");
      setLevelPlan(c.target.stairsLevelId, out);
      setCarry(null);
      return say("Added a railing. Click it to change its kind or look; Undo takes it away.");
    }
    if (c.kind === "wall") {
      if (!c.hover) return say("Aim at the floor where the wall goes.");
      if (!c.first) return setCarry({ ...c, first: c.hover });
      const out = addWall(pl, c.first, c.hover, c.height);
      if (!out) return say("That's too short for a wall. Click farther apart.");
      setLevelPlan(c.levelId, out.plan);
      setCarry(null);
      return say(out.split ? "Added the wall. It split the room in two; name the new room on the floor plan." : "Added the wall. It's on the floor plan too.");
    }
    if (c.kind === "door" || c.kind === "slide") {
      if (!c.opening) return say(c.kind === "door" ? "Aim at a wall to put it there." : "Aim along its own wall to slide it.");
      setLevelPlan(c.levelId, withOpening(pl, c.opening));
      setCarry(null);
      return say(c.kind === "door" ? `Added the ${openingType(c.opening.style).label.toLowerCase()}. Click it in Place to change its size or style.` : null);
    }
    const g = c.ghost;
    if (!g) return say(`It can't go there: ${carryInfo(c, pl).problem ?? "it doesn't fit"}.`);
    if (!g.check.ok) return say(g.check.problem ?? "It doesn't fit there.");
    if (c.kind === "move") {
      const out = patchItem(pl, c.item, { x: g.x, y: g.y, rotation: g.rotation, ...(liftable(c.item) ? { bottomIn: g.bottomIn } : {}) });
      setLevelPlan(c.levelId, out.plan);
    } else {
      const out = placeGhost(pl, g, ceilingOf(c.levelId));
      if (!out.id) return say("It doesn't fit there.");
      // New furniture takes a color from the style answers.
      const color = c.entryId.startsWith("furniture:") ? defaultFurnitureColor(c.entryId.slice(10), answers) : undefined;
      setLevelPlan(c.levelId, color ? { ...out.plan, furniture: out.plan.furniture.map((f) => (f.id === out.id ? { ...f, color } : f)) } : out.plan);
    }
    setCarry(null);
    say(g.check.blocksDoors.length ? `${carryInfo(c, pl).label} is in front of a door. It's allowed, and shows in Things to check.` : null);
  };

  /** R on an item under the dot: turn it, if it fits turned. */
  const turnAimed = (levelId: string, id: string, by: number) => {
    const items = latest.current.itemsOn[levelId] ?? [];
    const item = items.find((x) => x.id === id);
    if (!item) return;
    const pl = planOf(project.floorPlans, levelId);
    const turned = { ...item, rotation: item.rotation + by };
    const check = placeCheck(pl, turned, items.filter((x) => x.id !== id));
    if (!check.ok) return say(`It can't turn there: ${check.problem?.toLowerCase() ?? "it doesn't fit."}`);
    setLevelPlan(levelId, patchItem(pl, item, { rotation: turned.rotation }).plan);
    if (check.blocksDoors.length) say("Turned. It's in front of a door now.");
  };

  const removeThis = (levelId: string, id: string) => {
    const item = latest.current.itemsOn[levelId]?.find((x) => x.id === id);
    if (!item) return;
    setLevelPlan(levelId, deleteItem(planOf(project.floorPlans, levelId), item));
    setPanel(null);
    say(isClosetRod(item.id) ? "Took out the closet's rod and shelf. Its walls and door stay." : "Deleted. Undo brings it back.");
  };

  /** The room you're standing in, for Furnish for me. */
  const roomHere = () => {
    const levelId = levelHere();
    const room = levelId ? roomAt(planOf(project.floorPlans, levelId), walker.current.p) : undefined;
    return levelId && room ? { levelId, room } : null;
  };
  const furnishHere = () => {
    const here = roomHere();
    if (!here) return;
    const res = furnishRoom(planOf(project.floorPlans, here.levelId), here.room.id, ceilingOf(here.levelId));
    if (res.placed) setLevelPlan(here.levelId, res.plan);
    setAutoNotes(res.notes);
    say(furnishSummary(res));
  };

  /** Change, remove or reset the railing with this key (built on `levelId`); the change is saved on its stairs. */
  const changeRailingAimed = (levelId: string, key: string, change: RailingChange) => {
    const t = railingTarget(stageRailings(latest.current.plans, levels, basics, levelId), key);
    if (!t) return;
    const pl = changeRailingIn(latest.current.plans, t, change);
    if (!pl) return;
    setLevelPlan(t.stairsLevelId, pl);
    if (change === "remove") {
      setPanel(null);
      say("Removed the railing. Undo brings it back.");
    }
  };

  /** Change, remove or put back the faucet on the fixture with this id (on `levelId`). */
  const changeFaucetAimed = (levelId: string, fixtureId: string, change: FaucetChangeIn) => {
    const pl = planOf(latest.current.plans, levelId);
    if (!pl.fixtures.some((f) => f.id === fixtureId)) return;
    setLevelPlan(levelId, applyFaucetChange(pl, fixtureId, change), typeof change === "object" ? "faucet" : undefined);
    if (change === "remove") {
      setPanel(null);
      say("Took the faucet off. Undo puts it back.");
    }
  };

  const setDesignOn = (on: boolean) => {
    setDesign(on);
    if (!on) {
      setCarry(null);
      if (isDesignPanel(latest.current.panel)) setPanel(null);
    } else setTapeOn(false);
  };

  /** Open the Design panel on a tab, with nothing clicked. */
  const openDesign = (t: DesignTab) => {
    setDesign(true);
    setTapeOn(false);
    setTab(t);
    setCarry(null);
    setPanel({ kind: "design" });
    stopWalking();
  };

  /** I or X: the Interior or Exterior design window. Walking stops; Design, the tape and anything being placed turn off. */
  const openWindow = (kind: DesignWindowKind) => {
    setCarry(null);
    setDesign(false);
    setTapeOn(false);
    setPanel(null);
    setTopDown(null);
    stopWalking();
    setWin({ kind, roomId: roomHere()?.room.id ?? null });
  };
  /** I or X again (or its top-bar button): open that window, or close it when it's the one showing. */
  const toggleWindow = (kind: DesignWindowKind) => {
    if (latest.current.win?.kind === kind) setWin(null);
    else openWindow(kind);
  };
  const keepWalking = () => {
    setWin(null);
    start();
  };

  /** M: the top-down view of this floor, with you marked on it. */
  const openTopDown = () => {
    const levelId = levelHere();
    if (!levelId) return say("There's no floor plan to show from above yet.");
    setCarry(null);
    setPanel(null);
    stopWalking();
    setTopDown({ levelId, p: { ...walker.current.p }, dir: heading(walker.current.yaw) });
  };

  /** What the dot is on, worked out from the 3D view a few times a second. */
  const onLook = useCallback(
    (look: Look) => {
      const toPlan = (v: THREE.Vector3): Point => ({ x: v.x * IN_PER_UNIT + frame.ox, y: v.z * IN_PER_UNIT + frame.oy });
      const c = latest.current.carry;
      if (c) {
        // Placing: the spot on the floor you're looking at, and the wall the dot is on.
        const floorIn = heights[c.levelId]?.floorIn ?? 0;
        const y = floorIn / IN_PER_UNIT;
        const t = look.dir.y < -0.03 ? (y - look.origin.y) / look.dir.y : Infinity;
        // Looking level (or far off): a few feet ahead of you instead, short of the wall you're looking at.
        const flatDir = new THREE.Vector3(look.dir.x, 0, look.dir.z).normalize();
        const e = c.kind === "new" ? catalogEntry(c.entryId) : undefined;
        const size = c.kind === "move" ? Math.max(c.item.widthIn, c.item.depthIn) : e ? Math.max(e.widthIn, e.depthIn) : 0;
        const reach = size / 2 / IN_PER_UNIT + 0.5;
        const wallAt = look.hit ? Math.hypot(look.hit.point.x - look.origin.x, look.hit.point.z - look.origin.z) : Infinity;
        const ahead = Math.max(2, Math.min(6, wallAt - reach));
        const floor = t > 0 && t < 25 ? toPlan(look.origin.clone().addScaledVector(look.dir, t)) : toPlan(look.origin.clone().addScaledVector(flatDir, ahead));
        const h = look.hit;
        const onWall = h && Math.abs(h.normal.y) < 0.3 && h.owner.levelId === c.levelId;
        const spot: WalkSpot = { floor, ...(onWall ? { wall: { p: toPlan(h.point), n: { x: h.normal.x, y: h.normal.z } } } : {}) };
        const pl = planOf(latest.current.plans, c.levelId);
        const items = latest.current.itemsOn[c.levelId] ?? [];
        const ceilingIn = ceilingOf(c.levelId);
        // A new door keeps one id while it's moved about, so it isn't redrawn for nothing.
        const keepId = (o: Opening | null, was: Opening | null) => (o && was ? { ...o, id: was.id } : o);
        let next: Carry;
        if (c.kind === "railing") {
          // The bare side of the stairs or stairwell nearest where you're looking (within a few feet).
          const at = h ? toPlan(h.point) : floor;
          let best: { d: number; t: RailingTarget } | null = null;
          for (const l of levels) {
            for (const x of stageRailings(latest.current.plans, levels, basics, l.id).bare) {
              const d = projectOnto(at, x.a, x.b).d;
              if (d < 36 && (!best || d < best.d)) best = { d, t: { key: x.key, stairsId: x.stairsId, stairsLevelId: x.stairsLevelId, levelId: x.levelId, edge: x.edge, slot: x } };
            }
          }
          next = { ...c, target: best?.t ?? null };
        } else if (c.kind === "new") next = { ...c, ghost: walkGhost(pl, c.entryId, spot, c.turn, items, ceilingIn, c.lift) };
        else if (c.kind === "move") next = { ...c, ghost: walkMove(pl, c.item, spot, c.turn, items, ceilingIn, c.lift) };
        else if (c.kind === "door") next = { ...c, opening: keepId(openingOnWall(pl, spot.wall?.p ?? floor, c.style, basics?.doorHeightIn), c.opening) };
        else if (c.kind === "slide") next = { ...c, opening: slideOpening(pl, c.id, spot.wall?.p ?? floor) };
        else next = { ...c, hover: wallPoint(pl, floor) };
        setCarry((cur) => (!cur || cur.kind !== next.kind || cur.levelId !== next.levelId ? cur : JSON.stringify(cur) === JSON.stringify(next) ? cur : next));
        return;
      }
      if (latest.current.tapeOn) {
        // Measuring: the spot you're aiming at, snapped to corners and door/window edges.
        const h = look.hit;
        let hover: TapePoint | null = null;
        if (h) {
          const at = toPlan(h.point);
          hover = snap({ x: at.x, y: at.y, z: h.point.y * IN_PER_UNIT }, latest.current.snapPoints);
          const first = latest.current.tape.first;
          if (first && shiftDown.current) hover = lockAxis(first, hover);
        }
        setTape((t) => (JSON.stringify(t.hover) === JSON.stringify(hover) ? t : { ...t, hover }));
        return;
      }
      let next: Aim = { kind: "none" };
      const h = look.hit;
      if (h) {
        const owner = h.owner;
        const plan = planOf(latest.current.plans, owner.levelId);
        const floorIn = heights[owner.levelId]?.floorIn ?? 0;
        const order = levels.filter((l) => heights[l.id] && (latest.current.plans[l.id]?.rooms.length ?? 0) > 0).sort((a, b) => heights[a.id].floorIn - heights[b.id].floorIn);
        const i = order.findIndex((l) => l.id === owner.levelId);
        const below = i > 0 ? { levelId: order[i - 1].id, plan: planOf(latest.current.plans, order[i - 1].id) } : undefined;
        next = aimAt(
          plan,
          { layer: owner.layer, levelId: owner.levelId, pick: owner.pick, furnitureId: owner.furnitureId },
          { p: toPlan(h.point), heightIn: h.point.y * IN_PER_UNIT - floorIn, normal: { x: h.normal.x, y: h.normal.z, up: h.normal.y } },
          basics,
          below,
          { tab: latest.current.tab, items: latest.current.itemsOn[owner.levelId] ?? [] },
        );
      }
      setAim((cur) => (JSON.stringify(cur) === JSON.stringify(next) ? cur : next));
    },
    [frame, heights, levels, basics, ceilingOf],
  );

  // The mouse is captured while walking; Esc gives it back (the browser does that), and Esc again closes
  // (or closes the panel first, when one is open).
  useEffect(() => {
    const onChange = () => {
      const on = document.pointerLockElement === canvasRef.current;
      setLocked(on);
      if (on) setWin(null);
      if (!on) {
        unlockedAt.current = performance.now();
        setAim(null);
        // Letting go of the mouse also cancels a measurement in progress.
        setTape((t) => (t.first || t.hover ? { ...t, first: null, hover: null } : t));
        // Letting go of the mouse while placing cancels it (a piece being moved goes back where it was).
        if (latest.current.carry) {
          setCarry(null);
          say(latest.current.carry.kind === "move" ? "Put back where it was." : null);
        }
      }
    };
    const onKey = (e: KeyboardEvent) => {
      // The top-down view has its own keys (M or Esc come back).
      if (latest.current.topDown) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select")) return;
      if (e.key === "Shift") shiftDown.current = true;
      // While a design window is open walking is paused: only I, X and Esc do anything.
      if (latest.current.win) {
        if (e.key === "Escape") {
          setWin(null);
          unlockedAt.current = performance.now();
        } else if ((e.code === "KeyI" || e.code === "KeyX") && !e.metaKey && !e.ctrlKey && !e.altKey) toggleWindow(e.code === "KeyI" ? "interior" : "exterior");
        return;
      }
      if (e.key === "Escape" && !document.pointerLockElement) {
        if (latest.current.panel) setPanel(null);
        else if (performance.now() - unlockedAt.current > 400) onClose();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const { aim: a, carry: c, locked: on, design: d } = latest.current;
      if ((e.code === "KeyI" || e.code === "KeyX") && !c) {
        openWindow(e.code === "KeyI" ? "interior" : "exterior");
        return;
      }
      if (e.code === "KeyE") {
        setDesignOn(!d);
        return;
      }
      if (e.code === "KeyF" && !c) {
        openDesign("place");
        return;
      }
      if (e.code === "Tab" && d) {
        e.preventDefault();
        const next = latest.current.tab === "finishes" ? "place" : "finishes";
        setTab(next);
        if (isDesignPanel(latest.current.panel)) setPanel({ kind: "design" });
        else say(next === "place" ? "Place: aim at something placed to change it, or press F for the list." : "Finishes: aim at a surface and click to pick its finish.");
        return;
      }
      if (e.code === "KeyM" && !c) {
        openTopDown();
        return;
      }
      if (e.code === "KeyL" && e.shiftKey) {
        const next = !labelSettingsRef.current.locked;
        setLabelSettings({ ...labelSettingsRef.current, locked: next });
        setLabelsOn(true);
        say(next ? "Labels locked" : "Labels turn with you");
        return;
      }
      if (e.code === "KeyL") {
        setLabelsOn((v) => !v);
        return;
      }
      if (e.code === "KeyK" && !c) {
        lockDoor();
        return;
      }
      if (e.code === "KeyO" && !c) {
        const modes = DOOR_MODES.map((m) => m.id);
        const next = modes[(modes.indexOf(doorModeRef.current) + 1) % modes.length];
        setDoorMode(next);
        say(`Doors: ${DOOR_MODES.find((m) => m.id === next)?.label}`);
        return;
      }
      if (e.code === "KeyT" && !c) {
        const next = !latest.current.tapeOn;
        setTapeOn(next);
        if (next) setDesignOn(false);
        setTape((t) => ({ ...t, first: null, hover: null }));
        return;
      }
      if (e.code === "KeyP" && !c && latest.current.tape.done.length) {
        pinTape();
        return;
      }
      if (e.code === "KeyC" && latest.current.tapeOn) {
        setTape({ done: [], first: null, hover: null });
        return;
      }
      if (!on || !d) return;
      if (e.code === "KeyR") {
        const by = e.shiftKey ? -15 : 15;
        if (c && (c.kind === "new" || c.kind === "move")) setCarry({ ...c, turn: c.turn + by, ghost: c.ghost && { ...c.ghost, rotation: (((c.ghost.rotation + by) % 360) + 360) % 360 } });
        else if (!c && a?.kind === "furnish") turnAimed(a.levelId, a.id, by);
      } else if ((e.code === "Delete" || e.code === "Backspace") && a?.kind === "furnish" && !c) {
        removeThis(a.levelId, a.id);
      } else if ((e.code === "Delete" || e.code === "Backspace") && a?.kind === "faucet" && !c) {
        changeFaucetAimed(a.levelId, a.id, "remove");
      } else if ((e.code === "Delete" || e.code === "Backspace") && a?.kind === "railing" && !c) {
        changeRailingAimed(a.levelId, a.id, "remove");
      }
    };
    const onWheel = (e: WheelEvent) => {
      // Scrolling raises or lowers a wall-hung shelf or cabinet being placed.
      const c = latest.current.carry;
      if (!latest.current.locked || !c || (c.kind !== "new" && c.kind !== "move")) return;
      setCarry({ ...c, lift: c.lift + (e.deltaY < 0 ? 2 : -2) });
    };
    const onDown = (e: MouseEvent) => {
      const { aim: a, carry: c, locked: on, design: d } = latest.current;
      if (!on || e.button !== 0) return;
      if (c) {
        putDown();
        return;
      }
      if (latest.current.tapeOn) {
        const { first, hover } = latest.current.tape;
        if (!hover) return;
        const at = first && e.shiftKey ? lockAxis(first, hover) : hover;
        setTape((t) => (!first ? { ...t, first: at } : { done: [...t.done, { a: first, b: at }].slice(-TAPE_KEEP), first: null, hover: null }));
        return;
      }
      const pinId = latest.current.pinAim;
      if (!d && pinId) {
        setPanel({ kind: "pin", id: pinId });
        stopWalking();
        return;
      }
      if (!d && clickDoor()) return;
      if (!d || !a) return;
      if (a.kind === "finish") {
        setPanel({ kind: "finish", aim: a });
        stopWalking();
      } else if (a.kind === "outside") {
        setPanel({ kind: "outside", aim: a });
        stopWalking();
      } else if (a.kind === "furnish") {
        setPanel({ kind: "item", levelId: a.levelId, id: a.id });
        stopWalking();
      } else if (a.kind === "opening") {
        setPanel({ kind: "opening", levelId: a.levelId, id: a.id });
        stopWalking();
      } else if (a.kind === "railing") {
        setPanel({ kind: "railing", levelId: a.levelId, key: a.id });
        stopWalking();
      } else if (a.kind === "faucet") {
        setPanel({ kind: "faucet", levelId: a.levelId, id: a.id });
        stopWalking();
      } else if (a.hint) say(a.hint);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") shiftDown.current = false;
    };
    document.addEventListener("pointerlockchange", onChange);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("wheel", onWheel);
    return () => {
      window.removeEventListener("wheel", onWheel);
      document.removeEventListener("pointerlockchange", onChange);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousedown", onDown);
    };
  });

  useEffect(
    () => () => {
      if (document.pointerLockElement) document.exitPointerLock();
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  // Opened straight into a design window (Furnish's Next button, the Plans page).
  useEffect(() => {
    if (startWindow) setWin({ kind: startWindow, roomId: null });
  }, [startWindow]);

  // Nothing behind the walkthrough scrolls while it's open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const span = useMemo(() => {
    const b = model.bounds;
    return b ? Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2], 30) : 60;
  }, [model.bounds]);

  const panelPlan = panel?.kind === "item" || panel?.kind === "opening" ? planOf(project.floorPlans, panel.levelId) : null;
  const openItem = panel?.kind === "item" ? itemsOn[panel.levelId]?.find((x) => x.id === panel.id) : undefined;
  const openOpening = panel?.kind === "opening" ? panelPlan?.openings.find((o) => o.id === panel.id) : undefined;
  const showPanel = panel && !locked && !topDown && (panel.kind !== "item" || openItem) && (panel.kind !== "opening" || openOpening);
  const aimText = aim && aim.kind !== "none" ? aim.label : aim?.label;
  const here = panel?.kind === "design" && tab === "place" ? roomHere() : null;
  // The item or door under the dot, boxed in blue.
  const aimedItem = design && locked && !carry && aim?.kind === "furnish" ? itemsOn[aim.levelId]?.find((x) => x.id === aim.id) : undefined;
  // The railing under the dot, or the bare side that a click would give one.
  const railHint = useMemo(() => {
    if (!design || !locked) return null;
    if (carry?.kind === "railing") return carry.target?.slot ? { ...carry.target.slot, heightIn: 36 } : null;
    if (carry || aim?.kind !== "railing") return null;
    const r = stageRailings(project.floorPlans, levels, basics, aim.levelId).railings.find((x) => x.key === aim.id);
    return r ? { a: r.a, b: r.b, za: r.za, zb: r.zb, heightIn: r.heightIn, levelId: r.levelId } : null;
  }, [design, locked, carry, aim, project.floorPlans, levels, basics]);
  const aimedOpening = useMemo(() => {
    if (!design || !locked || carry || aim?.kind !== "opening") return null;
    const pl = planOf(project.floorPlans, aim.levelId);
    const o = pl.openings.find((x) => x.id === aim.id);
    return o ? openingShape(pl, o) : null;
  }, [design, locked, carry, aim, project.floorPlans]);
  const carryOpening = useMemo(() => (carry && (carry.kind === "door" || carry.kind === "slide") && carry.opening ? openingShape(planOf(project.floorPlans, carry.levelId), carry.opening) : null), [carry, project.floorPlans]);
  const carryLabel = carry ? carryInfo(carry, planOf(project.floorPlans, carry.levelId)) : null;
  const levelOf = (id: string) => levels.find((l) => l.id === id);

  return (
    <div className="fixed inset-0 z-50 bg-black" data-testid="walkthrough">
      <Canvas
        key={quality}
        {...canvasSettings(quality, 1.5)}
        onCreated={({ gl }) => {
          canvasRef.current = gl.domElement;
        }}
      >
        <PerspectiveCamera makeDefault fov={70} near={0.3} far={6000} />
        <ViewShift open={!!win && !locked} />
        <Sky day={seasonInfo.day} hour={shownHour} span={span} version={model} center={model.bounds ? [(model.bounds.min[0] + model.bounds.max[0]) / 2, 0, (model.bounds.min[2] + model.bounds.max[2]) / 2] : [0, 0, 0]} />
        <Ground site={site} frame={frame} plans={plans} ctx={ctx} heights={heights} yard={false} />
        <HouseMeshes parts={model.parts} aimRef={aimTarget} doorsApart />
        <DoorLeaves parts={doorParts} frame={frame} amountOf={(id) => world.doorAmount[id] ?? 0} groupRef={doorsGroup} />
        <DoorDriver world={world} walker={walker} states={doorStates} modeRef={doorModeRef} />
        {labelsOn && <FloorLabels project={project} settings={labelSettings} frame={frame} heights={heights} walker={walker} costTotal={cost?.total.likely} />}
        <TapeMeasure done={tape.done} first={tape.first} hover={tapeOn ? tape.hover : null} frame={frame} units={labelSettings.units} pins={walkPins} aimedPin={pinAim} canPin={!locked} onPin={pinTape} />
        {carry && (carry.kind === "new" || carry.kind === "move") && carry.ghost && (
          <ItemGhost ghost={carry.ghost} color={carry.kind === "move" ? carry.item.color : undefined} floorIn={heights[carry.levelId]?.floorIn ?? 0} frame={frame} />
        )}
        {carry && carryOpening && <OpeningGhost g={carryOpening} floorIn={heights[carry.levelId]?.floorIn ?? 0} frame={frame} ok />}
        {carry?.kind === "wall" && carry.hover && <WallGhost a={carry.first ?? carry.hover} b={carry.hover} heightIn={wallHeightIn(carry.height, ceilingOf(carry.levelId))} floorIn={heights[carry.levelId]?.floorIn ?? 0} frame={frame} />}
        {aimedItem && aim?.kind === "furnish" && <ItemHighlight item={aimedItem} floorIn={heights[aim.levelId]?.floorIn ?? 0} ceilingIn={ceilingOf(aim.levelId)} frame={frame} />}
        {railHint && <RailingHighlight a={railHint.a} b={railHint.b} za={railHint.za} zb={railHint.zb} heightIn={railHint.heightIn} floorIn={heights[railHint.levelId]?.floorIn ?? 0} frame={frame} />}
        {aimedOpening && aim?.kind === "opening" && <OpeningGhost g={aimedOpening} floorIn={heights[aim.levelId]?.floorIn ?? 0} frame={frame} ok highlight />}
        {design &&
          levels.map((l) =>
            itemsOn[l.id]?.length && heights[l.id] ? <DevicePlates key={l.id} items={itemsOn[l.id]} floorIn={heights[l.id].floorIn} ceilingIn={ceilingOf(l.id)} frame={frame} /> : null,
          )}
        <Player
          walker={walker}
          locked={locked}
          frame={frame}
          step={(w, input, dt) => walkStep(world, w, input, dt)}
          onWhere={(w) => {
            const next = whereAmI(world, plans, w);
            setWhere((cur) => (cur.levelName === next.levelName && cur.roomName === next.roomName ? cur : next));
            // The door under the dot, for the hint below it.
            const { eye, dir } = eyeRay(w);
            const d = latest.current.locked && !latest.current.design && !latest.current.tapeOn && !latest.current.carry ? aimDoor(world.doors, eye, dir, 90, (a, b, z) => sightBlocked(world, a, b, z)) : null;
            const hint = d ? `${d.label}: click to ${doorStates.current[d.id]?.open ? "close" : "open"} · K to ${d.locked ? "unlock" : "lock"}${d.locked ? " (locked)" : ""}` : null;
            setDoorHint((cur) => (cur === hint ? cur : hint));
            const pin = latest.current.locked && !latest.current.design && !latest.current.carry ? pinUnderAim(w) : null;
            setPinAim((cur) => (cur === pin ? cur : pin));
          }}
          doorsRef={doorsGroup}
          aimTarget={aimTarget}
          looking={locked && (design || !!carry || tapeOn)}
          fastLook={!!carry}
          onLook={onLook}
        />
      </Canvas>

      <WalkTopBar
        name={project.name}
        where={where}
        cost={cost}
        design={design}
        tab={tab}
        locked={locked}
        onDesign={() => setDesignOn(!design)}
        labelsOn={labelsOn}
        tapeOn={tapeOn}
        onLabels={() => setLabelsOn(!labelsOn)}
        onLabelSettings={() => setPanel({ kind: "labels" })}
        onTape={() => {
          setTapeOn(!tapeOn);
          if (!tapeOn) setDesignOn(false);
          setTape((t) => ({ ...t, first: null, hover: null }));
        }}
        onClearTape={() => setTape({ done: [], first: null, hover: null })}
        hasTape={tape.done.length > 0}
        onPlace={() => openDesign("place")}
        onTopDown={openTopDown}
        win={win?.kind ?? null}
        onWindow={toggleWindow}
        onClose={onClose}
      />

      {locked ? (
        <AimDot design={design} aimText={aimText} aimable={!!aim && aim.kind !== "none"} carry={carryLabel} />
      ) : win ? null : showPanel ? (
        <button className="absolute inset-0 cursor-pointer" onClick={start} aria-label="Keep walking" />
      ) : (
        <WalkHelp onStart={start} />
      )}

      {locked && pinAim && !design && !carry && (
        <div className="pointer-events-none absolute top-1/2 left-1/2 mt-5 -translate-x-1/2 rounded-md bg-black/65 px-3 py-1.5 text-center text-sm text-white" data-testid="pin-hint">
          Click for pin options
          {tapeOn && <span className="block text-xs text-white/60">The tape is on, so a click measures. Press T to turn it off</span>}
        </div>
      )}

      {locked && doorHint && !pinAim && !design && !tapeOn && !carry && (
        <div className="pointer-events-none absolute top-1/2 left-1/2 mt-5 -translate-x-1/2 rounded-md bg-black/65 px-3 py-1.5 text-center text-sm text-white" data-testid="door-hint">
          {doorHint}
        </div>
      )}

      {locked && tapeOn && !pinAim && (
        <div className="pointer-events-none absolute top-1/2 left-1/2 mt-5 -translate-x-1/2 rounded-md bg-black/65 px-3 py-1.5 text-center text-sm text-white" data-testid="tape-hint">
          {tape.first ? "Click the second point" : "Click to start measuring"}
          <span className="block text-xs text-white/60">Shift keeps it level or straight up · C clears · T stops</span>
        </div>
      )}

      {toast && (
        <div className="pointer-events-none absolute top-20 left-1/2 -translate-x-1/2 rounded-md bg-black/75 px-4 py-2 text-sm text-white" role="status" data-testid="walk-toast">
          {toast}
        </div>
      )}

      {showPanel && (
        <aside className="absolute top-[var(--walk-bar,4rem)] right-4 bottom-4 z-10 flex w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl bg-white shadow-xl">
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
            <button className="btn-primary px-3 py-1 text-sm" onClick={start}>
              Keep walking
            </button>
            <button className="text-sm text-muted hover:text-ink" onClick={() => setPanel(null)} aria-label="Close panel">
              Close ✕
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {isDesignPanel(panel) && (
              <div className="mb-4">
                <DesignTabs
                  tab={panel.kind === "finish" || panel.kind === "outside" ? "finishes" : panel.kind === "design" ? tab : "place"}
                  onTab={(t) => {
                    setTab(t);
                    setPanel({ kind: "design" });
                  }}
                />
              </div>
            )}
            {panel.kind === "finish" && <FinishPanel key={panel.aim.label} aim={panel.aim} selections={project.interior.selections} answers={answers} onChange={setSelections} />}
            {panel.kind === "outside" && <OutsidePanel key={panel.aim.label} aim={panel.aim} selections={project.exterior.selections} answers={outsideAnswers} onChange={setOutside} />}
            {panel.kind === "design" && tab === "finishes" && <FinishesHelp onOpenWindow={openWindow} />}
            {panel.kind === "design" && tab === "place" && (
              <PlaceTab picked={null} onPick={pickEntry} roomName={here?.room.name ?? null} canFurnish={Boolean(here && canAutoFurnish(here.room))} onFurnishForMe={furnishHere} notes={autoNotes} onAddRailing={addRailingMode} />
            )}
            {panel.kind === "item" && openItem && panelPlan && (
              <div className="space-y-3" data-testid="walk-item-panel">
                <button className="btn-primary w-full justify-center" onClick={() => pickUp(openItem, panel.levelId)} data-testid="walk-pick-up">
                  Pick up and move
                </button>
                <FurnishItemPanel
                  plan={panelPlan}
                  item={openItem}
                  ceilingIn={ceilingOf(panel.levelId)}
                  roomName={openItem.roomId ? panelPlan.rooms.find((r) => r.id === openItem.roomId)?.name : undefined}
                  onApply={(out, coalesce) => {
                    setLevelPlan(panel.levelId, out.plan, coalesce);
                    setPanel(out.id ? { kind: "item", levelId: panel.levelId, id: out.id } : { kind: "design" });
                  }}
                  onDelete={(pl) => {
                    setLevelPlan(panel.levelId, pl);
                    setPanel(null);
                    say(isClosetRod(openItem.id) ? "Took out the closet's rod and shelf. Its walls and door stay." : "Deleted. Undo brings it back.");
                  }}
                  onMessage={say}
                  {...(openItem.entryId === "addon:pot-filler"
                    ? (() => {
                        const pk = potFillerPick(panelPlan, openItem, project.interior.selections);
                        return { productPick: { label: pk.label, usedFor: pk.usedFor, products: pk.products, picked: pk.picked, onPick: (prod: Product | null) => setSelections(pickPotFiller(panelPlan, openItem, project.interior.selections, prod)) } };
                      })()
                    : {})}
                />
                <p className="text-xs text-muted">While walking: aim at it and press R to turn it, or Delete to remove it.</p>
              </div>
            )}
            {panel.kind === "opening" && openOpening && panelPlan && levelOf(panel.levelId) && (
              <div className="space-y-3" data-testid="walk-opening-panel">
                <button className="btn-primary w-full justify-center" onClick={() => carryThis({ kind: "slide", id: openOpening.id, levelId: panel.levelId, opening: null })} data-testid="walk-slide">
                  Slide along the wall
                </button>
                <PlanSidePanel
                  plan={panelPlan}
                  overhangs={[]}
                  level={levelOf(panel.levelId)!}
                  levels={levels}
                  brief={project.brief}
                  basics={basics}
                  selection={[{ kind: "opening", id: openOpening.id }]}
                  tool="select"
                  placeOpening={openOpening.style}
                  onPlaceOpening={() => {}}
                  onChange={(pl) => setLevelPlan(panel.levelId, pl)}
                  onSelect={() => {}}
                  noDelete
                />
              </div>
            )}
            {panel.kind === "faucet" && (() => {
              const pl = planOf(project.floorPlans, panel.levelId);
              const fx = pl.fixtures.find((f) => f.id === panel.id);
              const fc = fx && faucetById(pl, panel.levelId, fx.id, project.interior.selections, exteriorWallIn(basics));
              if (!fx || !fc) return <p className="text-sm text-muted">That faucet is gone.</p>;
              return (
                <div className="space-y-3" data-testid="walk-faucet-panel">
                  <FaucetPanel
                    faucet={fc}
                    fixtureLabel={fixtureType(fx.kind).label}
                    usedFor={usedFor(pl, fx, fc.kind)}
                    onChange={(c) => changeFaucetAimed(panel.levelId, fx.id, c)}
                    onPick={(prod) => setSelections(pickFaucetProduct(pl, fx, fc.kind, project.interior.selections, prod))}
                  />
                  <p className="text-xs text-muted">While walking: aim at it and press Delete to take it off.</p>
                </div>
              );
            })()}
            {panel.kind === "railing" && (() => {
              const t = railingTarget(stageRailings(project.floorPlans, levels, basics, panel.levelId), panel.key);
              if (!t) return <p className="text-sm text-muted">That railing is gone.</p>;
              const edited = !!project.floorPlans[t.stairsLevelId]?.stairs.find((x) => x.id === t.stairsId)?.railings?.some((e) => e.edge === t.edge);
              return (
                <div className="space-y-3" data-testid="walk-railing-panel">
                  <RailingPanel target={t} edited={edited} onChange={(c) => changeRailingAimed(panel.levelId, panel.key, c)} />
                  <p className="text-xs text-muted">While walking: aim at it and press Delete to remove it.</p>
                </div>
              );
            })()}
            {panel.kind === "pin" && (
              <div className="space-y-3" data-testid="walk-pin-panel">
                <p className="text-sm font-medium">Pinned measurement</p>
                {pinsRef.current.some((x) => x.id === panel.id) ? (
                  <button className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700" onClick={() => deletePin(panel.id)} data-testid="pin-delete">
                    Delete
                  </button>
                ) : (
                  <p className="text-sm text-muted">That pin is gone.</p>
                )}
              </div>
            )}
            {panel.kind === "labels" && (
              <LabelSettingsPanel
                settings={labelSettings}
                lockable
                onChange={setLabelSettings}
                onHideAll={() => {
                  setLabelsOn(false);
                }}
              />
            )}
          </div>
        </aside>
      )}

      {win && !locked && <DesignWindow key={win.kind} kind={win.kind} roomId={win.roomId} onWalk={keepWalking} onClose={() => setWin(null)} />}

      {topDown && (
        <TopDown
          here={topDown}
          onBack={() => {
            setTopDown(null);
            unlockedAt.current = performance.now();
          }}
        />
      )}

      {/* Time of day, season, and jumping around. Hidden while walking so the mouse stays in the view. */}
      {!locked && !showPanel && !topDown && !win && (
        <WalkControls
          hour={shownHour}
          sunrise={sunrise}
          sunset={sunset}
          daylightSaving={seasonInfo.daylightSaving}
          season={season}
          world={world}
          doorMode={doorMode}
          onDoorMode={setDoorMode}
          onHour={setHour}
          onSeason={setSeason}
          onJump={jump}
        />
      )}
    </div>
  );
}
