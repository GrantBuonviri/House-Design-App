"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { Part, Pick } from "@/lib/house3d/build";
import { leafPose } from "@/lib/house3d/doors";
import { IN_PER_UNIT, toScene, type Frame } from "@/lib/house3d/mesh";
import { toGeometry } from "./geometry";
import { glassMaterial, solidMaterial } from "./House3DView";

/** Event handlers for clicking a mesh, given which pick each of its triangles belongs to (see House3DView's useDrag). */
export type PickHandlers = (picks: (Pick | undefined)[]) => {
  onPointerDown?: (e: ThreeEvent<PointerEvent>) => void;
  onPointerMove?: (e: ThreeEvent<PointerEvent>) => void;
  onPointerOut?: () => void;
};

/**
 * Door leaves (parts with a `door`), each drawn on its own so it can swing, slide or roll up.
 * Their meshes are built closed; `amountOf` says how open each door is (0 to 1), read every frame.
 */
export function DoorLeaves({
  parts,
  frame,
  amountOf,
  groupRef,
  on,
}: {
  parts: Part[];
  frame: Frame;
  amountOf: (doorId: string) => number;
  /** The group holding every leaf, for aiming at them. */
  groupRef?: React.Ref<THREE.Group>;
  on?: PickHandlers;
}) {
  return (
    <group ref={groupRef}>
      {parts.map((p) => (
        <Leaf key={p.key} part={p} frame={frame} amountOf={amountOf} on={on} />
      ))}
    </group>
  );
}

function Leaf({ part, frame, amountOf, on }: { part: Part; frame: Frame; amountOf: (id: string) => number; on?: PickHandlers }) {
  const door = part.door!;
  const geometry = useMemo(() => toGeometry(part.mesh), [part.mesh]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  // Turns and shrinks happen about this point (scene feet).
  const pivot = useMemo<[number, number, number]>(() => {
    const m = door.motion;
    if (m.kind === "swing") return toScene(frame, m.hinge, 0);
    if (m.kind === "roll") return [0, m.topIn / IN_PER_UNIT, 0];
    return [0, 0, 0];
  }, [door.motion, frame]);
  const outer = useRef<THREE.Group>(null);
  const last = useRef<number>(NaN);
  const { gl } = useThree();
  const handlers = useMemo(() => (on ? on(Array(part.mesh.count).fill(part.pick)) : {}), [on, part.mesh.count, part.pick]);

  useFrame(() => {
    const g = outer.current;
    if (!g) return;
    const amount = amountOf(door.id);
    if (amount === last.current) return;
    last.current = amount;
    const pose = leafPose(door.motion, amount);
    g.position.set(pivot[0] + pose.shift.x / IN_PER_UNIT, pivot[1], pivot[2] + pose.shift.y / IN_PER_UNIT);
    // Plan angles run from east toward south; the scene's y-rotation runs the other way.
    g.rotation.set(0, -pose.turn, 0);
    g.scale.set(1, pose.stretch, 1);
    // The sun's shadows are only redrawn when asked, so ask while a door moves.
    gl.shadowMap.needsUpdate = true;
  });

  return (
    <group ref={outer}>
      <mesh
        geometry={geometry}
        material={part.glass ? glassMaterial : solidMaterial}
        position={[-pivot[0], -pivot[1], -pivot[2]]}
        castShadow={!part.glass}
        receiveShadow={!part.glass}
        userData={{ part }}
        {...handlers}
      />
    </group>
  );
}
