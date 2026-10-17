import * as THREE from "three";

/**
 * Patterns drawn by the material itself: wood planks, a tile grid with grout
 * lines, carpet and stone on floors; lap siding, board and batten, shakes,
 * brick and stucco on walls; shingles and metal seams on roofs; grass and
 * mulch in the yard. Each corner of the house mesh carries a pattern number
 * (see PATTERN in lib/house3d/finishes.ts); 0 is plain color. Drawn from the
 * position on the surface (in feet), so nothing extra is built. Floors use
 * their x and z; walls use the distance along the wall and the height.
 */
export const PATTERN_GLSL = /* glsl */ `
varying float vPattern;
varying vec3 vPatPos;
varying vec3 vPatNormal;
float patHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 patternShade(vec3 col, float pat, vec3 pos, vec3 nrm) {
  int k = int(pat + 0.5);
  vec2 nh = nrm.xz;
  float nl = length(nh);
  // Level along the surface: across a wall or roof, sideways.
  vec2 t = nl > 0.05 ? vec2(-nh.y, nh.x) / nl : vec2(1.0, 0.0);
  float along = dot(pos.xz, t);
  bool isFlat = abs(nrm.y) > 0.7;
  // Floors and the ground use x and z; walls the distance along them and the height.
  vec2 p = isFlat ? pos.xz : vec2(along, pos.y);
  if (k == 10 || k == 11) {
    // Roofs: rows up the slope (the slope distance is the height over how steep it is).
    float up = nl > 0.05 ? pos.y / nl : pos.z;
    if (k == 10) {
      // Shingles: 5.6 in rows, tabs 3 ft wide staggered, each a slightly different tone.
      float row = floor(up / 0.47);
      float tab = floor((along + patHash(vec2(row, 3.0)) * 3.0) / 1.0);
      float fy = fract(up / 0.47);
      float tint = 0.85 + 0.25 * patHash(vec2(row, tab));
      return col * tint * (fy < 0.08 ? 0.62 : 1.0);
    }
    // Standing seams every 16 in.
    float f = fract(along / 1.333);
    return col * (f < 0.04 ? 1.35 : (f < 0.08 ? 0.7 : 1.0));
  }
  if (k == 5) {
    // Lap siding: 7 in boards, each with a shadow line under it.
    float f = fract(p.y / 0.583);
    return col * (f < 0.12 ? 0.72 + 2.0 * f : 1.0);
  }
  if (k == 6) {
    // Board and batten: a 2.5 in batten every 16 in.
    float f = fract(p.x / 1.333);
    return col * (f < 0.16 ? (f < 0.03 || f > 0.13 ? 0.72 : 1.06) : 1.0);
  }
  if (k == 7) {
    // Shakes: 7 in rows of random-width shingles.
    float row = floor(p.y / 0.583);
    float x = p.x + patHash(vec2(row, 7.0)) * 2.0;
    float w = floor(x / 0.6);
    float fy = fract(p.y / 0.583);
    float fx = fract(x / 0.6);
    float tint = 0.85 + 0.25 * patHash(vec2(row, w));
    return col * tint * ((fy < 0.1 || fx < 0.04) ? 0.65 : 1.0);
  }
  if (k == 8) {
    // Brick: 2.67 in courses of 8 in bricks, every other course offset, with mortar.
    float row = floor(p.y / 0.222);
    float x = p.x / 0.667 + mod(row, 2.0) * 0.5;
    float fy = fract(p.y / 0.222);
    float fx = fract(x);
    float tint = 0.85 + 0.25 * patHash(vec2(row, floor(x)));
    bool mortar = fy < 0.14 || fx < 0.05;
    return mortar ? mix(col, vec3(0.62), 0.7) : col * tint;
  }
  if (k == 9) {
    float n = patHash(floor(p * 40.0)) * 0.5 + patHash(floor(p * 9.0)) * 0.5;
    return col * (0.94 + 0.1 * n);
  }
  if (k == 12) {
    float n = patHash(floor(p * 30.0)) * 0.6 + patHash(floor(p * 3.0)) * 0.4;
    return col * (0.82 + 0.3 * n);
  }
  if (k == 13) {
    float n = patHash(floor(p * 18.0));
    return col * (0.75 + 0.45 * n);
  }
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
    if (!isFlat) {
      // Stone on a wall: rough courses of different-sized stones with dark joints.
      float row = floor(p.y / 0.7);
      float x = p.x / (0.9 + 0.8 * patHash(vec2(row, 4.0))) + patHash(vec2(row, 5.0));
      float fy = fract(p.y / 0.7);
      float fx = fract(x);
      float tint = 0.78 + 0.35 * patHash(vec2(row, floor(x)));
      return col * tint * ((fy < 0.07 || fx < 0.05) ? 0.55 : 1.0);
    }
    float n = patHash(floor(p * 5.0)) * 0.6 + patHash(floor(p * 23.0)) * 0.4;
    return col * (0.88 + 0.2 * n);
  }
  return col;
}
`;

/** Add the patterns to a vertex-colored standard material. */
export function withPatterns<M extends THREE.MeshStandardMaterial>(m: M): M {
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nattribute float pattern;\nvarying float vPattern;\nvarying vec3 vPatPos;\nvarying vec3 vPatNormal;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvPattern = pattern;\nvPatPos = position;\nvPatNormal = normal;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${PATTERN_GLSL}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\nif (vPattern > 0.5) diffuseColor.rgb = patternShade(diffuseColor.rgb, vPattern, vPatPos, normalize(vPatNormal));`);
  };
  m.customProgramCacheKey = () => "patterns-2";
  return m;
}
