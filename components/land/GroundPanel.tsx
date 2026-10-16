"use client";

import type { CustomLand } from "@/lib/model/schema";
import { removePick, type Pick } from "@/lib/land/featureTools";
import {
  GROUND_KINDS,
  GROUND_RADIUS_MAX_FT,
  GROUND_RADIUS_MIN_FT,
  HEIGHT_MAX_FT,
  HEIGHT_MIN_FT,
  clearGround,
  groundLabel,
  isBump,
  setGroundAmount,
  setGroundRadius,
  type GroundKind,
} from "@/lib/land/groundTools";
import type { GroundSettings } from "./DesignerGround";

const HELP: Record<GroundKind, string> = {
  hill: "Click to drop a hill. Drag it to move it, drag the white dot on its ring to resize it.",
  dip: "Click to drop a dip (a hollow). Drag it to move it, drag the white dot on its ring to resize it.",
  steeper: "Click or drag to paint steeper ground. The lines are contours: the closer together, the steeper.",
  flatter: "Click or drag to paint flatter ground. Full strength makes a level building pad.",
};

/** Controls for the Ground tool: which shape, how big, how strong, and the selected shape. */
export default function GroundPanel({
  land,
  pick,
  settings,
  setSettings,
  onChange,
  onPick,
  contourStepFt,
}: {
  land: CustomLand;
  pick: Pick;
  settings: GroundSettings;
  setSettings: (s: GroundSettings) => void;
  onChange: (l: CustomLand) => void;
  onPick: (p: Pick) => void;
  contourStepFt: number;
}) {
  const g = pick?.type === "ground" ? land.ground[pick.index] : null;
  const slider = (label: string, min: number, max: number, step: number, value: number, set: (n: number) => void, show: string) => (
    <label className="flex items-center gap-2 text-xs text-muted">
      {label}
      <input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} />
      {show}
    </label>
  );
  const bump = isBump(settings.kind);
  return (
    <section data-ground-panel>
      <h3 className="field-label">Shape the ground</h3>
      <p className="field-hint mb-2">{HELP[settings.kind]}</p>
      <div role="radiogroup" aria-label="Ground shape" className="mb-2 inline-flex rounded-md border border-line bg-white p-0.5">
        {GROUND_KINDS.map((k) => (
          <button
            key={k.id}
            role="radio"
            aria-checked={settings.kind === k.id}
            onClick={() => {
              setSettings({ ...settings, kind: k.id });
              onPick(null);
            }}
            className={`rounded px-3 py-1 text-xs font-medium ${settings.kind === k.id ? "bg-accent text-white" : "text-muted hover:text-ink"}`}
          >
            {k.label}
          </button>
        ))}
      </div>
      <div className="mb-2 space-y-1">
        {bump
          ? slider(`New ${groundLabel(settings.kind).toLowerCase()} height`, HEIGHT_MIN_FT, HEIGHT_MAX_FT, 1, settings.heightFt, (n) => setSettings({ ...settings, heightFt: n }), `${settings.heightFt} ft`)
          : slider("Brush strength", 5, 100, 5, Math.round(settings.strength * 100), (n) => setSettings({ ...settings, strength: n / 100 }), `${Math.round(settings.strength * 100)}%`)}
        {slider("Size (radius)", GROUND_RADIUS_MIN_FT, 150, 2, settings.radiusFt, (n) => setSettings({ ...settings, radiusFt: n }), `${settings.radiusFt} ft`)}
      </div>

      {g && pick?.type === "ground" && (
        <div className="mb-2 rounded-lg border border-line bg-stone-50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-medium">{groundLabel(g.kind)} selected</span>
            <button
              className="btn"
              onClick={() => {
                onChange(removePick(land, pick));
                onPick(null);
              }}
            >
              Remove
            </button>
          </div>
          <div className="space-y-1">
            {isBump(g.kind)
              ? slider(`${groundLabel(g.kind)} height`, HEIGHT_MIN_FT, HEIGHT_MAX_FT, 1, g.amount, (n) => onChange(setGroundAmount(land, pick.index, n)), `${Math.round(g.amount)} ft`)
              : slider("Strength", 5, 100, 5, Math.round(Math.min(g.amount, 1) * 100), (n) => onChange(setGroundAmount(land, pick.index, n / 100)), `${Math.round(Math.min(g.amount, 1) * 100)}%`)}
            {slider("Selected size", GROUND_RADIUS_MIN_FT, GROUND_RADIUS_MAX_FT, 2, g.radiusFt, (n) => onChange(setGroundRadius(land, pick.index, n)), `${Math.round(g.radiusFt)} ft`)}
          </div>
        </div>
      )}

      <p className="field-hint">
        {land.ground.length} ground shape{land.ground.length === 1 ? "" : "s"}
        {contourStepFt > 0 && `, contour lines every ${contourStepFt} ft`}. Select one and press Delete to remove it.
      </p>
      {land.ground.length > 0 && (
        <button
          className="btn mt-2"
          onClick={() => {
            onChange(clearGround(land));
            onPick(null);
          }}
        >
          Clear ground shapes
        </button>
      )}
    </section>
  );
}
