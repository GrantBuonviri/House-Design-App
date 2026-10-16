"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Level, PlanBasics, Project, WalkLabels } from "@/lib/model/schema";
import { IN_PER_UNIT, type Frame } from "@/lib/house3d/mesh";
import type { LevelHeights } from "@/lib/house3d/levels";
import { insidePoint, type Walker } from "@/lib/house3d/walk";
import { costShares, floorColorOf, labelInk, labelLines, LABEL_LINE_IN, type LabelLine } from "@/lib/house3d/walkLabels";
import { boundsOf } from "@/lib/plan/geometry";

/** Room labels lying on the floor in the walkthrough, turned to read the way you're facing. Settings: components/walk/LabelSettingsPanel.tsx. */

type Made = { key: string; texture: THREE.CanvasTexture; w: number; h: number; x: number; y: number; z: number };

const PX = 56;

function drawLabel(lines: LabelLine[], ink: "dark" | "light", background: WalkLabels["background"]) {
  const font = (l: LabelLine) => `${l.bold ? "700" : "500"} ${Math.round(PX * (l.small ? 0.7 : 1))}px system-ui, sans-serif`;
  const probe = document.createElement("canvas").getContext("2d")!;
  const heights = lines.map((l) => PX * (l.small ? 0.7 : 1) * 1.25);
  const widths = lines.map((l) => {
    probe.font = font(l);
    return probe.measureText(l.text).width;
  });
  const pad = PX * 0.4;
  const width = Math.ceil(Math.max(...widths, PX) + pad * 2);
  const height = Math.ceil(heights.reduce((a, b) => a + b, 0) + pad * 2);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const c = canvas.getContext("2d")!;
  if (background === "soft") {
    c.fillStyle = ink === "dark" ? "rgba(255,255,255,0.7)" : "rgba(20,20,20,0.6)";
    c.beginPath();
    c.roundRect(0, 0, width, height, PX * 0.3);
    c.fill();
  }
  c.fillStyle = ink === "dark" ? "#1c1917" : "#fafaf9";
  c.textAlign = "center";
  c.textBaseline = "middle";
  let y = pad;
  lines.forEach((l, i) => {
    c.font = font(l);
    c.fillText(l.text, width / 2, y + heights[i] / 2);
    y += heights[i];
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { texture, aspect: width / height, lineCount: lines.length, heights, height };
}

export function FloorLabels({
  project,
  settings,
  frame,
  heights,
  walker,
  costTotal,
}: {
  project: Project;
  settings: WalkLabels;
  frame: Frame;
  heights: LevelHeights;
  walker: React.RefObject<Walker>;
  costTotal?: number;
}) {
  const basics: PlanBasics | null = project.plan.basics;
  const labels = useMemo<Made[]>(() => {
    const levels: Level[] = project.levels.filter((l) => heights[l.id] && (project.floorPlans[l.id]?.rooms.length ?? 0) > 0);
    const shares = costShares(levels.map((l) => project.floorPlans[l.id].rooms));
    const out: Made[] = [];
    for (const level of levels) {
      for (const room of project.floorPlans[level.id].rooms) {
        const lines = labelLines(
          { room, level, basics, selections: project.interior.selections, cost: costTotal ? { share: shares.get(room.id) ?? 0, total: costTotal } : undefined },
          settings,
        );
        if (!lines.length) continue;
        const ink = labelInk(settings.textColor, floorColorOf(project.interior.selections, room.id));
        const made = drawLabel(lines, ink, settings.background);
        // About LABEL_LINE_IN inches of floor per line of text, but never wider than the room.
        const bb = boundsOf(room.polygon)!;
        const hIn = (made.height / (PX * 1.25)) * LABEL_LINE_IN[settings.textSize];
        let wIn = hIn * made.aspect;
        const fit = Math.min(1, ((bb.x1 - bb.x0) * 0.9) / wIn);
        wIn *= fit;
        const c = insidePoint(room.polygon);
        out.push({
          key: `${level.id}:${room.id}`,
          texture: made.texture,
          w: wIn / IN_PER_UNIT,
          h: (hIn * fit) / IN_PER_UNIT,
          x: (c.x - frame.ox) / IN_PER_UNIT,
          y: (heights[level.id].floorIn + 0.6) / IN_PER_UNIT,
          z: (c.y - frame.oy) / IN_PER_UNIT,
        });
      }
    }
    return out;
  }, [project.levels, project.floorPlans, project.interior.selections, basics, heights, settings, frame, costTotal]);

  useEffect(() => () => labels.forEach((l) => l.texture.dispose()), [labels]);

  // Every label turns to read the way you're facing.
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const yaw = -(walker.current?.yaw ?? 0);
    for (const child of g.children) child.rotation.y = yaw;
  });

  return (
    <group ref={group}>
      {labels.map((l) => (
        <group key={l.key} position={[l.x, l.y, l.z]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={5}>
            <planeGeometry args={[l.w, l.h]} />
            <meshBasicMaterial map={l.texture} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
