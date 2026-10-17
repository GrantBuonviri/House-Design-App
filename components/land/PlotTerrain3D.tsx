"use client";

import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { Line, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { Plot } from "@/lib/model/schema";
import { SCENE_SIZE, buildTerrainMesh, drapeLine, featureSpots, landScene, ribbonMesh, roadStrips, waterSurfaces, type RibbonMesh } from "@/lib/land/mesh";
import { dayArc, sunPosition, SUMMER_SOLSTICE, WINTER_SOLSTICE } from "@/lib/land/sun";
import { useGraphics } from "@/lib/graphics";
import { usePlace } from "@/lib/location/usePlace";

const SKY_RADIUS = 6.5;

/** Scene direction toward a compass bearing and height (x east, z south, y up). */
function skyPoint(azimuthDeg: number, altitudeDeg: number, r = SKY_RADIUS): [number, number, number] {
  const az = (azimuthDeg * Math.PI) / 180;
  const alt = (altitudeDeg * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(alt) * r, Math.sin(alt) * r, -Math.cos(az) * Math.cos(alt) * r];
}

function sunArc(day: number, latitudeDeg: number): [number, number, number][] {
  const arc = dayArc(day, latitudeDeg);
  const start = 12 - arc.daylightHours / 2;
  const pts: [number, number, number][] = [];
  for (let i = 0; i <= 32; i++) {
    const s = sunPosition(day, start + (arc.daylightHours * i) / 32, latitudeDeg);
    pts.push(skyPoint(s.azimuthDeg, Math.max(0, s.altitudeDeg)));
  }
  return pts;
}

/** A flat strip (river, lane or road) as a mesh. */
function Strip({ data, color, opacity = 1 }: { data: RibbonMesh; color: string; opacity?: number }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
    g.setIndex(new THREE.BufferAttribute(data.indices, 1));
    g.computeVertexNormals();
    return g;
  }, [data]);
  return (
    <mesh geometry={geometry}>
      <meshLambertMaterial color={color} side={THREE.DoubleSide} transparent={opacity < 1} opacity={opacity} />
    </mesh>
  );
}

function Land({ plot }: { plot: Plot }) {
  const scene = useMemo(() => landScene(plot), [plot]);
  const mesh = useMemo(() => buildTerrainMesh(plot, scene), [plot, scene]);
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
    // Mesh colors are sRGB; the renderer works in linear light.
    const linear = mesh.colors.map((c) => Math.pow(c, 2.2));
    g.setAttribute("color", new THREE.BufferAttribute(linear, 3));
    g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    g.computeVertexNormals();
    return g;
  }, [mesh]);

  const water = useMemo(
    () =>
      waterSurfaces(plot, scene).map((w) => {
        const shape = new THREE.Shape(w.outline.map(([x, z]) => new THREE.Vector2(x, -z)));
        return { geometry: new THREE.ShapeGeometry(shape), level: w.level };
      }),
    [plot, scene],
  );

  const outline = useMemo(() => drapeLine(plot.outline, scene, { closed: true, liftIn: 10 }), [plot, scene]);
  const roads = useMemo(
    () =>
      roadStrips(plot).flatMap((r) => {
        const data = ribbonMesh(r.points, r.widthIn, scene, 6);
        return data ? [{ data, main: r.main }] : [];
      }),
    [plot, scene],
  );
  const lanes = useMemo(
    () => plot.lanes.flatMap((l) => ribbonMesh(l.points, l.widthFt * 12, scene, 14) ?? []),
    [plot, scene],
  );
  const rivers = useMemo(
    () => plot.waterFeatures.filter((w) => w.kind === "river").flatMap((w) => ribbonMesh(w.points, 36 * 12, scene, 3) ?? []),
    [plot, scene],
  );
  const spots = useMemo(() => featureSpots(plot, scene), [plot, scene]);
  const streams = useMemo(
    () =>
      plot.waterFeatures
        .filter((w) => w.kind === "creek" || w.kind === "wash")
        .map((w) => ({ kind: w.kind, points: drapeLine(w.points, scene, { liftIn: 4 }) }))
        .filter((s) => s.points.length > 1),
    [plot, scene],
  );
  const lat = usePlace().latitudeDeg;
  const summer = useMemo(() => sunArc(SUMMER_SOLSTICE, lat), [lat]);
  const winter = useMemo(() => sunArc(WINTER_SOLSTICE, lat), [lat]);
  const sun = useMemo(() => {
    const s = sunPosition(SUMMER_SOLSTICE, 15, lat);
    return skyPoint(s.azimuthDeg, s.altitudeDeg);
  }, [lat]);

  return (
    <>
      <hemisphereLight args={["#eef4fb", "#8a8470", 1.1]} />
      <directionalLight position={sun} intensity={1.4} />
      <mesh geometry={geometry}>
        <meshLambertMaterial vertexColors />
      </mesh>
      {water.map((w, i) => (
        <mesh key={i} geometry={w.geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, w.level, 0]}>
          <meshLambertMaterial color="#5b93bd" transparent opacity={0.9} />
        </mesh>
      ))}
      {streams.map((s, i) =>
        s.kind === "creek" ? (
          <Line key={i} points={s.points} color="#3f7fae" lineWidth={3.5} />
        ) : (
          <Line key={i} points={s.points} color="#a88a5c" lineWidth={2.5} dashed dashSize={0.15} gapSize={0.1} />
        ),
      )}
      {rivers.map((r, i) => (
        <Strip key={`river${i}`} data={r} color="#4a86b8" opacity={0.9} />
      ))}
      {lanes.map((l, i) => (
        <Strip key={`lane${i}`} data={l} color="#e3d6b0" />
      ))}
      {roads.map((r, i) => (
        <Strip key={`road${i}`} data={r.data} color={r.main ? "#7d7f7c" : "#92948f"} />
      ))}
      {spots.map((s) =>
        s.kind === "rock" ? (
          <mesh key={s.id} position={[s.position[0], s.position[1] + s.radius * 0.2, s.position[2]]} scale={[1, 0.65, 1]}>
            <dodecahedronGeometry args={[s.radius, 0]} />
            <meshLambertMaterial color="#8b8a85" flatShading />
          </mesh>
        ) : (
          <group key={s.id} position={s.position}>
            <mesh position={[0, s.radius * 0.35, 0]}>
              <cylinderGeometry args={[s.radius * 0.1, s.radius * 0.14, s.radius * 0.7, 6]} />
              <meshLambertMaterial color="#6b4f33" />
            </mesh>
            <mesh position={[0, s.radius * 1.1, 0]}>
              <coneGeometry args={[s.radius, s.radius * 1.9, 8]} />
              <meshLambertMaterial color="#4f7f43" flatShading />
            </mesh>
          </group>
        ),
      )}
      {outline.length > 1 && (
        <Line points={outline} color="#1f2421" lineWidth={1.8} dashed dashSize={0.18} gapSize={0.1} />
      )}
      <Line points={summer} color="#e8892b" lineWidth={2} transparent opacity={0.85} />
      <Line points={winter} color="#d8b43a" lineWidth={2} dashed dashSize={0.25} gapSize={0.15} />
      <mesh position={sun}>
        <sphereGeometry args={[0.22, 16, 16]} />
        <meshBasicMaterial color="#f5b041" />
      </mesh>
      <NorthMarker y={mesh.maxY + 0.05} />
    </>
  );
}

/** A small "N" drawn with lines past the north edge, with an arrow pointing north. */
function NorthMarker({ y }: { y: number }) {
  const z = -SCENE_SIZE / 2 - 0.35;
  const s = 0.45;
  const letter: [number, number, number][] = [
    [-s / 2, y, z + s],
    [-s / 2, y, z],
    [s / 2, y, z + s],
    [s / 2, y, z],
  ];
  const arrow: [number, number, number][] = [
    [-0.2, y, z - 0.25],
    [0, y, z - 0.5],
    [0.2, y, z - 0.25],
  ];
  return (
    <>
      <Line points={letter} color="#1f2421" lineWidth={2.5} />
      <Line points={arrow} color="#1f2421" lineWidth={2.5} />
    </>
  );
}

/**
 * A 3D model of a plot: the ground with its slope, water, property line,
 * road, and the place's summer and winter sun paths across the sky. Drag to
 * turn it around.
 */
export default function PlotTerrain3D({
  plot,
  size,
  interactive = true,
}: {
  plot: Plot;
  size: number;
  interactive?: boolean;
}) {
  const quality = useGraphics((g) => g.quality);
  return (
    <div style={{ width: size, height: size }} className="overflow-hidden rounded-lg bg-[#dfe9f2]">
      <Canvas
        key={quality}
        frameloop="demand"
        dpr={quality === "fast" ? 1 : [1, 2]}
        camera={{ position: [4, 12, 12], fov: 38, near: 0.1, far: 100 }}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
      >
        <color attach="background" args={["#dfe9f2"]} />
        <Land plot={plot} />
        <OrbitControls
          makeDefault
          enabled={interactive}
          enablePan={false}
          enableZoom={size > 300}
          minDistance={6}
          maxDistance={22}
          maxPolarAngle={Math.PI * 0.47}
          target={[0, 0, 0]}
        />
      </Canvas>
    </div>
  );
}
