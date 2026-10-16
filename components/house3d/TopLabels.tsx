"use client";

import { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { PlanRoom, Point, TopLabelRoom, TopLabels as TopLabelSettings } from "@/lib/model/schema";
import { clampLabelOffset, type TopLabel } from "@/lib/house3d/topLabels";
import { insidePoint } from "@/lib/house3d/walk";
import { IN_PER_UNIT, toScene, type Frame } from "@/lib/house3d/mesh";

/**
 * Room labels in the 3D Top view: plain page elements laid over the 3D picture. Clicking one (outside Edit mode)
 * opens a small menu; dragging it moves it. Settings (`house3d.topLabels`) are edited in
 * components/walk/LabelSettingsPanel.tsx; what each label says comes from lib/house3d/topLabels.ts.
 */

/** Shared between the boxes (page) and the placer (inside the 3D canvas). */
export type LabelBridge = {
  /** A mouse position on the page to a spot on the floor plan, inches. */
  toPlan: ((clientX: number, clientY: number) => Point | null) | null;
  /** Where each box sits in the scene, and its element, in the same order. */
  spots: [number, number, number][];
  els: (HTMLDivElement | null)[];
};

export type TopLabelItem = { room: PlanRoom; label: TopLabel };

const FONT_PX = { small: 11, medium: 14, large: 18 } as const;

/** Inside the 3D canvas: keeps each box over its spot as the view moves, and answers where the mouse is on the floor. */
export function LabelPlacer({ bridge, frame, floorIn }: { bridge: React.RefObject<LabelBridge>; frame: Frame; floorIn: number }) {
  const { camera, size, gl } = useThree();
  const v = useRefOnce(() => new THREE.Vector3());
  useEffect(() => {
    const b = bridge.current;
    const ray = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(floorIn + 2) / IN_PER_UNIT);
    const hit = new THREE.Vector3();
    b.toPlan = (cx, cy) => {
      const r = gl.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), camera);
      return ray.ray.intersectPlane(plane, hit) ? { x: hit.x * IN_PER_UNIT + frame.ox, y: hit.z * IN_PER_UNIT + frame.oy } : null;
    };
    return () => {
      b.toPlan = null;
    };
  }, [bridge, camera, gl, frame, floorIn]);
  useFrame(() => {
    const { spots, els } = bridge.current;
    spots.forEach((at, i) => {
      const el = els[i];
      if (!el) return;
      v.set(...at).project(camera);
      const x = ((v.x + 1) / 2) * size.width;
      const y = ((1 - v.y) / 2) * size.height;
      el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
      el.style.visibility = v.z < 1 ? "visible" : "hidden";
    });
  });
  return null;
}

function useRefOnce<T>(make: () => T): T {
  const r = useRef<T | null>(null);
  if (r.current === null) r.current = make();
  return r.current;
}

type Drag = { id: string; x: number; y: number; moved: boolean; grab: Point };

export function TopLabelBoxes({
  items,
  settings,
  bridge,
  frame,
  floorIn,
  editing,
  onChange,
}: {
  items: TopLabelItem[];
  settings: TopLabelSettings;
  bridge: React.RefObject<LabelBridge>;
  frame: Frame;
  floorIn: number;
  /** In Edit mode the labels let clicks through so floors can be selected. */
  editing: boolean;
  onChange: (next: TopLabelSettings) => void;
}) {
  const [live, setLive] = useState<{ id: string; at: Point } | null>(null);
  const [menu, setMenu] = useState<{ id: string; renaming: boolean } | null>(null);
  const drag = useRef<Drag | null>(null);

  // Keep the placer's list in step with what is drawn.
  const at = (it: TopLabelItem) => (live?.id === it.room.id ? live.at : it.label.at);
  bridge.current.spots = items.map((it) => toScene(frame, at(it), floorIn + 2));
  bridge.current.els.length = items.length;

  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => {
      if (!(e.target as Element).closest("[data-label-menu]")) setMenu(null);
    };
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  }, [menu]);

  const setRoom = (id: string, patch: TopLabelRoom | null) => {
    const rooms = { ...settings.rooms };
    const next = patch && { ...rooms[id], ...patch };
    if (next && Object.keys(next).some((k) => next[k as keyof TopLabelRoom] !== undefined)) rooms[id] = next;
    else delete rooms[id];
    onChange({ ...settings, rooms });
  };
  const dropKey = (id: string, key: keyof TopLabelRoom) => {
    const cur = { ...settings.rooms[id] };
    delete cur[key];
    const rooms = { ...settings.rooms };
    if (Object.keys(cur).length) rooms[id] = cur;
    else delete rooms[id];
    onChange({ ...settings, rooms });
  };

  const move = (e: React.PointerEvent, it: TopLabelItem) => {
    const d = drag.current;
    if (!d || d.id !== it.room.id) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
    d.moved = true;
    const p = bridge.current.toPlan?.(e.clientX, e.clientY);
    if (!p) return;
    const base = insidePoint(it.room.polygon);
    const { at: spot } = clampLabelOffset(it.room, { x: p.x - d.grab.x - base.x, y: p.y - d.grab.y - base.y }, base);
    setLive({ id: d.id, at: spot });
  };

  const up = (it: TopLabelItem) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== it.room.id) return;
    if (!d.moved) {
      setMenu({ id: it.room.id, renaming: false });
      return;
    }
    if (live?.id === d.id) {
      const base = insidePoint(it.room.polygon);
      setRoom(d.id, { offset: { x: Math.round(live.at.x - base.x), y: Math.round(live.at.y - base.y) } });
    }
    setLive(null);
  };

  return (
    <>
      {items.map((it, i) => {
        const id = it.room.id;
        const px = FONT_PX[settings.textSize];
        const light = it.label.ink === "light";
        const mine = settings.rooms[id];
        return (
          <div
            key={id}
            ref={(el) => {
              bridge.current.els[i] = el;
            }}
            className={`absolute top-0 left-0 rounded px-1.5 py-0.5 text-center leading-tight whitespace-nowrap ${editing ? "pointer-events-none" : "cursor-grab touch-none select-none"} ${
              settings.background === "soft" ? "bg-white/80 shadow-sm" : ""
            } ${light ? "text-white" : "text-ink"}`}
            style={{ visibility: "hidden", fontSize: px }}
            data-testid="room-label"
            onPointerDown={(e) => {
              if (editing || e.button !== 0) return;
              const p = bridge.current.toPlan?.(e.clientX, e.clientY);
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { id, x: e.clientX, y: e.clientY, moved: false, grab: p ? { x: p.x - it.label.at.x, y: p.y - it.label.at.y } : { x: 0, y: 0 } };
            }}
            onPointerMove={(e) => move(e, it)}
            onPointerUp={() => up(it)}
            onPointerCancel={() => {
              drag.current = null;
              setLive(null);
            }}
          >
            {it.label.lines.map((l, j) => (
              <span key={j} className={`block ${l.bold ? "font-semibold" : ""}`} style={l.small || !l.bold ? { fontSize: Math.round(px * 0.9) } : undefined}>
                {l.text}
              </span>
            ))}
            {menu?.id === id && !editing && (
              <div
                data-label-menu
                className="absolute top-full left-1/2 z-10 mt-1 w-40 -translate-x-1/2 cursor-default rounded-md border border-line bg-white p-1 text-left text-sm font-normal text-ink shadow-md"
                style={{ fontSize: 13 }}
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
              >
                {menu.renaming ? (
                  <input
                    autoFocus
                    className="w-full rounded border border-line px-1 py-0.5"
                    aria-label="Label text"
                    placeholder={it.room.name}
                    defaultValue={mine?.text ?? ""}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const text = e.currentTarget.value.trim();
                        if (text) setRoom(id, { text });
                        else dropKey(id, "text");
                        setMenu(null);
                      } else if (e.key === "Escape") setMenu(null);
                      e.stopPropagation();
                    }}
                  />
                ) : (
                  <>
                    <MenuItem onClick={() => setMenu({ id, renaming: true })}>Rename label</MenuItem>
                    <MenuItem
                      onClick={() => {
                        setRoom(id, { hidden: true });
                        setMenu(null);
                      }}
                    >
                      Hide this label
                    </MenuItem>
                    <MenuItem
                      onClick={() => {
                        dropKey(id, "offset");
                        setMenu(null);
                      }}
                    >
                      Reset position
                    </MenuItem>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button className="block w-full rounded px-2 py-1 text-left hover:bg-line/40" onClick={onClick}>
      {children}
    </button>
  );
}
