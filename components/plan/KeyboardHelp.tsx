"use client";

import { PLAN_TOOLS } from "./types";

const OTHER: [string, string][] = [
  ["Delete", "Remove what's picked (a picked wall is taken out)"],
  ["⌘D", "Duplicate what's picked"],
  ["Arrow keys", "Nudge what's picked (Shift for a foot)"],
  ["Shift", "Hold while drawing or dragging for any angle, no snapping"],
  ["Option", "Hold while dragging a corner or wall to pull it away from neighbors; hold while finishing a wall or curve to keep it a divider; hold while bending a wall to curve only one room's side"],
  ["L", "Show or hide all labels"],
  ["M", "Measuring tape"],
  ["Space + drag", "Move around the drawing"],
  ["Escape", "Let go of a tool or selection"],
  ["⌘Z / ⇧⌘Z", "Undo and redo"],
  ["Right-click", "Menu with the main actions for what's under the pointer: on a corner, Round corner; on an outside wall, Add half-round bay"],
  ["?", "Show or hide this card"],
];

/** A card listing every keyboard shortcut on the floor plan. */
export default function KeyboardHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="card p-4" role="dialog" aria-label="Keyboard shortcuts">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Keyboard shortcuts</h3>
        <button className="text-xs text-muted hover:underline" onClick={onClose}>
          Close
        </button>
      </div>
      <dl className="mt-2 space-y-1 text-xs">
        {PLAN_TOOLS.map((t) => (
          <div key={t.id} className="flex gap-2">
            <dt className="w-24 shrink-0 font-mono font-semibold">{t.key}</dt>
            <dd>{t.label}</dd>
          </div>
        ))}
        {OTHER.map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <dt className="w-24 shrink-0 font-mono font-semibold">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
