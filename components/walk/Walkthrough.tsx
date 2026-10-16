"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import type { FloorPlan, FurnitureItem, Point, Project, Selection } from "@/lib/model/schema";
import { newId } from "@/lib/model/project";
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
import { add, scale } from "@/lib/plan/geometry";
import { checkPlacement, defaultFurnitureColor, furnitureType, newFurniture, type PlaceCheck } from "@/lib/plan/furniture";
import { effectiveAnswers } from "@/lib/interior/style";
import { aimAt, type Aim } from "@/lib/interior/surfaces";
import { Ground } from "@/components/house3d/House3DView";
import { HouseMeshes, Sky, type AimTarget } from "@/components/house3d/Scene";
import { AddFurniturePanel, FinishPanel, FurniturePanel, OutsidePanel } from "./DesignPanel";
import { FurnitureGhost, Player, type Look } from "./Player";
import { AimDot, WalkControls, WalkHelp, WalkTopBar } from "./WalkOverlays";
import { FloorLabels } from "./FloorLabels";
import LabelSettingsPanel from "./LabelSettingsPanel";
import { TapeMeasure } from "./TapeMeasure";
import { lockAxis, snap, tapeCandidates, TAPE_KEEP, type Tape, type TapePoint } from "@/lib/house3d/tape";
import type { WalkLabels } from "@/lib/model/schema";
import { effectiveExterior } from "@/lib/exterior/style";
import { canvasSettings, useGraphics } from "@/lib/graphics";
import { useFrame } from "@react-three/fiber";

/** Moves the doors every frame: opens the ones you walk into, shuts the ones you left, and keeps the world's blockers in step. */
function DoorDriver({ world, walker, states, modeRef }: { world: ReturnType<typeof walkWorld>; walker: React.RefObject<Walker>; states: React.MutableRefObject<DoorStates>; modeRef: React.RefObject<DoorMode> }) {
  useFrame((_, dt) => {
    const w = walker.current;
    states.current = stepDoors(states.current, world.doors, { p: w.p, feet: w.feet }, Math.min(dt, 0.1), modeRef.current);
    for (const d of world.doors) world.doorAmount[d.id] = states.current[d.id].amount;
  });
  return null;
}

/** What the panel on the right shows: what you clicked, or the list of furniture to add. */
type Panel =
  | { kind: "finish"; aim: Extract<Aim, { kind: "finish" }> }
  | { kind: "outside"; aim: Extract<Aim, { kind: "outside" }> }
  | { kind: "furniture"; levelId: string; id: string }
  | { kind: "add" }
  | { kind: "labels" };

/** Furniture being carried: it follows where you look until you click to put it down. */
type Carry = { item: FurnitureItem; levelId: string; isNew: boolean; check: PlaceCheck };

const withFurniture = (plan: FloorPlan, change: (f: FurnitureItem[]) => FurnitureItem[]): FloorPlan => ({ ...plan, furniture: change(plan.furniture) });
const turnBy = (deg: number, by: number) => (((Math.round(deg + by) % 360) + 360) % 360);

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
export default function Walkthrough({ project, cost, onClose }: { project: Project; cost?: Estimate | null; onClose: () => void }) {
  const quality = useGraphics((g) => g.quality);
  const update = useProjectStore((s) => s.update);

  const levels = useMemo(() => [...project.levels].sort((a, b) => a.elevationIn - b.elevationIn), [project.levels]);
  const basics = project.plan.basics;
  const offset = useMemo(() => lotOffsetFor(project), [project]);
  const answers = useMemo(() => effectiveAnswers(project.interior.answers, project.discovery.answers.feel ?? ""), [project.interior.answers, project.discovery.answers.feel]);

  const [design, setDesign] = useState(false);
  // Floor labels (L) and the tape measure (T). Measurements aren't saved.
  const [labelsOn, setLabelsOn] = useState(false);
  const [tapeOn, setTapeOn] = useState(false);
  const [tape, setTape] = useState<{ done: Tape[]; first: TapePoint | null; hover: TapePoint | null }>({ done: [], first: null, hover: null });
  const shiftDown = useRef(false);
  const labelSettings = project.house3d.walkLabels;
  const setLabelSettings = (next: WalkLabels) => update((p) => ({ ...p, house3d: { ...p.house3d, walkLabels: next } }));
  // Doors: the Doors picker (not saved; each walkthrough starts on Normal), how open each is, and the door under the dot.
  const [doorMode, setDoorMode] = useState<DoorMode>("normal");
  const doorStates = useRef<DoorStates>({});
  const doorModeRef = useRef<DoorMode>("normal");
  doorModeRef.current = doorMode;
  const doorsGroup = useRef<THREE.Group | null>(null);
  const [doorHint, setDoorHint] = useState<string | null>(null);
  const [aim, setAim] = useState<Aim | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [carry, setCarry] = useState<Carry | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = useCallback((text: string | null) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    if (text) toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  // A piece being moved is left out of the house until it's put down (it's drawn on its own meanwhile).
  const plans = useMemo(() => {
    if (!carry || carry.isNew) return project.floorPlans;
    const pl = planOf(project.floorPlans, carry.levelId);
    return { ...project.floorPlans, [carry.levelId]: withFurniture(pl, (f) => f.filter((x) => x.id !== carry.item.id)) };
  }, [project.floorPlans, carry]);

  const [frame] = useState<Frame>(() => {
    const bb = planBounds(project.floorPlans);
    return bb ? { ox: (bb.x0 + bb.x1) / 2, oy: (bb.y0 + bb.y1) / 2 } : { ox: 0, oy: 0 };
  });
  const heights = useMemo(() => levelHeights(levels, basics), [levels, basics]);
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
  const { sunrise, sunset } = daylight(seasonInfo.day);
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
  const latest = useRef({ aim, carry, panel, design, locked, plans: project.floorPlans, tapeOn, tape, snapPoints });
  latest.current = { aim, carry, panel, design, locked, plans: project.floorPlans, tapeOn, tape, snapPoints };

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

  /** Pick up a piece (or a new one) and carry it, with the mouse captured so it follows where you look. */
  const pickUp = (item: FurnitureItem, levelId: string, isNew: boolean) => {
    const pl = planOf(project.floorPlans, levelId);
    setCarry({ item, levelId, isNew, check: checkPlacement(withFurniture(pl, (f) => f.filter((x) => x.id !== item.id)), item) });
    setPanel(null);
    say(null);
    start();
  };

  const addFurniture = (kind: string) => {
    const levelId = levelHere();
    if (!levelId) return;
    const w = walker.current;
    // A few feet in front of you, facing you.
    const at = add(w.p, scale(heading(w.yaw), 60 + (furnitureType(kind)?.depthIn ?? 30) / 2));
    const item = newFurniture(kind, at, (w.yaw * 180) / Math.PI, defaultFurnitureColor(kind, answers), newId());
    pickUp(item, levelId, true);
  };

  /** Put down what you're carrying, if it fits there. */
  const putDown = () => {
    const c = latest.current.carry;
    if (!c) return;
    if (!c.check.ok) {
      say(c.check.problem ?? "It doesn't fit there.");
      return;
    }
    const item = { ...c.item, roomId: c.check.roomId };
    setPlan(c.levelId, (pl) => withFurniture(pl, (f) => (c.isNew ? [...f, item] : f.map((x) => (x.id === item.id ? item : x)))));
    setCarry(null);
    say(c.check.blocksDoors.length ? `${furnitureType(item.kind)?.label ?? "It"} is in front of a door. You can move it with Design on.` : null);
  };

  const turnFurniture = (levelId: string, id: string, by: number) => {
    const pl = planOf(project.floorPlans, levelId);
    const item = pl.furniture.find((x) => x.id === id);
    if (!item) return;
    const next = { ...item, rotation: turnBy(item.rotation, by) };
    const check = checkPlacement(withFurniture(pl, (f) => f.filter((x) => x.id !== id)), next);
    if (!check.ok) {
      say(`It can't turn there: ${check.problem?.toLowerCase() ?? "it doesn't fit."}`);
      return;
    }
    setPlan(levelId, (p) => withFurniture(p, (f) => f.map((x) => (x.id === id ? next : x))));
    if (check.blocksDoors.length) say("Turned. It's in front of a door now.");
  };
  const removeFurniture = (levelId: string, id: string) => {
    setPlan(levelId, (p) => withFurniture(p, (f) => f.filter((x) => x.id !== id)));
    setPanel(null);
    say("Removed. Undo brings it back.");
  };

  /** What the dot is on, worked out from the 3D view a few times a second. */
  const onLook = useCallback(
    (look: Look) => {
      const toPlan = (v: THREE.Vector3): Point => ({ x: v.x * IN_PER_UNIT + frame.ox, y: v.z * IN_PER_UNIT + frame.oy });
      const c = latest.current.carry;
      if (c) {
        // Carrying: the spot on the floor you're looking at.
        const floorIn = heights[c.levelId]?.floorIn ?? 0;
        const y = floorIn / IN_PER_UNIT;
        const t = look.dir.y < -0.03 ? (y - look.origin.y) / look.dir.y : Infinity;
        // Looking level (or far off): a few feet ahead of you instead, short of the wall you're looking at.
        const flatDir = new THREE.Vector3(look.dir.x, 0, look.dir.z).normalize();
        const reach = Math.max(c.item.widthIn, c.item.depthIn) / 2 / IN_PER_UNIT + 0.5;
        const wallAt = look.hit ? Math.hypot(look.hit.point.x - look.origin.x, look.hit.point.z - look.origin.z) : Infinity;
        const ahead = Math.max(2, Math.min(6, wallAt - reach));
        const spot = t > 0 && t < 25 ? toPlan(look.origin.clone().addScaledVector(look.dir, t)) : toPlan(look.origin.clone().addScaledVector(flatDir, ahead));
        const item = { ...c.item, x: Math.round(spot.x), y: Math.round(spot.y) };
        if (Math.abs(item.x - c.item.x) < 1 && Math.abs(item.y - c.item.y) < 1) return;
        const pl = planOf(latest.current.plans, c.levelId);
        setCarry({ ...c, item, check: checkPlacement(withFurniture(pl, (f) => f.filter((x) => x.id !== item.id)), item) });
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
        );
      }
      setAim((cur) => (JSON.stringify(cur) === JSON.stringify(next) ? cur : next));
    },
    [frame, heights, levels, basics],
  );

  // The mouse is captured while walking; Esc gives it back (the browser does that), and Esc again closes
  // (or closes the panel first, when one is open).
  useEffect(() => {
    const onChange = () => {
      const on = document.pointerLockElement === canvasRef.current;
      setLocked(on);
      if (!on) {
        unlockedAt.current = performance.now();
        setAim(null);
        // Letting go of the mouse also cancels a measurement in progress.
        setTape((t) => (t.first || t.hover ? { ...t, first: null, hover: null } : t));
        // Letting go of the mouse while carrying puts the piece back where it was.
        if (latest.current.carry) {
          setCarry(null);
          say(latest.current.carry.isNew ? null : "Put back where it was.");
        }
      }
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select")) return;
      if (e.key === "Shift") shiftDown.current = true;
      if (e.key === "Escape" && !document.pointerLockElement) {
        if (latest.current.panel) setPanel(null);
        else if (performance.now() - unlockedAt.current > 400) onClose();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const { aim: a, carry: c, locked: on, design: d } = latest.current;
      if (e.code === "KeyE") {
        setDesign(!d);
        if (d) setCarry(null);
        else setTapeOn(false);
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
        if (next) setDesign(false);
        setTape((t) => ({ ...t, first: null, hover: null }));
        return;
      }
      if (e.code === "KeyC" && latest.current.tapeOn) {
        setTape({ done: [], first: null, hover: null });
        return;
      }
      if (!on || !d) return;
      if (e.code === "KeyR") {
        const by = e.shiftKey ? -15 : 15;
        if (c) {
          const item = { ...c.item, rotation: turnBy(c.item.rotation, by) };
          const pl = planOf(latest.current.plans, c.levelId);
          setCarry({ ...c, item, check: checkPlacement(withFurniture(pl, (f) => f.filter((x) => x.id !== item.id)), item) });
        } else if (a?.kind === "furniture") turnFurniture(a.levelId, a.id, by);
      } else if ((e.code === "Delete" || e.code === "Backspace") && a?.kind === "furniture" && !c) {
        removeFurniture(a.levelId, a.id);
      } else if (e.code === "KeyF" && !c) {
        setPanel({ kind: "add" });
        stopWalking();
      }
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
      if (!d && clickDoor()) return;
      if (!d || !a) return;
      if (a.kind === "finish") {
        setPanel({ kind: "finish", aim: a });
        stopWalking();
      } else if (a.kind === "outside") {
        setPanel({ kind: "outside", aim: a });
        stopWalking();
      } else if (a.kind === "furniture") {
        setPanel({ kind: "furniture", levelId: a.levelId, id: a.id });
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
    return () => {
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

  const openFurniture = panel?.kind === "furniture" ? planOf(project.floorPlans, panel.levelId).furniture.find((x) => x.id === panel.id) : undefined;
  const furnitureWarning = useMemo(() => {
    if (!openFurniture || panel?.kind !== "furniture") return undefined;
    const pl = planOf(project.floorPlans, panel.levelId);
    const check = checkPlacement(withFurniture(pl, (f) => f.filter((x) => x.id !== openFurniture.id)), openFurniture);
    return check.blocksDoors.length ? "It's in front of a door." : undefined;
  }, [openFurniture, panel, project.floorPlans]);
  const showPanel = panel && !locked && (panel.kind !== "furniture" || openFurniture);
  const aimText = aim && aim.kind !== "none" ? aim.label : aim?.label;

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
        <Sky day={seasonInfo.day} hour={shownHour} span={span} version={model} center={model.bounds ? [(model.bounds.min[0] + model.bounds.max[0]) / 2, 0, (model.bounds.min[2] + model.bounds.max[2]) / 2] : [0, 0, 0]} />
        <Ground site={site} frame={frame} plans={plans} ctx={ctx} heights={heights} yard={false} />
        <HouseMeshes parts={model.parts} aimRef={aimTarget} doorsApart />
        <DoorLeaves parts={doorParts} frame={frame} amountOf={(id) => world.doorAmount[id] ?? 0} groupRef={doorsGroup} />
        <DoorDriver world={world} walker={walker} states={doorStates} modeRef={doorModeRef} />
        {labelsOn && <FloorLabels project={project} settings={labelSettings} frame={frame} heights={heights} walker={walker} costTotal={cost?.total.likely} />}
        <TapeMeasure done={tape.done} first={tape.first} hover={tapeOn ? tape.hover : null} frame={frame} units={labelSettings.units} />
        {carry && <FurnitureGhost item={carry.item} floorIn={heights[carry.levelId]?.floorIn ?? 0} frame={frame} ok={carry.check.ok} />}
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
        locked={locked}
        onDesign={() => {
          setDesign(!design);
          if (design) setCarry(null);
          else setTapeOn(false);
        }}
        labelsOn={labelsOn}
        tapeOn={tapeOn}
        onLabels={() => setLabelsOn(!labelsOn)}
        onLabelSettings={() => setPanel({ kind: "labels" })}
        onTape={() => {
          setTapeOn(!tapeOn);
          if (!tapeOn) setDesign(false);
          setTape((t) => ({ ...t, first: null, hover: null }));
        }}
        onClearTape={() => setTape({ done: [], first: null, hover: null })}
        hasTape={tape.done.length > 0}
        onAddFurniture={() => setPanel({ kind: "add" })}
        onClose={onClose}
      />

      {locked ? (
        <AimDot design={design} aimText={aimText} aimable={aim?.kind !== "none"} carry={carry} />
      ) : showPanel ? (
        <button className="absolute inset-0 cursor-pointer" onClick={start} aria-label="Keep walking" />
      ) : (
        <WalkHelp onStart={start} />
      )}

      {locked && doorHint && !design && !tapeOn && !carry && (
        <div className="pointer-events-none absolute top-1/2 left-1/2 mt-5 -translate-x-1/2 rounded-md bg-black/65 px-3 py-1.5 text-center text-sm text-white" data-testid="door-hint">
          {doorHint}
        </div>
      )}

      {locked && tapeOn && (
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
        <aside className="absolute top-16 right-4 bottom-4 z-10 flex w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl bg-white shadow-xl">
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
            <button className="btn-primary px-3 py-1 text-sm" onClick={start}>
              Keep walking
            </button>
            <button className="text-sm text-muted hover:text-ink" onClick={() => setPanel(null)} aria-label="Close panel">
              Close ✕
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {panel.kind === "finish" && <FinishPanel key={panel.aim.label} aim={panel.aim} selections={project.interior.selections} answers={answers} onChange={setSelections} />}
            {panel.kind === "outside" && <OutsidePanel key={panel.aim.label} aim={panel.aim} selections={project.exterior.selections} answers={outsideAnswers} onChange={setOutside} />}
            {panel.kind === "furniture" && openFurniture && (
              <FurniturePanel
                item={openFurniture}
                warning={furnitureWarning}
                onColor={(color) => setPlan(panel.levelId, (p) => withFurniture(p, (f) => f.map((x) => (x.id === openFurniture.id ? { ...x, color } : x))))}
                onMove={() => pickUp(openFurniture, panel.levelId, false)}
                onTurn={(by) => turnFurniture(panel.levelId, openFurniture.id, by)}
                onRemove={() => removeFurniture(panel.levelId, openFurniture.id)}
              />
            )}
            {panel.kind === "add" && <AddFurniturePanel onPick={addFurniture} />}
            {panel.kind === "labels" && (
              <LabelSettingsPanel
                settings={labelSettings}
                onChange={setLabelSettings}
                onHideAll={() => {
                  setLabelsOn(false);
                }}
              />
            )}
          </div>
        </aside>
      )}

      {/* Time of day, season, and jumping around. Hidden while walking so the mouse stays in the view. */}
      {!locked && !showPanel && (
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
