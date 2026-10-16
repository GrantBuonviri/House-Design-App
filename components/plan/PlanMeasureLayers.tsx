"use client";

import { Group, Line, Rect, Text } from "react-konva";
import type { FloorPlan, PlanLabels, Point } from "@/lib/model/schema";
import { roomType } from "@/lib/brief/rooms";
import { CATEGORY_COLOR } from "@/lib/bubbles/shapes";
import { fixtureType } from "@/lib/plan/catalog";
import { add, dist, edgesOf, leftNormal, polygonCenter, scale as scaleV, sub, unit } from "@/lib/plan/geometry";
import { edgeFrame, formatLength, labelOn, openingTagText, outsideDimensions, roomSizeText, tapeReading, type Guide } from "@/lib/plan/labels";
import { roomSqft } from "@/lib/plan/measure";
import { leftBulge, wallLength } from "@/lib/plan/arcs";
import { roomOutline } from "@/lib/plan/flatten";
import type { OpeningGeometry } from "@/lib/plan/walls";
import { ACCENT, INK } from "./PlanShapes";
import { uprightAngle } from "./canvasHelpers";

/** Labels and measurements drawn on the floor plan: room text, outside dimensions, drag guides and the measuring tape. */

const SOFT = "#6b716c";
const FAINT = "#7a6f5e";
const GUIDE_RED = "#d6453d";

/** A category color dark enough to read as text. */
function darker(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(v * 0.45);
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

type Tone = "main" | "soft" | "faint";

/** The color for a label: the user's choice, with `room` standing in for the room's own color. */
function toneColor(labels: PlanLabels, tone: Tone, roomColor?: string): string {
  if (labels.textColor === "gray") return "#8a8f89";
  if (labels.textColor === "room" && roomColor) return roomColor;
  return tone === "main" ? INK : tone === "soft" ? SOFT : FAINT;
}

/** Text centered on a point, optionally over a white box, turned `rotation` degrees. Sizes are in world inches. */
function LText({ x, y, rotation = 0, text, fontSize, fill, bold, bg, maxW, s }: { x: number; y: number; rotation?: number; text: string; fontSize: number; fill: string; bold?: boolean; bg?: boolean; maxW?: number; s: number }) {
  const est = text.length * fontSize * 0.56 + 6 / s;
  const w = Math.min(est, maxW ?? est);
  return (
    <Group x={x} y={y} rotation={rotation} listening={false}>
      {bg && <Rect x={-w / 2} y={-fontSize * 0.7} width={w} height={fontSize * 1.4} fill="rgba(255,255,255,0.88)" cornerRadius={2 / s} />}
      <Text x={-w / 2} y={-fontSize * 0.53} width={w} align="center" text={text} fontSize={fontSize} fontStyle={bold ? "600" : "normal"} fill={fill} wrap="none" ellipsis />
    </Group>
  );
}

/** Room names, sizes and wall lengths; the hovered wall's length; and the selected edge's, larger. */
export function RoomLabels({ plan, labels, selectedEdge, selectedRoomId, hoverWall, s }: { plan: FloorPlan; labels: PlanLabels; selectedEdge: { roomId: string; edge: number } | null; selectedRoomId?: string; hoverWall: { a: Point; b: Point; bulge?: number } | null; s: number }) {
  const k = labels.textSize;
  const bg = labels.background === "white";
  const units = labels.units;
  const showEdges = labelOn(labels, "wallLengths");
  const selected = (() => {
    const r = selectedEdge && plan.rooms.find((x) => x.id === selectedEdge.roomId);
    if (!selectedEdge || !r) return null;
    const a = r.polygon[selectedEdge.edge];
    const b = r.polygon[(selectedEdge.edge + 1) % r.polygon.length];
    const f = edgeFrame(a, b, leftBulge(r, selectedEdge.edge));
    const at = add(f.mid, scaleV(leftNormal(f.u), 10 + 12 / s));
    return <LText x={at.x} y={at.y} rotation={uprightAngle(f.u)} text={formatLength(f.length, units) + (f.radius ? ` · R ${formatLength(f.radius, units)}` : "")} fontSize={(13 * k) / s} fill={ACCENT} bold bg={bg} s={s} />;
  })();
  const hf = hoverWall ? edgeFrame(hoverWall.a, hoverWall.b, hoverWall.bulge) : null;
  const hovered = hoverWall && hf && hf.length > 1 ? { at: add(hf.mid, scaleV(leftNormal(hf.u), 14 / s + 6)), rot: uprightAngle(hf.u) } : null;
  const selRoom = selectedRoomId ? plan.rooms.find((r) => r.id === selectedRoomId) : undefined;
  const edgeText = (r: FloorPlan["rooms"][number], strong: boolean) =>
    edgesOf(r.polygon).map((e) => {
      // A curved wall measures along the curve, with its label at the middle of it.
      const f = edgeFrame(e.a, e.b, leftBulge(r, e.i));
      const L = f.length;
      if (!strong && L * s < 64 * k) return null;
      const u = f.u;
      // Inside the room: corners run clockwise, so inside is to the right of each edge.
      const mid = add(f.mid, scaleV(scaleV(leftNormal(u), -1), 6 + (9 * k) / s));
      const roomColor = darker(CATEGORY_COLOR[roomType(r.type ?? "").category] ?? "#d8d2c6");
      return <LText key={`${r.id}-${e.i}`} x={mid.x} y={mid.y} rotation={uprightAngle(u)} text={formatLength(L, units) + (strong && f.radius ? ` · R ${formatLength(f.radius, units)}` : "")} fontSize={((strong ? 10.5 : 9.5) * k) / s} fill={strong ? ACCENT : toneColor(labels, "faint", roomColor)} bold={strong} bg={bg} s={s} />;
    });
  return (
    <>
      <Group listening={false}>
        {plan.rooms.map((r) => {
          const c = polygonCenter(roomOutline(r));
          const roomColor = darker(r.type ? CATEGORY_COLOR[roomType(r.type).category] : "#d8d2c6");
          const lines: { text: string; size: number; fill: string; bold?: boolean }[] = [];
          if (labelOn(labels, "roomNames")) lines.push({ text: r.name, size: 12.5, fill: toneColor(labels, "main", roomColor), bold: labels.boldNames });
          if (labelOn(labels, "roomSizes")) lines.push({ text: roomSizeText(r.polygon, units, r.bulges), size: 10, fill: toneColor(labels, "soft", roomColor) });
          if (labelOn(labels, "sqft")) lines.push({ text: `${roomSqft(r).toLocaleString("en-US")} sq ft`, size: 10.5, fill: toneColor(labels, "soft", roomColor) });
          const gap = 14 * k;
          return (
            <Group key={`label-${r.id}`}>
              {lines.map((l, i) => (
                <LText key={i} x={c.x} y={c.y + (i - (lines.length - 1) / 2) * (gap / s)} text={l.text} fontSize={(l.size * k) / s} fill={l.fill} bold={l.bold} bg={bg} maxW={(140 * k) / s} s={s} />
              ))}
            </Group>
          );
        })}
        {showEdges && plan.rooms.flatMap((r) => edgeText(r, false))}
        {!labels.hideAll && !showEdges && selRoom && edgeText(selRoom, true)}
        {showEdges &&
          plan.walls.map((w) => {
            const L = wallLength(w);
            if (L * s < 64 * k) return null;
            const f = edgeFrame(w.a, w.b, w.bulge);
            const at = add(f.mid, scaleV(leftNormal(f.u), 6 + (9 * k) / s));
            return <LText key={`wl-${w.id}`} x={at.x} y={at.y} rotation={uprightAngle(f.u)} text={formatLength(L, units)} fontSize={(9.5 * k) / s} fill={toneColor(labels, "faint")} bg={bg} s={s} />;
          })}
      </Group>
      {selected}
      {hovered && hoverWall && <LText x={hovered.at.x} y={hovered.at.y} rotation={hovered.rot} text={formatLength(hf!.length, units) + (hf!.radius ? ` · R ${formatLength(hf!.radius, units)}` : "")} fontSize={(12 * k) / s} fill={ACCENT} bold bg s={s} />}
    </>
  );
}

/** Door and window sizes, and fixture names, beside the things they describe. */
export function ThingLabels({ plan, geos, labels, s }: { plan: FloorPlan; geos: OpeningGeometry[]; labels: PlanLabels; s: number }) {
  const k = labels.textSize;
  const bg = labels.background === "white";
  const tags = labelOn(labels, "openingTags");
  const names = labelOn(labels, "fixtureNames");
  return (
    <Group listening={false}>
      {tags &&
        geos.map((g) => {
          if (g.opening.widthIn * s < 30 * k) return null;
          // Inside the room, a little further in than the wall lengths.
          const at = add(g.center, scaleV(g.n, -30 * k));
          return <LText key={`ot-${g.opening.id}`} x={at.x} y={at.y} rotation={uprightAngle(g.u)} text={openingTagText(g.opening.widthIn, g.opening.heightIn, labels.units)} fontSize={(8.5 * k) / s} fill={toneColor(labels, "faint")} bg={bg} s={s} />;
        })}
      {names &&
        plan.fixtures.map((f) => {
          if (Math.min(f.widthIn, f.depthIn) * s < 14) return null;
          return <LText key={`fn-${f.id}`} x={f.x} y={f.y + f.depthIn / 2 + (8 * k) / s} text={fixtureType(f.kind).label} fontSize={(8.5 * k) / s} fill={toneColor(labels, "faint")} bg={bg} s={s} />;
        })}
    </Group>
  );
}

/** Dimension strings around the outside of the floor: each room's stretch, and the overall length. */
export function OutsideDims({ plan, labels, s }: { plan: FloorPlan; labels: PlanLabels; s: number }) {
  if (!labelOn(labels, "outsideDims")) return null;
  const k = labels.textSize;
  const bg = labels.background === "white";
  const color = toneColor(labels, "faint");
  return (
    <Group listening={false}>
      {outsideDimensions(plan, labels.units).map((d, i) => {
        const along = unit(sub(d.b, d.a));
        const tick = scaleV(leftNormal(along), 5 / s);
        const mid = scaleV(add(d.a, d.b), 0.5);
        const long = dist(d.a, d.b) * s > 34 * k;
        return (
          <Group key={i}>
            <Line points={[d.a.x, d.a.y, d.b.x, d.b.y]} stroke={color} strokeWidth={1} strokeScaleEnabled={false} />
            {[d.a, d.b].map((p, j) => (
              <Line key={j} points={[p.x - tick.x, p.y - tick.y, p.x + tick.x, p.y + tick.y]} stroke={color} strokeWidth={1.4} strokeScaleEnabled={false} />
            ))}
            {long && <LText x={mid.x + (d.out.x * (7 * k)) / s} y={mid.y + (d.out.y * (7 * k)) / s} rotation={uprightAngle(along)} text={d.text} fontSize={(9.5 * k) / s} fill={color} bg={bg} s={s} />}
          </Group>
        );
      })}
    </Group>
  );
}

/** Red distance lines (like Figma's) from what is being dragged to the nearest walls. */
export function DistanceGuides({ guides, labels, s }: { guides: Guide[]; labels: PlanLabels; s: number }) {
  return (
    <Group listening={false}>
      {guides.map((g, i) => {
        const along = unit(sub(g.to, g.from));
        const tick = scaleV(leftNormal(along), 4 / s);
        const mid = scaleV(add(g.from, g.to), 0.5);
        const away = scaleV(leftNormal(along), 9 / s);
        return (
          <Group key={i}>
            <Line points={[g.from.x, g.from.y, g.to.x, g.to.y]} stroke={GUIDE_RED} strokeWidth={1} strokeScaleEnabled={false} />
            {[g.from, g.to].map((p, j) => (
              <Line key={j} points={[p.x - tick.x, p.y - tick.y, p.x + tick.x, p.y + tick.y]} stroke={GUIDE_RED} strokeWidth={1} strokeScaleEnabled={false} />
            ))}
            <LText x={mid.x + away.x} y={mid.y + away.y} text={formatLength(g.inches, labels.units)} fontSize={11 / s} fill={GUIDE_RED} bold bg s={s} />
          </Group>
        );
      })}
    </Group>
  );
}

/** The measuring tape: a line between two clicked points with its distance and angle. */
export function TapeLine({ a, b, labels, s }: { a: Point; b: Point | null; labels: PlanLabels; s: number }) {
  if (!b) return <Rect x={a.x - 3 / s} y={a.y - 3 / s} width={6 / s} height={6 / s} fill={ACCENT} listening={false} />;
  const r = tapeReading(a, b);
  const mid = scaleV(add(a, b), 0.5);
  const u = unit(sub(b, a));
  const off = scaleV(leftNormal(u), 14 / s);
  return (
    <Group listening={false}>
      <Line points={[a.x, a.y, b.x, b.y]} stroke={ACCENT} strokeWidth={2} strokeScaleEnabled={false} dash={[8, 4]} />
      {[a, b].map((p, i) => (
        <Rect key={i} x={p.x - 3 / s} y={p.y - 3 / s} width={6 / s} height={6 / s} fill={ACCENT} />
      ))}
      <LText x={mid.x + off.x} y={mid.y + off.y} text={`${formatLength(r.inches, labels.units)} · ${r.angle}°`} fontSize={12 / s} fill={ACCENT} bold bg s={s} />
    </Group>
  );
}
