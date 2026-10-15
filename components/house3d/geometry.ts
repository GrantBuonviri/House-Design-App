import * as THREE from "three";
import type { Part, Pick } from "@/lib/house3d/build";
import type { MeshData } from "@/lib/house3d/mesh";

/** Join parts into one geometry, remembering which part each triangle came from (for clicking). */
export function mergeParts(parts: Part[]): { geometry: THREE.BufferGeometry; picks: (Pick | undefined)[] } | null {
  const used = parts.filter((p) => p.mesh.count > 0);
  if (!used.length) return null;
  const picks: (Pick | undefined)[] = [];
  for (const p of used) for (let i = 0; i < p.mesh.count; i++) picks.push(p.pick);
  return { geometry: toGeometry(concatMeshes(used.map((p) => p.mesh))), picks };
}

export function concatMeshes(meshes: MeshData[]): MeshData {
  const total = meshes.reduce((s, m) => s + m.count, 0);
  const positions = new Float32Array(total * 9);
  const normals = new Float32Array(total * 9);
  const colors = new Float32Array(total * 9);
  const patterned = meshes.some((m) => m.patterns);
  const patterns = patterned ? new Float32Array(total * 3) : undefined;
  let at = 0;
  for (const m of meshes) {
    positions.set(m.positions, at * 9);
    normals.set(m.normals, at * 9);
    colors.set(m.colors, at * 9);
    if (patterns && m.patterns) patterns.set(m.patterns, at * 3);
    at += m.count;
  }
  return { positions, normals, colors, ...(patterns ? { patterns } : {}), count: total };
}

export function toGeometry(m: MeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(m.normals, 3));
  g.setAttribute("color", new THREE.BufferAttribute(m.colors, 3));
  // Every geometry gets a pattern per corner, so one material draws them all.
  g.setAttribute("pattern", new THREE.BufferAttribute(m.patterns ?? new Float32Array(m.count * 3), 1));
  g.computeBoundingSphere();
  return g;
}
