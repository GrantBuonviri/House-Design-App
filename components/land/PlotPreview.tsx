"use client";

import { useEffect, useRef, useState } from "react";
import type { Plot, Point } from "@/lib/model/schema";
import { bearingVector } from "@/lib/land/generate";
import { pointInPolygon } from "@/lib/land/geometry";
import { createTerrain } from "@/lib/land/terrain";
import { dayArc, SUMMER_SOLSTICE, WINTER_SOLSTICE } from "@/lib/land/sun";

const MARGIN = 0.14; // neighbors' land shown around the plot, as a share of its size
const VERTICAL_EXAGGERATION = 3;

type View = { x0: number; y0: number; side: number };

function viewFor(plot: Plot): View {
  const side = Math.max(plot.widthIn, plot.depthIn) * (1 + MARGIN * 2);
  return { x0: plot.widthIn / 2 - side / 2, y0: plot.depthIn / 2 - side / 2, side };
}

/** Earthy tint from low (green) to high (tan). t in [0, 1]. */
function tint(t: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [
    [0, [122, 145, 104]],
    [0.5, [176, 170, 128]],
    [1, [205, 186, 150]],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, a] = stops[i - 1];
      const [t1, b] = stops[i];
      const k = (t - t0) / (t1 - t0);
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    }
  }
  return stops[stops.length - 1][1];
}

function drawRelief(ctx: CanvasRenderingContext2D, plot: Plot, px: number) {
  const view = viewFor(plot);
  const height = createTerrain(plot);
  const cell = view.side / px;
  // One extra row and column so every pixel has a right/bottom neighbor.
  const n = px + 1;
  const z = new Float32Array(n * n);
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = height(view.x0 + (i + 0.5) * cell, view.y0 + (j + 0.5) * cell);
      z[j * n + i] = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  const range = Math.max(hi - lo, 1);
  // Contour every 2 ft on gentle land, 5 or 10 ft where there's more relief.
  const interval = range > 50 * 12 ? 120 : range > 20 * 12 ? 60 : 24;

  const lake = plot.waterFeatures.filter((w) => w.kind === "lake" || w.kind === "pond");
  const img = ctx.createImageData(px, px);
  // Light from the north-west, 45° up (x east, y south, z up).
  const L = [-0.5, -0.5, Math.SQRT1_2];
  for (let j = 0; j < px; j++) {
    for (let i = 0; i < px; i++) {
      const k = j * n + i;
      const dzdx = ((z[k + 1] - z[k]) / cell) * VERTICAL_EXAGGERATION;
      const dzdy = ((z[k + n] - z[k]) / cell) * VERTICAL_EXAGGERATION;
      const len = Math.hypot(dzdx, dzdy, 1);
      const shade = Math.max(0, (-dzdx * L[0] - dzdy * L[1] + L[2]) / len);
      const lit = 0.55 + 0.6 * shade;
      let [r, g, b] = tint((z[k] - lo) / range);
      r *= lit;
      g *= lit;
      b *= lit;

      const world: Point = { x: view.x0 + (i + 0.5) * cell, y: view.y0 + (j + 0.5) * cell };
      if (lake.some((w) => pointInPolygon(world, w.points))) {
        [r, g, b] = [96 * lit + 20, 140 * lit + 20, 170 * lit + 30];
      } else if (Math.floor(z[k] / interval) !== Math.floor(z[k + 1] / interval) ||
                 Math.floor(z[k] / interval) !== Math.floor(z[k + n] / interval)) {
        r *= 0.82;
        g *= 0.82;
        b *= 0.82;
      }
      // Fade the neighbors' land so the plot stands out.
      if (!pointInPolygon(world, plot.outline)) {
        r = r * 0.55 + 255 * 0.45;
        g = g * 0.55 + 250 * 0.45;
        b = b * 0.55 + 240 * 0.45;
      }
      const o = (j * px + i) * 4;
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { view, scale: px / view.side };
}

function drawOverlays(ctx: CanvasRenderingContext2D, plot: Plot, view: View, scale: number, px: number, detailed: boolean) {
  const toPx = (p: Point) => [(p.x - view.x0) * scale, (p.y - view.y0) * scale] as const;
  const u = px / 220; // drawing unit, so line widths scale with the canvas

  // Creeks and washes
  for (const w of plot.waterFeatures) {
    if (w.kind !== "creek" && w.kind !== "wash") continue;
    ctx.beginPath();
    w.points.forEach((p, i) => (i ? ctx.lineTo(...toPx(p)) : ctx.moveTo(...toPx(p))));
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (w.kind === "creek") {
      ctx.strokeStyle = "#4a86b0";
      ctx.lineWidth = 3.2 * u;
      ctx.setLineDash([]);
    } else {
      ctx.strokeStyle = "#a88a5c";
      ctx.lineWidth = 2.4 * u;
      ctx.setLineDash([5 * u, 4 * u]);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Road along one edge
  const roadW = 7 * u;
  const [ax, ay] = toPx({ x: 0, y: 0 });
  const [bx, by] = toPx({ x: plot.widthIn, y: plot.depthIn });
  const gap = 5 * u;
  ctx.fillStyle = "#8d8f8c";
  if (plot.roadSide === "N") ctx.fillRect(0, ay - gap - roadW, px, roadW);
  if (plot.roadSide === "S") ctx.fillRect(0, by + gap, px, roadW);
  if (plot.roadSide === "W") ctx.fillRect(ax - gap - roadW, 0, roadW, px);
  if (plot.roadSide === "E") ctx.fillRect(bx + gap, 0, roadW, px);

  // Plot boundary
  ctx.beginPath();
  plot.outline.forEach((p, i) => (i ? ctx.lineTo(...toPx(p)) : ctx.moveTo(...toPx(p))));
  ctx.closePath();
  ctx.strokeStyle = "#1f2421";
  ctx.lineWidth = 1.6 * u;
  ctx.setLineDash([6 * u, 3 * u]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Downhill arrow from the middle of the plot
  if (plot.slope.percent >= 0.5) {
    const d = bearingVector(plot.slope.downhillDeg);
    const [cx, cy] = toPx({ x: plot.widthIn / 2, y: plot.depthIn / 2 });
    const len = 34 * u;
    const ex = cx + d.x * len;
    const ey = cy + d.y * len;
    arrow(ctx, cx - d.x * len * 0.3, cy - d.y * len * 0.3, ex, ey, "#1f2421", 2 * u);
    if (detailed) {
      ctx.font = `${10 * u}px ui-sans-serif, system-ui`;
      ctx.fillStyle = "#1f2421";
      ctx.textAlign = "center";
      ctx.fillText("downhill", ex + d.x * 18 * u, ey + d.y * 12 * u + 3 * u);
    }
  }

  // North marker
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath();
  ctx.arc(16 * u, 16 * u, 10 * u, 0, Math.PI * 2);
  ctx.fill();
  arrow(ctx, 16 * u, 22 * u, 16 * u, 8 * u, "#1f2421", 1.6 * u);
  ctx.font = `bold ${7 * u}px ui-sans-serif, system-ui`;
  ctx.fillStyle = "#1f2421";
  ctx.textAlign = "center";
  ctx.fillText("N", 22.5 * u, 25 * u);

  // Sun paths: summer and winter arcs from sunrise to sunset, on a small dial.
  const r = 17 * u;
  const ox = px - r - 7 * u;
  const oy = px - r - 7 * u;
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath();
  ctx.arc(ox, oy, r + 4 * u, 0, Math.PI * 2);
  ctx.fill();
  const dial = (az: number, rr: number) => {
    const v = bearingVector(az);
    return [ox + v.x * rr, oy + v.y * rr] as const;
  };
  for (const [day, color, rr] of [
    [SUMMER_SOLSTICE, "#e8892b", r],
    [WINTER_SOLSTICE, "#d8b43a", r * 0.62],
  ] as const) {
    const arc = dayArc(day);
    ctx.beginPath();
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
      const az = arc.sunrise.azimuthDeg + ((arc.sunset.azimuthDeg - arc.sunrise.azimuthDeg) * i) / steps;
      const [x, y] = dial(az, rr);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 * u;
    ctx.stroke();
  }
  // Noon sun sits due south.
  const [sx, sy] = dial(180, r);
  ctx.fillStyle = "#f2a531";
  ctx.beginPath();
  ctx.arc(sx, sy, 3.6 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1f2421";
  ctx.beginPath();
  ctx.arc(ox, oy, 1.5 * u, 0, Math.PI * 2);
  ctx.fill();
}

function arrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, w: number) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const head = w * 3.2;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2 - Math.cos(a) * head * 0.6, y2 - Math.sin(a) * head * 0.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - Math.cos(a - 0.45) * head, y2 - Math.sin(a - 0.45) * head);
  ctx.lineTo(x2 - Math.cos(a + 0.45) * head, y2 - Math.sin(a + 0.45) * head);
  ctx.closePath();
  ctx.fill();
}

/**
 * A shaded-relief map of a plot: contours, water, road, boundary, a downhill
 * arrow, north marker and a dial with Boise's summer and winter sun paths.
 * Draws only once it scrolls into view, so long feeds stay fast.
 */
export default function PlotPreview({
  plot,
  size = 220,
  detailed = false,
  className = "",
}: {
  plot: Plot;
  size?: number;
  detailed?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !visible) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = Math.round(size * dpr);
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { view, scale } = drawRelief(ctx, plot, px);
    drawOverlays(ctx, plot, view, scale, px, detailed);
  }, [plot, size, detailed, visible]);

  return (
    <canvas
      ref={ref}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className={`block rounded-lg bg-stone-200 ${className}`}
      role="img"
      aria-label={`Terrain map of ${plot.name ?? "plot"}`}
    />
  );
}
