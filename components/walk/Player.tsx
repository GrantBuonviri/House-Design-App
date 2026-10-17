"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { IN_PER_UNIT, type Frame } from "@/lib/house3d/mesh";
import { EYE_IN, type Walker } from "@/lib/house3d/walk";
import type { AimTarget } from "@/components/house3d/Scene";

/** The walker in the 3D view: moving the camera, and what the dot in the middle is on. Used by Walkthrough.tsx (what is being placed is drawn by WalkGhosts.tsx). */

const LOOK_PER_PX = 0.0022;

/** What the dot in the middle of the screen is on, from the 3D view. */
export type Look = {
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  hit: { point: THREE.Vector3; normal: THREE.Vector3; owner: AimTarget["owners"][number] } | null;
};

type StepFn = (w: Walker, input: { forward: number; right: number; fast: boolean }, dt: number) => Walker;

const CENTER = new THREE.Vector2(0, 0);

/** Moves the camera: mouse look and keys while the mouse is captured, every frame. With `looking`, also reports what the dot in the middle is on. */
export function Player({
  walker,
  locked,
  frame,
  step,
  onWhere,
  aimTarget,
  looking,
  fastLook,
  onLook,
  doorsRef,
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
  /** The door leaves, drawn apart from the house, which can be aimed at too. */
  doorsRef?: React.RefObject<THREE.Object3D | null>;
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
    // On the document: the walkthrough stops keys there so the page under it doesn't see them.
    document.addEventListener("keydown", down);
    document.addEventListener("keyup", up);
    window.addEventListener("mousemove", move);
    return () => {
      document.removeEventListener("keydown", down);
      document.removeEventListener("keyup", up);
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
      let h: THREE.Intersection | undefined = t ? ray.intersectObject(t.mesh, false)[0] : undefined;
      let owner = h && h.faceIndex != null ? t!.owners[h.faceIndex] : undefined;
      // The side you're looking at, whichever way the triangle happens to be wound.
      let normal = h?.face ? h.face.normal.clone() : undefined;
      const doors = doorsRef?.current;
      const dh = doors ? ray.intersectObjects(doors.children, true)[0] : undefined;
      if (dh && (!h || dh.distance < h.distance) && dh.object.userData.part) {
        h = dh;
        owner = dh.object.userData.part;
        normal = dh.face ? dh.face.normal.clone().transformDirection(dh.object.matrixWorld) : undefined;
      }
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
