"use client";

import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { forQuality, type Part } from "@/lib/house3d/build";
import { useGraphics } from "@/lib/graphics";
import { sunDirection } from "@/lib/house3d/sun";
import { glassMaterial, solidMaterial } from "./House3DView";
import { mergeParts } from "./geometry";
import { setDaylight, useHouseMaterials } from "./prettyMaterial";
import { usePlace } from "@/lib/location/usePlace";

/**
 * Pieces shared by the walkthrough and the window preview: the house with
 * its walls up and ceilings in, and the sky and sunlight for a time of day.
 */

/** What you can aim at: the solid mesh, and the part each of its triangles came from. */
export type AimTarget = { mesh: THREE.Mesh; owners: Part[] };

/**
 * The whole house (or a floor of it), ceilings included, as one solid mesh and one glass mesh. Walls are always up, so no footprint strips.
 * `aimRef`, when given, gets the solid mesh for aiming at things.
 */
export function HouseMeshes({ parts, aimRef, doorsApart }: { parts: Part[]; aimRef?: React.MutableRefObject<AimTarget | null>; doorsApart?: boolean }) {
  // With `doorsApart`, door leaves are left out: the caller draws them on their own (see DoorLeaves).
  const quality = useGraphics((g) => g.quality);
  const mat = useHouseMaterials(solidMaterial, glassMaterial);
  const shown = useMemo(() => forQuality(parts, quality), [parts, quality]);
  const solid = useMemo(() => mergeParts(shown.filter((p) => !p.glass && !p.glow && p.layer !== "footprints" && !(doorsApart && p.door))), [shown, doorsApart]);
  const glass = useMemo(() => mergeParts(shown.filter((p) => p.glass && !(doorsApart && p.door))), [shown, doorsApart]);
  // Lamp shades and light fixtures: lit from inside in the evening (see setGlow).
  const glowing = useMemo(() => mergeParts(shown.filter((p) => p.glow)), [shown]);
  useEffect(() => () => solid?.geometry.dispose(), [solid]);
  useEffect(() => () => glass?.geometry.dispose(), [glass]);
  useEffect(() => () => glowing?.geometry.dispose(), [glowing]);
  return (
    <>
      {solid && (
        <mesh
          geometry={solid.geometry}
          material={mat.solid}
          castShadow
          receiveShadow
          ref={(m) => {
            if (aimRef) aimRef.current = m ? { mesh: m, owners: solid.owners } : null;
          }}
        />
      )}
      {glass && <mesh geometry={glass.geometry} material={mat.glass} />}
      {glowing && <mesh geometry={glowing.geometry} material={glowMaterial} castShadow={false} receiveShadow />}
    </>
  );
}

/**
 * Lamp shades, pendants and ceiling light covers: their own color by day,
 * glowing warm from inside once the lights are on (`setGlow`, 0 to 1). Both
 * faces are drawn so a shade's inside shows from below.
 */
export const glowMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide, emissive: new THREE.Color("#ffc985"), emissiveIntensity: 0 });

/** How brightly lamps and lights glow: 0 off, 1 fully on at night. */
export function setGlow(amount: number) {
  glowMaterial.emissiveIntensity = Math.max(0, Math.min(1, amount)) * 1.6;
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
  /** How dark it is, 0 by day to 1 at night (the walkthrough's evening hours). */
  night?: number;
};

/** Sunlight for the day and hour, and a sky that warms up near sunrise and sunset. */
export function Sky({ day, hour, span, center, version, shadowSize = 4096, showSun = false, night = 0 }: SkyProps) {
  const { scene, gl } = useThree();
  const lat = usePlace().latitudeDeg;
  const sun = useMemo(() => sunDirection(day, hour, lat), [day, hour, lat]);
  const low = Math.max(0, Math.min(1, 1 - sun[1] / 0.35)); // 1 near the horizon, 0 once the sun is up
  // Pretty's reflections of the room dim from late afternoon into the night.
  useEffect(() => setDaylight(Math.min((sun[1] + 0.05) / 0.3, 1 - night)), [sun, night]);
  const sky = useMemo(() => new THREE.Color("#a9cbe8").lerp(new THREE.Color("#f2c49b"), low * 0.8).lerp(new THREE.Color("#0c1526"), night), [low, night]);
  const sunColor = useMemo(() => new THREE.Color("#fffaf0").lerp(new THREE.Color("#ffb46b"), low), [low]);
  // After sunset the sun fades out and a dim blue sky light is left (moonlight, the glow of town).
  const dim = 1 - night;
  const skyLight = useMemo(() => new THREE.Color("#eef4fb").lerp(new THREE.Color("#5a6f96"), night), [night]);
  // Nothing in the scene moves, so shadows are only redrawn when the sun (or the house) does.
  useEffect(() => {
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
  }, [gl, sun, center, version, night]);
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
      <hemisphereLight args={["#eef4fb", "#d9cfbd"]} color={skyLight} intensity={(0.7 + 0.4 * (1 - low)) * (1 - 0.85 * night)} />
      <ambientLight intensity={0.25 * (1 - 0.7 * night)} />
      <directionalLight
        position={[center[0] + sun[0] * d, sun[1] * d, center[2] + sun[2] * d]}
        target={target}
        color={sunColor}
        intensity={(1.4 + 1.2 * (1 - low)) * dim}
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
      {showSun && dim > 0.5 && (
        <group position={[center[0] + sun[0] * far, sun[1] * far, center[2] + sun[2] * far]}>
          <mesh geometry={sunBall} material={sunMaterial} scale={far * 0.026} />
          <mesh geometry={sunBall} material={sunGlowMaterial} scale={far * 0.06} />
        </group>
      )}
    </>
  );
}
