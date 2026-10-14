"use client";

import { Arrow, Group, Line, Rect, Shape, Text } from "react-konva";
import type Konva from "konva";
import type { Fixture, Point } from "@/lib/model/schema";
import { openingType } from "@/lib/plan/catalog";
import { angleOf } from "@/lib/plan/geometry";
import type { OpeningGeometry } from "@/lib/plan/walls";
import type { StairsDrawing } from "@/lib/plan/stairs";

/** The plan symbols: doors and windows in walls, fixtures, and stairs. Sizes are real, in inches. */

export const INK = "#2b2925";
export const ACCENT = "#2f6b4f";
const GLASS = "#5d8fb3";
const flat = (pts: Point[]) => pts.flatMap((p) => [p.x, p.y]);

type Ctx = Konva.Context;

/**
 * A door, window or opening, drawn in its wall's own frame: x runs along the
 * wall (the opening spans -w/2 to w/2) and y across it. `thickness` is the
 * wall's, so windows fill the wall and doors swing clear of it.
 */
export function OpeningSymbol({ g, thickness, selected, scale, name, ghost }: { g: OpeningGeometry; thickness: number; selected: boolean; scale: number; name?: string; ghost?: boolean }) {
  const o = g.opening;
  const type = openingType(o.style);
  const w = o.widthIn;
  const t = Math.max(thickness, 3);
  const color = selected ? ACCENT : INK;
  const thin = 1.2 / scale;
  // The swing side, in the wall's frame: the left of the wall is -y.
  const sgn = -o.side;
  const draw = (ctx: Ctx) => {
    ctx.lineWidth = thin;
    ctx.strokeStyle = color;
    const jambs = () => {
      ctx.beginPath();
      ctx.moveTo(-w / 2, -t / 2);
      ctx.lineTo(-w / 2, t / 2);
      ctx.moveTo(w / 2, -t / 2);
      ctx.lineTo(w / 2, t / 2);
      ctx.stroke();
    };
    const leaf = (hx: number, dir: 1 | -1, r: number) => {
      // Leaf standing open at 90°, and the arc it sweeps.
      ctx.beginPath();
      ctx.moveTo(hx, 0);
      ctx.lineTo(hx, sgn * r);
      ctx.lineWidth = 2 / scale;
      ctx.stroke();
      ctx.lineWidth = thin;
      const a1 = sgn > 0 ? Math.PI / 2 : -Math.PI / 2;
      const a2 = dir > 0 ? 0 : Math.PI;
      let delta = a2 - a1;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta <= -Math.PI) delta += 2 * Math.PI;
      ctx.beginPath();
      ctx.arc(hx, 0, r, a1, a2, delta < 0);
      ctx.setLineDash([4 / scale, 3 / scale]);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    if (o.kind === "window") {
      ctx.beginPath();
      ctx.rect(-w / 2, -t / 2, w, t);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-w / 2, -t / 6);
      ctx.lineTo(w / 2, -t / 6);
      ctx.moveTo(-w / 2, t / 6);
      ctx.lineTo(w / 2, t / 6);
      ctx.strokeStyle = selected ? ACCENT : GLASS;
      ctx.stroke();
      return;
    }
    jambs();
    if (o.kind === "opening") return;
    if (type.swings) {
      const start = o.hinge === "start";
      if (type.double) {
        leaf(-w / 2, 1, w / 2);
        leaf(w / 2, -1, w / 2);
      } else leaf(start ? -w / 2 : w / 2, start ? 1 : -1, w);
      return;
    }
    if (o.style === "door-slider") {
      ctx.beginPath();
      ctx.rect(-w / 2, -t / 4, w / 2 + 2, t / 4);
      ctx.rect(-2, 0, w / 2 + 2, t / 4);
      ctx.strokeStyle = selected ? ACCENT : GLASS;
      ctx.stroke();
      return;
    }
    if (o.style === "door-pocket") {
      ctx.beginPath();
      ctx.setLineDash([4 / scale, 3 / scale]);
      ctx.rect(-w / 2 - w, -1.5, w, 3);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(-w / 2, 0);
      ctx.lineTo(-w / 2 + w * 0.25, 0);
      ctx.lineWidth = 2 / scale;
      ctx.stroke();
      return;
    }
    if (o.style === "door-barn") {
      const y = sgn * (t / 2 + 2);
      ctx.beginPath();
      ctx.moveTo(-w / 2 - 4, y);
      ctx.lineTo(w / 2 + 4, y);
      ctx.lineWidth = 3 / scale;
      ctx.stroke();
      return;
    }
    // Garage door: panels across the opening.
    ctx.beginPath();
    ctx.setLineDash([8 / scale, 4 / scale]);
    ctx.moveTo(-w / 2, 0);
    ctx.lineTo(w / 2, 0);
    ctx.lineWidth = 2 / scale;
    ctx.stroke();
    ctx.setLineDash([]);
  };
  return (
    <Group x={g.center.x} y={g.center.y} rotation={angleOf(g.u)} name={name} id={name ? o.id : undefined} opacity={ghost ? 0.6 : 1} listening={!ghost}>
      <Rect x={-w / 2} y={-Math.max(t, 14 / scale) / 2} width={w} height={Math.max(t, 14 / scale)} fill={selected ? "rgba(47,107,79,0.12)" : "transparent"} />
      <Shape sceneFunc={(ctx) => draw(ctx)} listening={false} />
    </Group>
  );
}

/** A fixture, drawn around its middle with its back toward -y (north at rotation 0). */
export function FixtureSymbol({ f, selected, scale, onTransformEnd, ghost }: { f: Fixture; selected: boolean; scale: number; onTransformEnd?: (e: Konva.KonvaEventObject<Event>) => void; ghost?: boolean }) {
  const w = f.widthIn;
  const d = f.depthIn;
  const color = selected ? ACCENT : INK;
  const draw = (ctx: Ctx) => {
    const thin = 1 / scale;
    ctx.lineWidth = thin;
    ctx.strokeStyle = color;
    const line = (pts: number[]) => {
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
      ctx.stroke();
    };
    const ellipse = (cx: number, cy: number, rx: number, ry: number) => {
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2);
      ctx.stroke();
    };
    const label = (text: string) => {
      const size = Math.min(w, d) * 0.32;
      ctx.fillStyle = color;
      ctx.font = `${size}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, 0, 0);
    };
    switch (f.kind) {
      case "sink":
      case "laundry-sink":
        ctx.beginPath();
        ctx.rect(-w / 2 + 3, -d / 2 + 4, w - 6, d - 7);
        ctx.stroke();
        break;
      case "range":
        for (const [x, y] of [
          [-w / 4, -d / 4],
          [w / 4, -d / 4],
          [-w / 4, d / 4],
          [w / 4, d / 4],
        ])
          ellipse(x, y, Math.min(w, d) * 0.16, Math.min(w, d) * 0.16);
        break;
      case "fridge":
        line([-w / 2, -d / 2, w / 2, d / 2]);
        label("Ref");
        break;
      case "dishwasher":
        label("DW");
        break;
      case "toilet":
        ctx.beginPath();
        ctx.rect(-w / 2, -d / 2, w, d * 0.3);
        ctx.stroke();
        ellipse(0, d * 0.12, w * 0.4, d * 0.36);
        break;
      case "vanity": {
        const n = w >= 60 ? 2 : 1;
        for (let i = 0; i < n; i++) ellipse(n === 1 ? 0 : (i === 0 ? -1 : 1) * w * 0.25, 1, Math.min(8, w / 5), d * 0.28);
        break;
      }
      case "tub":
        ctx.beginPath();
        ctx.roundRect(-w / 2 + 3, -d / 2 + 3, w - 6, d - 6, Math.min(w, d) * 0.3);
        ctx.stroke();
        ellipse(-w / 2 + 9, 0, 1.5, 1.5);
        break;
      case "shower":
        line([-w / 2, -d / 2, w / 2, d / 2]);
        line([w / 2, -d / 2, -w / 2, d / 2]);
        ellipse(0, 0, 2, 2);
        break;
      case "washer":
        ellipse(0, 2, Math.min(w, d) * 0.32, Math.min(w, d) * 0.32);
        break;
      case "dryer":
        label("D");
        break;
      case "closet":
        ctx.setLineDash([4 / scale, 3 / scale]);
        line([-w / 2, 0, w / 2, 0]);
        ctx.setLineDash([]);
        break;
      case "water-heater":
        ellipse(0, 0, w * 0.4, d * 0.4);
        break;
      case "furnace":
        label("F");
        break;
      case "fireplace":
        line([-w * 0.35, d / 2, -w * 0.25, -d / 4, w * 0.25, -d / 4, w * 0.35, d / 2]);
        break;
      case "island":
      case "counter":
        line([-w / 2, -d / 2 + 2, w / 2, -d / 2 + 2]);
        break;
    }
  };
  return (
    <Group
      id={ghost ? undefined : f.id}
      name={ghost ? undefined : "fixture"}
      x={f.x}
      y={f.y}
      rotation={f.rotation}
      opacity={ghost ? 0.55 : 1}
      listening={!ghost}
      onTransformEnd={onTransformEnd}
    >
      <Rect
        x={-w / 2}
        y={-d / 2}
        width={w}
        height={d}
        fill={f.kind === "closet" ? "rgba(255,255,255,0.4)" : "#fdfcf9"}
        stroke={color}
        strokeWidth={selected ? 2 : 1.2}
        strokeScaleEnabled={false}
        dash={f.kind === "closet" ? [5, 3] : undefined}
      />
      <Shape sceneFunc={(ctx) => draw(ctx)} listening={false} />
    </Group>
  );
}

/** Stairs: the outline, step edges and a walking arrow. `down` draws stairs coming up from the floor below. */
export function StairsSymbol({ id, d, selected, scale, down, onTransformEnd }: { id?: string; d: StairsDrawing; selected?: boolean; scale: number; down?: boolean; onTransformEnd?: (e: Konva.KonvaEventObject<Event>) => void }) {
  const color = selected ? ACCENT : INK;
  // The label sits just off the bottom step ("Up") or the top step ("Down").
  const [p0, p1] = down ? [d.arrow[d.arrow.length - 1], d.arrow[d.arrow.length - 2]] : [d.arrow[0], d.arrow[1]];
  const len = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
  const off = 13 / scale;
  const at = { x: p0.x - ((p1.x - p0.x) / len) * off, y: p0.y - ((p1.y - p0.y) / len) * off };
  const tag = down ? "Down" : "Up";
  const w = 60 / scale;
  return (
    <Group id={id} name={down ? undefined : "stairs"} listening={!down} onTransformEnd={onTransformEnd}>
      <Line
        points={flat(d.footprint)}
        closed
        fill={down ? undefined : "#f1ece3"}
        stroke={color}
        strokeWidth={selected ? 2.5 : 1.4}
        strokeScaleEnabled={false}
        dash={down ? [6, 4] : undefined}
        opacity={down ? 0.7 : 1}
      />
      {d.lines.map(([a, b], i) => (
        <Line key={i} points={[a.x, a.y, b.x, b.y]} stroke={color} strokeWidth={1} strokeScaleEnabled={false} opacity={down ? 0.5 : 0.8} listening={false} />
      ))}
      <Arrow
        points={flat(down ? [...d.arrow].reverse() : d.arrow)}
        stroke={color}
        fill={color}
        strokeWidth={1.4}
        strokeScaleEnabled={false}
        pointerLength={8 / scale}
        pointerWidth={7 / scale}
        opacity={down ? 0.6 : 0.9}
        listening={false}
      />
      <Text x={at.x} y={at.y} width={w} offsetX={w / 2} offsetY={6 / scale} align="center" text={tag} fontSize={11 / scale} fontStyle="600" fill={color} listening={false} />
    </Group>
  );
}
