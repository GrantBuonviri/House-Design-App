"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DEVICE_KINDS, type Device, type DeviceKind, type FloorPlan, type Point, type Project } from "@/lib/model/schema";
import { useProjectStore } from "@/lib/store/projectStore";
import { planOf } from "@/lib/plan/edit";
import { exteriorWallIn } from "@/lib/plan/basics";
import { add, boundsOf, rotate, scale, sub } from "@/lib/plan/geometry";
import { cabinetCorners } from "@/lib/plan/cabinets";
import { addDevice, DEVICE_INFO, devicesEdited, removeDevice, resetDevices, snapToWall, updateDevice, type DeviceSystem, type PlacedDevice } from "@/lib/plan/devices";
import { levelDevices } from "@/lib/plans/systems";

/**
 * Change the outlets, switches, lights, alarms, fans, registers and hose
 * bibs the app placed: drag one to move it (wall ones stay on a wall), pick
 * one to change or take it away, or add more. Every change saves right away
 * and can be undone; "Back to automatic" drops the changes on a floor.
 */

const SYSTEMS: { id: DeviceSystem; label: string }[] = [
  { id: "electrical", label: "Electrical" },
  { id: "mechanical", label: "Heating and air" },
  { id: "plumbing", label: "Plumbing" },
];

export const DEVICE_CODE: Record<DeviceKind, string> = {
  outlet: "O",
  "outlet-240": "240",
  junction: "J",
  switch: "S",
  "switch-3way": "S3",
  light: "L",
  "light-recessed": "R",
  "light-wall": "WL",
  fan: "EF",
  smoke: "SD",
  co: "CO",
  "smoke-co": "S/CO",
  heat: "HD",
  panel: "P",
  supply: "SR",
  return: "RA",
  thermostat: "T",
  "hose-bib": "HB",
};

/** Fans show with the heating and air layer too. */
const onSystem = (k: DeviceKind, s: DeviceSystem) => DEVICE_INFO[k].system === s || (k === "fan" && s === "mechanical");

export default function DeviceEditor({ project, onClose }: { project: Project; onClose: () => void }) {
  const update = useProjectStore((s) => s.update);
  const levels = useMemo(() => [...project.levels].sort((a, b) => a.elevationIn - b.elevationIn).filter((l) => planOf(project.floorPlans, l.id).rooms.length > 0), [project]);
  const [levelId, setLevelId] = useState(() => levels[0]?.id ?? project.levels[0]?.id);
  const level = project.levels.find((l) => l.id === levelId) ?? project.levels[0];
  const plan = planOf(project.floorPlans, level.id);
  const devices = levelDevices(project, level);
  const ext = exteriorWallIn(project.plan.basics);
  const [system, setSystem] = useState<DeviceSystem>("electrical");
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState<DeviceKind | null>(null);
  const [drag, setDrag] = useState<{ id: string; from: Point; to: Point } | null>(null);
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

  const sel = devices.find((d) => d.id === selected) ?? null;
  const setPlan = (change: (p: FloorPlan) => FloorPlan) => update((p) => ({ ...p, floorPlans: { ...p.floorPlans, [level.id]: change(planOf(p.floorPlans, level.id)) } }));
  const b = boundsOf([...plan.rooms.flatMap((r) => r.polygon), ...devices.map((d) => ({ x: d.x, y: d.y }))]) ?? { x0: 0, y0: 0, x1: 240, y1: 240 };
  const pad = 36;
  const view = { x: b.x0 - pad, y: b.y0 - pad, w: b.x1 - b.x0 + pad * 2, h: b.y1 - b.y0 + pad * 2 };
  const r = Math.max(5, view.w / 160);

  const toPlan = (e: { clientX: number; clientY: number }): Point => {
    const m = svg.current?.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: pt.x, y: pt.y };
  };

  /** Where a device ends up when dropped: wall ones snap to the nearest wall face. */
  const place = (kind: DeviceKind, p: Point): Omit<Device, "id"> | null => {
    if (!DEVICE_INFO[kind].wall) return { kind, x: p.x, y: p.y, rotation: 0 };
    const w = snapToWall(plan, p, ext);
    return w ? { kind, x: w.p.x, y: w.p.y, rotation: w.rotation } : null;
  };

  const addable = DEVICE_KINDS.filter((k) => onSystem(k, system) && k !== "panel");
  const kinds = sel ? DEVICE_KINDS.filter((k) => DEVICE_INFO[k].system === DEVICE_INFO[sel.kind].system && DEVICE_INFO[k].wall === DEVICE_INFO[sel.kind].wall) : [];
  const shown = devices.filter((d) => onSystem(d.kind, system));
  const count = (k: DeviceKind) => devices.filter((d) => d.kind === k).length;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-6" data-testid="device-editor">
      <div className="flex h-full max-h-[820px] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <header className="flex items-center gap-3 border-b border-line px-5 py-3">
          <div>
            <h3 className="text-lg font-semibold">Outlets, lights and systems</h3>
            <p className="text-xs text-muted">Placed by the code rules. Drag one to move it, click one to change it, or add more.</p>
          </div>
          {levels.length > 1 && (
            <select className="input ml-auto w-auto py-1.5" value={level.id} onChange={(e) => (setLevelId(e.target.value), setSelected(null))} aria-label="Floor" data-testid="device-floor">
              {levels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          )}
          <button className={`btn ${levels.length > 1 ? "" : "ml-auto"}`} onClick={onClose} data-testid="device-close">
            Done
          </button>
        </header>
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col bg-paper p-3">
            <div className="mb-2 flex overflow-hidden self-start rounded-md border border-line bg-white text-sm">
              {SYSTEMS.map((s) => (
                <button key={s.id} className={`px-3 py-1 ${system === s.id ? "bg-accent-soft font-medium" : ""}`} onClick={() => (setSystem(s.id), setSelected(null), setAdding(null))} data-testid={`dev-layer-${s.id}`}>
                  {s.label}
                </button>
              ))}
            </div>
            <svg
              ref={svg}
              viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
              className={`min-h-0 w-full flex-1 ${adding ? "cursor-crosshair" : ""}`}
              onPointerMove={(e) => drag && setDrag({ ...drag, to: toPlan(e) })}
              onPointerUp={() => {
                if (!drag) return;
                const d = devices.find((x) => x.id === drag.id);
                const moved = sub(drag.to, drag.from);
                if (d && Math.hypot(moved.x, moved.y) >= 2) {
                  const next = place(d.kind, add({ x: d.x, y: d.y }, moved));
                  if (next) setPlan((p) => updateDevice(p, d, next));
                  setSelected(null);
                }
                setDrag(null);
              }}
              onClick={(e) => {
                if (adding) {
                  const next = place(adding, toPlan(e));
                  if (next) setPlan((p) => addDevice(p, next));
                  setAdding(null);
                } else if (e.target === svg.current) setSelected(null);
              }}
              data-testid="device-canvas"
            >
              {plan.rooms.map((rm) => (
                <polygon key={rm.id} points={rm.polygon.map((p) => `${p.x},${p.y}`).join(" ")} fill="#ffffff" stroke="#9a958c" strokeWidth={4} />
              ))}
              {plan.rooms.map((rm) => {
                const c = rm.polygon.reduce((s, p) => ({ x: s.x + p.x / rm.polygon.length, y: s.y + p.y / rm.polygon.length }), { x: 0, y: 0 });
                return (
                  <text key={`t${rm.id}`} x={c.x} y={c.y} fontSize={r * 1.6} textAnchor="middle" fill="#b5b0a6" pointerEvents="none">
                    {rm.name}
                  </text>
                );
              })}
              {plan.fixtures.map((f) => (
                <polygon key={f.id} points={cabinetCorners(f).map((p) => `${p.x},${p.y}`).join(" ")} fill="#f1eee8" stroke="#c9c4ba" strokeWidth={0.8} pointerEvents="none" />
              ))}
              {shown.map((d) => (
                <DeviceGlyph
                  key={d.id}
                  d={d}
                  r={r}
                  on={d.id === selected}
                  shift={drag?.id === d.id ? sub(drag.to, drag.from) : null}
                  onDown={(e) => {
                    if (adding) return;
                    e.stopPropagation();
                    (e.target as Element).setPointerCapture?.(e.pointerId);
                    setSelected(d.id);
                    const at = toPlan(e);
                    setDrag({ id: d.id, from: at, to: at });
                  }}
                />
              ))}
            </svg>
          </div>
          <aside className="w-72 shrink-0 overflow-y-auto border-l border-line p-4 text-sm">
            {sel ? (
              <div data-testid="device-panel">
                <h4 className="font-semibold">{DEVICE_INFO[sel.kind].label}</h4>
                <p className="field-hint">
                  {sel.auto ? "Placed by the app." : "Added by you."} Drag it to move it{DEVICE_INFO[sel.kind].wall ? "; it stays on a wall" : ""}.
                </p>
                {kinds.length > 1 && (
                  <>
                    <label className="field-label mt-3" htmlFor="dev-kind">
                      Kind
                    </label>
                    <select id="dev-kind" className="input" value={sel.kind} onChange={(e) => (setPlan((p) => updateDevice(p, sel, { kind: e.target.value as DeviceKind })), setSelected(null))} data-testid="dev-kind">
                      {kinds.map((k) => (
                        <option key={k} value={k}>
                          {DEVICE_INFO[k].label}
                        </option>
                      ))}
                    </select>
                  </>
                )}
                <button className="mt-4 block text-sm text-red-700 hover:underline" onClick={() => (setPlan((p) => removeDevice(p, sel.id)), setSelected(null))} data-testid="dev-delete">
                  Take this away
                </button>
              </div>
            ) : (
              <div>
                <h4 className="font-semibold">Add</h4>
                <p className="field-hint">Pick one, then click where it goes. Outlets, switches and wall lights go on the nearest wall.</p>
                <div className="mt-2 grid grid-cols-1 gap-1.5">
                  {addable.map((k) => (
                    <button key={k} className={`btn justify-start text-left text-sm ${adding === k ? "border-accent bg-accent-soft" : ""}`} onClick={() => setAdding(adding === k ? null : k)} data-testid={`add-dev-${k}`}>
                      <span className="mr-2 inline-block w-9 text-xs font-semibold text-muted">{DEVICE_CODE[k]}</span>
                      {DEVICE_INFO[k].label}
                      <span className="ml-auto text-xs text-muted">{count(k) || ""}</span>
                    </button>
                  ))}
                </div>
                {adding && <p className="mt-2 rounded-md bg-accent-soft p-2 text-xs">Click in the drawing. Esc to stop.</p>}
                <p className="mt-4 text-xs text-muted">The code check on the Plans page rechecks the outlet spacing, alarms and fans after every change.</p>
              </div>
            )}
            {devicesEdited(plan) && (
              <button className="btn mt-6 w-full text-sm" onClick={() => (setPlan(resetDevices), setSelected(null))} data-testid="dev-reset">
                Back to automatic
              </button>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

function DeviceGlyph({ d, r, on, shift, onDown }: { d: PlacedDevice; r: number; on: boolean; shift: Point | null; onDown: (e: React.PointerEvent) => void }) {
  const wall = DEVICE_INFO[d.kind].wall;
  // Wall devices sit just off the wall face, toward the room.
  const at = add(add({ x: d.x, y: d.y }, shift ?? { x: 0, y: 0 }), wall ? scale(rotate({ x: 0, y: 1 }, d.rotation), r) : { x: 0, y: 0 });
  const code = DEVICE_CODE[d.kind];
  return (
    <g onPointerDown={onDown} onClick={(e) => e.stopPropagation()} style={{ cursor: "grab" }} data-testid={`dev-${d.id}`}>
      <circle cx={at.x} cy={at.y} r={r * (code.length > 2 ? 1.25 : 1)} fill={on ? "#dcebe3" : "#ffffff"} stroke={on ? "#2f6b4f" : "#3a3a3a"} strokeWidth={on ? r / 3 : r / 6} />
      <text x={at.x} y={at.y} fontSize={r * (code.length > 2 ? 0.75 : 1)} fontWeight={600} textAnchor="middle" dominantBaseline="central" fill="#222" pointerEvents="none">
        {code}
      </text>
    </g>
  );
}
