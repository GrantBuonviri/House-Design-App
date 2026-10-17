"use client";

import { EffectComposer, N8AO, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";

/**
 * What Pretty graphics add over a 3D view: soft shading where surfaces meet
 * (ambient occlusion) and photo-like colors (ACES filmic tone mapping). Not used
 * with Fast. `aoRadius` is in feet: about a room corner's worth inside, more
 * from outside. (The textures and shine are in prettyMaterial.ts.)
 */
export function PrettyLook({ aoRadius = 2.5 }: { aoRadius?: number }) {
  return (
    <EffectComposer multisampling={4}>
      <N8AO aoRadius={aoRadius} distanceFalloff={1} intensity={4} quality="medium" halfRes />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}
