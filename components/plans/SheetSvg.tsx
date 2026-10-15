"use client";

import { memo } from "react";
import { WEIGHT_IN, type Sheet } from "@/lib/plans/draw";
import { textOrigin } from "@/lib/plans/pdf";

/**
 * A sheet's drawing list as SVG, for the preview. It uses the same list and
 * the same text placement as the PDF, so what you see is what prints.
 */
function SheetSvg({ sheet, className, style }: { sheet: Sheet; className?: string; style?: React.CSSProperties }) {
  const pts = (p: { x: number; y: number }[]) => p.map((q) => `${q.x},${q.y}`).join(" ");
  return (
    <svg viewBox={`0 0 ${sheet.w} ${sheet.h}`} className={className} role="img" aria-label={`${sheet.number} ${sheet.title}`} style={{ background: "#ffffff", ...style }}>
      {sheet.items.map((it, i) => {
        if (it.t === "line")
          return <polyline key={i} points={pts(it.pts)} fill="none" stroke={it.color ?? "#000"} strokeWidth={WEIGHT_IN[it.w]} strokeDasharray={it.dash?.join(" ")} />;
        if (it.t === "poly")
          return (
            <polygon
              key={i}
              points={pts(it.pts)}
              fill={it.fill ?? "none"}
              stroke={it.stroke ? "#000" : "none"}
              strokeWidth={it.stroke ? WEIGHT_IN[it.stroke] : 0}
              strokeDasharray={it.dash?.join(" ")}
            />
          );
        if (it.t === "circle") return <circle key={i} cx={it.c.x} cy={it.c.y} r={it.r} fill={it.fill ?? "none"} stroke={it.stroke ? "#000" : "none"} strokeWidth={it.stroke ? WEIGHT_IN[it.stroke] : 0} />;
        const o = textOrigin(it);
        return (
          <text
            key={i}
            x={o.x}
            y={o.y}
            fontSize={it.size / 72}
            fontFamily="Helvetica, Arial, sans-serif"
            fontWeight={it.bold ? 700 : 400}
            fill={it.color ?? "#000"}
            transform={it.rotate ? `rotate(${-it.rotate} ${o.x} ${o.y})` : undefined}
            style={{ whiteSpace: "pre" }}
          >
            {it.text}
          </text>
        );
      })}
    </svg>
  );
}

export default memo(SheetSvg);
