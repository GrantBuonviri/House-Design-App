"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CustomLand, Plot } from "@/lib/model/schema";
import { buildCustomPlot } from "@/lib/land/custom";
import { describeSlope } from "@/lib/land/generate";
import { plotImplications } from "@/lib/land/implications";
import { compassName } from "@/lib/land/sun";
import { TREE_SIZES, type PathKind, type Pick } from "@/lib/land/featureTools";
import DesignerPanel from "./DesignerPanel";
import FeaturePanel from "./FeaturePanel";
import GroundPanel from "./GroundPanel";
import type { GroundSettings } from "./DesignerGround";
import { buildingSpotGrade, landContours } from "@/lib/land/groundTools";
import { CANVAS_H, CANVAS_W } from "./DesignerCanvas";
import { DRAINAGE_STYLE, plotFacts } from "./plotText";
import { keyIsForPage } from "@/lib/keys";

const DesignerCanvas = dynamic(() => import("./DesignerCanvas"), {
  ssr: false,
  loading: () => <div className="animate-pulse rounded-lg bg-stone-200" style={{ width: CANVAS_W, height: CANVAS_H }} />,
});
const PlotTerrain3D = dynamic(() => import("./PlotTerrain3D"), { ssr: false });

/**
 * The toolbar above the drawing. Each tool is one button; the land step's
 * later parts (natural features, roads, lanes, shaping the ground) add theirs here.
 */
export const DESIGNER_TOOLS = [
  { id: "shape", label: "Shape the lot" },
  { id: "water", label: "River / creek" },
  { id: "pond", label: "Pond" },
  { id: "lake", label: "Lake" },
  { id: "rock", label: "Big rock" },
  { id: "tree", label: "Tree" },
  { id: "roads", label: "Roads" },
  { id: "lane", label: "Lane" },
  { id: "ground", label: "Ground" },
] as const;

/**
 * The "Design your own land" page. It edits a local copy of the settings
 * (with its own undo), and "Use this land" hands the finished plot back.
 */
export default function LandDesigner({
  start,
  editing,
  warnings,
  onUse,
  onCancel,
}: {
  start: CustomLand;
  /** True when changing land the house already uses. */
  editing: boolean;
  /** Warnings about the house for a candidate version of the land (shown while editing). */
  warnings: (plot: Plot, land: CustomLand) => string[];
  onUse: (land: CustomLand) => void;
  onCancel: () => void;
}) {
  const [past, setPast] = useState<CustomLand[]>([]);
  const [future, setFuture] = useState<CustomLand[]>([]);
  const [land, setLand] = useState(start);
  const [view, setView] = useState<"2d" | "3d">("2d");
  const [tool, setTool] = useState<(typeof DESIGNER_TOOLS)[number]["id"]>("shape");
  const [selected, setSelectedCorner] = useState<number | null>(null);
  const [pick, setPickRaw] = useState<Pick>(null);
  const [pathKind, setPathKind] = useState<PathKind>("creek");
  const [treeFt, setTreeFt] = useState<number>(TREE_SIZES[1].ft);
  const [laneFt, setLaneFt] = useState<number>(14);
  const [ground, setGround] = useState<GroundSettings>({ kind: "hill", heightFt: 6, radiusFt: 50, strength: 1 });
  // A corner and a feature are never selected together.
  const setSelected = (i: number | null) => {
    setSelectedCorner(i);
    if (i !== null) setPickRaw(null);
  };
  const setPick = (p: Pick) => {
    setPickRaw(p);
    if (p) setSelectedCorner(null);
  };
  const chooseTool = (id: (typeof DESIGNER_TOOLS)[number]["id"]) => {
    setTool(id);
    setPick(null);
    setSelected(null);
  };

  const lastEdit = useRef(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const change = (next: CustomLand) => {
    // Edits that come one after another (a drag, typing) are folded into one undo step.
    const now = Date.now();
    const fold = now - lastEdit.current < 500;
    lastEdit.current = now;
    if (!fold) setPast((p) => [...p.slice(-60), land]);
    setFuture([]);
    setLand(next);
  };
  const undo = () => {
    if (!past.length) return;
    setFuture((f) => [land, ...f]);
    setLand(past[past.length - 1]);
    setPast(past.slice(0, -1));
    setSelected(null);
    setPick(null);
  };
  const redo = () => {
    if (!future.length) return;
    setPast((p) => [...p, land]);
    setLand(future[0]);
    setFuture(future.slice(1));
    setSelected(null);
    setPick(null);
  };

  // Closing with Escape or a click outside asks first when there are changes to lose.
  const cancel = () => {
    if (past.length && !confirm("Discard your land changes?")) return;
    onCancel();
  };
  // A click outside only counts when it starts outside too, not a drag let go there.
  const downOnBackdrop = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = !keyIsForPage(e, { here: dialogRef.current });
      if (e.key === "Escape" && !typing) cancel();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const plot = useMemo(() => buildCustomPlot(land), [land]);
  const contours = useMemo(() => landContours(land, plot), [land, plot]);
  const spot = buildingSpotGrade(plot);
  const f = plotFacts(plot);
  const imp = plotImplications(plot);
  const warn = useMemo(() => (editing ? warnings(plot, land) : []), [editing, warnings, plot, land]);
  const valid = land.outline.length >= 3 && f.size !== "0.00 acres";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => (downOnBackdrop.current = e.target === e.currentTarget)}
      onClick={(e) => {
        if (downOnBackdrop.current && e.target === e.currentTarget) cancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Design your own land"
        className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">{editing ? "Edit this land" : "Design your own land"}</h2>
            <p className="text-xs text-muted">Draw the lot the way you picture it, with the street at the bottom, then turn the north dial.</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn" onClick={undo} disabled={!past.length}>
              Undo
            </button>
            <button className="btn" onClick={redo} disabled={!future.length}>
              Redo
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 gap-5 overflow-auto p-5">
          <div className="shrink-0" style={{ width: CANVAS_W }}>
            <div className="mb-2 flex items-center justify-between">
              <div data-designer-tools className="flex flex-wrap gap-1.5">
                {DESIGNER_TOOLS.map((t) => (
                  <button key={t.id} onClick={() => chooseTool(t.id)} className={tool === t.id ? "btn-primary" : "btn"}>
                    {t.label}
                  </button>
                ))}
              </div>
              <div role="radiogroup" aria-label="Designer view" className="inline-flex rounded-md border border-line bg-white p-0.5">
                {(["2d", "3d"] as const).map((m) => (
                  <button
                    key={m}
                    role="radio"
                    aria-checked={view === m}
                    onClick={() => setView(m)}
                    className={`rounded px-3 py-1.5 text-sm font-medium ${view === m ? "bg-accent text-white" : "text-muted hover:text-ink"}`}
                  >
                    {m.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-hidden rounded-lg border border-line" style={{ width: CANVAS_W, height: CANVAS_H }}>
              {view === "2d" ? (
                <DesignerCanvas
                  land={land}
                  onChange={change}
                  selected={selected}
                  onSelect={setSelected}
                  tool={tool}
                  pick={pick}
                  onPick={setPick}
                  pathKind={pathKind}
                  treeFt={treeFt}
                  laneFt={laneFt}
                  ground={ground}
                  contours={contours.segments}
                />
              ) : (
                <div className="flex h-full items-center justify-center bg-[#dfe9f2]">
                  <PlotTerrain3D plot={plot} size={CANVAS_H} />
                </div>
              )}
            </div>
            <div className="mt-3 rounded-lg bg-stone-50 p-3 text-sm">
              <p className="font-medium">
                {f.size} · {f.dims} · {f.road}
              </p>
              <p className="text-muted">
                {describeSlope(plot)} · {plot.slope.percent < 2 ? "Open on all sides" : `Faces ${compassName(plot.facingDeg).toLowerCase()}`}
              </p>
              <p className="text-muted">Building spot: {spot}% grade</p>
              <p className="mt-1">
                <span className={`mr-2 rounded-full px-2 py-0.5 text-xs ${DRAINAGE_STYLE[plot.drainage.rating]}`}>{plot.drainage.rating} drainage</span>
                <span className="font-medium">{imp.foundation.label}.</span> <span className="text-muted">{imp.foundation.note}</span>
              </p>
            </div>
          </div>

          <div className="min-w-0 flex-1 overflow-y-auto pr-1">
            {tool === "ground" ? (
              <GroundPanel land={land} pick={pick} settings={ground} setSettings={setGround} onChange={change} onPick={setPick} contourStepFt={contours.stepFt} />
            ) : (
            <FeaturePanel
              land={land}
              tool={tool}
              pick={pick}
              onChange={change}
              onPick={setPick}
              pathKind={pathKind}
              setPathKindNext={setPathKind}
              treeFt={treeFt}
              setTreeFt={setTreeFt}
              laneFt={laneFt}
              setLaneFt={setLaneFt}
            />
            )}
            <div className="mt-5">
              <DesignerPanel land={land} onChange={change} />
            </div>
          </div>
        </div>

        {warn.length > 0 && (
          <ul className="space-y-1 border-t border-line bg-amber-50 px-5 py-2 text-sm text-amber-900">
            {warn.map((w) => (
              <li key={w}>⚠ {w}</li>
            ))}
          </ul>
        )}
        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!valid} onClick={() => onUse(land)}>
            Use this land
          </button>
        </div>
      </div>
    </div>
  );
}
