"use client";

import { Group, Layer, Line, Stage, Text } from "react-konva";
import type { BubbleDiagram } from "@/lib/model/schema";
import { FREE_COLOR } from "@/lib/bubbles/shapes";
import BubbleShape from "./BubbleShape";

/**
 * A small read-only drawing of one level, for comparing alternatives. Every
 * drawing in a row uses the same scale and middle, so they line up.
 */
export default function MiniSketch({
  diagram,
  width,
  height,
  frame,
  onBubbleClick,
}: {
  diagram: BubbleDiagram;
  width: number;
  height: number;
  /** The area to show, in inches, shared by every drawing in the row. */
  frame: { x0: number; y0: number; x1: number; y1: number };
  onBubbleClick?: (id: string) => void;
}) {
  const pad = 10;
  const scale = Math.min((width - pad * 2) / Math.max(1, frame.x1 - frame.x0), (height - pad * 2) / Math.max(1, frame.y1 - frame.y0));
  const x = width / 2 - ((frame.x0 + frame.x1) / 2) * scale;
  const y = height / 2 - ((frame.y0 + frame.y1) / 2) * scale;
  const byId = new Map(diagram.bubbles.map((b) => [b.id, b]));
  return (
    <Stage width={width} height={height} scaleX={scale} scaleY={scale} x={x} y={y}>
      <Layer>
        {diagram.flows.map((f) => {
          const a = byId.get(f.from);
          const b = byId.get(f.to);
          return a && b ? <Line key={f.id} points={[a.x, a.y, b.x, b.y]} stroke="#857a6a" strokeWidth={1.5} strokeScaleEnabled={false} listening={false} /> : null;
        })}
        {diagram.bubbles.map((b) => (
          <Group
            key={b.id}
            onClick={() => onBubbleClick?.(b.id)}
            onMouseEnter={(e) => {
              const c = e.target.getStage()?.container();
              if (c && onBubbleClick) c.style.cursor = "pointer";
            }}
            onMouseLeave={(e) => {
              const c = e.target.getStage()?.container();
              if (c) c.style.cursor = "default";
            }}
          >
            <BubbleShape
              name="mini-bubble"
              id={`mini-${b.id}`}
              b={b}
              fill={b.color ?? FREE_COLOR}
              stroke="#5b564d"
              strokeWidth={1}
              strokeScaleEnabled={false}
              dash={b.stairs ? [3, 3] : undefined}
            />
            <Text
              x={b.x}
              y={b.y - 5 / scale}
              width={2 * Math.max(b.rx, b.ry)}
              offsetX={Math.max(b.rx, b.ry)}
              align="center"
              text={b.label}
              fontSize={9.5 / scale}
              fill="#2a2925"
              wrap="none"
              ellipsis
              listening={false}
            />
          </Group>
        ))}
      </Layer>
    </Stage>
  );
}
