"use client";

import { Circle, Group, Layer, Line, Rect, Text } from "react-konva";
import type { BubbleDiagram, FloorPlan, FurnitureItem, Level, PlanRoom, Point } from "@/lib/model/schema";
import { formatFeetInches } from "@/lib/model/units";
import { add, dist, edgesOf, leftNormal, scale as scaleV, sub, unit } from "@/lib/plan/geometry";
import { bendInfo, type BendSnap, type BendTarget } from "@/lib/plan/bend";
import { arcBetween, leftBulge, pointOnEdge, roomEdgeLength } from "@/lib/plan/arcs";
import { edgeFrame } from "@/lib/plan/labels";
import { roomOutline, wallOutline } from "@/lib/plan/flatten";
import { roomSqft } from "@/lib/plan/measure";
import { furnitureOutline, furnitureType } from "@/lib/plan/furniture";
import type { OpeningHost } from "@/lib/model/schema";
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
        <Line key={r.id} points={flat(roomOutline(r))} closed stroke={INK} strokeWidth={1} strokeScaleEnabled={false} dash={[6, 4]} opacity={0.3} />
      ))}
      {above?.rooms.map((r) => (
        <Line key={`above-${r.id}`} points={flat(roomOutline(r))} closed stroke={INK} strokeWidth={1} strokeScaleEnabled={false} dash={[2, 4]} opacity={0.3} />
      ))}
      {support?.flatMap((r, i) => [r.outline, ...r.holes].map((ring, k) => <Line key={`support-${i}-${k}`} points={flat(ring)} closed stroke={INK} strokeWidth={2} strokeScaleEnabled={false} opacity={0.55} />))}
    </Layer>
  );
}

/** How a room held up on purpose reads on the plan. */
const HELD_BY: Record<Overhang["kind"], string> = { none: "", cantilever: "short cantilever", posts: "on posts", engineered: "engineered" };

/** The parts of rooms that hang past the floor below: red stripes and how far they reach, or blue when it's held up on purpose. */
export function OverhangLayer({ overhangs, s, past = "the wall below" }: { overhangs: Overhang[]; s: number; past?: string }) {
  const pattern = stripes();
  const w = 260 / s;
  return (
    <Layer listening={false}>
      {overhangs.flatMap((o) =>
        o.pieces.map((piece, i) =>
          o.ok ? (
            <Line key={`${o.roomId}-${i}`} points={flat(piece)} closed fill="rgba(40,110,190,0.12)" stroke="#2c6eb8" strokeWidth={1.5} strokeScaleEnabled={false} dash={[6, 4]} />
          ) : (
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
          ),
        ),
      )}
      {overhangs.map((o) => (
        <Text
          key={`t-${o.roomId}`}
          x={o.at.x}
          y={o.at.y}
          width={w}
          offsetX={w / 2}
          offsetY={6 / s}
          align="center"
          text={o.ok ? `${HELD_BY[o.kind]}, ${formatFeetInches(o.depthIn)} out` : `hangs ${formatFeetInches(o.depthIn)} past ${past}`}
          fontSize={11.5 / s}
          fontStyle="600"
          fill={o.ok ? "#1f548f" : "#a3231c"}
        />
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

export function PlanWalls({ solids, selection, s, toSaved }: { solids: SolidWall[]; selection: PlanSelection; s: number; toSaved: (h: OpeningHost) => OpeningHost }) {
  return (
    <>
      {solids.map((w, i) => {
        // A curved wall is many short pieces on screen but one wall: they all answer to the saved wall.
        const host = toSaved(w.piece.host);
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
export function DraftPreview({ rectStart, rectEnd, draft, cursor, tool, typed, bow, s, round = false }: { rectStart: Point | null; rectEnd: Point | null; draft: Point[]; cursor: Point | null; tool: PlanTool; typed: string; bow?: { left: number; snap: BendSnap } | null; s: number; round?: boolean }) {
  if (tool === "curve" && draft.length === 2) return <CurvePreview a={draft[0]} b={draft[1]} left={bow?.left ?? 0} snap={bow?.snap ?? null} cursor={cursor} typed={typed} s={s} />;
  if (round && rectStart && rectEnd) {
    const r = dist(rectStart, rectEnd);
    return (
      <>
        <Circle x={rectStart.x} y={rectStart.y} radius={r} fill="rgba(47,107,79,0.12)" stroke={ACCENT} strokeWidth={2} strokeScaleEnabled={false} dash={[6, 4]} listening={false} />
        <Text x={rectStart.x} y={rectStart.y} width={160 / s} offsetX={80 / s} offsetY={6 / s} align="center" text={`${formatFeetInches(r * 2)} across`} fontSize={12 / s} fontStyle="600" fill={ACCENT} listening={false} />
      </>
    );
  }
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
            strokeWidth={tool === "room" ? 2 : 4.5}
            strokeScaleEnabled={tool === "room"}
            dash={tool === "room" ? [6 / s, 4 / s] : undefined}
            opacity={tool === "room" ? 1 : 0.7}
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

/** The Curve tool's curve while its bow is being set, with its radius and length. */
function CurvePreview({ a, b, left, snap, cursor, typed, s }: { a: Point; b: Point; left: number; snap: BendSnap; cursor: Point | null; typed: string; s: number }) {
  const arc = arcBetween(a, b, left);
  const note = snap === "half" ? "Half circle · " : snap === "radius" ? "Same radius · " : "";
  const text = typed ? `Radius ${typed}▏ (Enter)` : arc ? `${note}R ${formatFeetInches(arc.radius)} · arc ${formatFeetInches(arc.length)}` : `Straight · ${formatFeetInches(dist(a, b))} (move to bow it)`;
  const at = cursor ?? a;
  return (
    <Group listening={false}>
      <Line points={flat(wallOutline(a, b, left))} stroke={ACCENT} strokeWidth={4.5} opacity={0.7} lineCap="round" />
      {!arc && <Line points={flat([a, b])} stroke={ACCENT} strokeWidth={1} strokeScaleEnabled={false} dash={[4 / s, 4 / s]} />}
      {[a, b].map((p, i) => (
        <Circle key={i} x={p.x} y={p.y} radius={3.5 / s} fill="#fff" stroke={ACCENT} strokeWidth={1.5} strokeScaleEnabled={false} />
      ))}
      <Text x={at.x + 10 / s} y={at.y + 10 / s} text={text} fontSize={11.5 / s} fontStyle="600" fill={ACCENT} />
    </Group>
  );
}

/** A small "+" on each edge of the selected room, a little off the middle (the diamond bends the wall there): drag one to make a new corner. */
export function MidNodes({ room, s }: { room: PlanRoom; s: number }) {
  return (
    <>
      {edgesOf(room.polygon).map((e) => {
        const length = roomEdgeLength(room, e.i);
        if (length * s < 56) return null;
        const m = pointOnEdge(e.a, e.b, leftBulge(room, e.i), length * 0.3);
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

/** A small diamond in the middle of each picked wall: drag it sideways to bow the wall into a curve. */
export function BendHandles({ targets, plan, s }: { targets: BendTarget[]; plan: FloorPlan; s: number }) {
  return (
    <>
      {targets.map((t) => {
        const info = bendInfo(plan, t);
        if (!info || info.length * s < 28) return null;
        const m = pointOnEdge(info.a, info.b, info.left, info.length / 2);
        const r = 6 / s;
        const id = "roomId" in t ? edgeId(t.roomId, t.edge) : t.wallId;
        return (
          <Group key={id} id={id} name="bend" x={m.x} y={m.y}>
            <Line points={[0, -r, r, 0, 0, r, -r, 0]} closed fill={info.radius ? ACCENT : "#fff"} stroke={ACCENT} strokeWidth={1.5} strokeScaleEnabled={false} hitStrokeWidth={8} />
          </Group>
        );
      })}
    </>
  );
}

/** What the wall measures while it's being bent, on a white tag in the middle of the straight line across it. */
export function BendTip({ at, text, s }: { at: Point; text: string; s: number }) {
  const w = (text.length * 6.6 + 14) / s;
  const h = 20 / s;
  return (
    <Group x={at.x} y={at.y} listening={false}>
      <Rect x={-w / 2} y={-h / 2} width={w} height={h} fill="rgba(255,255,255,0.94)" stroke={ACCENT} strokeWidth={1} strokeScaleEnabled={false} cornerRadius={4 / s} />
      <Text x={-w / 2} y={-6.5 / s} width={w} align="center" text={text} fontSize={12 / s} fontStyle="600" fill={ACCENT} wrap="none" />
    </Group>
  );
}

/** While a corner is dragged: the two edge lengths beside it and the room's square feet. */
export function NodeReadout({ plan, roomId, i, s }: { plan: FloorPlan; roomId: string; i: number; s: number }) {
  const room = plan.rooms.find((r) => r.id === roomId);
  if (!room || !room.polygon[i]) return null;
  const n = room.polygon.length;
  const p = room.polygon[i];
  const tag = (i: number, key: string) => {
    const a = room.polygon[i];
    const b = room.polygon[(i + 1) % n];
    const f = edgeFrame(a, b, leftBulge(room, i));
    const mid = add(f.mid, scaleV(leftNormal(f.u), -(10 + 8 / s)));
    const w = 90 / s;
    return <Text key={key} x={mid.x} y={mid.y} offsetX={w / 2} offsetY={6 / s} width={w} align="center" rotation={uprightAngle(f.u)} text={formatFeetInches(roomEdgeLength(room, i))} fontSize={12 / s} fontStyle="600" fill={ACCENT} listening={false} />;
  };
  const w = 120 / s;
  return (
    <Group listening={false}>
      {tag((i - 1 + n) % n, "in")}
      {tag(i, "out")}
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
