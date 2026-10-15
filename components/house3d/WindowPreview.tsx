"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { House3D, Level, PlanBasics, Plot, Point, Selection } from "@/lib/model/schema";
import { buildLevel, buildRoofs, houseBounds, type HouseContext, type Part } from "@/lib/house3d/build";
import { levelHeights } from "@/lib/house3d/levels";
import { IN_PER_UNIT, toScene, type Frame } from "@/lib/house3d/mesh";
import { planBounds, siteFor } from "@/lib/house3d/site";
import { SEASONS, clockTime, daylight, type SeasonId } from "@/lib/house3d/sun";
import { blockersOf, sunNote, sunThroughWindow } from "@/lib/house3d/sunHours";
import { windowViews, type Shot, type WindowViews } from "@/lib/house3d/windowView";
import type { Plans } from "@/lib/plan/edit";
import { Ground } from "./House3DView";
import { HouseMeshes, Sky } from "./Scene";

type Props = {
  plans: Plans;
  /** Lowest first. */
  levels: Level[];
  basics: PlanBasics | null;
  house3d: House3D;
  /** Interior picks, for finishes. */
  interior?: Selection[];
  exterior?: HouseContext["exterior"];
  plot: Plot | null;
  offset: Point;
  levelId: string;
  openingId: string;
  onClose: () => void;
};

/** How far the pictures can be turned by dragging, in radians. */
const MAX_YAW = 0.6;
const MAX_PITCH = 0.35;
const LOOK_PER_PX = 0.004;
/** One sunrise-to-sunset loop takes this long when playing. */
const LOOP_SECONDS = 12;
const PICTURE_HEIGHT = 250;

/** Where the popup was last dragged to, so it opens there again. */
let lastPos: { x: number; y: number } | null = null;

type Look = { yaw: number; pitch: number };
type Looks = { inside: Look; outside: Look };
const STILL: Looks = { inside: { yaw: 0, pitch: 0 }, outside: { yaw: 0, pitch: 0 } };

/**
 * The Preview window popup: what you'd see standing in the room looking out
 * through a window, and the window from outside on its wall, side by side.
 * The sun can be set to any time of day and season, or played across the
 * day on a loop. It follows the window as it's moved or resized.
 */
export default function WindowPreview(props: Props) {
  const { plans, levels, basics, house3d, interior, exterior, plot, offset, levelId, openingId, onClose } = props;

  // The scene is centered on the house as it was when the preview opened.
  const [frame] = useState<Frame>(() => {
    const bb = planBounds(plans);
    return bb ? { ox: (bb.x0 + bb.x1) / 2, oy: (bb.y0 + bb.y1) / 2 } : { ox: 0, oy: 0 };
  });

  // Moving a window doesn't change the rooms, so the ground, roof and the house's place on the land stay as they are.
  const shapeKey = JSON.stringify(levels.map((l) => (plans[l.id]?.rooms ?? []).map((r) => [r.id, r.type, r.polygon])));
  const shapePlans = useMemo(() => plans, [shapeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const heights = useMemo(() => levelHeights(levels, basics), [levels, basics]);
  const site = useMemo(() => siteFor(plot, offset, shapePlans), [plot, offset, shapePlans]);
  const ctx = useMemo(() => ({ levels, basics, house3d, site, frame, heights, interior, exterior }), [levels, basics, house3d, site, frame, heights, interior, exterior]);

  // Each floor is rebuilt only when it (or a floor next to it) changes.
  const cache = useRef(new Map<string, { key: unknown[]; parts: Part[] }>());
  const levelParts = useMemo(
    () =>
      levels.map((l, i) => {
        const key = [ctx, plans[l.id], plans[levels[i - 1]?.id], plans[levels[i + 1]?.id]];
        const hit = cache.current.get(l.id);
        if (hit && hit.key.every((k, j) => k === key[j])) return hit.parts;
        const parts = buildLevel(plans, l, ctx);
        cache.current.set(l.id, { key, parts });
        return parts;
      }),
    [levels, plans, ctx],
  );
  const roofs = useMemo(() => buildRoofs(shapePlans, ctx), [shapePlans, ctx]);
  const allParts = useMemo(() => [...levelParts.flat(), ...roofs.parts], [levelParts, roofs]);

  const bounds = useMemo(() => houseBounds(shapePlans, ctx, roofs.topIn), [shapePlans, ctx, roofs.topIn]);
  const span = bounds ? Math.max(bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2], 30) : 60;
  const centerKey = bounds ? `${(bounds.min[0] + bounds.max[0]) / 2},${(bounds.min[2] + bounds.max[2]) / 2}` : "0,0";
  const lightCenter = useMemo<[number, number, number]>(() => {
    const [x, z] = centerKey.split(",").map(Number);
    return [x, 0, z];
  }, [centerKey]);

  const views = useMemo(() => windowViews(plans, ctx, levelId, openingId), [plans, ctx, levelId, openingId]);

  // ---- Time of day ----
  const [season, setSeason] = useState<SeasonId>("summer");
  const seasonInfo = SEASONS.find((s) => s.id === season)!;
  const { sunrise, sunset } = daylight(seasonInfo.day);
  const [hour, setHour] = useState(14);
  const shownHour = Math.min(sunset, Math.max(sunrise, hour));
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      setHour((h) => {
        const from = Math.min(sunset, Math.max(sunrise, h));
        const next = from + (dt * (sunset - sunrise)) / LOOP_SECONDS;
        return next > sunset ? sunrise : next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, sunrise, sunset]);

  // ---- When the sun comes in (worked out once things stop moving) ----
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (!views) return;
    const t = setTimeout(() => setNote(sunNote(sunThroughWindow(views, blockersOf(allParts), site, frame))), 250);
    return () => clearTimeout(t);
  }, [views, allParts, site, frame]);

  // ---- Dragging the pictures to look around ----
  const looks = useRef<Looks>(structuredClone(STILL));
  const invalidate = useRef<() => void>(() => {});
  const drag = useRef<{ which: keyof Looks; x: number; y: number } | null>(null);
  const startDrag = (which: keyof Looks) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { which, x: e.clientX, y: e.clientY };
  };
  const onDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const look = looks.current[d.which];
    // Inside you turn your head; outside you walk around the window a little.
    const sign = d.which === "inside" ? 1 : -1;
    look.yaw = Math.max(-MAX_YAW, Math.min(MAX_YAW, look.yaw + sign * (e.clientX - d.x) * LOOK_PER_PX));
    look.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, look.pitch + sign * (e.clientY - d.y) * LOOK_PER_PX));
    d.x = e.clientX;
    d.y = e.clientY;
    invalidate.current();
  };
  const endDrag = () => {
    drag.current = null;
  };
  const reset = (which: keyof Looks) => () => {
    looks.current[which] = { yaw: 0, pitch: 0 };
    invalidate.current();
  };

  // ---- Moving the popup by its title bar ----
  const [pos, setPosState] = useState<{ x: number; y: number } | null>(lastPos);
  const setPos = (p: { x: number; y: number }) => {
    lastPos = p;
    setPosState(p);
  };
  const [folded, setFolded] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const move = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const what = views ? (views.opening.kind === "window" ? "Window" : "Sliding door") : "Window";
  const where = views ? [views.roomName, `faces ${views.facing}`].filter(Boolean).join(" · ") : "";

  return (
    <div
      ref={boxRef}
      role="dialog"
      aria-label="Preview window"
      data-testid="window-preview"
      className="fixed z-40 w-[min(860px,calc(100vw-32px))] overflow-hidden rounded-xl border border-line bg-white shadow-2xl"
      style={pos ? { left: pos.x, top: pos.y } : { left: 16, top: 16 }}
    >
      <div
        className="flex cursor-move items-center justify-between gap-3 border-b border-line bg-stone-50 px-4 py-2 select-none"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          const r = boxRef.current!.getBoundingClientRect();
          move.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const m = move.current;
          if (!m) return;
          const r = boxRef.current!.getBoundingClientRect();
          setPos({
            x: Math.max(0, Math.min(window.innerWidth - r.width, e.clientX - m.dx)),
            y: Math.max(0, Math.min(window.innerHeight - 40, e.clientY - m.dy)),
          });
        }}
        onPointerUp={() => {
          move.current = null;
        }}
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold">Preview window</p>
          <p className="truncate text-xs text-muted">
            {what}
            {where ? ` · ${where}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className="mr-2 hidden text-xs text-muted lg:inline">Drag this bar to move it</span>
          <button className="rounded-md px-2 py-1 text-xs font-medium text-muted hover:bg-stone-200 hover:text-ink" onClick={() => setFolded((f) => !f)} aria-expanded={!folded}>
            {folded ? "Show" : "Hide"}
          </button>
          <button className="rounded-md px-2 py-1 text-sm text-muted hover:bg-stone-200 hover:text-ink" onClick={onClose} aria-label="Close preview">
            ✕
          </button>
        </div>
      </div>

      {folded ? null : views ? (
        <>
          <div className="relative bg-stone-200" style={{ height: PICTURE_HEIGHT }}>
            <Canvas
              shadows
              frameloop="demand"
              dpr={[1, 1.5]}
              gl={{ antialias: true, preserveDrawingBuffer: true }}
              onCreated={(state) => {
                invalidate.current = () => state.invalidate();
              }}
            >
              <Sky day={seasonInfo.day} hour={shownHour} span={span} center={lightCenter} version={allParts} shadowSize={2048} showSun />
              <Ground site={site} frame={frame} plans={shapePlans} ctx={ctx} heights={heights} />
              {levelParts.map((parts, i) => (
                <HouseMeshes key={levels[i].id} parts={parts} />
              ))}
              <HouseMeshes parts={roofs.parts} />
              <WindowMarker views={views} frame={frame} />
              <TwoPictures inside={views.inside} outside={views.outside} looks={looks} />
            </Canvas>
            {/* Drag areas over each half, the labels, and the line between them. */}
            {(["inside", "outside"] as const).map((which) => (
              <div
                key={which}
                className={`absolute top-0 bottom-0 cursor-grab active:cursor-grabbing ${which === "inside" ? "left-0" : "right-0"}`}
                style={{ width: "50%" }}
                onPointerDown={startDrag(which)}
                onPointerMove={onDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onDoubleClick={reset(which)}
                title="Drag to look around. Double-click to look straight at the window again."
                data-testid={`preview-${which}`}
              >
                <span className="pointer-events-none absolute top-2 left-2 rounded bg-black/55 px-2 py-0.5 text-xs font-medium text-white">
                  {which === "inside" ? "From inside" : "From outside"}
                </span>
              </div>
            ))}
            <div className="pointer-events-none absolute top-0 bottom-0 left-1/2 w-1 -translate-x-1/2 bg-white" />
          </div>

          <div className="flex flex-wrap items-end gap-x-5 gap-y-3 px-4 pt-3">
            <button
              className={`w-24 rounded-md px-3 py-1.5 text-sm font-semibold shadow-sm ${playing ? "bg-ink text-white hover:bg-stone-700" : "bg-accent text-white hover:opacity-90"}`}
              onClick={() => setPlaying((p) => !p)}
              aria-pressed={playing}
              title="Move the sun from sunrise to sunset, over and over"
            >
              {playing ? "❚❚ Pause" : "▶ Play"}
            </button>
            <label className="min-w-[220px] flex-1 text-sm">
              <span className="flex justify-between text-xs text-muted">
                <span>Time of day</span>
                <span className="font-medium text-ink" data-testid="preview-time">
                  {clockTime(shownHour, seasonInfo.daylightSaving)}
                </span>
              </span>
              <input
                type="range"
                className="mt-1 w-full accent-[var(--color-accent)]"
                min={sunrise}
                max={sunset}
                step={0.25}
                value={shownHour}
                onChange={(e) => {
                  setPlaying(false);
                  setHour(Number(e.target.value));
                }}
                aria-label="Time of day"
              />
              <span className="flex justify-between text-[11px] text-muted">
                <span>Sunrise {clockTime(sunrise, seasonInfo.daylightSaving)}</span>
                <span>Sunset {clockTime(sunset, seasonInfo.daylightSaving)}</span>
              </span>
            </label>
            <div className="text-sm">
              <span className="block text-xs text-muted">Season</span>
              <div className="mt-1 flex overflow-hidden rounded-md border border-line" role="radiogroup" aria-label="Season">
                {SEASONS.map((s) => (
                  <button
                    key={s.id}
                    role="radio"
                    aria-checked={season === s.id}
                    onClick={() => setSeason(s.id)}
                    className={`px-3 py-1 text-sm ${season === s.id ? "bg-ink text-white" : "hover:bg-stone-100"}`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <p className="px-4 pt-2 pb-3 text-sm text-ink" data-testid="sun-note">
            {note ?? "Working out when the sun comes in…"}
          </p>
        </>
      ) : (
        <p className="px-4 py-6 text-sm text-muted">This window is on an inside wall now, so there&apos;s no outside to see. Move it onto an outside wall to preview it.</p>
      )}
    </div>
  );
}

/** Aim a camera from a shot: turning the head in place (inside) or stepping around the window (outside). */
function aim(cam: THREE.PerspectiveCamera, shot: Shot, look: Look, mode: "turn" | "orbit") {
  const [ex, ey, ez] = shot.eye;
  const [tx, ty, tz] = shot.target;
  if (mode === "turn") {
    const d = [tx - ex, ty - ey, tz - ez];
    const yaw = Math.atan2(-d[0], -d[2]);
    const pitch = Math.atan2(d[1], Math.hypot(d[0], d[2]));
    cam.position.set(ex, ey, ez);
    cam.rotation.set(Math.max(-1.4, Math.min(1.4, pitch + look.pitch)), yaw + look.yaw, 0, "YXZ");
    return;
  }
  const o = [ex - tx, ey - ty, ez - tz];
  const r = Math.hypot(o[0], o[1], o[2]);
  const theta = Math.atan2(o[0], o[2]) + look.yaw;
  const phi = Math.max(-0.2, Math.min(1.3, Math.asin(o[1] / r) + look.pitch));
  cam.position.set(tx + r * Math.cos(phi) * Math.sin(theta), ty + r * Math.sin(phi), tz + r * Math.cos(phi) * Math.cos(theta));
  cam.lookAt(tx, ty, tz);
}

/** Only the outside picture shows things on this layer. */
const OUTSIDE_ONLY = 1;
const markerMaterial = new THREE.MeshBasicMaterial({ color: "#2f8a5f" });

/** A green outline around the window on the outside wall, so it's easy to spot from outside. */
function WindowMarker({ views, frame }: { views: WindowViews; frame: Frame }) {
  const { og, out, wallIn, z0, z1 } = views;
  const w = og.opening.widthIn;
  const h = z1 - z0;
  const bar = 2.5;
  // Local x runs along the wall, y up, z out of the wall face.
  const zOut = (out.x * -og.u.y + out.y * og.u.x) * (wallIn / 2 + 1.5);
  const at = toScene(frame, og.center, (z0 + z1) / 2);
  const s = (n: number) => n / IN_PER_UNIT;
  const bars: [number, number, number, number][] = [
    [0, h / 2 + bar / 2, w + 2 * bar, bar],
    [0, -h / 2 - bar / 2, w + 2 * bar, bar],
    [-w / 2 - bar / 2, 0, bar, h],
    [w / 2 + bar / 2, 0, bar, h],
  ];
  return (
    <group position={at} rotation={[0, -Math.atan2(og.u.y, og.u.x), 0]}>
      {bars.map(([x, y, bw, bh], i) => (
        <mesh key={i} position={[s(x), s(y), s(zOut)]} material={markerMaterial} ref={(m) => m?.layers.set(OUTSIDE_ONLY)}>
          <boxGeometry args={[s(bw), s(bh), s(1)]} />
        </mesh>
      ))}
    </group>
  );
}

/** Draws the scene twice each frame: from inside on the left half, from outside on the right. */
function TwoPictures({ inside, outside, looks }: { inside: Shot; outside: Shot; looks: React.RefObject<Looks> }) {
  const { gl, scene, size, invalidate } = useThree();
  const cams = useMemo(() => {
    const outsideCam = new THREE.PerspectiveCamera(50, 1, 0.5, 6000);
    outsideCam.layers.enable(OUTSIDE_ONLY);
    return { inside: new THREE.PerspectiveCamera(62, 1, 0.2, 6000), outside: outsideCam };
  }, []);
  useEffect(() => invalidate(), [inside, outside, size, invalidate]);
  useFrame(() => {
    const half = Math.floor(size.width / 2);
    const h = size.height;
    aim(cams.inside, inside, looks.current.inside, "turn");
    aim(cams.outside, outside, looks.current.outside, "orbit");
    gl.setScissorTest(true);
    for (const [cam, x, w] of [
      [cams.inside, 0, half],
      [cams.outside, half, size.width - half],
    ] as const) {
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
      gl.setViewport(x, 0, w, h);
      gl.setScissor(x, 0, w, h);
      gl.render(scene, cam);
    }
    gl.setScissorTest(false);
  }, 1);
  return null;
}
