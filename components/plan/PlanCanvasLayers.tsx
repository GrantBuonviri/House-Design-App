"use client";

import { Circle, Group, Layer, Line, Rect, Text } from "react-konva";
import type { BubbleDiagram, FloorPlan, FurnitureItem, Level, PlanRoom, Point } from "@/lib/model/schema";
import { formatFeetInches } from "@/lib/model/units";
import { add, dist, edgesOf, leftNormal, scale as scaleV, sub, unit } from "@/lib/plan/geometry";
import { roomSqft } from "@/lib/plan/measure";
import { furnitureOutline, furnitureType } from "@/lib/plan/furniture";
import type { SolidWall } from "@/lib/plan/walls";
import type { Overhang } from "@/lib/plan/support";
import type { Region } from "@/lib/house3d/footprint";
import type { Guides } from "@/lib/plan/snap";
import BubbleShape from "@/components/bubbles/BubbleShape";
import { ACCENT, INK } from "./PlanShapes";
import { edgeId, isPicked, type PlanSelection, type PlanTool } from "./types";
import { flat, stripes, uprightAngle, type Box } from "./canvasHelpers";

/** The pieces PlanCanvas draws. Each takes plain props, so the canvas keeps the state and mouse handling. */

/** The flow sketch and the floor below, drawn faintly to trace over. */
export function ReferenceLayer({ sketch, below, support, above, s }: { sketch: BubbleDiagram | null; below: { plan: FloorPlan; level: Level } | null; support?: Region[] | null; above?: FloorPlan | null; s: number }) {
  return (
    <Layer listening={false}>
      {sketch?.bubbles.map((b) => (
        <Group key={b.id} opacity={0.35}>
          <BubbleShape b={b} fill={b.color ?? "#ead9f0"} stroke={INK} strokeWidth={1} strokeScaleEnabled={false} dash={[5, 4]} />
          <Text x={b.x} y={b.y - 6 / s} text={b.label} fontSize={11 / s} width={160 / s} offsetX={80 / s} align="center" fill={INK} />
        </Group>
      ))}
      {below?.plan.rooms.map((r) => (
        <Line key={r.id} points={flat(r.polygon)} closed stroke={INK} strokeWidth={1} strokeScaleEnabled={false} dash={[6, 4]} opacity={0.3} />
      ))}
      {above?.rooms.map((r) => (
        <Line key={`above-${r.id}`} points={flat(r.polygon)} closed stroke={INK} strokeWidth={1} strokeScaleEnabled={false} dash={[2, 4]} opacity={0.3} />
      ))}
      {support?.flatMap((r, i) => [r.outline, ...r.holes].map((ring, k) => <Line key={`support-${i}-${k}`} points={flat(ring)} closed stroke={INK} strokeWidth={2} strokeScaleEnabled={false} opacity={0.55} />))}
    </Layer>
  );
}

/** The parts of rooms that hang past the floor below: red stripes, and how far they reach. */
export function OverhangLayer({ overhangs, s, past = "the wall below" }: { overhangs: Overhang[]; s: number; past?: string }) {
  const pattern = stripes();
  const w = 260 / s;
  return (
    <Layer listening={false}>
      {overhangs.flatMap((o) =>
        o.pieces.map((piece, i) => (
          <Line
            key={`${o.roomId}-${i}`}
            points={flat(piece)}
            closed
            fill="rgba(200,50,40,0.18)"
            fillPatternImage={pattern as unknown as HTMLImageElement}
            fillPatternScale={{ x: 1 / s, y: 1 / s }}
            fillPriority={pattern ? "pattern" : "color"}
            stroke="#c8322a"
            strokeWidth={1.5}
            strokeScaleEnabled={false}
          />
        )),
      )}
      {overhangs.map((o) => (
        <Text key={`t-${o.roomId}`} x={o.at.x} y={o.at.y} width={w} offsetX={w / 2} offsetY={6 / s} align="center" text={`hangs ${formatFeetInches(o.depthIn)} past ${past}`} fontSize={11.5 / s} fontStyle="600" fill="#a3231c" />
      ))}
    </Layer>
  );
}

/** Furniture placed in the walkthrough: outlines only (it's moved there, with Design on). */
export function FurnitureOutlines({ furniture, s, names = true }: { furniture: FurnitureItem[]; s: number; names?: boolean }) {
  return (
    <Group listening={false}>
      {furniture.map((f) => {
        const t = furnitureType(f.kind);
        return (
          <Group key={f.id}>
            <Line points={flat(furnitureOutline(f))} closed fill={f.color ?? "#cfcac0"} opacity={t?.flat ? 0.25 : 0.45} stroke="#6f6658" strokeWidth={1} strokeScaleEnabled={false} dash={[4, 3]} />
            {names && !t?.flat && Math.min(f.widthIn, f.depthIn) * s > 28 && (
              <Text x={f.x} y={f.y} width={f.widthIn} offsetX={f.widthIn / 2} offsetY={5 / s} align="center" text={t?.label ?? ""} fontSize={9.5 / s} fill="#4a463f" wrap="none" ellipsis />
            )}
          </Group>
        );
      })}
    </Group>
  );
}

/** Walls, each room edge as its own hit target so it can be picked and pushed. */
/** Half walls, and the counter cap on top of one. */
const HALF_WALL = "#9a9285";
const CAP = "#d6cbb6";

export function PlanWalls({ solids, selection, s }: { solids: SolidWall[]; selection: PlanSelection; s: number }) {
  return (
    <>
      {solids.map((w, i) => {
        const host = w.piece.host;
        const id = "roomId" in host ? edgeId(host.roomId, host.edge) : host.wallId;
        const on = isPicked(selection, id) || ("wallId" in host ? false : isPicked(selection, host.roomId) && selection.length === 1);
        if (w.open) {
          // A removed wall: a faint line where one room ends and the next begins. A porch edge: a stronger dash.
          const removed = w.piece.removed;
          return (
            <Line
              key={i}
              id={id}
              name="edge"
              points={[w.a.x, w.a.y, w.b.x, w.b.y]}
              stroke={on ? ACCENT : removed ? "#b3ab9c" : "#7d766a"}
              strokeWidth={removed ? 1 : 1.5}
              strokeScaleEnabled={false}
              dash={removed ? [4, 4] : [8, 5]}
              hitStrokeWidth={12 / s}
            />
          );
        }
        const u = unit(sub(w.b, w.a));
        const half = w.thicknessIn / 2;
        const a = w.capA ? add(w.a, scaleV(u, -half)) : w.a;
        const b = w.capB ? add(w.b, scaleV(u, half)) : w.b;
        // A half wall is drawn lighter, so it reads as lower; one with a counter cap shows the cap's overhang around it.
        const low = w.piece.height;
        const wall = (
          <Line
            key={i}
            id={id}
            name={"wallId" in host ? "wall" : "edge"}
            points={[a.x, a.y, b.x, b.y]}
            stroke={on ? ACCENT : w.exterior ? INK : low ? HALF_WALL : "#4a463f"}
            strokeWidth={w.thicknessIn}
            hitStrokeWidth={Math.max(w.thicknessIn, 12 / s)}
            lineCap="butt"
          />
        );
        if (low !== "half-cap") return wall;
        return (
          <Group key={i}>
            <Line points={[a.x, a.y, b.x, b.y]} stroke={CAP} strokeWidth={w.thicknessIn + 3} lineCap="butt" listening={false} />
            {wall}
          </Group>
        );
      })}
    </>
  );
}

/** A room or walls being drawn: the dragged rectangle, or the corners clicked so far. */
export function DraftPreview({ rectStart, rectEnd, draft, cursor, tool, typed, s }: { rectStart: Point | null; rectEnd: Point | null; draft: Point[]; cursor: Point | null; tool: PlanTool; typed: string; s: number }) {
  return (
    <>
      {rectStart && rectEnd && (
        <Rect
          x={Math.min(rectStart.x, rectEnd.x)}
          y={Math.min(rectStart.y, rectEnd.y)}
          width={Math.abs(rectEnd.x - rectStart.x)}
          height={Math.abs(rectEnd.y - rectStart.y)}
          fill="rgba(47,107,79,0.12)"
          stroke={ACCENT}
          strokeWidth={2}
          strokeScaleEnabled={false}
          dash={[6, 4]}
          listening={false}
        />
      )}
      {rectStart && rectEnd && (
        <Text
          x={(rectStart.x + rectEnd.x) / 2}
          y={(rectStart.y + rectEnd.y) / 2}
          width={160 / s}
          offsetX={80 / s}
          offsetY={6 / s}
          align="center"
          text={`${formatFeetInches(Math.abs(rectEnd.x - rectStart.x))} × ${formatFeetInches(Math.abs(rectEnd.y - rectStart.y))}`}
          fontSize={12 / s}
          fontStyle="600"
          fill={ACCENT}
          listening={false}
        />
      )}
      {draft.length > 0 && (
        <Group listening={false}>
          <Line
            points={flat(cursor ? [...draft, cursor] : draft)}
            closed={tool === "room"}
            fill={tool === "room" ? "rgba(47,107,79,0.1)" : undefined}
            stroke={ACCENT}
            strokeWidth={tool === "wall" ? 4.5 : 2}
            strokeScaleEnabled={tool !== "wall"}
            dash={tool === "room" ? [6 / s, 4 / s] : undefined}
            opacity={tool === "wall" ? 0.7 : 1}
          />
          {draft.map((p, i) => (
            <Circle key={i} x={p.x} y={p.y} radius={(i === 0 && tool === "room" ? 6 : 3.5) / s} fill={i === 0 ? ACCENT : "#fff"} stroke={ACCENT} strokeWidth={1.5} strokeScaleEnabled={false} />
          ))}
          {cursor && (
            <Text x={cursor.x + 10 / s} y={cursor.y + 10 / s} text={typed ? `${typed}▏ (Enter)` : formatFeetInches(dist(draft[draft.length - 1], cursor))} fontSize={11.5 / s} fontStyle="600" fill={ACCENT} />
          )}
        </Group>
      )}
    </>
  );
}

/** A small "+" in the middle of each edge of the selected room: drag one to make a new corner. */
export function MidNodes({ room, s }: { room: PlanRoom; s: number }) {
  return (
    <>
      {edgesOf(room.polygon).map((e) => {
        if (dist(e.a, e.b) * s < 28) return null;
        const m = scaleV(add(e.a, e.b), 0.5);
        const r = 5 / s;
        return (
          <Group key={e.i} id={edgeId(room.id, e.i)} name="mid" x={m.x} y={m.y}>
            <Circle radius={r} fill="#fff" stroke={ACCENT} strokeWidth={1.5} strokeScaleEnabled={false} hitStrokeWidth={8} />
            <Line points={[-r * 0.55, 0, r * 0.55, 0]} stroke={ACCENT} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
            <Line points={[0, -r * 0.55, 0, r * 0.55]} stroke={ACCENT} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
          </Group>
        );
      })}
    </>
  );
}

/** While a corner is dragged: the two edge lengths beside it and the room's square feet. */
export function NodeReadout({ plan, roomId, i, s }: { plan: FloorPlan; roomId: string; i: number; s: number }) {
  const room = plan.rooms.find((r) => r.id === roomId);
  if (!room || !room.polygon[i]) return null;
  const n = room.polygon.length;
  const p = room.polygon[i];
  const tag = (a: Point, b: Point, key: string) => {
    const u = unit(sub(b, a));
    const mid = add(scaleV(add(a, b), 0.5), scaleV(leftNormal(u), -(10 + 8 / s)));
    const w = 90 / s;
    return <Text key={key} x={mid.x} y={mid.y} offsetX={w / 2} offsetY={6 / s} width={w} align="center" rotation={uprightAngle(u)} text={formatFeetInches(dist(a, b))} fontSize={12 / s} fontStyle="600" fill={ACCENT} />;
  };
  const w = 120 / s;
  return (
    <Group listening={false}>
      {tag(room.polygon[(i - 1 + n) % n], p, "in")}
      {tag(p, room.polygon[(i + 1) % n], "out")}
      <Text x={p.x} y={p.y - 24 / s} offsetX={w / 2} width={w} align="center" text={`${roomSqft(room).toLocaleString("en-US")} sq ft`} fontSize={11.5 / s} fontStyle="600" fill={ACCENT} />
    </Group>
  );
}

/** Lining-up guides while snapping, and the box being dragged to select. */
export function GuidesAndBox({ guides, box }: { guides: Guides; box: Box | null }) {
  return (
    <>
      {guides.x !== undefined && <Line points={[guides.x, -1e5, guides.x, 1e5]} stroke={ACCENT} strokeWidth={1} strokeScaleEnabled={false} dash={[4, 4]} opacity={0.6} listening={false} />}
      {guides.y !== undefined && <Line points={[-1e5, guides.y, 1e5, guides.y]} stroke={ACCENT} strokeWidth={1} strokeScaleEnabled={false} dash={[4, 4]} opacity={0.6} listening={false} />}
      {box && (
        <Rect
          x={Math.min(box.x0, box.x1)}
          y={Math.min(box.y0, box.y1)}
          width={Math.abs(box.x1 - box.x0)}
          height={Math.abs(box.y1 - box.y0)}
          fill="rgba(47,107,79,0.08)"
          stroke={ACCENT}
          strokeWidth={1}
          strokeScaleEnabled={false}
          dash={[4, 3]}
          listening={false}
        />
      )}
    </>
  );
}

/** Zoom out, the zoom level, zoom in and Fit, bottom right. */
export function ZoomButtons({ percent, onZoom, onFit }: { percent: number; onZoom: (factor: number) => void; onFit: () => void }) {
  return (
    <div className="absolute right-3 bottom-3 flex items-center gap-1 rounded-md border border-line bg-white p-0.5 text-sm shadow-sm">
      <button className="rounded px-2 py-1 hover:bg-stone-100" onClick={() => onZoom(1 / 1.25)} aria-label="Zoom out" title="Zoom out">
        −
      </button>
      <span className="w-12 text-center text-xs tabular-nums text-muted">{percent}%</span>
      <button className="rounded px-2 py-1 hover:bg-stone-100" onClick={() => onZoom(1.25)} aria-label="Zoom in" title="Zoom in">
        +
      </button>
      <button className="rounded px-2 py-1 text-xs hover:bg-stone-100" onClick={onFit} title="Fit the drawing on screen">
        Fit
      </button>
    </div>
  );
}
