"use client";

import type { CustomLand } from "@/lib/model/schema";
import {
  LANE_MAX_FT,
  LANE_MIN_FT,
  PATH_KINDS,
  ROCK_MAX_FT,
  ROCK_MIN_FT,
  TREE_SIZES,
  flowsUphill,
  isPathWater,
  pickLabel,
  removePick,
  setFeatureSize,
  setLaneWidth,
  setMainRoad,
  setPathKind,
  type PathKind,
  type Pick,
} from "@/lib/land/featureTools";
import type { FeatureTool } from "./DesignerFeatures";

const HELP: Record<FeatureTool, string> = {
  shape: "",
  water: "Click points along the path, then double-click (or press Enter) to finish. Drag its dots to bend it, double-click a dot to remove it. Water flows from the first point to the last, so draw it downhill.",
  pond: "Click where the pond goes and drag outward to size it. Drag its edge dots to reshape it.",
  lake: "Click a side of the lot to put a lake beyond it. Drag the shore dots in or out.",
  rock: "Click to drop a big rock. Drag to move it, then set its size here.",
  tree: "Click to drop a tree. Hold Shift and drag to paint a row or a clump.",
  roads: "Click a side of the lot to put a road along it (the first one is the main street). Click a road to make it the main street or remove it.",
  lane: "Click points along the lane, then double-click (or press Enter) to finish. Drag its dots to bend it.",
  ground: "",
};

export default function FeaturePanel({
  land,
  tool,
  pick,
  onChange,
  onPick,
  pathKind,
  setPathKindNext,
  treeFt,
  setTreeFt,
  laneFt,
  setLaneFt,
}: {
  land: CustomLand;
  tool: FeatureTool;
  pick: Pick;
  onChange: (l: CustomLand) => void;
  onPick: (p: Pick) => void;
  pathKind: PathKind;
  setPathKindNext: (k: PathKind) => void;
  treeFt: number;
  setTreeFt: (n: number) => void;
  laneFt: number;
  setLaneFt: (n: number) => void;
}) {
  const feature = pick?.type === "feature" ? land.features[pick.index] : null;
  const lane = pick?.type === "lane" ? land.lanes[pick.index] : null;
  const water = pick?.type === "water" ? land.water[pick.index] : null;
  const road = pick?.type === "road" ? land.roads[pick.index] : null;

  const seg = (items: { id: string; label: string }[], value: string, set: (id: string) => void, label: string) => (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line bg-white p-0.5">
      {items.map((it) => (
        <button
          key={it.id}
          role="radio"
          aria-checked={value === it.id}
          onClick={() => set(it.id)}
          className={`rounded px-3 py-1 text-xs font-medium ${value === it.id ? "bg-accent text-white" : "text-muted hover:text-ink"}`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );

  const counts = [
    land.water.length && `${land.water.length} water`,
    land.features.filter((f) => f.kind === "rock").length && `${land.features.filter((f) => f.kind === "rock").length} rock`,
    land.features.filter((f) => f.kind === "tree").length && `${land.features.filter((f) => f.kind === "tree").length} trees`,
    land.lanes.length && `${land.lanes.length} lane`,
    `${land.roads.length} road${land.roads.length === 1 ? "" : "s"}`,
  ].filter(Boolean);

  return (
    <section data-feature-panel>
      <h3 className="field-label">{tool === "shape" ? "On the land" : "Features, roads and lanes"}</h3>
      {HELP[tool] && <p className="field-hint mb-2">{HELP[tool]}</p>}

      {tool === "water" && (
        <div className="mb-2">
          <span className="field-hint">Draw a</span> {seg(PATH_KINDS, pathKind, (k) => setPathKindNext(k as PathKind), "Kind of water")}
        </div>
      )}
      {tool === "tree" && (
        <div className="mb-2">
          <span className="field-hint">Size</span>{" "}
          {seg(
            TREE_SIZES.map((t) => ({ id: String(t.ft), label: t.label })),
            String(treeFt),
            (v) => setTreeFt(Number(v)),
            "Tree size",
          )}
        </div>
      )}
      {tool === "lane" && (
        <label className="mb-2 flex items-center gap-2 text-xs text-muted">
          Width for the next lane
          <input type="range" aria-label="New lane width" min={LANE_MIN_FT} max={LANE_MAX_FT} value={laneFt} onChange={(e) => setLaneFt(Number(e.target.value))} />
          {laneFt} ft
        </label>
      )}

      {pick && (
        <div className="mb-2 rounded-lg border border-line bg-stone-50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-medium">{pickLabel(land, pick)} selected</span>
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
          {feature && pick.type === "feature" && (
            <label className="flex items-center gap-2 text-xs text-muted">
              Size
              <input
                type="range"
                aria-label={feature.kind === "rock" ? "Rock size" : "Tree size"}
                min={feature.kind === "rock" ? ROCK_MIN_FT : 6}
                max={feature.kind === "rock" ? ROCK_MAX_FT : 60}
                value={feature.sizeFt}
                onChange={(e) => onChange(setFeatureSize(land, pick.index, Number(e.target.value)))}
              />
              {Math.round(feature.sizeFt)} ft across
            </label>
          )}
          {lane && pick.type === "lane" && (
            <label className="flex items-center gap-2 text-xs text-muted">
              Width
              <input type="range" aria-label="Lane width" min={LANE_MIN_FT} max={LANE_MAX_FT} value={lane.widthFt} onChange={(e) => onChange(setLaneWidth(land, pick.index, Number(e.target.value)))} />
              {lane.widthFt} ft
            </label>
          )}
          {water && pick.type === "water" && isPathWater(water) && (
            <div className="space-y-1">
              {seg(PATH_KINDS, water.kind, (k) => onChange(setPathKind(land, pick.index, k as PathKind)), "This water")}
              {flowsUphill(land, water.points) && (
                <p className="text-xs text-amber-800">⚠ This runs uphill. Water flows from its first point to its last, so the first point should be the higher end.</p>
              )}
            </div>
          )}
          {road && pick.type === "road" && (
            <div className="flex items-center gap-2 text-xs text-muted">
              {road.kind === "main" ? (
                <span>The driveway and front door face this street.</span>
              ) : (
                <button className="btn" onClick={() => onChange(setMainRoad(land, pick.index))}>
                  Make this the main street
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <p className="field-hint">
        Placed so far: {counts.join(", ")}. Select anything and press Delete, or right-click it, to remove it.
      </p>
    </section>
  );
}
