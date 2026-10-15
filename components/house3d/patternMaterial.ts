import * as THREE from "three";

/**
 * Floor patterns drawn by the material itself: wood planks, a tile grid with
 * grout lines, carpet and stone. Each corner of the house mesh carries a
 * pattern number (see PATTERN in lib/house3d/finishes.ts); 0 is plain color.
 * Drawn from the position on the floor, so nothing extra is built.
 */
const COMMON = /* glsl */ `
varying float vPattern;
varying vec3 vPatPos;
float patHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 patternShade(vec3 col, float pat, vec2 p) {
  int k = int(pat + 0.5);
  if (k == 1) {
    // Planks 5 in wide and 6 ft long, ends staggered, each a slightly different tone.
    float w = 5.0 / 12.0;
    float row = floor(p.y / w);
    float off = patHash(vec2(row, 1.0)) * 6.0;
    float along = (p.x + off) / 6.0;
    float board = floor(along);
    float tint = 0.9 + 0.18 * patHash(vec2(row, board));
    float fy = fract(p.y / w);
    float fx = fract(along);
    float seam = (fy < 0.035 || fx < 0.005) ? 0.7 : 1.0;
    float grain = 1.0 + 0.05 * sin((p.x + off) * 7.0 + patHash(vec2(board, row)) * 20.0 + sin(p.y * 25.0) * 0.8);
    return col * tint * seam * grain;
  }
  if (k == 2) {
    // 12 in tiles with light grout.
    vec2 f = fract(p);
    bool grout = min(f.x, 1.0 - f.x) < 0.012 || min(f.y, 1.0 - f.y) < 0.012;
    float tint = 0.95 + 0.07 * patHash(floor(p));
    return grout ? mix(col, vec3(0.72), 0.75) : col * tint;
  }
  if (k == 3) {
    float n = patHash(floor(p * 48.0));
    return col * (0.92 + 0.12 * n);
  }
  if (k == 4) {
    float n = patHash(floor(p * 5.0)) * 0.6 + patHash(floor(p * 23.0)) * 0.4;
    return col * (0.88 + 0.2 * n);
  }
  return col;
}
`;

/** Add the floor patterns to a vertex-colored standard material. */
export function withPatterns<M extends THREE.MeshStandardMaterial>(m: M): M {
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nattribute float pattern;\nvarying float vPattern;\nvarying vec3 vPatPos;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvPattern = pattern;\nvPatPos = position;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${COMMON}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\nif (vPattern > 0.5) diffuseColor.rgb = patternShade(diffuseColor.rgb, vPattern, vPatPos.xz);`);
  };
  m.customProgramCacheKey = () => "floor-patterns";
  return m;
}
