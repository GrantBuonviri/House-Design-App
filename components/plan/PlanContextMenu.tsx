"use client";

import { useEffect, useRef } from "react";
import type { FloorPlan } from "@/lib/model/schema";
import { mirrorMany, copyableIds } from "@/lib/plan/arrange";
import { removeMany, insertCorner, removeCorner } from "@/lib/plan/edit";
import { project } from "@/lib/plan/geometry";
import { removeWall, restoreWall, combineRooms, whyNotCombine, whyWallStays, edgeWalls, roomsAlong } from "@/lib/plan/openWalls";
import { updateOpening } from "@/lib/plan/edit";
import { duplicateAndSelect } from "./ArrangeButtons";
import { parseEdgeId, type PlanItem, type PlanSelection } from "./types";
import type { Point } from "@/lib/model/schema";

export type ContextAt = { x: number; y: number; el: (PlanItem & { corner?: number }) | null; at: Point };
type Item = { label: string; run: () => void; danger?: boolean; disabled?: string | boolean } | "line";

/** The right-click menu: the side panel's main actions for whatever was clicked. */
export function contextItems(
  plan: FloorPlan,
  c: ContextAt,
  selection: PlanSelection,
  act: { change: (p: FloorPlan) => void; select: (s: PlanSelection) => void; message: (t: string) => void },
): Item[] {
  const { el } = c;
  if (!el) return [];
  const picked = selection.some((s) => s.id === el.id) ? selection : [el];
  const ids = picked.filter((s) => s.kind !== "edge" && s.kind !== "opening").map((s) => s.id);
  const copies = copyableIds(plan, ids);
  const arrange: Item[] = copies.length
    ? [
        { label: "Duplicate  ⌘D", run: () => duplicateAndSelect(plan, copies, act.change, act.select) },
        { label: "Flip left-right", run: () => act.change(mirrorMany(plan, copies, "left-right")) },
        { label: "Flip top-bottom", run: () => act.change(mirrorMany(plan, copies, "top-bottom")) },
      ]
    : [];
  const remove = (label: string, rm: string[]): Item => ({ label, danger: true, run: () => (act.change(removeMany(plan, rm)), act.select([])) });

  if (el.corner !== undefined) {
    const room = plan.rooms.find((r) => r.id === el.id);
    return [
      { label: "Remove corner", disabled: room && room.polygon.length <= 3 ? "Rooms keep at least three corners." : false, run: () => act.change(removeCorner(plan, el.id, el.corner!)) },
    ];
  }
  if (el.kind === "edge") {
    const { roomId, edge } = parseEdgeId(el.id);
    const room = plan.rooms.find((r) => r.id === roomId);
    if (!room) return [];
    const walls = edgeWalls(plan, roomId, edge);
    const why = whyWallStays(plan, roomId, edge);
    const along = roomsAlong(plan, roomId, edge);
    const items: Item[] = [{ label: "Add a corner here", run: () => act.change(insertCorner(plan, roomId, edge, project(c.at, room.polygon[edge], room.polygon[(edge + 1) % room.polygon.length]).point)) }];
    if (walls.inside.length > 0 || !walls.removed.length) {
      items.push({ label: "Remove wall", disabled: why ?? false, run: () => { const out = removeWall(plan, roomId, edge); if (out) act.change(out.plan); } });
    } else items.push({ label: "Put wall back", run: () => act.change(restoreWall(plan, roomId, edge)) });
    if (along.length > 1) {
      const whyNot = whyNotCombine(plan, along);
      items.push({ label: "Combine these rooms", disabled: whyNot ?? false, run: () => { const out = combineRooms(plan, along); if (out) { act.change(out.plan); act.select([{ kind: "room", id: out.keptId }]); } } });
    }
    return items;
  }
  if (el.kind === "room") {
    const others = plan.rooms.filter((r) => r.id !== el.id && !whyNotCombine(plan, [el.id, r.id])).slice(0, 6);
    const items: Item[] = [...arrange];
    if (ids.length > 1 && ids.every((id) => plan.rooms.some((r) => r.id === id))) {
      const why = whyNotCombine(plan, ids);
      items.push({ label: "Combine into one room", disabled: why ?? false, run: () => { const out = combineRooms(plan, ids); if (out) { act.change(out.plan); act.select([{ kind: "room", id: out.keptId }]); } } });
    } else {
      for (const o of others) items.push({ label: `Combine with ${o.name}`, run: () => { const out = combineRooms(plan, [el.id, o.id]); if (out) { act.change(out.plan); act.select([{ kind: "room", id: out.keptId }]); } } });
    }
    items.push("line", remove(ids.length > 1 ? `Delete ${ids.length} things` : "Delete room", ids));
    return items;
  }
  if (el.kind === "opening") {
    const o = plan.openings.find((x) => x.id === el.id);
    const items: Item[] = [];
    if (o && o.kind === "door") items.push({ label: "Flip the swing", run: () => act.change(updateOpening(plan, o.id, { side: o.side === 1 ? -1 : 1 })) });
    items.push(remove(`Delete ${o?.kind === "window" ? "window" : "door"}`, [el.id]));
    return items;
  }
  const noun = el.kind === "wall" ? "wall" : el.kind === "stairs" ? "stairs" : "fixture";
  return [...arrange, ...(arrange.length ? (["line"] as Item[]) : []), remove(ids.length > 1 ? `Delete ${ids.length} things` : `Delete ${noun}`, ids.length ? ids : [el.id])];
}

export default function PlanContextMenu({ at, items, onClose }: { at: { x: number; y: number }; items: Item[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", away, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("wheel", onClose, { passive: true });
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", away, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("wheel", onClose);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);
  if (!items.length) return null;
  const left = Math.min(at.x, (typeof window === "undefined" ? at.x : window.innerWidth) - 230);
  const top = Math.min(at.y, (typeof window === "undefined" ? at.y : window.innerHeight) - 40 - items.length * 32);
  return (
    <div ref={ref} role="menu" className="fixed z-50 w-56 rounded-md border border-line bg-white py-1 text-sm shadow-lg" style={{ left, top }} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) =>
        it === "line" ? (
          <hr key={i} className="my-1 border-line" />
        ) : (
          <button
            key={i}
            role="menuitem"
            disabled={!!it.disabled}
            title={typeof it.disabled === "string" ? it.disabled : undefined}
            className={`block w-full px-3 py-1.5 text-left hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40 ${it.danger ? "text-red-700" : ""}`}
            onClick={() => {
              it.run();
              onClose();
            }}
          >
            {it.label}
          </button>
        ),
      )}
    </div>
  );
}
