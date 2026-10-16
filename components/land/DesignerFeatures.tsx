"use client";

import { useEffect, useRef, useState } from "react";
import { Arrow, Circle, Group, Line, Rect, Text } from "react-konva";
import type Konva from "konva";
import type { CustomLand, Point } from "@/lib/model/schema";
import { edgeEnds } from "@/lib/land/custom";
import {
  addLake,
  addLane,
  addFeature,
  addPond,
  addRoad,
  addTreesAlong,
  addWater,
  flowsUphill,
  isPathWater,
  moveFeature,
  movePoint,
  removePoint,
  type PathKind,
  type Pick,
} from "@/lib/land/featureTools";

const FT = 12;
const WATER_LOOK = {
  creek: { color: "#4a86b0", ft: 8 },
  river: { color: "#3f78a8", ft: 30 },
  wash: { color: "#a88a5c", ft: 8 },
} as const;

export type FeatureTool = "shape" | "water" | "pond" | "lake" | "rock" | "tree" | "roads" | "lane";
const PLACING: FeatureTool[] = ["water", "pond", "rock", "tree", "lane"];
export const ROCK_DEFAULT_FT = 8;

type Props = {
  land: CustomLand;
  tool: FeatureTool;
  pick: Pick;
  onPick: (p: Pick) => void;
  onChange: (l: CustomLand) => void;
  /** Settings for the next thing placed. */
  pathKind: PathKind;
  treeFt: number;
  laneFt: number;
  /** Canvas pixels per inch, and conversions between canvas and lot coordinates. */
  scale: number;
  px: (p: Point) => Point;
  inch: (x: number, y: number) => Point;
  pts: Point[];
  size: { w: number; h: number };
  onMenu: (pick: NonNullable<Pick>, at: Point) => void;
};

const pointer = (e: Konva.KonvaEventObject<MouseEvent>) => e.target.getStage()!.getPointerPosition()!;

/** Everything the designer draws on the lot besides its outline: water, rocks, trees, lanes and road highlights, plus the tools that place and edit them. */
export default function DesignerFeatures(props: Props) {
  const { land, tool, pick, onPick, onChange, pathKind, treeFt, laneFt, scale, px, inch, pts, size, onMenu } = props;
  const [draft, setDraft] = useState<Point[]>([]);
  const [hover, setHover] = useState<Point | null>(null);
  const [pond, setPond] = useState<{ c: Point; r: number } | null>(null);
  const paint = useRef<Point | null>(null);
  const landRef = useRef(land);
  landRef.current = land;
  // The points so far, kept in a ref too so a quick double-click sees the one just added.
  const draftRef = useRef<Point[]>([]);
  draftRef.current = draft;
  // When the last point was added, so pressing the same spot again soon after finishes the line (a double-click).
  const lastPress = useRef(0);

  useEffect(() => {
    draftRef.current = [];
    setDraft([]);
    setHover(null);
  }, [tool]);

  const finish = (points: Point[] = draft) => {
    if (points.length >= 2) {
      if (tool === "lane") {
        onChange(addLane(land, points, laneFt));
        onPick({ type: "lane", index: land.lanes.length });
      } else {
        onChange(addWater(land, pathKind, points));
        onPick({ type: "water", index: land.water.length });
      }
    }
    draftRef.current = [];
    setDraft([]);
    setHover(null);
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!draft.length || (e.target as HTMLElement).closest("input, textarea, select")) return;
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        draftRef.current = [];
        setDraft([]);
        setHover(null);
      } else if (e.key === "Enter") finishRef.current();
    };
    // Capture, so Escape cancels the line being drawn before it closes the whole designer.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [draft.length]);

  const stop = (e: Konva.KonvaEventObject<MouseEvent>) => {
    e.cancelBubble = true;
  };
  const select = (p: NonNullable<Pick>) => (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button === 2) return;
    stop(e);
    onPick(p);
  };
  const menu = (p: NonNullable<Pick>) => (e: Konva.KonvaEventObject<PointerEvent | MouseEvent>) => {
    e.evt.preventDefault();
    e.cancelBubble = true;
    onPick(p);
    const at = e.target.getStage()!.getPointerPosition()!;
    onMenu(p, at);
  };
  const flat = (points: Point[]) => points.flatMap((p) => [px(p).x, px(p).y]);

  const onDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button === 2) return;
    const at = inch(pointer(e).x, pointer(e).y);
    if (tool === "water" || tool === "lane") {
      const last = draftRef.current[draftRef.current.length - 1];
      if (last && Math.hypot(at.x - last.x, at.y - last.y) * scale < 6) {
        if (Date.now() - lastPress.current < 600) finish(draftRef.current);
        return;
      }
      lastPress.current = Date.now();
      draftRef.current = [...draftRef.current, at];
      setDraft(draftRef.current);
      onPick(null);
    } else if (tool === "pond") {
      setPond({ c: at, r: 0 });
    } else if (tool === "rock") {
      onChange(addFeature(land, "rock", at, ROCK_DEFAULT_FT));
      onPick({ type: "feature", index: land.features.length });
    } else if (tool === "tree") {
      if (e.evt.shiftKey) paint.current = at;
      onChange(addTreesAlong(land, null, at, treeFt));
      onPick(e.evt.shiftKey ? null : { type: "feature", index: land.features.length });
    }
  };
  const onMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const at = inch(pointer(e).x, pointer(e).y);
    if (draft.length) setHover(at);
    if (pond) setPond({ ...pond, r: Math.hypot(at.x - pond.c.x, at.y - pond.c.y) / FT });
    if (paint.current) {
      const from = paint.current;
      if (Math.hypot(at.x - from.x, at.y - from.y) > treeFt * 0.9 * FT) {
        onChange(addTreesAlong(landRef.current, from, at, treeFt));
        paint.current = at;
      }
    }
  };
  const onUp = () => {
    paint.current = null;
    if (pond) {
      onChange(addPond(land, pond.c, pond.r >= 8 ? pond.r : 40));
      onPick({ type: "water", index: land.water.length });
      setPond(null);
    }
  };

  const placing = PLACING.includes(tool);
  const sel = (type: NonNullable<Pick>["type"], i: number) => pick?.type === type && pick.index === i;

  return (
    <>
      {placing && (
        <Rect
          width={size.w}
          height={size.h}
          fill="rgba(0,0,0,0.001)"
          onMouseDown={onDown}
          onMouseMove={onMove}
          onMouseUp={onUp}
          onMouseEnter={(e) => (e.target.getStage()!.container().style.cursor = "crosshair")}
          onMouseLeave={(e) => (e.target.getStage()!.container().style.cursor = "")}
        />
      )}

      {/* Lanes sit under the water so a river can cross one. */}
      {land.lanes.map((l, i) => (
        <Group key={l.id}>
          <Line
            points={flat(l.points)}
            stroke={sel("lane", i) ? "#9c8a63" : "#b9a98a"}
            strokeWidth={Math.max(5, l.widthFt * FT * scale)}
            lineCap="round"
            lineJoin="round"
            hitStrokeWidth={Math.max(14, l.widthFt * FT * scale)}
            onMouseDown={select({ type: "lane", index: i })}
            onContextMenu={menu({ type: "lane", index: i })}
          />
          <Line points={flat(l.points)} stroke="#f3ead2" strokeWidth={1.2} dash={[6, 5]} listening={false} />
        </Group>
      ))}

      {land.water.map((w, i) => {
        const p = { type: "water", index: i } as const;
        if (!isPathWater(w)) {
          return (
            <Line
              key={`w${i}`}
              points={flat(w.points)}
              closed
              fill="rgba(110,160,198,0.75)"
              stroke={sel("water", i) ? "#1f4f78" : "#4a86b0"}
              strokeWidth={sel("water", i) ? 3 : 1.6}
              onMouseDown={select(p)}
              onContextMenu={menu(p)}
            />
          );
        }
        const look = WATER_LOOK[w.kind];
        const a = w.points.map(px);
        const up = flowsUphill(land, w.points);
        const m = a.length > 1 ? Math.min(a.length - 2, Math.floor((a.length - 1) * 0.6)) : 0;
        const [s, t] = a.length > 1 ? [a[m], a[m + 1]] : [a[0], a[0]];
        const len = Math.hypot(t.x - s.x, t.y - s.y) || 1;
        const cx = (s.x + t.x) / 2;
        const cy = (s.y + t.y) / 2;
        const ux = (t.x - s.x) / len;
        const uy = (t.y - s.y) / len;
        return (
          <Group key={`w${i}`}>
            <Line
              points={flat(w.points)}
              stroke={look.color}
              strokeWidth={Math.max(3, look.ft * FT * scale)}
              lineCap="round"
              lineJoin="round"
              opacity={w.kind === "wash" ? 0.55 : 0.85}
              dash={w.kind === "wash" ? [10, 6] : undefined}
              hitStrokeWidth={Math.max(14, look.ft * FT * scale)}
              onMouseDown={select(p)}
              onContextMenu={menu(p)}
            />
            {sel("water", i) && <Line points={flat(w.points)} stroke="#1f2421" strokeWidth={1} dash={[3, 3]} listening={false} />}
            {a.length > 1 && (
              <>
                <Arrow
                  points={[cx - ux * 9, cy - uy * 9, cx + ux * 9, cy + uy * 9]}
                  stroke={up ? "#b45309" : "#fff"}
                  fill={up ? "#b45309" : "#fff"}
                  strokeWidth={2.5}
                  pointerLength={8}
                  pointerWidth={8}
                  listening={false}
                />
                {up && <Text x={cx + 10} y={cy - 18} text="Runs uphill" fontSize={11} fontStyle="bold" fill="#b45309" listening={false} />}
              </>
            )}
          </Group>
        );
      })}

      {land.features.map((f, i) => {
        const c = px(f.at);
        const r = Math.max(4, (f.sizeFt * FT * scale) / 2);
        const p = { type: "feature", index: i } as const;
        return (
          <Circle
            key={f.id}
            x={c.x}
            y={c.y}
            radius={r}
            fill={f.kind === "rock" ? "#8b8a85" : "#5f8f4f"}
            opacity={f.kind === "tree" ? 0.88 : 1}
            stroke={sel("feature", i) ? "#1f2421" : f.kind === "rock" ? "#5c5b57" : "#3e6a35"}
            strokeWidth={sel("feature", i) ? 2.5 : 1.2}
            draggable
            onMouseDown={select(p)}
            onContextMenu={menu(p)}
            onDragMove={(e) => onChange(moveFeature(landRef.current, i, inch(e.target.x(), e.target.y())))}
            onMouseEnter={(e) => (e.target.getStage()!.container().style.cursor = "move")}
            onMouseLeave={(e) => (e.target.getStage()!.container().style.cursor = "")}
          />
        );
      })}

      {/* Edges of the lot, clickable for the lake and road tools. */}
      {(tool === "lake" || tool === "roads") &&
        pts.map((_, i) => {
          const [a, b] = edgeEnds(pts, i);
          const road = land.roads.findIndex((r) => r.edge === i);
          return (
            <Line
              key={`edge${i}`}
              points={[a.x, a.y, b.x, b.y]}
              stroke="rgba(47,111,79,0.01)"
              strokeWidth={16}
              hitStrokeWidth={16}
              onMouseEnter={(e) => {
                (e.target as Konva.Line).stroke("rgba(47,111,79,0.6)");
                e.target.getStage()!.container().style.cursor = "pointer";
              }}
              onMouseLeave={(e) => {
                (e.target as Konva.Line).stroke("rgba(47,111,79,0.01)");
                e.target.getStage()!.container().style.cursor = "";
              }}
              onClick={(e) => {
                if (e.evt.button === 2) return;
                if (tool === "lake") {
                  onChange(addLake(land, i));
                  onPick({ type: "water", index: land.water.length });
                } else if (road >= 0) onPick({ type: "road", index: road });
                else {
                  const next = addRoad(land, i);
                  onChange(next);
                  onPick({ type: "road", index: next.roads.findIndex((r) => r.edge === i) });
                }
              }}
            />
          );
        })}

      {/* A selected road shows as a bright line along its side of the lot. */}
      {pick?.type === "road" &&
        land.roads[pick.index] &&
        land.roads[pick.index].edge < pts.length &&
        (() => {
          const [a, b] = edgeEnds(pts, land.roads[pick.index].edge);
          return <Line points={[a.x, a.y, b.x, b.y]} stroke="#2f6f4f" strokeWidth={4} listening={false} />;
        })()}
      {land.roads.map((r, i) =>
        r.edge < pts.length ? (
          <Line
            key={r.id}
            points={(() => {
              const [a, b] = edgeEnds(pts, r.edge);
              return [a.x, a.y, b.x, b.y];
            })()}
            stroke="rgba(0,0,0,0.001)"
            strokeWidth={10}
            hitStrokeWidth={10}
            onMouseDown={tool === "roads" ? select({ type: "road", index: i }) : undefined}
            onContextMenu={menu({ type: "road", index: i })}
            listening={tool === "roads" || tool === "shape"}
          />
        ) : null,
      )}

      {/* The line being drawn, with a rubber band to the pointer. */}
      {draft.length > 0 && (
        <>
          <Line
            points={flat(hover ? [...draft, hover] : draft)}
            stroke={tool === "lane" ? "#9c8a63" : "#3f78a8"}
            strokeWidth={2.5}
            dash={[6, 4]}
            listening={false}
          />
          {draft.map((d, i) => (
            <Circle key={i} x={px(d).x} y={px(d).y} radius={4} fill="#fff" stroke="#1f2421" strokeWidth={1.5} listening={false} />
          ))}
          <Text x={8} y={size.h - 22} text="Click to add points. Double-click or press Enter to finish. Esc cancels." fontSize={12} fill="#57534e" listening={false} />
        </>
      )}
      {pond && pond.r > 0 && (
        <Circle x={px(pond.c).x} y={px(pond.c).y} radius={pond.r * FT * scale} fill="rgba(110,160,198,0.6)" stroke="#4a86b0" strokeWidth={1.6} listening={false} />
      )}

      {/* Handles on the selected river, pond, lake or lane. */}
      {(pick?.type === "water" || pick?.type === "lane") &&
        (pick.type === "water" ? land.water[pick.index]?.points : land.lanes[pick.index]?.points)?.map((v, k) => {
          const c = px(v);
          return (
            <Circle
              key={`h${pick.type}${pick.index}-${k}`}
              x={c.x}
              y={c.y}
              radius={6}
              fill="#fff"
              stroke="#1f2421"
              strokeWidth={2}
              draggable
              onMouseDown={stop}
              onDragMove={(e) => onChange(movePoint(landRef.current, pick, k, inch(e.target.x(), e.target.y())))}
              onDblClick={() => onChange(removePoint(landRef.current, pick, k))}
              onMouseEnter={(e) => (e.target.getStage()!.container().style.cursor = "move")}
              onMouseLeave={(e) => (e.target.getStage()!.container().style.cursor = "")}
            />
          );
        })}
    </>
  );
}
