"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { Opening, Point } from "@/lib/model/schema";
import { drawAddOn, drawFixture, drawFurniture } from "@/lib/house3d/fixtures";
import { hex, MeshBuilder, type Frame, type MeshData } from "@/lib/house3d/mesh";
import { COLORS } from "@/lib/house3d/colors";
import { DEVICE_INFO } from "@/lib/plan/devices";
import { angleOf, sub } from "@/lib/plan/geometry";
import type { OpeningGeometry } from "@/lib/plan/walls";
import type { LayerItem } from "@/lib/furnish/layer";
import type { Ghost } from "@/lib/furnish/stage";
import { toGeometry } from "@/components/house3d/geometry";

/**
 * What Furnish draws in the walkthrough on top of the house: the item being
 * carried (see-through, red where it can't go), a door, window or wall being
 * placed, the box around the item under the dot, and small plates for the
 * outlets, switches and ceiling lights (the house itself doesn't draw those).
 */

type Shape = Pick<Ghost, "entryId" | "x" | "y" | "rotation" | "widthIn" | "depthIn" | "heightIn" | "bottomIn"> & { color?: string };

const WHITE = hex("#f4f2ee");
const PLATE = hex("#fbfaf7");

/** An item's shape as the house would draw it (furniture, fixtures and built-ins), or a plain box. */
function drawShape(mb: MeshBuilder, frame: Frame, g: Shape, floorIn: number) {
  const [kind, type] = [g.entryId.slice(0, g.entryId.indexOf(":")), g.entryId.slice(g.entryId.indexOf(":") + 1)];
  const z = floorIn + 0.3;
  if (kind === "furniture") return drawFurniture(mb, frame, { id: "ghost", kind: type, x: g.x, y: g.y, rotation: g.rotation, widthIn: g.widthIn, depthIn: g.depthIn, ...(g.color ? { color: g.color } : {}) }, z);
  if (kind === "fixture") return drawFixture(mb, new MeshBuilder(), frame, { id: "ghost", kind: type, x: g.x, y: g.y, rotation: g.rotation, widthIn: g.widthIn, depthIn: g.depthIn }, z);
  if (kind === "addon") return drawAddOn(mb, frame, { id: "ghost", kind: type, x: g.x, y: g.y, rotation: g.rotation, widthIn: g.widthIn, depthIn: g.depthIn, heightIn: g.heightIn, bottomIn: g.bottomIn }, z);
  const small = kind === "device" || kind === "hookup";
  mb.block(frame, { x: g.x, y: g.y }, g.rotation, small ? 6 : g.widthIn, small ? 3 : Math.max(g.depthIn, 1), z + g.bottomIn, z + g.bottomIn + (small ? 6 : g.heightIn), kind === "cabinet" ? COLORS.cabinet : WHITE);
}

/** One see-through mesh, white when it fits and red when it doesn't. */
function SeeThrough({ data, ok, opacity = 0.75, highlight = false }: { data: MeshData; ok: boolean; opacity?: number; highlight?: boolean }) {
  const geometry = useMemo(() => toGeometry(data), [data]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity, roughness: 0.9, depthWrite: false }), [opacity]);
  useEffect(() => {
    material.color.set(highlight ? "#2f7fd1" : ok ? "#ffffff" : "#ff6b6b");
  }, [material, ok, highlight]);
  useEffect(() => () => material.dispose(), [material]);
  return <mesh geometry={geometry} material={material} renderOrder={2} />;
}

/** The item being carried or placed. */
export function ItemGhost({ ghost, color, floorIn, frame }: { ghost: Ghost; color?: string; floorIn: number; frame: Frame }) {
  const data = useMemo(() => {
    const mb = new MeshBuilder();
    drawShape(mb, frame, { ...ghost, color }, floorIn);
    return mb.build();
  }, [ghost, color, floorIn, frame]);
  return <SeeThrough data={data} ok={ghost.check.ok} />;
}

/** A door or window being put on a wall or slid along it (or, with `highlight`, the one under the dot). */
export function OpeningGhost({ g, floorIn, frame, ok, highlight = false }: { g: OpeningGeometry; floorIn: number; frame: Frame; ok: boolean; highlight?: boolean }) {
  const data = useMemo(() => {
    const mb = new MeshBuilder();
    const o: Opening = g.opening;
    const sill = o.sillIn ?? 0;
    mb.block(frame, g.center, angleOf(g.u), o.widthIn, 8, floorIn + sill, floorIn + sill + (o.heightIn ?? 80), o.kind === "window" ? hex("#cfe0e6") : COLORS.cabinet);
    return mb.build();
  }, [g, floorIn, frame]);
  return <SeeThrough data={data} ok={ok} opacity={highlight ? 0.3 : 0.6} highlight={highlight} />;
}

/** A wall being drawn, from its first spot to where you're looking. */
export function WallGhost({ a, b, heightIn, floorIn, frame }: { a: Point; b: Point; heightIn: number; floorIn: number; frame: Frame }) {
  const data = useMemo(() => {
    const mb = new MeshBuilder();
    const d = sub(b, a);
    const len = Math.hypot(d.x, d.y);
    if (len > 1) mb.block(frame, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, angleOf(d), len, 4.5, floorIn, floorIn + heightIn, WHITE);
    else mb.block(frame, a, 0, 6, 6, floorIn, floorIn + heightIn, WHITE);
    return mb.build();
  }, [a, b, heightIn, floorIn, frame]);
  return <SeeThrough data={data} ok opacity={0.55} />;
}

/** A see-through box around the item under the dot. */
export function ItemHighlight({ item, floorIn, frame, ceilingIn }: { item: LayerItem; floorIn: number; frame: Frame; ceilingIn: number }) {
  const geometry = useMemo(() => {
    const mb = new MeshBuilder();
    const small = item.kind === "device";
    const bottom = item.mount === "ceiling" ? ceilingIn - 3 : item.bottomIn;
    const h = small ? 7 : item.heightIn;
    mb.block(frame, { x: item.x, y: item.y }, item.rotation, (small ? 7 : item.widthIn) + 2, (small ? 4 : Math.max(item.depthIn, 1)) + 2, floorIn + bottom - 1, floorIn + bottom + h + 1, hex("#2f7fd1"));
    return toGeometry(mb.build());
  }, [item, floorIn, frame, ceilingIn]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = useMemo(() => new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.28, depthWrite: false }), []);
  useEffect(() => () => material.dispose(), [material]);
  return <mesh geometry={geometry} material={material} renderOrder={3} />;
}

/** A see-through blue strip along a stair railing (or the side where one would go), following the slope of the stairs. */
export function RailingHighlight({ a, b, za, zb, heightIn, floorIn, frame }: { a: Point; b: Point; za: number; zb: number; heightIn: number; floorIn: number; frame: Frame }) {
  const geometry = useMemo(() => {
    const mb = new MeshBuilder();
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const pieces = Math.max(1, Math.ceil(len / 12));
    const angle = angleOf(sub(b, a));
    for (let i = 0; i < pieces; i++) {
      const [t0, t1] = [i / pieces, (i + 1) / pieces];
      const at = (t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      const mid = at((t0 + t1) / 2);
      const lo = floorIn + za + (zb - za) * Math.min(t0, t1);
      mb.block(frame, mid, angle, (len / pieces) * 1.02, 5, lo - 1, lo + (zb - za) * (t1 - t0) + heightIn + 1, hex("#2f7fd1"));
    }
    return toGeometry(mb.build());
  }, [a, b, za, zb, heightIn, floorIn, frame]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = useMemo(() => new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.35, depthWrite: false }), []);
  useEffect(() => () => material.dispose(), [material]);
  return <mesh geometry={geometry} material={material} renderOrder={3} />;
}

/** Cover plates for outlets and switches on the walls, and discs for ceiling lights, fans and alarms. Hookups are drawn by the house. */
export function DevicePlates({ items, floorIn, ceilingIn, frame }: { items: LayerItem[]; floorIn: number; ceilingIn: number; frame: Frame }) {
  const data = useMemo(() => {
    const mb = new MeshBuilder();
    for (const it of items) {
      if (it.kind !== "device") continue;
      const kind = it.entryId.slice(it.entryId.indexOf(":") + 1) as keyof typeof DEVICE_INFO;
      if (["water", "drain", "gas", "dryer-vent", "junction"].includes(kind)) continue;
      const info = DEVICE_INFO[kind];
      if (!info) continue;
      if (info.wall) mb.block(frame, { x: it.x, y: it.y }, it.rotation, 3, 0.6, floorIn + it.bottomIn - 2.25, floorIn + it.bottomIn + 2.25, PLATE);
      else mb.block(frame, { x: it.x, y: it.y }, it.rotation, 6, 6, floorIn + ceilingIn - 1.2, floorIn + ceilingIn - 0.2, PLATE);
    }
    return mb.build();
  }, [items, floorIn, ceilingIn, frame]);
  const geometry = useMemo(() => toGeometry(data), [data]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), []);
  useEffect(() => () => material.dispose(), [material]);
  return <mesh geometry={geometry} material={material} />;
}
