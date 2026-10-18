"use client";

import * as THREE from "three";
import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { useGraphics } from "@/lib/graphics";
import { lookTables, MAX_PATTERNS, TEXTURES } from "@/lib/house3d/looks";
import { averageLinear, drawTexture } from "@/lib/house3d/textureDraw";
import { roomEnvironment } from "@/lib/house3d/environment";
import { PATTERN_GLSL } from "./patternMaterial";

/**
 * The Pretty material: every surface takes its photo texture (tinted to the
 * picked color), its shine (roughness and metalness) and reflections of a
 * built-in room, by the pattern number on each corner (see lib/house3d/looks.ts).
 * Textures are sampled from the surface position, like the drawn patterns:
 * floors by x and z, walls by the distance along them and the height. Fast
 * keeps the plain material in House3DView.
 */

/** Each texture's pixels across (and down). */
const TEX_SIZE = 1024;

const tables = lookTables();
const uniforms = {
  // Stand-in until the textures load (a texture's size can't change once it's on the GPU).
  uLookTex: { value: new THREE.DataArrayTexture(new Uint8Array(4), 1, 1, 1) },
  uLookReady: { value: 0 },
  uSlot: { value: tables.slot },
  uSize: { value: tables.size },
  uStrength: { value: tables.strength },
  uRough: { value: tables.rough },
  uMetal: { value: tables.metal },
  uKeep: { value: tables.keep },
  uMean: { value: new Float32Array(TEXTURES.length * 3).fill(0.5) },
};

const LOOK_GLSL = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray uLookTex;
uniform float uLookReady;
uniform float uSlot[${MAX_PATTERNS}];
uniform float uSize[${MAX_PATTERNS}];
uniform float uStrength[${MAX_PATTERNS}];
uniform float uRough[${MAX_PATTERNS}];
uniform float uMetal[${MAX_PATTERNS}];
uniform float uKeep[${MAX_PATTERNS}];
uniform vec3 uMean[${TEXTURES.length}];
float lookNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = patHash(i), b = patHash(i + vec2(1.0, 0.0)), c = patHash(i + vec2(0.0, 1.0)), d = patHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
// Where on the texture: floors and tops by x and z, roofs up the slope, walls and sides along and up.
vec2 lookUV(vec3 pos, vec3 nrm, int k) {
  vec2 nh = nrm.xz;
  float nl = length(nh);
  vec2 t = nl > 0.05 ? vec2(-nh.y, nh.x) / nl : vec2(1.0, 0.0);
  float along = dot(pos.xz, t);
  if (k == 10 || k == 11) return vec2(along, nl > 0.05 ? -pos.y / nl : pos.z);
  if (abs(nrm.y) > 0.7) return pos.xz;
  return vec2(along, -pos.y);
}
`;

function withLooks<M extends THREE.MeshStandardMaterial>(m: M, key: string): M {
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nattribute float pattern;\nvarying float vPattern;\nvarying vec3 vPatPos;\nvarying vec3 vPatNormal;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvPattern = pattern;\nvPatPos = position;\nvPatNormal = normal;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${PATTERN_GLSL}\n${LOOK_GLSL}`)
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
int lk = clamp(int(vPattern + 0.5), 0, ${MAX_PATTERNS - 1});
vec3 lnrm = normalize(vPatNormal);
float lslot = uSlot[lk];
bool ltex = lslot > -0.5 && uLookReady > 0.5;
// Board lines and seams stay drawn; until the photos are in, so do the old patterns.
if (lk > 0 && lk < 14 && (uKeep[lk] > 0.5 || !ltex)) diffuseColor.rgb = patternShade(diffuseColor.rgb, vPattern, vPatPos, lnrm);
if (ltex) {
  vec2 luv = lookUV(vPatPos, lnrm, lk);
  vec3 lt = texture(uLookTex, vec3(luv / uSize[lk], lslot)).rgb;
  vec3 ld = clamp(lt / max(uMean[int(lslot + 0.5)], vec3(0.01)), 0.0, 3.0);
  // A slow, wide change in tone so the repeats don't line up into a grid.
  float lbig = 0.93 + 0.14 * lookNoise(luv / 7.0);
  diffuseColor.rgb *= mix(vec3(1.0), ld * lbig, uStrength[lk]);
}`,
      )
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\nroughnessFactor = uRough[lk];`)
      .replace("#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>\nmetalnessFactor = uMetal[lk];`);
  };
  m.customProgramCacheKey = () => key;
  return m;
}

/** Solid surfaces with Pretty graphics. */
export const prettySolidMaterial = withLooks(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }), "looks-1");
/** Window glass with Pretty graphics: clearer, and it reflects. */
export const prettyGlassMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.28, depthWrite: false });

const env = (() => {
  const w = 256;
  const data = roomEnvironment(w);
  const half = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) half[i] = THREE.DataUtils.toHalfFloat(data[i]);
  const t = new THREE.DataTexture(half, w, w / 2, THREE.RGBAFormat, THREE.HalfFloatType);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.LinearSRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.flipY = true;
  t.needsUpdate = true;
  return t;
})();
prettySolidMaterial.envMap = env;
prettyGlassMaterial.envMap = env;
prettyGlassMaterial.envMapIntensity = 1.2;

/** How much the built-in room's light reaches the surfaces: full by day, little at night. */
export function setDaylight(day: number) {
  const d = Math.max(0, Math.min(1, day));
  prettySolidMaterial.envMapIntensity = 0.1 + 0.3 * d;
  // Windows stop mirroring the bright built-in room after dark, so the night sky shows through them.
  prettyGlassMaterial.envMapIntensity = 0.15 + 1.05 * d;
}
setDaylight(1);

let loading: Promise<void> | null = null;

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((done) => {
    const img = new Image();
    img.onload = () => done(img);
    img.onerror = () => done(null);
    img.src = src;
  });
}

/** Load the photo textures (drawing the ones there's no photo for) into one stack; done once they're in. */
export function loadLooks(maxAnisotropy: number): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    const n = TEXTURES.length;
    const pixels = new Uint8Array(TEX_SIZE * TEX_SIZE * 4 * n);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = TEX_SIZE;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    const means = uniforms.uMean.value;
    for (let i = 0; i < n; i++) {
      const name = TEXTURES[i];
      const img = await loadImage(`/textures/${name}.jpg`);
      if (img) ctx.drawImage(img, 0, 0, TEX_SIZE, TEX_SIZE);
      else {
        // No photo: draw it in code at half size and scale it up.
        const small = TEX_SIZE / 2;
        const tmp = document.createElement("canvas");
        tmp.width = tmp.height = small;
        tmp.getContext("2d")?.putImageData(new ImageData(drawTexture(name, small) as Uint8ClampedArray<ArrayBuffer>, small, small), 0, 0);
        ctx.drawImage(tmp, 0, 0, TEX_SIZE, TEX_SIZE);
      }
      const layer = ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE).data;
      pixels.set(layer, i * TEX_SIZE * TEX_SIZE * 4);
      means.set(averageLinear(layer), i * 3);
      // Let the page breathe between textures.
      await new Promise((r) => setTimeout(r, 0));
    }
    const texture = new THREE.DataArrayTexture(pixels, TEX_SIZE, TEX_SIZE, n);
    texture.anisotropy = Math.min(8, maxAnisotropy);
    texture.format = THREE.RGBAFormat;
    texture.type = THREE.UnsignedByteType;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    uniforms.uLookTex.value = texture;
    uniforms.uLookReady.value = 1;
  })();
  return loading;
}

/** The solid and glass materials for the chosen graphics (inside a Canvas). With Pretty, starts loading the textures and redraws once they're in. */
export function useHouseMaterials(fast: THREE.Material, fastGlass: THREE.Material) {
  const pretty = useGraphics((g) => g.quality) === "pretty";
  const { gl, invalidate } = useThree();
  useEffect(() => {
    if (!pretty) return;
    let live = true;
    loadLooks(gl.capabilities.getMaxAnisotropy()).then(() => live && invalidate());
    return () => {
      live = false;
    };
  }, [pretty, gl, invalidate]);
  return pretty ? { solid: prettySolidMaterial, glass: prettyGlassMaterial } : { solid: fast, glass: fastGlass };
}
