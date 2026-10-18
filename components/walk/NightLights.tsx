"use client";

import { MAX_LIVE_LIGHTS, type LightSource } from "@/lib/house3d/nightLights";
import { toScene, type Frame } from "@/lib/house3d/mesh";

/**
 * The few real lights on in the evening and at night (see liveLights): warm
 * point lights at the lamps and ceiling lights round where you stand. Always
 * MAX_LIVE_LIGHTS of them, the spare ones off, so walking from room to room
 * only moves them (changing how many there are would rebuild every material).
 */
export function NightLights({ lights, amount, frame, floorOf }: { lights: LightSource[]; amount: number; frame: Frame; floorOf: (levelId: string) => number }) {
  return (
    <>
      {Array.from({ length: MAX_LIVE_LIGHTS }, (_, i) => {
        const s = lights[i];
        const at = s ? toScene(frame, s.p, floorOf(s.levelId) + s.z) : ([0, -100, 0] as const);
        // Lamps are softer and warmer than the ceiling lights.
        const strength = !s ? 0 : s.kind === "lamp" ? 14 : s.kind === "wall" ? 8 : 18;
        return <pointLight key={i} position={[at[0], at[1], at[2]]} color={s?.kind === "lamp" ? "#ffcf96" : "#ffe2bd"} intensity={strength * amount} distance={30} decay={2} />;
      })}
    </>
  );
}
