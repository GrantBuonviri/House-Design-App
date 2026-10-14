import type { FloorPlan, Point } from "@/lib/model/schema";
import { CATEGORY_COLOR } from "@/lib/bubbles/shapes";
import { roomType } from "@/lib/brief/rooms";
import type { Bounds } from "@/lib/plan/geometry";
import { polygonCenter } from "@/lib/plan/geometry";
import { openingGeometries, solidWalls, wallPieces } from "@/lib/plan/walls";

/**
 * A small read-only drawing of one floor, for comparing alternatives. Every
 * drawing in a row uses the same frame, so they line up. Rooms that changed
 * get a colored outline.
 */
export default function MiniPlan({
  plan,
  frame,
  size,
  exteriorIn,
  stairs = [],
  changed = [],
}: {
  plan: FloorPlan;
  frame: Bounds;
  size: number;
  exteriorIn: number;
  /** Footprints of the stairs on this floor. */
  stairs?: Point[][];
  changed?: string[];
}) {
  const pad = 14 * Math.max((frame.x1 - frame.x0) / size, (frame.y1 - frame.y0) / size);
  const vb = `${frame.x0 - pad} ${frame.y0 - pad} ${frame.x1 - frame.x0 + 2 * pad} ${frame.y1 - frame.y0 + 2 * pad}`;
  const k = Math.max(frame.x1 - frame.x0 + 2 * pad, frame.y1 - frame.y0 + 2 * pad) / size;
  const geos = openingGeometries(plan);
  const walls = solidWalls(wallPieces(plan, exteriorIn), geos);
  const hot = new Set(changed);
  return (
    <svg viewBox={vb} width={size} height={size} role="img" aria-label="Floor plan">
      {plan.rooms.map((r) => (
        <polygon
          key={r.id}
          points={r.polygon.map((p) => `${p.x},${p.y}`).join(" ")}
          fill={r.type ? CATEGORY_COLOR[roomType(r.type).category] : "#e6dfd2"}
          stroke={hot.has(r.id) ? "#7c3aed" : "none"}
          strokeWidth={hot.has(r.id) ? 3 * k : 0}
          strokeDasharray={hot.has(r.id) ? `${6 * k} ${3 * k}` : undefined}
        />
      ))}
      {walls.map((w, i) => (
        <line key={i} x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke="#2a2a2a" strokeWidth={w.open ? 0.8 * k : Math.max(w.thicknessIn, 1.6 * k)} strokeDasharray={w.open ? `${3 * k} ${2 * k}` : undefined} />
      ))}
      {geos
        .filter((g) => g.opening.kind === "window")
        .map((g) => (
          <line key={g.opening.id} x1={g.a.x} y1={g.a.y} x2={g.b.x} y2={g.b.y} stroke="#4a90d9" strokeWidth={Math.max(3, 1.6 * k)} />
        ))}
      {stairs.map((pts, i) => (
        <polygon key={i} points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="#d6c7b4" fillOpacity={0.7} stroke="#8a7a66" strokeWidth={0.8 * k} />
      ))}
      {plan.rooms.map((r) => {
        const c = polygonCenter(r.polygon);
        return (
          <text key={r.id} x={c.x} y={c.y} fontSize={10 * k} textAnchor="middle" dominantBaseline="middle" fill="#3b3b3b" style={{ fontFamily: "inherit" }}>
            {r.name.length > 16 ? `${r.name.slice(0, 15)}…` : r.name}
          </text>
        );
      })}
    </svg>
  );
}
