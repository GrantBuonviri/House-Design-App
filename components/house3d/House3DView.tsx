"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Line, MapControls, OrbitControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import type { FloorPlan, House3D, Level, PlanBasics, Plot, Point } from "@/lib/model/schema";
import { buildLevel, buildRoofs, dugOut, houseBounds, type HouseContext, type Part, type Pick } from "@/lib/house3d/build";
import { levelHeights, type LevelHeights } from "@/lib/house3d/levels";
import { IN_PER_UNIT, toScene, type Frame } from "@/lib/house3d/mesh";
import { planBounds, siteFor, type Site } from "@/lib/house3d/site";
import { EQUINOX, SUMMER, sunDirection } from "@/lib/house3d/sun";
import { groundMesh, lineOnGround, waterIn3D } from "@/lib/house3d/terrain";
import { landView } from "@/lib/land/view";
import { roadLine } from "@/lib/land/mesh";
import type { Plans } from "@/lib/plan/edit";
import { planOf } from "@/lib/plan/edit";
import { dragPlan } from "@/lib/house3d/drag";
import { polygonCenter } from "@/lib/plan/geometry";
import { roomSqft } from "@/lib/plan/measure";
import type { PlanSelection } from "@/components/plan/types";
import { concatMeshes, mergeParts, toGeometry } from "./geometry";

export type View3DMode = "birdseye" | "3d";

type Props = {
  mode: View3DMode;
  plans: Plans;
  /** Lowest first. */
  levels: Level[];
  basics: PlanBasics | null;
  house3d: House3D;
  plot: Plot | null;
  offset: Point;
  levelId: string;
  /** Show only up to the current floor (always, from above). */
  cutAway: boolean;
  selection: PlanSelection;
  snap: boolean;
  height: number;
  onSelect: (levelId: string, sel: PlanSelection) => void;
  onChange: (levelId: string, plan: FloorPlan, coalesce?: string) => void;
};

const SKY = "#dfe9f2";
const ACCENT = "#2f6b4f";

export const solidMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
export const glassMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.15, metalness: 0, transparent: true, opacity: 0.35, depthWrite: false });
const highlightMaterial = new THREE.MeshBasicMaterial({
  color: ACCENT,
  transparent: true,
  opacity: 0.45,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -4,
  polygonOffsetUnits: -4,
});

/**
 * The house in 3D (or from straight above), built from the floor plan and
 * standing on the land. Click a room's floor, a door, a window, stairs or a
 * fixture to select it, and drag it to move it; the 2D plan changes with it.
 */
export default function House3DView(props: Props) {
  const { mode, plans, levels, basics, house3d, plot, offset, levelId, height } = props;
  const cutAway = props.cutAway || mode === "birdseye";

  // While something is being dragged, the ground and the house's place on it wait until it's let go.
  const [dragging, setDragging] = useState(false);
  const settledRef = useRef(plans);
  if (!dragging) settledRef.current = plans;
  const settled = settledRef.current;

  // The scene is centered on the house as it was when the view opened, so the camera doesn't jump as things move.
  const [frame] = useState<Frame>(() => {
    const bb = planBounds(plans);
    return bb ? { ox: (bb.x0 + bb.x1) / 2, oy: (bb.y0 + bb.y1) / 2 } : { ox: 0, oy: 0 };
  });

  const heights = useMemo(() => levelHeights(levels, basics), [levels, basics]);
  const site = useMemo(() => siteFor(plot, offset, settled), [plot, offset, settled]);
  const ctx = useMemo(() => ({ levels, basics, house3d, site, frame, heights }), [levels, basics, house3d, site, frame, heights]);

  // Each floor is rebuilt only when it (or a floor next to it) changes.
  const cache = useRef(new Map<string, { key: unknown[]; parts: Part[] }>());
  const levelParts = useMemo(() => {
    const out: Record<string, Part[]> = {};
    levels.forEach((l, i) => {
      const key = [ctx, plans[l.id], plans[levels[i - 1]?.id], plans[levels[i + 1]?.id]];
      const hit = cache.current.get(l.id);
      if (hit && hit.key.every((k, j) => k === key[j])) out[l.id] = hit.parts;
      else {
        const parts = buildLevel(plans, l, ctx);
        cache.current.set(l.id, { key, parts });
        out[l.id] = parts;
      }
    });
    return out;
  }, [levels, plans, ctx]);
  const roofs = useMemo(() => buildRoofs(plans, ctx), [plans, ctx]);
  const [bounds] = useState(() => houseBounds(plans, ctx, roofs.topIn));

  // Room names and sizes, shown from above.
  const labelPlan = planOf(plans, levelId);
  const labelFloor = heights[levelId]?.floorIn ?? 0;
  const labels = useMemo(
    () => labelPlan.rooms.map((r) => ({ id: r.id, name: r.name, sqft: roomSqft(r), at: toScene(frame, polygonCenter(r.polygon), labelFloor + 2) })),
    [labelPlan, labelFloor, frame],
  );
  const labelRefs = useRef<(HTMLDivElement | null)[]>([]);

  const order = useMemo(() => Object.fromEntries(levels.map((l, i) => [l.id, i])), [levels]);
  const showUpTo = cutAway ? (order[levelId] ?? levels.length) : Infinity;

  const center: [number, number, number] = bounds
    ? [(bounds.min[0] + bounds.max[0]) / 2, Math.max(0, (bounds.min[1] + bounds.max[1]) / 3), (bounds.min[2] + bounds.max[2]) / 2]
    : [0, 4, 0];
  const span = bounds ? Math.max(bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2], 30) : 60;

  return (
    <div style={{ height }} className="relative w-full overflow-hidden rounded-lg border border-line" data-testid="house-3d">
      <Canvas shadows frameloop="demand" dpr={[1, 2]} gl={{ antialias: true, preserveDrawingBuffer: true }}>
        <color attach="background" args={[SKY]} />
        <fog attach="fog" args={[SKY, span * 6, span * 18]} />
        {mode === "3d" ? (
          <>
            <PerspectiveCamera makeDefault fov={40} near={0.5} far={4000} position={[center[0] + span * 1.05, span * 0.85, center[2] + span * 1.25]} />
            <OrbitControls makeDefault target={center} maxPolarAngle={Math.PI * 0.495} minDistance={6} maxDistance={span * 10} enableDamping={false} />
          </>
        ) : (
          <TopCamera center={center} span={span} height={height} />
        )}
        {/* From above, a high summer sun keeps shadows short; in 3D, a mid-afternoon sun shows the shape. */}
        <Lights span={span} day={mode === "birdseye" ? SUMMER : EQUINOX} hour={mode === "birdseye" ? 12.5 : 15} />
        <Ground site={site} frame={frame} plans={settled} ctx={ctx} heights={heights} onEmpty={() => props.onSelect(levelId, [])} />
        {levels.map((l, i) => (i <= showUpTo ? <LevelMeshes key={l.id} parts={levelParts[l.id]} {...props} frame={frame} heights={heights} onDragging={setDragging} /> : null))}
        {levels.map((l, i) =>
          showUpTo === Infinity || i < showUpTo ? (
            <LevelMeshes key={`roof-${l.id}`} parts={roofs.parts.filter((p) => p.levelId === l.id)} {...props} frame={frame} heights={heights} onDragging={setDragging} />
          ) : null,
        )}
        <Highlight parts={levels.flatMap((l, i) => (i <= showUpTo ? levelParts[l.id] : []))} selection={props.selection} />
        {mode === "birdseye" && <LabelPlacer labels={labels} refs={labelRefs} />}
      </Canvas>
      {mode === "birdseye" &&
        labels.map((l, i) => (
          <div
            key={l.id}
            ref={(el) => {
              labelRefs.current[i] = el;
            }}
            className="pointer-events-none absolute top-0 left-0 rounded bg-white/80 px-1.5 py-0.5 text-center text-[11px] leading-tight whitespace-nowrap text-ink shadow-sm"
            style={{ visibility: "hidden" }}
          >
            {l.name}
            <span className="block text-[10px] text-muted">{l.sqft} sq ft</span>
          </div>
        ))}
      {roofs.fellBack && (
        <p className="absolute bottom-2 left-2 rounded bg-white/90 px-2 py-1 text-xs text-muted">This outline was too tricky for a sloped roof, so part of it has a flat one.</p>
      )}
    </div>
  );
}

/** Straight down from above, north at the top of the screen. */
function TopCamera({ center, span, height }: { center: [number, number, number]; span: number; height: number }) {
  const ref = useRef<THREE.OrthographicCamera>(null);
  useEffect(() => {
    const cam = ref.current;
    if (!cam) return;
    cam.up.set(0, 0, -1);
    cam.lookAt(center[0], 0, center[2]);
    cam.updateProjectionMatrix();
  }, [center]);
  return (
    <>
      <OrthographicCamera ref={ref} makeDefault position={[center[0], 400, center[2]]} zoom={height / (span * 1.35)} near={1} far={2000} up={[0, 0, -1]} />
      <MapControls makeDefault target={[center[0], 0, center[2]]} enableRotate={false} screenSpacePanning minZoom={1} maxZoom={200} />
    </>
  );
}

function Lights({ span, day, hour }: { span: number; day: number; hour: number }) {
  const sun = useMemo(() => sunDirection(day, hour), [day, hour]);
  const reach = span * 1.3 + 30;
  const d = reach * 2;
  return (
    <>
      <hemisphereLight args={["#eef4fb", "#8a8470", 1.0]} />
      <directionalLight
        position={[sun[0] * d, sun[1] * d, sun[2] * d]}
        intensity={2.1}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
        shadow-camera-left={-reach}
        shadow-camera-right={reach}
        shadow-camera-top={reach}
        shadow-camera-bottom={-reach}
        shadow-camera-near={1}
        shadow-camera-far={d * 2.5}
      />
    </>
  );
}

export function Ground({ site, frame, plans, ctx, heights, onEmpty }: { site: Site; frame: Frame; plans: Plans; ctx: HouseContext; heights: LevelHeights; onEmpty?: () => void }) {
  const geometry = useMemo(() => {
    const m = groundMesh(site, frame, { house: planBounds(plans), holes: dugOut(plans, { ...ctx, heights }) });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
    g.setAttribute("color", new THREE.BufferAttribute(m.colors, 3));
    g.setIndex(new THREE.BufferAttribute(m.indices, 1));
    g.computeVertexNormals();
    return g;
  }, [site, frame, plans, ctx, heights]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const water = useMemo(
    () =>
      waterIn3D(site).map((w) => {
        const shape = new THREE.Shape(w.outline.map((p) => new THREE.Vector2((p.x - frame.ox) / IN_PER_UNIT, -(p.y - frame.oy) / IN_PER_UNIT)));
        return { geometry: new THREE.ShapeGeometry(shape), level: w.level / IN_PER_UNIT };
      }),
    [site, frame],
  );
  const lines = useMemo(() => {
    const plot = site.plot;
    if (!plot) return null;
    const view = landView(plot);
    return {
      outline: lineOnGround(site, frame, plot.outline, { closed: true, lift: 3 }),
      road: lineOnGround(site, frame, roadLine(plot, { view } as Parameters<typeof roadLine>[1]), { lift: 3, step: 96 }),
      streams: plot.waterFeatures
        .filter((w) => w.kind === "creek" || w.kind === "wash")
        .map((w) => ({ kind: w.kind, points: lineOnGround(site, frame, w.points, { lift: 3, step: 48 }) }))
        .filter((s) => s.points.length > 1),
    };
  }, [site, frame]);

  // A click on the ground (not a drag to turn the view) lets go of what's selected.
  const down = useRef<{ x: number; y: number } | null>(null);
  return (
    <>
      <mesh
        geometry={geometry}
        material={groundMaterial}
        receiveShadow
        onPointerDown={(e) => {
          e.stopPropagation();
          down.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={(e) => {
          if (onEmpty && down.current && Math.hypot(e.clientX - down.current.x, e.clientY - down.current.y) < 4) onEmpty();
          down.current = null;
        }}
      />
      {water.map((w, i) => (
        <mesh key={i} geometry={w.geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, w.level, 0]} receiveShadow>
          <meshStandardMaterial color="#5b93bd" roughness={0.2} transparent opacity={0.9} />
        </mesh>
      ))}
      {lines?.streams.map((s, i) =>
        s.kind === "creek" ? (
          <Line key={i} points={s.points} color="#3f7fae" lineWidth={4} />
        ) : (
          <Line key={i} points={s.points} color="#a88a5c" lineWidth={3} dashed dashSize={3} gapSize={2} />
        ),
      )}
      {lines && lines.road.length > 1 && <Line points={lines.road} color="#7d7f7c" lineWidth={8} />}
      {lines && lines.outline.length > 1 && <Line points={lines.outline} color="#1f2421" lineWidth={1.6} dashed dashSize={4} gapSize={2.5} />}
    </>
  );
}

const groundMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });

type LevelProps = Props & { parts: Part[]; frame: Frame; heights: LevelHeights; onDragging: (on: boolean) => void };

/** One floor's parts as a few big meshes (solid, glass), which can be clicked and dragged. */
function LevelMeshes(props: LevelProps) {
  const { parts } = props;
  const solid = useMemo(() => mergeParts(parts.filter((p) => !p.glass && p.layer !== "ceilings")), [parts]);
  const glass = useMemo(() => mergeParts(parts.filter((p) => p.glass)), [parts]);
  useEffect(() => () => solid?.geometry.dispose(), [solid]);
  useEffect(() => () => glass?.geometry.dispose(), [glass]);
  const handlers = useDrag(props);
  return (
    <>
      {solid && <mesh geometry={solid.geometry} material={solidMaterial} castShadow receiveShadow {...handlers(solid.picks)} />}
      {glass && <mesh geometry={glass.geometry} material={glassMaterial} {...handlers(glass.picks)} />}
    </>
  );
}

/** Keeps the room labels (plain page elements over the 3D picture) over their rooms as the view moves. */
function LabelPlacer({ labels, refs }: { labels: { at: [number, number, number] }[]; refs: React.RefObject<(HTMLDivElement | null)[]> }) {
  const { camera, size } = useThree();
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    labels.forEach((l, i) => {
      const el = refs.current?.[i];
      if (!el) return;
      v.set(...l.at).project(camera);
      const x = ((v.x + 1) / 2) * size.width;
      const y = ((1 - v.y) / 2) * size.height;
      el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
      el.style.visibility = v.z < 1 ? "visible" : "hidden";
    });
  });
  return null;
}

/** A see-through green coat over whatever is selected. */
function Highlight({ parts, selection }: { parts: Part[]; selection: PlanSelection }) {
  const merged = useMemo(() => {
    const ids = new Set(selection.map((s) => s.id));
    const picked = parts.filter((p) => p.pick && ids.has(p.pick.id));
    return picked.length ? toGeometry(concatMeshes(picked.map((p) => p.mesh))) : null;
  }, [parts, selection]);
  useEffect(() => () => merged?.dispose(), [merged]);
  return merged ? <mesh geometry={merged} material={highlightMaterial} renderOrder={2} /> : null;
}

type Session = {
  pick: Pick;
  ids: string[];
  base: FloorPlan;
  start: Point;
  planeY: number;
  client: { x: number; y: number };
  moved: boolean;
};

/**
 * Click to select, drag to move. Rooms, stairs and fixtures slide across
 * their floor (snapping to other rooms' corners and the 6" grid); doors and
 * windows slide along walls and hop to the nearest wall.
 */
function useDrag(props: LevelProps) {
  const { camera, gl, controls, invalidate } = useThree();
  const session = useRef<Session | null>(null);
  const latest = useRef(props);
  latest.current = props;

  function planPoint(clientX: number, clientY: number, planeY: number): Point | null {
    const rect = gl.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY), hit)) return null;
    const { frame } = latest.current;
    return { x: hit.x * IN_PER_UNIT + frame.ox, y: hit.z * IN_PER_UNIT + frame.oy };
  }

  function onMove(e: PointerEvent) {
    const s = session.current;
    if (!s) return;
    if (!s.moved && Math.hypot(e.clientX - s.client.x, e.clientY - s.client.y) < 4) return;
    const p = planPoint(e.clientX, e.clientY, s.planeY);
    if (!p) return;
    if (!s.moved) {
      s.moved = true;
      latest.current.onDragging(true);
    }
    const { onChange, snap } = latest.current;
    onChange(s.pick.levelId, dragPlan(s.base, s.pick.kind, s.ids, s.start, p, snap), "drag3d");
    invalidate();
  }

  function onUp() {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    const s = session.current;
    session.current = null;
    if (controls) (controls as unknown as { enabled: boolean }).enabled = true;
    gl.domElement.style.cursor = "";
    if (s?.moved) latest.current.onDragging(false);
  }

  useEffect(() => () => onUp(), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (picks: (Pick | undefined)[]) => ({
    onPointerDown: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      if (e.button !== 0) return;
      const pick = e.faceIndex != null ? picks[e.faceIndex] : undefined;
      const { selection, onSelect, levelId, plans, heights } = latest.current;
      if (!pick) {
        // A wall or the roof: let go of the selection on a plain click.
        const at = { x: e.clientX, y: e.clientY };
        const up = (ev: PointerEvent) => {
          window.removeEventListener("pointerup", up);
          if (Math.hypot(ev.clientX - at.x, ev.clientY - at.y) < 4) onSelect(levelId, []);
        };
        window.addEventListener("pointerup", up);
        return;
      }
      const item = { kind: pick.kind, id: pick.id };
      const same = pick.levelId === levelId;
      const already = same && selection.some((s) => s.id === pick.id);
      let next: PlanSelection;
      if (e.shiftKey && same) next = already ? selection.filter((s) => s.id !== pick.id) : [...selection, item];
      else next = already ? selection : [item];
      if (next !== selection) onSelect(pick.levelId, next);
      if (e.shiftKey && already) return;

      const base = planOf(plans, pick.levelId);
      const floorIn = heights[pick.levelId]?.floorIn ?? 0;
      // Doors and windows are dragged at about their middle height; everything else on the floor.
      const planeIn = pick.kind === "opening" ? floorIn + 40 : floorIn;
      const start = planPoint(e.clientX, e.clientY, planeIn / IN_PER_UNIT);
      if (!start) return;
      const movable = next.filter((s) => s.kind === "room" || s.kind === "stairs" || s.kind === "fixture").map((s) => s.id);
      session.current = {
        pick,
        ids: pick.kind === "opening" ? [pick.id] : movable.includes(pick.id) ? movable : [pick.id],
        base,
        start,
        planeY: planeIn / IN_PER_UNIT,
        client: { x: e.clientX, y: e.clientY },
        moved: false,
      };
      if (controls) (controls as unknown as { enabled: boolean }).enabled = false;
      gl.domElement.style.cursor = "grabbing";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    onPointerMove: (e: ThreeEvent<PointerEvent>) => {
      if (session.current) return;
      const pick = e.faceIndex != null ? picks[e.faceIndex] : undefined;
      gl.domElement.style.cursor = pick ? "pointer" : "";
    },
    onPointerOut: () => {
      if (!session.current) gl.domElement.style.cursor = "";
    },
  });
}
