"use client";

import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Part } from "@/lib/house3d/build";
import { sunDirection } from "@/lib/house3d/sun";
import { glassMaterial, solidMaterial } from "./House3DView";
import { mergeParts } from "./geometry";

/**
 * Pieces shared by the walkthrough and the window preview: the house with
 * its walls up and ceilings in, and the sky and sunlight for a time of day.
 */

/** The whole house (or a floor of it), ceilings included, as one solid mesh and one glass mesh. Walls are always up, so no footprint strips. */
export function HouseMeshes({ parts }: { parts: Part[] }) {
  const solid = useMemo(() => mergeParts(parts.filter((p) => !p.glass && p.layer !== "footprints")), [parts]);
  const glass = useMemo(() => mergeParts(parts.filter((p) => p.glass)), [parts]);
  useEffect(() => () => solid?.geometry.dispose(), [solid]);
  useEffect(() => () => glass?.geometry.dispose(), [glass]);
  return (
    <>
      {solid && <mesh geometry={solid.geometry} material={solidMaterial} castShadow receiveShadow />}
      {glass && <mesh geometry={glass.geometry} material={glassMaterial} />}
    </>
  );
}

const sunMaterial = new THREE.MeshBasicMaterial({ color: "#fff3cf", fog: false });
const sunGlowMaterial = new THREE.MeshBasicMaterial({ color: "#ffe9b0", fog: false, transparent: true, opacity: 0.35, depthWrite: false });
const sunBall = new THREE.SphereGeometry(1, 24, 12);

type SkyProps = {
  day: number;
  hour: number;
  span: number;
  center: [number, number, number];
  /** Something that changes whenever the house does, so its shadows are redrawn. */
  version?: unknown;
  shadowSize?: number;
  /** Draw the sun itself in the sky. */
  showSun?: boolean;
};

/** Sunlight for the day and hour, and a sky that warms up near sunrise and sunset. */
export function Sky({ day, hour, span, center, version, shadowSize = 4096, showSun = false }: SkyProps) {
  const { scene, gl } = useThree();
  const sun = useMemo(() => sunDirection(day, hour), [day, hour]);
  const low = Math.max(0, Math.min(1, 1 - sun[1] / 0.35)); // 1 near the horizon, 0 once the sun is up
  const sky = useMemo(() => new THREE.Color("#a9cbe8").lerp(new THREE.Color("#f2c49b"), low * 0.8), [low]);
  const sunColor = useMemo(() => new THREE.Color("#fffaf0").lerp(new THREE.Color("#ffb46b"), low), [low]);
  // Nothing in the scene moves, so shadows are only redrawn when the sun (or the house) does.
  useEffect(() => {
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
  }, [gl, sun, center, version]);
  useEffect(() => {
    scene.background = sky;
    scene.fog = new THREE.Fog(sky, span * 8, span * 30);
  }, [scene, sky, span]);

  const reach = span * 0.8 + 30;
  const d = reach * 2;
  const target = useMemo(() => {
    const o = new THREE.Object3D();
    o.position.set(...center);
    return o;
  }, [center]);
  // Far off, past the land, but inside the camera's reach; about 3 degrees across.
  const far = 1500;
  return (
    <>
      <primitive object={target} />
      {/* Light bouncing around indoors: from above like the sky, and back up off the floors onto the ceilings. */}
      <hemisphereLight args={["#eef4fb", "#d9cfbd", 0.7 + 0.4 * (1 - low)]} />
      <ambientLight intensity={0.25} />
      <directionalLight
        position={[center[0] + sun[0] * d, sun[1] * d, center[2] + sun[2] * d]}
        target={target}
        color={sunColor}
        intensity={1.4 + 1.2 * (1 - low)}
        castShadow
        shadow-mapSize={[shadowSize, shadowSize]}
        shadow-bias={-0.0003}
        shadow-normalBias={0.03}
        shadow-camera-left={-reach}
        shadow-camera-right={reach}
        shadow-camera-top={reach}
        shadow-camera-bottom={-reach}
        shadow-camera-near={1}
        shadow-camera-far={d * 2.5}
      />
      {showSun && (
        <group position={[center[0] + sun[0] * far, sun[1] * far, center[2] + sun[2] * far]}>
          <mesh geometry={sunBall} material={sunMaterial} scale={far * 0.026} />
          <mesh geometry={sunBall} material={sunGlowMaterial} scale={far * 0.06} />
        </group>
      )}
    </>
  );
}
