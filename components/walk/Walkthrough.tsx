"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PerspectiveCamera } from "@react-three/drei";
import type { Project } from "@/lib/model/schema";
import { buildHouse, type HouseContext } from "@/lib/house3d/build";
import { levelHeights } from "@/lib/house3d/levels";
import { IN_PER_UNIT, type Frame } from "@/lib/house3d/mesh";
import { lotOffsetFor, planBounds, siteFor } from "@/lib/house3d/site";
import { SEASONS, clockTime, daylight, type SeasonId } from "@/lib/house3d/sun";
import { EYE_IN, walkStep, walkWorld, whereAmI, type Spot, type Walker } from "@/lib/house3d/walk";
import { Ground } from "@/components/house3d/House3DView";
import { HouseMeshes, Sky } from "@/components/house3d/Scene";

const LOOK_PER_PX = 0.0022;

/**
 * Walk through the house in first person, like a video game. Click to start,
 * the mouse looks around, W A S D or the arrow keys walk, Shift to go faster,
 * Esc to stop. Walls stop you, doors let you through, stairs take you up and
 * down, and you can walk out onto the land.
 */
export default function Walkthrough({ project, onClose }: { project: Project; onClose: () => void }) {
  const plans = project.floorPlans;
  const levels = useMemo(() => [...project.levels].sort((a, b) => a.elevationIn - b.elevationIn), [project.levels]);
  const basics = project.plan.basics;
  const offset = useMemo(() => lotOffsetFor(project), [project]);

  const [frame] = useState<Frame>(() => {
    const bb = planBounds(plans);
    return bb ? { ox: (bb.x0 + bb.x1) / 2, oy: (bb.y0 + bb.y1) / 2 } : { ox: 0, oy: 0 };
  });
  const heights = useMemo(() => levelHeights(levels, basics), [levels, basics]);
  const site = useMemo(() => siteFor(project.plot, offset, plans), [project.plot, offset, plans]);
  const ctx: HouseContext = useMemo(() => ({ levels, basics, house3d: project.house3d, site, frame }), [levels, basics, project.house3d, site, frame]);
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

  function jump(spot: Spot, keepYaw = true) {
    walker.current = { ...walker.current, p: spot.p, feet: spot.feet, vz: 0, yaw: keepYaw ? walker.current.yaw : spot.yaw };
    setWhere(whereAmI(world, plans, walker.current));
  }

  // The mouse is captured while walking; Esc gives it back (the browser does that), and Esc again closes.
  useEffect(() => {
    const onChange = () => {
      const on = document.pointerLockElement === canvasRef.current;
      setLocked(on);
      if (!on) unlockedAt.current = performance.now();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.pointerLockElement && performance.now() - unlockedAt.current > 400) onClose();
    };
    document.addEventListener("pointerlockchange", onChange);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerlockchange", onChange);
      window.removeEventListener("keydown", onKey);
      if (document.pointerLockElement) document.exitPointerLock();
    };
  }, [onClose]);

  // Nothing behind the walkthrough scrolls while it's open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const start = () => {
    const c = canvasRef.current;
    if (!c) return;
    const r = c.requestPointerLock() as unknown as Promise<void> | undefined;
    r?.catch?.(() => {});
  };

  const span = useMemo(() => {
    const b = model.bounds;
    return b ? Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2], 30) : 60;
  }, [model.bounds]);

  return (
    <div className="fixed inset-0 z-50 bg-black" data-testid="walkthrough">
      <Canvas
        shadows
        dpr={[1, 1.5]}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        onCreated={({ gl }) => {
          canvasRef.current = gl.domElement;
        }}
      >
        <PerspectiveCamera makeDefault fov={70} near={0.3} far={6000} />
        <Sky day={seasonInfo.day} hour={shownHour} span={span} center={model.bounds ? [(model.bounds.min[0] + model.bounds.max[0]) / 2, 0, (model.bounds.min[2] + model.bounds.max[2]) / 2] : [0, 0, 0]} />
        <Ground site={site} frame={frame} plans={plans} ctx={ctx} heights={heights} />
        <HouseMeshes parts={model.parts} />
        <Player
          walker={walker}
          locked={locked}
          frame={frame}
          step={(w, input, dt) => walkStep(world, w, input, dt)}
          onWhere={(w) => {
            const next = whereAmI(world, plans, w);
            setWhere((cur) => (cur.levelName === next.levelName && cur.roomName === next.roomName ? cur : next));
          }}
        />
      </Canvas>

      {/* Where you are, and the way out. */}
      <div className="pointer-events-none absolute top-0 right-0 left-0 flex items-start justify-between p-4">
        <div className="rounded-lg bg-black/55 px-3 py-2 text-white">
          <p className="text-xs text-white/70">{project.name}</p>
          <p className="text-sm font-medium" data-testid="walk-where">
            {where.roomName}
            {where.roomName !== "Outside" && where.levelName ? <span className="font-normal text-white/70"> · {where.levelName}</span> : null}
          </p>
        </div>
        <button className="pointer-events-auto rounded-md bg-white/90 px-3 py-1.5 text-sm font-medium text-ink shadow hover:bg-white" onClick={onClose}>
          Close walkthrough
        </button>
      </div>

      {locked ? (
        <div className="pointer-events-none absolute top-1/2 left-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/80 ring-1 ring-black/40" />
      ) : (
        <>
          <button className="absolute inset-0 cursor-pointer bg-black/25" onClick={start} aria-label="Start walking" />
          <div className="pointer-events-none absolute top-1/2 left-1/2 w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white/95 p-5 text-center shadow-lg">
            <p className="text-base font-semibold">Click to walk</p>
            <ul className="mt-2 space-y-0.5 text-sm text-muted">
              <li>Move the mouse to look around</li>
              <li>W A S D or the arrow keys to walk</li>
              <li>Hold Shift to walk faster</li>
              <li>Esc to stop, and Esc again to close</li>
            </ul>
          </div>
        </>
      )}

      {/* Time of day, season, and jumping around. Hidden while walking so the mouse stays in the view. */}
      {!locked && (
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

type StepFn = (w: Walker, input: { forward: number; right: number; fast: boolean }, dt: number) => Walker;

/** Moves the camera: mouse look and keys while the mouse is captured, every frame. */
function Player({ walker, locked, frame, step, onWhere }: { walker: React.RefObject<Walker>; locked: boolean; frame: Frame; step: StepFn; onWhere: (w: Walker) => void }) {
  const { camera } = useThree();
  const keys = useRef(new Set<string>());
  const eyeY = useRef<number | null>(null);
  const sinceWhere = useRef(0);

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
  });
  return null;
}
