"use client";

import { isLocked } from "@/lib/plan/locks";
import { useEffect, useRef, useState } from "react";
import type { FloorPlan } from "@/lib/model/schema";
import { mirrorMany, copyableIds } from "@/lib/plan/arrange";
import { removeMany, rotateMany, centerOfMany, turnableIds } from "@/lib/plan/edit";
import { combineAt, combineWalls, cornerBetween, splitEdge, splitEdgeEqual, splitWall, splitWallEqual, type WallEdit } from "@/lib/plan/wallEdits";
import { removeWall, restoreWall, combineRooms, whyNotCombine, whyWallStays, edgeWalls, roomsAlong } from "@/lib/plan/openWalls";
import { updateOpening } from "@/lib/plan/edit";
import { addBay, roundCorner, roundableRadius, whyNoBay, DEFAULT_CORNER_RADIUS_IN } from "@/lib/plan/shapes";
import { bendInfo } from "@/lib/plan/bend";
import { curveTogether, isRun, runInfo, runOf, straightenRun, type RunEdit } from "@/lib/plan/curveRun";
import { duplicateAndSelect } from "./ArrangeButtons";
import { edgeId, parseEdgeId, runTargets, type PlanItem, type PlanSelection } from "./types";
import type { Point } from "@/lib/model/schema";

export type ContextAt = { x: number; y: number; el: (PlanItem & { corner?: number }) | null; at: Point };
type Choice = { label: string; run: () => void; disabled?: string | false };
type Item = { label: string; run: () => void; danger?: boolean; disabled?: string | boolean; ask?: (deg: number) => void; choices?: Choice[] } | "line";

/** Equal-piece splits offered in the menu. */
const PIECES = [2, 3, 4];

/** The right-click menu: the side panel's main actions for whatever was clicked. */
export function contextItems(
  plan: FloorPlan,
  c: ContextAt,
  selection: PlanSelection,
  act: { change: (p: FloorPlan) => void; select: (s: PlanSelection) => void; message: (t: string) => void; anchor?: (id: string, on: boolean) => void },
): Item[] {
  const { el } = c;
  if (!el) return [];
  // Anchored stairs can't move: offer Unanchor instead (copies of stairs start free).
  if (el.kind === "stairs" && isLocked(plan, el.id)) {
    return [{ label: "Unanchor", run: () => act.anchor?.(el.id, false) }, "line", { label: "Duplicate  ⌘D", run: () => duplicateAndSelect(plan, [el.id], act.change, act.select) }];
  }
  const anchoring: Item[] = act.anchor && el.kind === "stairs" ? [{ label: "Anchor", run: () => act.anchor!(el.id, true) }, "line"] : [];
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
  const turnIds = turnableIds(plan, ids);
  const turn = (deg: number) => act.change(rotateMany(plan, turnIds, deg, centerOfMany(plan, turnIds)));
  const turning: Item[] = turnIds.length
    ? [
        { label: "Turn 90° right", run: () => turn(90) },
        { label: "Turn 90° left", run: () => turn(-90) },
        { label: "Turn 15° right", run: () => turn(15) },
        { label: "Turn 15° left", run: () => turn(-15) },
        { label: "Turn by an angle...", run: () => {}, ask: turn },
      ]
    : [];
  // Split and combine: worked out now, so a refusal greys the item with its reason.
  const edit = (label: string, r: WallEdit, then?: () => void): Item => ({
    label,
    disabled: "why" in r ? r.why : false,
    run: () => {
      if ("why" in r) return;
      act.change(r.plan);
      if (r.note) act.message(r.note);
      then?.();
    },
  });
  const pieces = (split: (n: number) => WallEdit): Item => {
    const choices: Choice[] = PIECES.map((n) => {
      const r = split(n);
      return { label: String(n), disabled: "why" in r ? r.why : false, run: () => { if ("why" in r) return; act.change(r.plan); if (r.note) act.message(r.note); } };
    });
    return { label: "Split into equal pieces", run: () => {}, choices, disabled: choices.every((c) => c.disabled) ? (choices[0].disabled as string) : false };
  };
  // Two or more picked walls that meet end to end: bend them as one curve, or straighten them.
  const runTs = runTargets(picked);
  const curving: Item[] = [];
  if (runTs) {
    const r = runOf(plan, runTs);
    const apply = (label: string, out: RunEdit): Exclude<Item, "line"> => ({ label, disabled: "why" in out ? out.why : false, run: () => { if (!("why" in out)) act.change(out.plan); } });
    if (!isRun(r)) curving.push({ label: "Curve together", disabled: r.why, run: () => {} });
    else {
      const info = runInfo(plan, r);
      const together = apply("Curve together", curveTogether(plan, r));
      curving.push(info.radius ? { ...together, disabled: "These walls already make one curve. Drag the diamond to change it." } : together);
      if (r.pieces.some((p) => bendInfo(plan, p.target)?.radius)) curving.push(apply("Make straight", straightenRun(plan, r)));
    }
    curving.push("line");
  }
  const remove = (label: string, rm: string[]): Item => ({ label, danger: true, run: () => (act.change(removeMany(plan, rm)), act.select([])) });

  if (el.corner !== undefined) {
    const room = plan.rooms.find((r) => r.id === el.id);
    return [
      {
        label: "Round corner",
        disabled: room && roundableRadius(room, el.corner, DEFAULT_CORNER_RADIUS_IN) === null ? "This corner can't be rounded: a curved wall or a nearly straight line meets it." : false,
        run: () => { const out = roundCorner(plan, el.id, el.corner!); if (out) act.change(out); },
      },
      edit("Combine walls", combineAt(plan, el.id, el.corner)),
    ];
  }
  if (el.kind === "edge") {
    const { roomId, edge } = parseEdgeId(el.id);
    const room = plan.rooms.find((r) => r.id === roomId);
    if (!room) return [];
    const walls = edgeWalls(plan, roomId, edge);
    const why = whyWallStays(plan, roomId, edge);
    const along = roomsAlong(plan, roomId, edge);
    const items: Item[] = [...curving];
    // Two picked walls of this room that meet: combine them.
    const edges = picked.filter((s) => s.kind === "edge").map((s) => parseEdgeId(s.id));
    if (edges.length === 2 && edges.every((x) => x.roomId === roomId)) {
      const corner = cornerBetween(plan, roomId, edges[0].edge, edges[1].edge);
      const n = room.polygon.length;
      items.push(
        corner === null
          ? { label: "Combine walls", disabled: "These walls don't meet end to end.", run: () => {} }
          : edit("Combine walls", combineAt(plan, roomId, corner), () => act.select([{ kind: "edge", id: edgeId(roomId, corner === 0 ? n - 2 : corner - 1) }])),
        "line",
      );
    }
    items.push(edit("Split wall here", splitEdge(plan, roomId, edge, c.at)), pieces((k) => splitEdgeEqual(plan, roomId, edge, k)), "line");
    if (walls.inside.length > 0 || !walls.removed.length) {
      items.push({ label: "Remove wall", disabled: why ?? false, run: () => { const out = removeWall(plan, roomId, edge); if (out) act.change(out.plan); } });
    } else items.push({ label: "Put wall back", run: () => act.change(restoreWall(plan, roomId, edge)) });
    const noBay = whyNoBay(plan, roomId, edge);
    items.push({ label: "Add half-round bay", disabled: noBay ?? false, run: () => { const out = addBay(plan, roomId, edge, undefined, undefined, c.at); if (out) act.change(out); } });
    if (along.length > 1) {
      const whyNot = whyNotCombine(plan, along);
      items.push({ label: "Combine these rooms", disabled: whyNot ?? false, run: () => { const out = combineRooms(plan, along); if (out) { act.change(out.plan); act.select([{ kind: "room", id: out.keptId }]); } } });
    }
    return items;
  }
  if (el.kind === "room") {
    const others = plan.rooms.filter((r) => r.id !== el.id && !whyNotCombine(plan, [el.id, r.id])).slice(0, 6);
    const items: Item[] = [...arrange, ...(turning.length ? (["line", ...turning] as Item[]) : [])];
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
  const turnGroup: Item[] = el.kind === "fixture" ? [] : turning;
  const walling: Item[] = [];
  if (el.kind === "wall") {
    const walls = picked.filter((s) => s.kind === "wall").map((s) => s.id);
    if (walls.length === 2) walling.push(edit("Combine walls", combineWalls(plan, walls), () => act.select([{ kind: "wall", id: walls[0] }])));
    else if (walls.length <= 1) walling.push(edit("Split wall here", splitWall(plan, el.id, c.at)), pieces((k) => splitWallEqual(plan, el.id, k)));
    if (walling.length) walling.push("line");
  }
  return [...anchoring, ...curving, ...walling, ...arrange, ...(arrange.length ? (["line"] as Item[]) : []), ...turnGroup, ...(turnGroup.length ? (["line"] as Item[]) : []), remove(ids.length > 1 ? `Delete ${ids.length} things` : `Delete ${noun}`, ids.length ? ids : [el.id])];
}

export default function PlanContextMenu({ at, items, onClose }: { at: { x: number; y: number }; items: Item[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [asking, setAsking] = useState<number | null>(null);
  const [typed, setTyped] = useState("");
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
  const left = Math.min(at.x, (typeof window === "undefined" ? at.x : window.innerWidth) - 262);
  const top = Math.min(at.y, (typeof window === "undefined" ? at.y : window.innerHeight) - 40 - items.length * 32);
  return (
    <div ref={ref} role="menu" className="fixed z-50 w-64 rounded-md border border-line bg-white py-1 text-sm shadow-lg" style={{ left, top }} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) =>
        it === "line" ? (
          <hr key={i} className="my-1 border-line" />
        ) : it.choices ? (
          <div key={i} className={`flex items-center gap-1 px-3 py-1 ${it.disabled ? "opacity-40" : ""}`} title={typeof it.disabled === "string" ? it.disabled : undefined}>
            <span className="flex-1">{it.label}</span>
            {it.choices.map((ch) => (
              <button
                key={ch.label}
                role="menuitem"
                disabled={!!ch.disabled}
                title={typeof ch.disabled === "string" ? ch.disabled : `${ch.label} equal pieces`}
                className="h-6 w-6 rounded border border-line text-xs hover:bg-stone-100 disabled:cursor-not-allowed"
                onClick={() => {
                  ch.run();
                  onClose();
                }}
              >
                {ch.label}
              </button>
            ))}
          </div>
        ) : it.ask && asking === i ? (
          <form
            key={i}
            className="flex items-center gap-1 px-3 py-1"
            onSubmit={(e) => {
              e.preventDefault();
              const deg = Number(typed.replace("°", "").trim());
              if (typed.trim() && Number.isFinite(deg) && deg !== 0) it.ask!(deg);
              onClose();
            }}
          >
            <input autoFocus className="field w-20 py-0.5 text-sm" placeholder="degrees" inputMode="decimal" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Degrees to turn (negative turns left)" />
            <span className="text-xs text-muted">° right (− left)</span>
          </form>
        ) : (
          <button
            key={i}
            role="menuitem"
            disabled={!!it.disabled}
            title={typeof it.disabled === "string" ? it.disabled : undefined}
            className={`block w-full px-3 py-1.5 text-left hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40 ${it.danger ? "text-red-700" : ""}`}
            onClick={() => {
              if (it.ask) return setAsking(i);
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
