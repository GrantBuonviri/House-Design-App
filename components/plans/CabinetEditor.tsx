"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Cabinet, FloorPlan, Point, Project } from "@/lib/model/schema";
import { useProjectStore } from "@/lib/store/projectStore";
import { planOf } from "@/lib/plan/edit";
import { ceilingFor } from "@/lib/plan/basics";
import { add, angleOf, boundsOf, dot, leftNormal, pointInPolygon, project as projectOn, rotate, scale, sub, unit } from "@/lib/plan/geometry";
import { formatFeetInches } from "@/lib/model/units";
import { addCabinet, CABINET_LABEL, CABINET_WIDTHS, cabinetCorners, cabinetsEdited, newCabinet, removeCabinet, resetCabinets, updateCabinet, VANITY_WIDTHS, type PlacedCabinet } from "@/lib/plan/cabinets";
import { levelCabinets } from "@/lib/plans/sheets/cabinets";

/**
 * Change the cabinets the app laid out: pick one to move it along its wall,
 * change its kind or width, or take it away; add uppers, bases or a tall
 * pantry by clicking a wall. Every change saves right away (and can be
 * undone); "Back to automatic" drops all the changes on a floor.
 */

const ADDABLE: Cabinet["kind"][] = ["upper", "base", "drawer", "tall", "vanity"];

export default function CabinetEditor({ project, onClose }: { project: Project; onClose: () => void }) {
  const update = useProjectStore((s) => s.update);
  const levels = useMemo(() => [...project.levels].sort((a, b) => a.elevationIn - b.elevationIn).filter((l) => levelCabinets(project, l).cabinets.length > 0), [project]);
  const [levelId, setLevelId] = useState(() => levels[0]?.id ?? project.levels[0]?.id);
  const level = project.levels.find((l) => l.id === levelId) ?? project.levels[0];
  const plan = planOf(project.floorPlans, level.id);
  const ceiling = ceilingFor(project.plan.basics, level);
  const layout = levelCabinets(project, level);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState<Cabinet["kind"] | null>(null);
  const [drag, setDrag] = useState<{ id: string; from: Point; shift: number } | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [layer, setLayer] = useState<"base" | "upper">("base");
  const svg = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (adding) setAdding(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [adding, onClose]);

  const sel = layout.cabinets.find((c) => c.id === selected) ?? null;
  const setPlan = (change: (p: FloorPlan) => FloorPlan, coalesce?: string) =>
    update((p) => ({ ...p, floorPlans: { ...p.floorPlans, [level.id]: change(planOf(p.floorPlans, level.id)) } }), coalesce ? { coalesce } : undefined);

  // Rooms that hold cabinets; one is shown at a time, zoomed in.
  const rooms = plan.rooms.filter((r) => layout.cabinets.some((c) => pointInPolygon({ x: c.x, y: c.y }, r.polygon)));
  const room = rooms.find((r) => r.id === roomId) ?? rooms.find((r) => r.type === "kitchen") ?? rooms[0];
  const shown = room ? [room] : plan.rooms;
  const inRoom = (c: PlacedCabinet) => !room || pointInPolygon({ x: c.x, y: c.y }, room.polygon);
  const isUpper = (c: PlacedCabinet) => c.bottomIn > 24;
  const onLayer = (c: PlacedCabinet) => c.kind === "tall" || (layer === "upper") === isUpper(c);
  const b = boundsOf([...shown.flatMap((r) => r.polygon), ...layout.cabinets.filter(inRoom).flatMap(cabinetCorners)]) ?? { x0: 0, y0: 0, x1: 240, y1: 240 };
  const pad = 24;
  const view = { x: b.x0 - pad, y: b.y0 - pad, w: b.x1 - b.x0 + pad * 2, h: b.y1 - b.y0 + pad * 2 };

  const toPlan = (e: { clientX: number; clientY: number }): Point => {
    const el = svg.current;
    const m = el?.getScreenCTM();
    if (!el || !m) return { x: 0, y: 0 };
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: pt.x, y: pt.y };
  };

  /** Moving a cabinet slides it along its own wall. */
  const along = (c: PlacedCabinet) => rotate({ x: 1, y: 0 }, c.rotation);
  const moveBy = (c: PlacedCabinet, d: number) => {
    const u = along(c);
    setPlan((p) => updateCabinet(p, c, { x: c.x + u.x * d, y: c.y + u.y * d }));
    setSelected(null);
  };

  const placeAt = (p: Point) => {
    if (!adding) return;
    // The nearest wall of a room, and the side of it that was clicked.
    let best: { a: Point; b: Point; d: number; at: Point } | null = null;
    for (const r of plan.rooms)
      for (let i = 0; i < r.polygon.length; i++) {
        const a = r.polygon[i];
        const bb = r.polygon[(i + 1) % r.polygon.length];
        const pr = projectOn(p, a, bb);
        if (!best || pr.d < best.d) best = { a, b: bb, d: pr.d, at: pr.point };
      }
    if (!best || best.d > 60) return;
    const u = unit(sub(best.b, best.a));
    const n = leftNormal(u);
    const inward = dot(sub(p, best.a), n) >= 0 ? n : scale(n, -1);
    const back = add(best.at, scale(inward, 2.5));
    const width = adding === "tall" ? 18 : adding === "vanity" ? 36 : adding === "upper" ? 30 : 24;
    setPlan((pl) => addCabinet(pl, newCabinet(adding, back, Math.round(angleOf(inward) - 90), width, ceiling)));
    if (adding !== "tall") setLayer(adding === "upper" ? "upper" : "base");
    setAdding(null);
  };

  const widths = sel ? [...new Set([...(sel.kind === "vanity" ? VANITY_WIDTHS : CABINET_WIDTHS), Math.round(sel.widthIn)])].sort((a, b) => a - b) : [];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-6" data-testid="cabinet-editor">
      <div className="flex h-full max-h-[760px] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <header className="flex items-center gap-3 border-b border-line px-5 py-3">
          <div>
            <h3 className="text-lg font-semibold">Cabinets</h3>
            <p className="text-xs text-muted">Laid out from your counters, islands, vanities and appliances. Click one to change it, or add more on a wall.</p>
          </div>
          {levels.length > 1 && (
            <select className="input ml-auto w-auto py-1.5" value={level.id} onChange={(e) => setLevelId(e.target.value)} aria-label="Floor">
              {levels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          )}
          <button className={`btn ${levels.length > 1 ? "" : "ml-auto"}`} onClick={onClose} data-testid="cabinet-close">
            Done
          </button>
        </header>
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col bg-paper p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
              {rooms.map((r) => (
                <button key={r.id} className={`rounded-md border px-2.5 py-1 ${r.id === room?.id ? "border-accent bg-accent-soft font-medium" : "border-line bg-white"}`} onClick={() => (setRoomId(r.id), setSelected(null))} data-testid={`cab-room-${r.type ?? "room"}`}>
                  {r.name}
                </button>
              ))}
              <div className="ml-auto flex overflow-hidden rounded-md border border-line bg-white">
                {(["base", "upper"] as const).map((k) => (
                  <button key={k} className={`px-2.5 py-1 ${layer === k ? "bg-accent-soft font-medium" : ""}`} onClick={() => (setLayer(k), setSelected(null))} data-testid={`cab-layer-${k}`}>
                    {k === "base" ? "Base cabinets" : "Upper cabinets"}
                  </button>
                ))}
              </div>
            </div>
            <svg
              ref={svg}
              viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
              className={`min-h-0 w-full flex-1 ${adding ? "cursor-crosshair" : ""}`}
              onPointerMove={(e) => {
                if (!drag) return;
                const c = layout.cabinets.find((x) => x.id === drag.id);
                if (!c) return;
                const d = dot(sub(toPlan(e), drag.from), along(c));
                setDrag({ ...drag, shift: Math.round(d * 2) / 2 });
              }}
              onPointerUp={() => {
                if (!drag) return;
                const c = layout.cabinets.find((x) => x.id === drag.id);
                if (c && Math.abs(drag.shift) >= 0.5) moveBy(c, drag.shift);
                setDrag(null);
              }}
              onClick={(e) => {
                if (adding) placeAt(toPlan(e));
                else if (e.target === svg.current) setSelected(null);
              }}
              data-testid="cabinet-canvas"
            >
              {plan.rooms.map((r) => (
                <polygon key={r.id} points={r.polygon.map((p) => `${p.x},${p.y}`).join(" ")} fill={shown.includes(r) ? "#ffffff" : "#f4f2ee"} stroke="#3a3a3a" strokeWidth={3} />
              ))}
              {shown.map((r) => {
                const c = r.polygon.reduce((s, p) => ({ x: s.x + p.x / r.polygon.length, y: s.y + p.y / r.polygon.length }), { x: 0, y: 0 });
                return (
                  <text key={`t${r.id}`} x={c.x} y={c.y} fontSize={9} textAnchor="middle" fill="#9a958c" pointerEvents="none">
                    {r.name}
                  </text>
                );
              })}
              {plan.fixtures
                .filter((f) => !["counter", "island", "vanity"].includes(f.kind))
                .map((f) => {
                  const pts = cabinetCorners(f);
                  return <polygon key={f.id} points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="#ece9e3" stroke="#9a958c" strokeWidth={0.8} pointerEvents="none" />;
                })}
              {[...layout.cabinets]
                .filter(inRoom)
                .sort((a, b) => Number(onLayer(a)) - Number(onLayer(b)))
                .map((c) => {
                  const live = onLayer(c);
                  const shift = drag?.id === c.id ? scale(along(c), drag.shift) : { x: 0, y: 0 };
                  const pts = cabinetCorners(c).map((p) => add(p, shift));
                  const upper = c.bottomIn > 24;
                  const on = c.id === selected;
                  const mid = add({ x: c.x, y: c.y }, shift);
                  const ang = readableDeg(c.rotation);
                  return (
                    <g
                      key={c.id}
                      opacity={live ? 1 : 0.35}
                      pointerEvents={live ? undefined : "none"}
                      onPointerDown={(e) => {
                        if (adding) return;
                        e.stopPropagation();
                        (e.target as Element).setPointerCapture?.(e.pointerId);
                        setSelected(c.id);
                        setDrag({ id: c.id, from: toPlan(e), shift: 0 });
                      }}
                      onClick={(e) => e.stopPropagation()}
                      style={{ cursor: adding ? "crosshair" : "grab" }}
                      data-testid={`cab-${c.code}`}
                    >
                      <polygon
                        points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
                        fill={on ? "#dcebe3" : upper ? "rgba(255,255,255,0.6)" : "#ffffff"}
                        stroke={on ? "#2f6b4f" : upper ? "#7a7a7a" : "#3a3a3a"}
                        strokeWidth={on ? 1.6 : 0.9}
                        strokeDasharray={upper ? "4 2" : undefined}
                      />
                      <text x={mid.x} y={mid.y} fontSize={upper ? 5 : 6} textAnchor="middle" dominantBaseline="middle" transform={`rotate(${ang} ${mid.x} ${mid.y})`} fill={upper ? "#555" : "#222"} pointerEvents="none">
                        {c.code}
                      </text>
                    </g>
                  );
                })}
            </svg>
          </div>
          <aside className="w-72 shrink-0 overflow-y-auto border-l border-line p-4 text-sm">
            {sel ? (
              <div data-testid="cabinet-panel">
                <h4 className="font-semibold">
                  {sel.code}: {CABINET_LABEL[sel.kind]}
                </h4>
                <p className="field-hint">{sel.auto ? "Placed by the app." : "Added by you."} Drag it along the wall, or use the arrows.</p>
                <label className="field-label mt-3" htmlFor="cab-kind">
                  Kind
                </label>
                <select
                  id="cab-kind"
                  className="input"
                  value={sel.kind}
                  onChange={(e) => {
                    const kind = e.target.value as Cabinet["kind"];
                    const back = add({ x: sel.x, y: sel.y }, scale(rotate({ x: 0, y: 1 }, sel.rotation), -sel.depthIn / 2));
                    const fresh = newCabinet(kind, back, sel.rotation, sel.widthIn, ceiling);
                    setPlan((p) => updateCabinet(p, sel, { kind, x: fresh.x, y: fresh.y, depthIn: fresh.depthIn, heightIn: fresh.heightIn, bottomIn: fresh.bottomIn }));
                    setSelected(null);
                  }}
                >
                  {(["base", "sink", "drawer", "upper", "tall", "vanity", "filler"] as const).map((k) => (
                    <option key={k} value={k}>
                      {CABINET_LABEL[k]}
                    </option>
                  ))}
                </select>
                <label className="field-label mt-3" htmlFor="cab-width">
                  Width
                </label>
                <select id="cab-width" className="input" value={Math.round(sel.widthIn)} onChange={(e) => (setPlan((p) => updateCabinet(p, sel, { widthIn: Number(e.target.value) })), setSelected(null))} data-testid="cab-width">
                  {widths.map((w) => (
                    <option key={w} value={w}>
                      {w}&quot;
                    </option>
                  ))}
                </select>
                <p className="field-hint">
                  {formatFeetInches(sel.widthIn)} wide, {formatFeetInches(sel.depthIn)} deep, {formatFeetInches(sel.heightIn)} tall{sel.bottomIn ? `, ${formatFeetInches(sel.bottomIn)} off the floor` : ""}.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button className="btn text-sm" onClick={() => moveBy(sel, -3)}>
                    ← 3&quot;
                  </button>
                  <button className="btn text-sm" onClick={() => moveBy(sel, 3)}>
                    3&quot; →
                  </button>
                </div>
                <button className="mt-4 text-sm text-red-700 hover:underline" onClick={() => (setPlan((p) => removeCabinet(p, sel.id)), setSelected(null))} data-testid="cab-delete">
                  Take this cabinet away
                </button>
              </div>
            ) : (
              <div>
                <h4 className="font-semibold">Add a cabinet</h4>
                <p className="field-hint">Pick one, then click the wall it goes on.</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {ADDABLE.map((k) => (
                    <button key={k} className={`btn text-sm ${adding === k ? "border-accent bg-accent-soft" : ""}`} onClick={() => setAdding(adding === k ? null : k)} data-testid={`add-${k}`}>
                      {CABINET_LABEL[k].replace(" cabinet", "").replace(" (pantry)", "")}
                    </button>
                  ))}
                </div>
                {adding && <p className="mt-2 rounded-md bg-accent-soft p-2 text-xs">Click a wall in the drawing. Esc to stop.</p>}
                <p className="mt-4 text-xs text-muted">
                  {layout.cabinets.length} cabinets on this floor. Switch between base and upper cabinets above the drawing; uppers are dashed. Sheet I-201 shows each wall from the front.
                </p>
              </div>
            )}
            {cabinetsEdited(plan) && (
              <button className="btn mt-6 w-full text-sm" onClick={() => (setPlan(resetCabinets), setSelected(null))} data-testid="cab-reset">
                Back to automatic
              </button>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

/** SVG rotation that keeps a label along a cabinet from reading upside down. */
function readableDeg(rotation: number): number {
  let a = ((rotation % 360) + 360) % 360;
  if (a > 90 && a < 270) a -= 180;
  return a;
}
