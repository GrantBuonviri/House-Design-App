"use client";

import { useRef } from "react";
import { snapAngle } from "@/lib/land/designer";

/**
 * A round dial with an arrow. Drag anywhere on it to turn the arrow; it snaps
 * every 15° (hold Shift for any angle). Degrees run clockwise from straight up.
 */
export default function Dial({
  value,
  onChange,
  label,
  color = "#1f2421",
  mark = "N",
}: {
  value: number;
  onChange: (deg: number) => void;
  label: string;
  color?: string;
  mark?: string;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const turnTo = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    onChange(snapAngle((Math.atan2(dx, -dy) * 180) / Math.PI, e.shiftKey));
  };
  return (
    <svg
      ref={ref}
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={359}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      width={84}
      height={84}
      viewBox="-42 -42 84 84"
      className="shrink-0 cursor-grab touch-none rounded-full outline-offset-2"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        turnTo(e);
      }}
      onPointerMove={(e) => e.buttons === 1 && turnTo(e)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowUp") onChange(snapAngle(value + 15, false));
        if (e.key === "ArrowLeft" || e.key === "ArrowDown") onChange(snapAngle(value - 15, false));
      }}
    >
      <circle r={38} fill="#fff" stroke="#d6d3cc" strokeWidth={1.5} />
      {Array.from({ length: 24 }, (_, i) => (
        <line key={i} y1={-38} y2={i % 6 === 0 ? -31 : -34} stroke="#a8a49a" strokeWidth={1} transform={`rotate(${i * 15})`} />
      ))}
      <g transform={`rotate(${value})`}>
        <line y1={4} y2={-26} stroke={color} strokeWidth={3} strokeLinecap="round" />
        <polygon points="0,-34 -6,-22 6,-22" fill={color} />
        <text y={-38.5} textAnchor="middle" fontSize={0} />
      </g>
      <text y={4} textAnchor="middle" fontSize={11} fontWeight={600} fill={color}>
        {mark}
      </text>
    </svg>
  );
}
