"use client";

import type Konva from "konva";
import { Ellipse, Line, type KonvaNodeEvents } from "react-konva";
import { isDrawn, type Bubble } from "@/lib/bubbles/shapes";

type ShapeProps = Omit<Konva.ShapeConfig, "x" | "y" | "rotation"> &
  KonvaNodeEvents & {
  b: Bubble;
  x?: number;
  y?: number;
};

/** A bubble as Konva draws it: an ellipse, or a drawn room's closed outline. */
export default function BubbleShape({ b, x = b.x, y = b.y, ...rest }: ShapeProps) {
  if (isDrawn(b)) {
    return <Line {...rest} x={x} y={y} rotation={b.rotation} points={b.outline.flatMap((p) => [p.x, p.y])} closed />;
  }
  return <Ellipse {...rest} x={x} y={y} radiusX={b.rx} radiusY={b.ry} rotation={b.rotation} />;
}
