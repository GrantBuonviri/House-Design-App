import { PATTERN } from "./finishes";

/**
 * How each pattern looks with Pretty graphics: a photo texture (or one drawn
 * in code when there's no photo), how many feet one copy of it covers, how
 * strongly it shows over the picked color, and the surface's shine
 * (roughness 0 is a mirror, 1 is chalk; metalness 1 is bare metal).
 * Fast graphics ignore all of this and draw the patterns as before.
 */

/** The textures, in the order they're stacked for the shader. Files are in public/textures (see CREDITS.md there). */
export const TEXTURES = [
  "wood-floor",
  "tile",
  "carpet",
  "stone",
  "brick",
  "stucco",
  "shingles",
  "grass",
  "mulch",
  "plaster",
  "wood-grain",
  "marble",
  "granite",
  "concrete",
  "fabric",
  "leather",
  "siding",
  "rug",
  "metal-seam",
] as const;
export type TextureName = (typeof TEXTURES)[number];

export type SurfaceLook = {
  texture?: TextureName;
  /** Feet covered by one copy of the texture. */
  sizeFt: number;
  /** 0 shows only the picked color, 1 the photo's full light and dark (always tinted to the picked color). */
  strength: number;
  roughness: number;
  metalness: number;
  /** Keep the drawn pattern (board lines, seams) under the texture. */
  keepPattern?: boolean;
};

const matte = (roughness = 0.9): SurfaceLook => ({ sizeFt: 1, strength: 0, roughness, metalness: 0 });

export const SURFACE_LOOKS: Record<number, SurfaceLook> = {
  [PATTERN.none]: matte(),
  [PATTERN.plank]: { texture: "wood-floor", sizeFt: 5.9, strength: 1, roughness: 0.42, metalness: 0 },
  [PATTERN.tile]: { texture: "tile", sizeFt: 6.6, strength: 1, roughness: 0.22, metalness: 0 },
  [PATTERN.carpet]: { texture: "carpet", sizeFt: 5.6, strength: 0.9, roughness: 1, metalness: 0 },
  [PATTERN.stone]: { texture: "stone", sizeFt: 6.6, strength: 1, roughness: 0.75, metalness: 0 },
  [PATTERN.lap]: { texture: "siding", sizeFt: 6.4, strength: 1, roughness: 0.6, metalness: 0 },
  [PATTERN.batten]: { texture: "wood-grain", sizeFt: 4, strength: 0.25, roughness: 0.6, metalness: 0, keepPattern: true },
  [PATTERN.shake]: { texture: "wood-grain", sizeFt: 3, strength: 0.45, roughness: 0.8, metalness: 0, keepPattern: true },
  [PATTERN.brick]: { texture: "brick", sizeFt: 5.9, strength: 1, roughness: 0.85, metalness: 0 },
  [PATTERN.stucco]: { texture: "stucco", sizeFt: 3.3, strength: 0.8, roughness: 0.95, metalness: 0 },
  [PATTERN.shingle]: { texture: "shingles", sizeFt: 10, strength: 1, roughness: 0.85, metalness: 0 },
  [PATTERN.seam]: { texture: "metal-seam", sizeFt: 8, strength: 1, roughness: 0.38, metalness: 0.55 },
  [PATTERN.grass]: { texture: "grass", sizeFt: 6.5, strength: 1, roughness: 1, metalness: 0 },
  [PATTERN.mulch]: { texture: "mulch", sizeFt: 3.3, strength: 1, roughness: 1, metalness: 0 },
  [PATTERN.drywall]: { texture: "plaster", sizeFt: 4.9, strength: 0.5, roughness: 0.88, metalness: 0 },
  [PATTERN.paint]: { texture: "plaster", sizeFt: 4.9, strength: 0.08, roughness: 0.48, metalness: 0 },
  [PATTERN.wood]: { texture: "wood-grain", sizeFt: 4.6, strength: 1, roughness: 0.5, metalness: 0 },
  [PATTERN.cabinet]: { texture: "wood-grain", sizeFt: 4.6, strength: 0.12, roughness: 0.42, metalness: 0 },
  [PATTERN.marble]: { texture: "marble", sizeFt: 6.6, strength: 1, roughness: 0.12, metalness: 0 },
  [PATTERN.granite]: { texture: "granite", sizeFt: 2, strength: 1, roughness: 0.15, metalness: 0 },
  [PATTERN.concrete]: { texture: "concrete", sizeFt: 6.6, strength: 0.9, roughness: 0.8, metalness: 0 },
  [PATTERN.metal]: { sizeFt: 1, strength: 0, roughness: 0.28, metalness: 1 },
  [PATTERN.ceramic]: { sizeFt: 1, strength: 0, roughness: 0.08, metalness: 0 },
  [PATTERN.fabric]: { texture: "fabric", sizeFt: 1.5, strength: 0.9, roughness: 1, metalness: 0 },
  [PATTERN.leather]: { texture: "leather", sizeFt: 1.5, strength: 0.7, roughness: 0.55, metalness: 0 },
  [PATTERN.mirror]: { sizeFt: 1, strength: 0, roughness: 0.03, metalness: 1 },
  [PATTERN.satin]: matte(0.5),
  [PATTERN.rug]: { texture: "rug", sizeFt: 3, strength: 1, roughness: 1, metalness: 0 },
  [PATTERN.butcherBlock]: { texture: "wood-grain", sizeFt: 4.6, strength: 1, roughness: 0.35, metalness: 0 },
};

/** The most pattern numbers the shader has room for. */
export const MAX_PATTERNS = 32;

/** The look of a pattern number (plain matte when it has none). */
export const surfaceLook = (pattern: number): SurfaceLook => SURFACE_LOOKS[Math.round(pattern)] ?? SURFACE_LOOKS[PATTERN.none];

/** The shader's tables, one entry per pattern number: texture layer (-1 for none), size, strength, roughness, metalness, keep the drawn pattern. */
export function lookTables(layerOf: (t: TextureName) => number = (t) => TEXTURES.indexOf(t)) {
  const slot = new Float32Array(MAX_PATTERNS).fill(-1);
  const size = new Float32Array(MAX_PATTERNS).fill(1);
  const strength = new Float32Array(MAX_PATTERNS);
  const rough = new Float32Array(MAX_PATTERNS).fill(0.9);
  const metal = new Float32Array(MAX_PATTERNS);
  const keep = new Float32Array(MAX_PATTERNS);
  for (let k = 0; k < MAX_PATTERNS; k++) {
    const l = SURFACE_LOOKS[k];
    if (!l) continue;
    slot[k] = l.texture ? layerOf(l.texture) : -1;
    size[k] = l.sizeFt;
    strength[k] = l.strength;
    rough[k] = l.roughness;
    metal[k] = l.metalness;
    keep[k] = l.keepPattern ? 1 : 0;
  }
  return { slot, size, strength, rough, metal, keep };
}
