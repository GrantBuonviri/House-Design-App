"use client";

import { useRef, useState } from "react";
import { Circle, Rect, Shape } from "react-konva";
import type Konva from "konva";
import type { CustomLand, Point } from "@/lib/model/schema";
import type { Pick } from "@/lib/land/featureTools";
import { addGround, moveGround, setGroundRadius, stampGround, isBump, type GroundKind } from "@/lib/land/groundTools";

const FT = 12;
const LOOK: Record<GroundKind, { fill: string; stroke: string }> = {
  hill: { fill: "rgba(160,120,70,0.22)", stroke: "#8a6a3a" },
  dip: { fill: "rgba(90,140,190,0.22)", stroke: "#4a7aa8" },
  steeper: { fill: "rgba(210,120,50,0.2)", stroke: "#c2610f" },
  flatter: { fill: "rgba(70,150,100,0.22)", stroke: "#2f7f4f" },
};

export type GroundSettings = {
  kind: GroundKind;
  /** Height in feet for the next hill or dip. */
  heightFt: number;
  /** Size in feet (radius) of the next shape or brush stamp. */
  radiusFt: number;
  /** 0 to 1, for the next steeper/flatter stamp. */
  strength: number;
};

type Props = {
  land: CustomLand;
  active: boolean;
  pick: Pick;
  onPick: (p: Pick) => void;
  onChange: (l: CustomLand) => void;
  settings: GroundSettings;
  scale: number;
  px: (p: Point) => Point;
  inch: (x: number, y: number) => Point;
  size: { w: number; h: number };
};

const pointer = (e: Konva.KonvaEventObject<MouseEvent>) => e.target.getStage()!.getPointerPosition()!;

/** Hills, dips and steeper/flatter spots on the lot, plus the tools that place and edit them. */
export default function DesignerGround({ land, active, pick, onPick, onChange, settings, scale, px, inch, size }: Props) {
  const painting = useRef<Point | null>(null);
  const [hover, setHover] = useState<Point | null>(null);
  const landRef = useRef(land);
  landRef.current = land;
  const { kind, heightFt, radiusFt, strength } = settings;
  const brush = !isBump(kind);

  const onDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button === 2) return;
    const at = inch(pointer(e).x, pointer(e).y);
    if (brush) {
      painting.current = at;
      onChange(stampGround(land, kind, at, radiusFt, strength));
      onPick(null);
    } else {
      onChange(addGround(land, kind, at, radiusFt, heightFt));
      onPick({ type: "ground", index: land.ground.length });
    }
  };
  const onMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const at = inch(pointer(e).x, pointer(e).y);
    setHover(at);
    const from = painting.current;
    if (from && Math.hypot(at.x - from.x, at.y - from.y) > radiusFt * FT * 0.5) {
      onChange(stampGround(landRef.current, kind, at, radiusFt, strength, from));
      painting.current = at;
    }
  };
  const sel = pick?.type === "ground" ? pick.index : -1;
  const shapes = land.ground.map((g, i) => ({ g, i, c: px(g.at), r: g.radiusFt * FT * scale }));

  return (
    <>
      {active && (
        <Rect
          width={size.w}
          height={size.h}
          fill="rgba(0,0,0,0.001)"
          onMouseDown={onDown}
          onMouseMove={onMove}
          onMouseUp={() => (painting.current = null)}
          onMouseLeave={(e) => {
            painting.current = null;
            setHover(null);
            e.target.getStage()!.container().style.cursor = "";
          }}
          onMouseEnter={(e) => (e.target.getStage()!.container().style.cursor = "crosshair")}
        />
      )}
      {shapes.map(({ g, i, c, r }) => (
        <Circle
          key={g.id}
          x={c.x}
          y={c.y}
          radius={r}
          fill={LOOK[g.kind].fill}
          stroke={LOOK[g.kind].stroke}
          strokeWidth={i === sel ? 2.5 : 1}
          dash={isBump(g.kind) ? undefined : [6, 4]}
          opacity={active ? 1 : 0.5}
          listening={active && (!brush || i === sel)}
          draggable={active}
          onMouseDown={(e) => {
            if (e.evt.button === 2) return;
            e.cancelBubble = true;
            onPick({ type: "ground", index: i });
          }}
          onDragMove={(e) => onChange(moveGround(landRef.current, i, inch(e.target.x(), e.target.y())))}
          onMouseEnter={(e) => (e.target.getStage()!.container().style.cursor = "move")}
          onMouseLeave={(e) => (e.target.getStage()!.container().style.cursor = "")}
        />
      ))}
      {active && sel >= 0 && shapes[sel] && (
        <Circle
          key={`ring-${land.ground[sel].id}`}
          x={shapes[sel].c.x + shapes[sel].r}
          y={shapes[sel].c.y}
          radius={6}
          fill="#fff"
          stroke="#1f2421"
          strokeWidth={2}
          draggable
          onMouseDown={(e) => (e.cancelBubble = true)}
          onDragMove={(e) => {
            const g = landRef.current.ground[sel];
            if (!g) return;
            const p = inch(e.target.x(), e.target.y());
            onChange(setGroundRadius(landRef.current, sel, Math.hypot(p.x - g.at.x, p.y - g.at.y) / FT));
          }}
          onMouseEnter={(e) => (e.target.getStage()!.container().style.cursor = "ew-resize")}
          onMouseLeave={(e) => (e.target.getStage()!.container().style.cursor = "")}
        />
      )}
      {active && hover && !painting.current && (
        <Circle x={px(hover).x} y={px(hover).y} radius={radiusFt * FT * scale} stroke={LOOK[kind].stroke} strokeWidth={1} dash={[3, 3]} listening={false} />
      )}
    </>
  );
}

/** Thin contour lines, so the shape of the ground can be read in the flat drawing. */
export function ContourLines({ segments, px, strong }: { segments: number[][]; px: (p: Point) => Point; strong: boolean }) {
  if (!segments.length) return null;
  return (
    <Shape
      listening={false}
      opacity={strong ? 0.8 : 0.4}
      sceneFunc={(ctx, shape) => {
        ctx.beginPath();
        for (const s of segments) {
          const a = px({ x: s[0], y: s[1] });
          const b = px({ x: s[2], y: s[3] });
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        }
        ctx.fillStrokeShape(shape);
      }}
      stroke="#8a6a3a"
      strokeWidth={strong ? 1.1 : 0.8}
    />
  );
}
