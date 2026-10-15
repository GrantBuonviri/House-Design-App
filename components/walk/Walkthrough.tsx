"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import type { FloorPlan, FurnitureItem, Point, Project, Selection } from "@/lib/model/schema";
import { newId } from "@/lib/model/project";
import { useProjectStore } from "@/lib/store/projectStore";
import UndoButtons from "@/components/project/UndoButtons";
import GraphicsToggle from "@/components/project/GraphicsToggle";
import type { Estimate } from "@/lib/cost/estimate";
import { shortMoney } from "@/lib/cost/estimate";
import { buildHouse, type HouseContext } from "@/lib/house3d/build";
import { drawFurniture } from "@/lib/house3d/fixtures";
import { levelHeights } from "@/lib/house3d/levels";
import { IN_PER_UNIT, MeshBuilder, type Frame } from "@/lib/house3d/mesh";
import { lotOffsetFor, planBounds, siteFor } from "@/lib/house3d/site";
import { SEASONS, clockTime, daylight, type SeasonId } from "@/lib/house3d/sun";
import { EYE_IN, heading, walkStep, walkWorld, whereAmI, type Spot, type Walker } from "@/lib/house3d/walk";
import { planOf } from "@/lib/plan/edit";
import { add, scale } from "@/lib/plan/geometry";
import { checkPlacement, defaultFurnitureColor, furnitureType, newFurniture, type PlaceCheck } from "@/lib/plan/furniture";
import { effectiveAnswers } from "@/lib/interior/style";
import { aimAt, type Aim } from "@/lib/interior/surfaces";
import { Ground } from "@/components/house3d/House3DView";
import { toGeometry } from "@/components/house3d/geometry";
import { HouseMeshes, Sky, type AimTarget } from "@/components/house3d/Scene";
import { AddFurniturePanel, FinishPanel, FurniturePanel, OutsidePanel } from "./DesignPanel";
import { effectiveExterior } from "@/lib/exterior/style";
import { canvasSettings, useGraphics } from "@/lib/graphics";

const LOOK_PER_PX = 0.0022;

/**
 * Walk through the house in first person, like a video game. Click to start,
 * the mouse looks around, W A S D or the arrow keys walk, Shift to go faster,
 * Esc to stop. Walls stop you, doors let you through, stairs take you up and
 * down, and you can walk out onto the land.
 */
/** What the panel on the right shows: what you clicked, or the list of furniture to add. */
type Panel =
  | { kind: "finish"; aim: Extract<Aim, { kind: "finish" }> }
  | { kind: "outside"; aim: Extract<Aim, { kind: "outside" }> }
  | { kind: "furniture"; levelId: string; id: string }
  | { kind: "add" };

/** Furniture being carried: it follows where you look until you click to put it down. */
type Carry = { item: FurnitureItem; levelId: string; isNew: boolean; check: PlaceCheck };

/** What the dot in the middle of the screen is on, from the 3D view. */
type Look = {
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  hit: { point: THREE.Vector3; normal: THREE.Vector3; owner: AimTarget["owners"][number] } | null;
};

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
    () => ({ levels, basics, house3d: project.house3d, site, frame, interior: project.interior.selections, exterior: project.exterior }),
    [levels, basics, project.house3d, site, frame, project.interior.selections, project.exterior],
  );
  const model = useMemo(() => buildHouse(plans, ctx), [plans, ctx]);
  const world = useMemo(() => walkWorld(plans, { ...ctx, heights }), [plans, ctx, heights]);

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
  const latest = useRef({ aim, carry, panel, design, locked, plans: project.floorPlans });
  latest.current = { aim, carry, panel, design, locked, plans: project.floorPlans };

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
    document.addEventListener("pointerlockchange", onChange);
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("pointerlockchange", onChange);
      window.removeEventListener("keydown", onKey);
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
        <HouseMeshes parts={model.parts} aimRef={aimTarget} />
        {carry && <FurnitureGhost item={carry.item} floorIn={heights[carry.levelId]?.floorIn ?? 0} frame={frame} ok={carry.check.ok} />}
        <Player
          walker={walker}
          locked={locked}
          frame={frame}
          step={(w, input, dt) => walkStep(world, w, input, dt)}
          onWhere={(w) => {
            const next = whereAmI(world, plans, w);
            setWhere((cur) => (cur.levelName === next.levelName && cur.roomName === next.roomName ? cur : next));
          }}
          aimTarget={aimTarget}
          looking={locked && (design || !!carry)}
          fastLook={!!carry}
          onLook={onLook}
        />
      </Canvas>

      {/* Where you are, design mode, undo and the cost, and the way out. */}
      <div className="pointer-events-none absolute top-0 right-0 left-0 z-20 flex items-start justify-between gap-3 p-4">
        <div className="rounded-lg bg-black/55 px-3 py-2 text-white">
          <p className="text-xs text-white/70">{project.name}</p>
          <p className="text-sm font-medium" data-testid="walk-where">
            {where.roomName}
            {where.roomName !== "Outside" && where.levelName ? <span className="font-normal text-white/70"> · {where.levelName}</span> : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {cost && (
            <span className="rounded-md bg-black/55 px-3 py-1.5 text-sm text-white tabular-nums" data-testid="walk-cost" title="The cost estimate, with your picks">
              {cost.source === "rough" ? "Rough cost" : "Cost"} about {shortMoney(cost.total.likely)}
            </span>
          )}
          <button
            className={`pointer-events-auto rounded-md px-3 py-1.5 text-sm font-medium shadow ${design ? "bg-accent text-white" : "bg-white/90 text-ink hover:bg-white"}`}
            onClick={() => {
              setDesign(!design);
              if (design) setCarry(null);
            }}
            aria-pressed={design}
            title="Aim at something and click to change it (E)"
            data-testid="design-toggle"
          >
            Design {design ? "on" : "off"}
          </button>
          {design && !locked && (
            <button className="pointer-events-auto rounded-md bg-white/90 px-3 py-1.5 text-sm text-ink shadow hover:bg-white" onClick={() => setPanel({ kind: "add" })}>
              Add furniture
            </button>
          )}
          {!locked && (
            <>
              <UndoButtons className="pointer-events-auto rounded-md bg-white/90 px-3 py-1.5 text-sm text-ink shadow hover:bg-white disabled:opacity-50" />
              <span className="pointer-events-auto">
                <GraphicsToggle dark />
              </span>
            </>
          )}
          <button className="pointer-events-auto rounded-md bg-white/90 px-3 py-1.5 text-sm font-medium text-ink shadow hover:bg-white" onClick={onClose}>
            Close walkthrough
          </button>
        </div>
      </div>

      {locked ? (
        <>
          <div className={`pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 ring-black/40 ${design ? "size-2.5 bg-accent ring-white/80" : "size-1.5 bg-white/80"}`} />
          {(carry || (design && aimText)) && (
            <div className="pointer-events-none absolute top-1/2 left-1/2 mt-5 -translate-x-1/2 rounded-md bg-black/65 px-3 py-1.5 text-center text-sm text-white" data-testid="aim-label">
              {carry ? (
                <>
                  <span className="font-medium">{furnitureType(carry.item.kind)?.label}</span>
                  <span className={carry.check.ok ? "text-white/80" : "text-red-300"}>
                    {carry.check.ok ? (carry.check.blocksDoors.length ? " · in front of a door" : " · click to put it down") : ` · ${carry.check.problem}`}
                  </span>
                  <span className="block text-xs text-white/60">R to turn · Esc to cancel</span>
                </>
              ) : (
                <>
                  {aimText}
                  {aim?.kind !== "none" && <span className="text-white/60"> · click to change</span>}
                </>
              )}
            </div>
          )}
        </>
      ) : showPanel ? (
        <button className="absolute inset-0 cursor-pointer" onClick={start} aria-label="Keep walking" />
      ) : (
        <>
          <button className="absolute inset-0 cursor-pointer bg-black/25" onClick={start} aria-label="Start walking" />
          <div className="pointer-events-none absolute top-1/2 left-1/2 w-[min(92vw,440px)] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white/95 p-5 text-center shadow-lg">
            <p className="text-base font-semibold">Click to walk</p>
            <ul className="mt-2 space-y-0.5 text-sm text-muted">
              <li>Move the mouse to look around</li>
              <li>W A S D or the arrow keys to walk</li>
              <li>Hold Shift to walk faster</li>
              <li>E turns Design on: aim at a floor, wall, counter, furniture, or outside at the siding, roof, doors and yard, and click to change it</li>
              <li>With Design on, F adds furniture</li>
              <li>Esc to stop, and Esc again to close</li>
            </ul>
          </div>
        </>
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
          </div>
        </aside>
      )}

      {/* Time of day, season, and jumping around. Hidden while walking so the mouse stays in the view. */}
      {!locked && !showPanel && (
        <div className="absolute right-0 bottom-0 left-0 flex flex-wrap items-end gap-x-6 gap-y-3 bg-black/60 px-4 py-3 text-white">
          <label className="min-w-[240px] flex-1 text-sm">
            <span className="flex justify-between text-xs text-white/75">
              <span>Time of day</span>
              <span data-testid="walk-time">{clockTime(shownHour, seasonInfo.daylightSaving)}</span>
            </span>
            <input
              type="range"
              className="mt-1 w-full accent-white"
              min={sunrise}
              max={sunset}
              step={0.25}
              value={shownHour}
              onChange={(e) => setHour(Number(e.target.value))}
              aria-label="Time of day"
            />
            <span className="flex justify-between text-[11px] text-white/60">
              <span>Sunrise {clockTime(sunrise, seasonInfo.daylightSaving)}</span>
              <span>Sunset {clockTime(sunset, seasonInfo.daylightSaving)}</span>
            </span>
          </label>
          <div className="text-sm">
            <span className="block text-xs text-white/75">Season</span>
            <div className="mt-1 flex overflow-hidden rounded-md border border-white/30" role="radiogroup" aria-label="Season">
              {SEASONS.map((s) => (
                <button
                  key={s.id}
                  role="radio"
                  aria-checked={season === s.id}
                  onClick={() => setSeason(s.id)}
                  className={`px-3 py-1 text-sm ${season === s.id ? "bg-white text-ink" : "hover:bg-white/15"}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <label className="text-sm">
            <span className="block text-xs text-white/75">Go to</span>
            <select
              className="mt-1 rounded-md border border-white/30 bg-black/40 px-2 py-1 text-sm"
              value=""
              onChange={(e) => {
                const v = e.target.value;
                if (v === "front") jump(world.start, false);
                else {
                  const r = world.rooms.find((x) => `${x.levelId}:${x.id}` === v);
                  if (r) jump(r.spot);
                }
              }}
            >
              <option value="" disabled>
                Pick a room…
              </option>
              <option value="front">The front door (outside)</option>
              {world.levels.map((l) => (
                <optgroup key={l.id} label={l.name}>
                  {world.rooms
                    .filter((r) => r.levelId === l.id)
                    .map((r) => (
                      <option key={r.id} value={`${r.levelId}:${r.id}`}>
                        {r.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}

/** A piece of furniture being carried, drawn on its own (and see-through), tinted red where it doesn't fit. */
function FurnitureGhost({ item, floorIn, frame, ok }: { item: FurnitureItem; floorIn: number; frame: Frame; ok: boolean }) {
  const geometry = useMemo(() => {
    const mb = new MeshBuilder();
    drawFurniture(mb, frame, item, floorIn + 0.3);
    return toGeometry(mb.build());
  }, [item, floorIn, frame]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.75, roughness: 0.9 }), []);
  useEffect(() => {
    material.color.set(ok ? "#ffffff" : "#ff6b6b");
  }, [material, ok]);
  useEffect(() => () => material.dispose(), [material]);
  return <mesh geometry={geometry} material={material} />;
}

type StepFn = (w: Walker, input: { forward: number; right: number; fast: boolean }, dt: number) => Walker;

const CENTER = new THREE.Vector2(0, 0);

/** Moves the camera: mouse look and keys while the mouse is captured, every frame. With `looking`, also reports what the dot in the middle is on. */
function Player({
  walker,
  locked,
  frame,
  step,
  onWhere,
  aimTarget,
  looking,
  fastLook,
  onLook,
}: {
  walker: React.RefObject<Walker>;
  locked: boolean;
  frame: Frame;
  step: StepFn;
  onWhere: (w: Walker) => void;
  aimTarget: React.RefObject<AimTarget | null>;
  looking: boolean;
  fastLook: boolean;
  onLook: (look: Look) => void;
}) {
  const { camera } = useThree();
  const keys = useRef(new Set<string>());
  const eyeY = useRef<number | null>(null);
  const sinceWhere = useRef(0);
  const sinceLook = useRef(0);
  const ray = useMemo(() => {
    const r = new THREE.Raycaster();
    r.far = 60;
    return r;
  }, []);

  useEffect(() => {
    camera.rotation.order = "YXZ";
  }, [camera]);

  useEffect(() => {
    if (!locked) {
      keys.current.clear();
      return;
    }
    const down = (e: KeyboardEvent) => {
      keys.current.add(e.code);
      if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.code);
    const move = (e: MouseEvent) => {
      // Some browsers send one huge jump right after the mouse is captured; skip it.
      if (Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250) return;
      const w = walker.current;
      w.yaw += e.movementX * LOOK_PER_PX;
      w.pitch = Math.max(-1.45, Math.min(1.45, w.pitch - e.movementY * LOOK_PER_PX));
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("mousemove", move);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("mousemove", move);
    };
  }, [locked, walker]);

  useFrame((_, dt) => {
    const k = keys.current;
    const has = (...codes: string[]) => codes.some((c) => k.has(c));
    const forward = (has("KeyW", "ArrowUp") ? 1 : 0) - (has("KeyS", "ArrowDown") ? 1 : 0);
    const right = (has("KeyD", "ArrowRight") ? 1 : 0) - (has("KeyA", "ArrowLeft") ? 1 : 0);
    let w = walker.current;
    if (forward || right || w.vz !== 0) {
      // Small steps, so a slow frame doesn't skip through a wall.
      const input = { forward, right, fast: has("ShiftLeft", "ShiftRight") };
      for (let left = Math.min(dt, 0.25); left > 1e-4; left -= 0.05) w = step(w, input, Math.min(left, 0.05));
      walker.current = w;
    }
    // Ease the eye up and down over steps, so stairs feel smooth.
    const target = (w.feet + EYE_IN) / IN_PER_UNIT;
    eyeY.current = eyeY.current === null || Math.abs(eyeY.current - target) > 6 ? target : eyeY.current + (target - eyeY.current) * (1 - Math.exp(-dt * 14));
    camera.position.set((w.p.x - frame.ox) / IN_PER_UNIT, eyeY.current, (w.p.y - frame.oy) / IN_PER_UNIT);
    camera.rotation.set(w.pitch, -w.yaw, 0);
    sinceWhere.current += dt;
    if (sinceWhere.current > 0.2) {
      sinceWhere.current = 0;
      onWhere(w);
    }
    // What the dot is on, a few times a second (more often while carrying furniture, so it follows smoothly).
    sinceLook.current += dt;
    if (looking && sinceLook.current > (fastLook ? 0.04 : 0.1)) {
      sinceLook.current = 0;
      camera.updateMatrixWorld();
      ray.setFromCamera(CENTER, camera);
      const t = aimTarget.current;
      const h = t ? ray.intersectObject(t.mesh, false)[0] : undefined;
      const owner = h && h.faceIndex != null ? t!.owners[h.faceIndex] : undefined;
      // The side you're looking at, whichever way the triangle happens to be wound.
      const normal = h?.face ? h.face.normal.clone() : undefined;
      if (normal && normal.dot(ray.ray.direction) > 0) normal.negate();
      onLook({
        origin: ray.ray.origin.clone(),
        dir: ray.ray.direction.clone(),
        hit: h && normal && owner ? { point: h.point.clone(), normal, owner } : null,
      });
    }
  });
  return null;
}
