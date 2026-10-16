"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Arrow, Circle, Group, Layer, Line, Rect, Stage, Text } from "react-konva";
import type Konva from "konva";
import type { CustomLand, Point } from "@/lib/model/schema";
import { removePick, pickLabel, setMainRoad, type PathKind, type Pick } from "@/lib/land/featureTools";
import DesignerFeatures, { type FeatureTool } from "./DesignerFeatures";
import DesignerGround, { ContourLines, type GroundSettings } from "./DesignerGround";
import { boxOf, insertCorner, removeCorner, sideLengthFt, snapCorner } from "@/lib/land/designer";
import { edgeEnds } from "@/lib/land/custom";

export const CANVAS_W = 640;
export const CANVAS_H = 520;
const PAD = 70;
const FT = 12;

/** The lot drawn flat, as the user thinks of it. Corners and "+" handles edit the shape. */
export default function DesignerCanvas({
  land,
  onChange,
  selected,
  onSelect,
  tool,
  pick,
  onPick,
  pathKind,
  treeFt,
  laneFt,
  ground,
  contours,
}: {
  land: CustomLand;
  onChange: (l: CustomLand) => void;
  selected: number | null;
  onSelect: (i: number | null) => void;
  tool: FeatureTool;
  pick: Pick;
  onPick: (p: Pick) => void;
  pathKind: PathKind;
  treeFt: number;
  laneFt: number;
  ground: GroundSettings;
  contours: number[][];
}) {
  const [dragging, setDragging] = useState(false);
  const [menu, setMenu] = useState<{ pick: NonNullable<Pick>; at: Point } | null>(null);
  // While a corner is dragged the view stays put, so the lot doesn't rescale under the pointer.
  const frozen = useRef(land.outline);
  if (!dragging) frozen.current = land.outline;
  const view = useMemo(() => {
    const b = boxOf(frozen.current);
    const s = Math.min((CANVAS_W - PAD * 2) / Math.max(1, b.x1 - b.x0), (CANVAS_H - PAD * 2) / Math.max(1, b.y1 - b.y0));
    const w = (b.x1 - b.x0) * s;
    const h = (b.y1 - b.y0) * s;
    return { x0: b.x0, y0: b.y0, s, ox: (CANVAS_W - w) / 2, oy: (CANVAS_H - h) / 2 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frozen.current]);
  const px = (p: Point) => ({ x: view.ox + (p.x - view.x0) * view.s, y: view.oy + (p.y - view.y0) * view.s });
  const inch = (x: number, y: number): Point => ({ x: view.x0 + (x - view.ox) / view.s, y: view.y0 + (y - view.oy) / view.s });

  const o = land.outline;
  const n = o.length;
  const pts = o.map(px);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (pick) {
        e.preventDefault();
        onChange(removePick(land, pick));
        onPick(null);
      } else if (selected !== null) {
        e.preventDefault();
        onChange(removeCorner(land, selected));
        onSelect(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, pick, land, onChange, onSelect, onPick]);
  useEffect(() => setMenu(null), [land, tool]);

  const centre = pts.reduce((a, p) => ({ x: a.x + p.x / n, y: a.y + p.y / n }), { x: 0, y: 0 });

  return (
    <div className="relative" style={{ width: CANVAS_W, height: CANVAS_H }} onContextMenu={(e) => e.preventDefault()}>
    <Stage
      width={CANVAS_W}
      height={CANVAS_H}
      onMouseDown={(e) => {
        setMenu(null);
        if (e.target === e.target.getStage()) {
          onSelect(null);
          onPick(null);
        }
      }}
    >
      <Layer>
        <Rect width={CANVAS_W} height={CANVAS_H} fill="#f5f4f0" listening={false} />
        {/* Roads sit just outside their side of the lot. */}
        {land.roads.map((r) => {
          if (r.edge >= n) return null;
          const [a, b] = edgeEnds(pts, r.edge);
          const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          let nx = (b.y - a.y) / len;
          let ny = -(b.x - a.x) / len;
          if (nx * ((a.x + b.x) / 2 - centre.x) + ny * ((a.y + b.y) / 2 - centre.y) < 0) {
            nx = -nx;
            ny = -ny;
          }
          const half = Math.max(8, (r.widthFt * FT * view.s) / 2);
          return (
            <Group key={r.id}>
              <Line
                points={[a.x + nx * half, a.y + ny * half, b.x + nx * half, b.y + ny * half]}
                stroke="#8d8f8c"
                strokeWidth={half * 2}
                lineCap="butt"
              />
              <Text
                x={(a.x + b.x) / 2 + nx * half - 30}
                y={(a.y + b.y) / 2 + ny * half - 6}
                width={60}
                align="center"
                text={r.kind === "main" ? "Street" : "Side street"}
                fontSize={11}
                fill="#fff"
                listening={false}
              />
            </Group>
          );
        })}
        <Line
          points={pts.flatMap((p) => [p.x, p.y])}
          closed
          fill="#e3ecd6"
          stroke="#1f2421"
          strokeWidth={1.6}
          dash={[8, 5]}
          listening={false}
        />
        {land.slope.percent >= 0.5 && (
          <Arrow
            points={[centre.x, centre.y, centre.x + Math.sin((land.slope.downhillDeg * Math.PI) / 180) * 50, centre.y - Math.cos((land.slope.downhillDeg * Math.PI) / 180) * 50]}
            stroke="#8a6d3b"
            fill="#8a6d3b"
            strokeWidth={2.5}
            pointerLength={9}
            pointerWidth={9}
            listening={false}
          />
        )}
        <ContourLines segments={contours} px={px} strong={tool === "ground"} />
        <DesignerFeatures
          land={land}
          tool={tool}
          pick={pick}
          onPick={(p) => {
            onSelect(null);
            onPick(p);
          }}
          onChange={onChange}
          pathKind={pathKind}
          treeFt={treeFt}
          laneFt={laneFt}
          scale={view.s}
          px={px}
          inch={inch}
          pts={pts}
          size={{ w: CANVAS_W, h: CANVAS_H }}
          onMenu={(p, at) => setMenu({ pick: p, at })}
        />
        <DesignerGround
          land={land}
          active={tool === "ground"}
          pick={pick}
          onPick={(p) => {
            onSelect(null);
            onPick(p);
          }}
          onChange={onChange}
          settings={ground}
          scale={view.s}
          px={px}
          inch={inch}
          size={{ w: CANVAS_W, h: CANVAS_H }}
        />
        {pts.map((a, i) => {
          const b = pts[(i + 1) % n];
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          let nx = (b.y - a.y) / len;
          let ny = -(b.x - a.x) / len;
          if (nx * (mx - centre.x) + ny * (my - centre.y) < 0) {
            nx = -nx;
            ny = -ny;
          }
          return (
            <Group key={`side-${i}`}>
              <Text
                x={mx - 35 - nx * 18}
                y={my - 6 - ny * 14}
                width={70}
                align="center"
                text={`${Math.round(sideLengthFt(o, i))}′`}
                fontSize={11}
                fill="#57534e"
                listening={false}
              />
              {tool === "shape" && (
              <Circle
                key={`${n}-${i}-${o[i].x}-${o[i].y}-${o[(i + 1) % n].x}-${o[(i + 1) % n].y}`}
                x={mx}
                y={my}
                radius={6}
                fill="#fff"
                stroke="#2f6f4f"
                strokeWidth={1.5}
                draggable
                onClick={() => {
                  onChange(insertCorner(land, i));
                  onSelect(i + 1);
                }}
                onDragEnd={(e) => {
                  const p = snapCorner(o[i], inch(e.target.x(), e.target.y()), e.evt.shiftKey);
                  onChange(insertCorner(land, i, p));
                  onSelect(i + 1);
                }}
                onMouseEnter={(e) => (e.target.getStage()!.container().style.cursor = "copy")}
                onMouseLeave={(e) => (e.target.getStage()!.container().style.cursor = "")}
              />
              )}
              {tool === "shape" && <Text x={mx - 4} y={my - 7} text="+" fontSize={13} fontStyle="bold" fill="#2f6f4f" listening={false} />}
            </Group>
          );
        })}
        {tool === "shape" && pts.map((p, i) => (
          <Circle
            key={`corner-${i}`}
            x={p.x}
            y={p.y}
            radius={selected === i ? 9 : 7}
            fill={selected === i ? "#2f6f4f" : "#fff"}
            stroke="#1f2421"
            strokeWidth={2}
            draggable
            onMouseDown={() => onSelect(i)}
            onDragStart={() => setDragging(true)}
            onDragMove={(e) => {
              const prev = o[(i - 1 + n) % n];
              const snapped = snapCorner(prev, inch(e.target.x(), e.target.y()), e.evt.shiftKey);
              const s = px(snapped);
              e.target.position(s);
              onChange({ ...land, outline: o.map((q, k) => (k === i ? snapped : q)) });
            }}
            onDragEnd={() => setDragging(false)}
            onDblClick={() => {
              onChange(removeCorner(land, i));
              onSelect(null);
            }}
            onMouseEnter={(e) => (e.target.getStage()!.container().style.cursor = "move")}
            onMouseLeave={(e: Konva.KonvaEventObject<MouseEvent>) => (e.target.getStage()!.container().style.cursor = "")}
          />
        ))}
        {/* North arrow, turned to the dial. */}
        <Group x={CANVAS_W - 44} y={46} rotation={land.northDeg} listening={false}>
          <Arrow points={[0, 18, 0, -18]} stroke="#1f2421" fill="#1f2421" strokeWidth={2.5} pointerLength={10} pointerWidth={10} />
          <Text x={-6} y={-36} text="N" fontSize={14} fontStyle="bold" fill="#1f2421" />
        </Group>
      </Layer>
    </Stage>
    {menu && (
      <div
        className="absolute z-10 min-w-36 rounded-md border border-line bg-white py-1 text-sm shadow-lg"
        style={{ left: menu.at.x, top: menu.at.y }}
      >
        {menu.pick.type === "road" && land.roads[menu.pick.index]?.kind !== "main" && (
          <button
            className="block w-full px-3 py-1.5 text-left hover:bg-stone-100"
            onClick={() => {
              onChange(setMainRoad(land, menu.pick.index));
              setMenu(null);
            }}
          >
            Make main street
          </button>
        )}
        <button
          className="block w-full px-3 py-1.5 text-left text-red-700 hover:bg-stone-100"
          onClick={() => {
            onChange(removePick(land, menu.pick));
            onPick(null);
            setMenu(null);
          }}
        >
          Remove {pickLabel(land, menu.pick).toLowerCase()}
        </button>
      </div>
    )}
    </div>
  );
}
