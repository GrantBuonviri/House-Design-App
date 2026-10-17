"use client";

import { useEffect, useRef, useState } from "react";
import { Shape } from "react-konva";
import type { Side } from "@/components/bubbles/types";
import { isTyping } from "@/lib/keys";

/** Pieces shared by the flow sketch and floor plan drawings. */

export type View = { scale: number; x: number; y: number };

/**
 * Hold Space to pan with the mouse, as in most drawing apps. Only while the
 * pointer is over the drawing (set `hovering.current`), so Space still
 * presses buttons elsewhere.
 */
export function useSpacePan() {
  const [spaceDown, setSpaceDown] = useState(false);
  const hovering = useRef(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !hovering.current || isTyping(e)) return;
      e.preventDefault();
      // A focused button would otherwise be pressed when Space comes back up.
      (e.target as HTMLElement | null)?.closest?.("button")?.blur();
      setSpaceDown(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceDown(false);
    };
    const blur = () => setSpaceDown(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);
  return { spaceDown, hovering };
}

/** Light grid lines that follow the zoom: a line every 1, 2, 4, 10 or 20 feet, whatever is readable. */
export function Grid({ view, width, height }: { view: View; width: number; height: number }) {
  const step = [12, 24, 48, 120, 240, 480].find((g) => g * view.scale >= 14) ?? 960;
  return (
    <Shape
      sceneFunc={(ctx) => {
        const x0 = -view.x / view.scale;
        const y0 = -view.y / view.scale;
        const x1 = x0 + width / view.scale;
        const y1 = y0 + height / view.scale;
        const line = (ax: number, ay: number, bx: number, by: number, major: boolean) => {
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.strokeStyle = major ? "rgba(60,55,45,0.13)" : "rgba(60,55,45,0.06)";
          ctx.lineWidth = 1 / view.scale;
          ctx.stroke();
        };
        for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) line(x, y0, x, y1, Math.round(x / step) % 5 === 0);
        for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) line(x0, y, x1, y, Math.round(y / step) % 5 === 0);
      }}
    />
  );
}

const SIDE_NAME: Record<Side, string> = { N: "North", E: "East", S: "South", W: "West" };

export function SideLabels({ sides }: { sides: Record<Side, string[]> }) {
  const place: Record<Side, string> = {
    N: "top-2 left-1/2 -translate-x-1/2",
    S: "bottom-2 left-1/2 -translate-x-1/2",
    E: "right-2 top-1/2 -translate-y-1/2",
    W: "left-2 top-1/2 -translate-y-1/2",
  };
  return (
    <>
      {(Object.keys(place) as Side[]).map((side) => (
        <span
          key={side}
          className={`pointer-events-none absolute ${place[side]} rounded-full bg-white/85 px-2.5 py-0.5 text-xs text-muted shadow-sm ${
            side === "E" || side === "W" ? "[writing-mode:vertical-rl]" : ""
          } ${side === "W" ? "rotate-180" : ""}`}
        >
          <span className="font-semibold text-ink">{SIDE_NAME[side]}</span>
          {sides[side].length > 0 && ` · ${sides[side].join(" · ")}`}
        </span>
      ))}
    </>
  );
}

export function ScaleBar({ scale }: { scale: number }) {
  const feet = [5, 10, 20, 25, 50, 100, 200, 500].find((f) => f * 12 * scale >= 60) ?? 500;
  const px = feet * 12 * scale;
  return (
    <div className="pointer-events-none absolute bottom-4 left-10 text-xs text-muted">
      <div className="h-1.5 border-x border-b border-ink/60" style={{ width: px }} />
      <div className="mt-0.5">{feet} ft</div>
    </div>
  );
}
