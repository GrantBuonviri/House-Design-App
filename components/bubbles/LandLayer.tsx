"use client";

import { Arrow, Circle, Group, Layer, Line, Shape, Text } from "react-konva";
import type { Point } from "@/lib/model/schema";
import { sunPaths } from "@/lib/bubbles/land";
import type { LandView } from "./types";

const LOT = "#5b6b5f";
const WATER = "#4a86b0";
const WASH = "#a88a5c";
const INK = "#3d3a35";
const LANE = "#b9a27c";
const ROCK = "#8a8580";
const TREE = "#5f8a4f";
const SEASON = { summer: { color: "#e8892b", month: "June" }, winter: { color: "#d8b43a", month: "Dec" } } as const;

const flat = (pts: Point[]) => pts.flatMap((p) => [p.x, p.y]);

/**
 * The land under the flow sketch: the lot line and roads, water, lanes, rocks,
 * trees, contours, a downhill arrow and the sun paths. It only shows things, so the drawing tools pass
 * straight through it. `shift` is how far the lot is being dragged right now.
 */
export default function LandLayer({ land, scale, shift }: { land: LandView; scale: number; shift: { dx: number; dy: number } | null }) {
  const { drawing, offset, show } = land;
  const px = (n: number) => n / scale;
  const at = { x: -offset.x + (shift?.dx ?? 0), y: -offset.y + (shift?.dy ?? 0) };
  const label = (text: string, p: Point, color = INK, size = 11) => {
    const w = px(160);
    return <Text x={p.x} y={p.y - px(size / 2)} width={w} offsetX={w / 2} align="center" text={text} fontSize={px(size)} fill={color} fontStyle="600" />;
  };

  return (
    <Layer listening={false}>
      <Group x={at.x} y={at.y}>
        {show.land && drawing.contours.length > 0 && (
          <Shape
            sceneFunc={(ctx) => {
              const c = drawing.contours;
              ctx.beginPath();
              for (let i = 0; i < c.length; i += 4) {
                ctx.moveTo(c[i], c[i + 1]);
                ctx.lineTo(c[i + 2], c[i + 3]);
              }
              ctx.strokeStyle = "rgba(120,95,60,0.22)";
              ctx.lineWidth = px(1);
              ctx.stroke();
            }}
          />
        )}

        {show.land &&
          drawing.lanes.map((l, i) => (
            <Group key={`lane${i}`}>
              <Line points={flat(l.points)} stroke={LANE} strokeWidth={l.width} lineCap="round" lineJoin="round" opacity={0.45} />
              <Line points={flat(l.points)} stroke={LANE} strokeWidth={1} strokeScaleEnabled={false} dash={[10, 8]} />
              {label("Lane", l.points[Math.floor(l.points.length / 2)], "#7d6a48", 11)}
            </Group>
          ))}

        {show.land &&
          drawing.water.map((w, i) =>
            w.closed ? (
              <Line key={i} points={flat(w.points)} closed fill="rgba(96,140,170,0.3)" stroke={WATER} strokeWidth={1.5} strokeScaleEnabled={false} tension={0.3} />
            ) : (
              <Line
                key={i}
                points={flat(w.points)}
                stroke={w.kind === "wash" ? WASH : WATER}
                strokeWidth={w.kind === "wash" ? 2 : w.kind === "river" ? 7 : 3}
                strokeScaleEnabled={false}
                dash={w.kind === "wash" ? [8, 5] : undefined}
                tension={0.4}
                lineCap="round"
                opacity={0.8}
              />
            ),
          )}

        {show.land &&
          drawing.trees.map((t, i) => (
            <Circle key={`tree${i}`} x={t.at.x} y={t.at.y} radius={t.size / 2} fill={TREE} opacity={0.35} stroke={TREE} strokeWidth={1.5} strokeScaleEnabled={false} />
          ))}
        {show.land &&
          drawing.rocks.map((r, i) => (
            <Group key={`rock${i}`}>
              <Circle x={r.at.x} y={r.at.y} radius={r.size / 2} fill={ROCK} opacity={0.6} stroke="#5d5955" strokeWidth={1.5} strokeScaleEnabled={false} />
              {label("Rock", { x: r.at.x, y: r.at.y + r.size / 2 + px(10) }, "#5d5955", 10)}
            </Group>
          ))}

        {show.property && (
          <>
            <Line points={flat(drawing.outline)} closed stroke={LOT} strokeWidth={2} strokeScaleEnabled={false} dash={[10, 6]} />
            {drawing.roads.map((r, i) => (
              <Group key={`road${i}`}>
                <Line points={[r.a.x, r.a.y, r.b.x, r.b.y]} stroke="#8d8f8c" strokeWidth={r.main ? 6 : 4} strokeScaleEnabled={false} lineCap="round" />
                {label(r.text, r.label, "#5f625f", r.main ? 13 : 11)}
              </Group>
            ))}
          </>
        )}

        {show.land && show.arrow && drawing.downhill && (
          <>
            <Arrow
              points={[drawing.downhill.from.x, drawing.downhill.from.y, drawing.downhill.to.x, drawing.downhill.to.y]}
              stroke={INK}
              fill={INK}
              strokeWidth={2.5}
              strokeScaleEnabled={false}
              pointerLength={px(12)}
              pointerWidth={px(11)}
              opacity={0.75}
            />
            {label(`Downhill · ${drawing.downhill.percent}%`, pastTip(drawing.downhill.from, drawing.downhill.to, px), INK, 12)}
          </>
        )}
      </Group>

      {show.sun && <SunDial center={land.sun.center} radius={land.sun.radius} scale={scale} />}
    </Layer>
  );
}

/** Where the downhill label goes: just past the arrow's tip, far enough that the text clears it. */
function pastTip(from: Point, to: Point, px: (n: number) => number): Point {
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const u = { x: (to.x - from.x) / len, y: (to.y - from.y) / len };
  const d = px(16 + Math.abs(u.x) * 52 + Math.abs(u.y) * 8);
  return { x: to.x + u.x * d, y: to.y + u.y * d };
}

/** A point `d` further along the line from `from` through `p`. */
function towards(p: Point, from: Point, d: number): Point {
  const len = Math.hypot(p.x - from.x, p.y - from.y) || 1;
  return { x: p.x - ((p.x - from.x) / len) * d, y: p.y - ((p.y - from.y) / len) * d };
}

function SunDial({ center, radius, scale }: { center: Point; radius: number; scale: number }) {
  const px = (n: number) => n / scale;
  const { paths, noon } = sunPaths(center, radius);
  const out = (p: Point, d: number) => towards(p, center, -px(d));
  const tag = (text: string, p: Point, color: string) => {
    const w = px(120);
    return <Text x={p.x} y={p.y - px(6)} width={w} offsetX={w / 2} align="center" text={text} fontSize={px(11)} fill={color} fontStyle="600" />;
  };
  return (
    <Group>
      {paths.map((path) => {
        const { color, month } = SEASON[path.season];
        return (
          <Group key={path.season}>
            <Line points={flat(path.points)} stroke={color} strokeWidth={2.5} strokeScaleEnabled={false} lineCap="round" opacity={0.9} />
            <Circle x={path.sunrise.x} y={path.sunrise.y} radius={px(4)} fill={color} />
            <Circle x={path.sunset.x} y={path.sunset.y} radius={px(4)} fill="#fff" stroke={color} strokeWidth={2} strokeScaleEnabled={false} />
            {tag(`${month} sunrise`, out(path.sunrise, 16), color)}
            {tag(`${month} sunset`, out(path.sunset, 16), color)}
          </Group>
        );
      })}
      <Circle x={noon.x} y={noon.y} radius={px(6)} fill="#f2a531" />
      {tag("Noon sun", out(noon, 18), "#b9781a")}
      <Circle x={center.x} y={center.y} radius={px(2.5)} fill={INK} opacity={0.5} />
    </Group>
  );
}
