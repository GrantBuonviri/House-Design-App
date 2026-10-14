"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FloorPlan, Level, PlanBasics, Point } from "@/lib/model/schema";
import { useProjectStore } from "@/lib/store/projectStore";
import { diagramOf } from "@/lib/bubbles/edit";
import { WINTER_RING, defaultLotOffset, houseCenter, landDrawing, lotCenter } from "@/lib/bubbles/land";
import { siteOf } from "@/lib/bubbles/site";
import { MAIN_LEVEL_ID } from "@/lib/brief/levels";
import { nearestSide } from "@/lib/land/generate";
import { blankPlans, moveMany, planHasContent, planOf, removeMany } from "@/lib/plan/edit";
import { plansFromSketch } from "@/lib/plan/fromSketch";
import { boundsOf, dist } from "@/lib/plan/geometry";
import { houseTotals, totalsText } from "@/lib/plan/measure";
import { Note } from "@/components/brief/bits";
import LevelTabs from "@/components/bubbles/LevelTabs";
import ViewOptions, { type Overlay } from "@/components/bubbles/ViewOptions";
import type { LandView, Side } from "@/components/bubbles/types";
import PlanBasicsForm from "./PlanBasicsForm";
import PlanSidePanel from "./PlanSidePanel";
import { PLAN_TOOLS, type PlanSelection, type PlanTool } from "./types";

const PlanCanvas = dynamic(() => import("./PlanCanvas"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-lg bg-stone-100" />,
});

const CANVAS_HEIGHT = 640;
const FT = 12;

/** Stage 5: the floor plan. Rooms with real walls, doors, windows, stairs and fixtures, one tab per floor. */
export default function PlanStage({ onContinue, onGoToSketch }: { onContinue: () => void; onGoToSketch: () => void }) {
  const project = useProjectStore((s) => s.project)!;
  const update = useProjectStore((s) => s.update);
  const { brief, plot } = project;
  const plans = project.floorPlans;
  const sketches = project.bubbles;
  const { overlays, lotOffset } = project.sketch;
  const { basics, showSketch, showDims } = project.plan;
  const levels = useMemo(() => [...project.levels].sort((a, b) => a.elevationIn - b.elevationIn), [project.levels]);

  const [levelId, setLevelId] = useState(MAIN_LEVEL_ID);
  const [tool, setTool] = useState<PlanTool>("select");
  const [selection, setSelection] = useState<PlanSelection>([]);
  const [snap, setSnap] = useState(true);
  const [placeOpening, setPlaceOpening] = useState("door-hinged");
  const [placeFixture, setPlaceFixture] = useState("counter");
  const [lotMode, setLotMode] = useState(false);
  const [editingBasics, setEditingBasics] = useState(false);
  const [choosing, setChoosing] = useState(() => !planHasContent(plans));
  const [notes, setNotes] = useState<string[]>([]);
  const [flash, setFlash] = useState<string>();
  const [drafting, setDrafting] = useState(false);

  // Back on the drawing when a plan appears (after Undo, say). Start over keeps
  // the old plan until a new start is picked, so it isn't counted.
  const filled = planHasContent(plans);
  const [wasFilled, setWasFilled] = useState(filled);
  if (filled !== wasFilled) {
    setWasFilled(filled);
    if (filled && choosing) setChoosing(false);
  }

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(undefined), 6000);
    return () => clearTimeout(t);
  }, [flash]);

  const level: Level = levels.find((l) => l.id === levelId) ?? levels.find((l) => l.id === MAIN_LEVEL_ID) ?? levels[0];
  const plan = planOf(plans, level.id);
  const belowLevel = [...levels].reverse().find((l) => l.elevationIn < level.elevationIn);
  const below = belowLevel && plans[belowLevel.id] ? { name: belowLevel.name, plan: plans[belowLevel.id], level: belowLevel } : null;
  const sketch = diagramOf(sketches, level.id);
  const sketchHasRooms = Object.values(sketches).some((d) => d.bubbles.some((b) => !b.stairs));

  // What's selected and still there (Undo can take things away).
  const live = new Set([
    ...plan.rooms.flatMap((r) => [r.id, ...r.polygon.map((_, i) => `${r.id}#${i}`)]),
    ...plan.walls.map((x) => x.id),
    ...plan.openings.map((x) => x.id),
    ...plan.stairs.map((x) => x.id),
    ...plan.fixtures.map((x) => x.id),
  ]);
  const sel = selection.filter((s) => live.has(s.id));

  const sides = useMemo(() => {
    const out: Record<Side, string[]> = { N: [], E: [], S: ["Sunny side"], W: [] };
    if (plot) {
      out[plot.roadSide].unshift("Road");
      if (siteOf(plot).walkout) out[nearestSide(plot.slope.downhillDeg)].push("Downhill");
    }
    return out;
  }, [plot]);

  // ---- The land under the plan (the same placement as the flow sketch) ----
  const drawing = useMemo(() => (plot ? landDrawing(plot) : null), [plot]);
  const mainBubbles = diagramOf(sketches, MAIN_LEVEL_ID).bubbles;
  const mainPts = planOf(plans, MAIN_LEVEL_ID).rooms.flatMap((r) => r.polygon);
  const allPts = Object.values(plans).flatMap((p) => p.rooms.flatMap((r) => r.polygon));
  const bb = boundsOf(mainPts.length ? mainPts : allPts);
  const center: Point = bb ? { x: (bb.x0 + bb.x1) / 2, y: (bb.y0 + bb.y1) / 2 } : houseCenter(mainBubbles);
  const fallbackOffset = (): Point | null => {
    if (!plot) return null;
    if (mainBubbles.length) return defaultLotOffset(plot, mainBubbles);
    const lot = lotCenter(plot);
    return { x: Math.round(lot.x - center.x), y: Math.round(lot.y - center.y) };
  };
  const reach = allPts.reduce((m, p) => Math.max(m, dist(p, center)), 0);
  const land: LandView | null =
    drawing && plot && (overlays.property || overlays.land || overlays.sun)
      ? {
          drawing,
          offset: lotOffset ?? fallbackOffset()!,
          show: overlays,
          sun: { center, radius: Math.max((reach + 8 * FT) / WINTER_RING, 25 * FT) },
        }
      : null;
  const canMoveLot = Boolean(land && (overlays.property || overlays.land));
  const lotOn = lotMode && canMoveLot;

  function setOverlay(key: Overlay, on: boolean) {
    update((p) => ({
      ...p,
      sketch: { ...p.sketch, overlays: { ...p.sketch.overlays, [key]: on }, lotOffset: p.sketch.lotOffset ?? (on && key !== "sun" ? fallbackOffset() : null) },
    }));
  }

  const setPlans = useCallback(
    (change: (ps: Record<string, FloorPlan>) => Record<string, FloorPlan>, coalesce?: string) =>
      update((p) => ({ ...p, floorPlans: change(p.floorPlans) }), coalesce ? { coalesce: `plan.${coalesce}` } : undefined),
    [update],
  );
  const setLevelPlan = useCallback((pl: FloorPlan, coalesce?: string) => setPlans((ps) => ({ ...ps, [level.id]: pl }), coalesce), [setPlans, level.id]);
  const setView = (patch: Partial<typeof project.plan>) => update((p) => ({ ...p, plan: { ...p.plan, ...patch } }));

  const chooseTool = (t: PlanTool) => {
    setTool(t);
    setLotMode(false);
    if (t !== "select") setSelection([]);
  };

  // Keyboard: tool letters, Delete to remove, arrows to nudge, Escape to let go.
  useEffect(() => {
    if (choosing || editingBasics || !basics) return;
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest("input, textarea, select, [contenteditable]")) return;
      const removable = sel.filter((s) => s.kind !== "edge");
      if ((e.key === "Delete" || e.key === "Backspace") && removable.length) {
        e.preventDefault();
        setLevelPlan(removeMany(plan, removable.map((s) => s.id)));
        setSelection([]);
        return;
      }
      const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      const movable = sel.filter((s) => s.kind === "room" || s.kind === "wall" || s.kind === "stairs" || s.kind === "fixture");
      if (nudge && movable.length) {
        e.preventDefault();
        const step = e.shiftKey ? 12 : 1;
        setLevelPlan(moveMany(plan, movable.map((s) => s.id), nudge[0] * step, nudge[1] * step), "nudge");
        return;
      }
      if (e.key === "Escape") {
        if (drafting) return;
        if (lotOn) setLotMode(false);
        else {
          setTool("select");
          setSelection([]);
        }
        return;
      }
      const hit = PLAN_TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
      if (hit) chooseTool(hit.id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [choosing, editingBasics, basics, sel, plan, drafting, lotOn, setLevelPlan]);

  function fromSketch() {
    const res = plansFromSketch(sketches, { brief, plot, levels, basics });
    update((p) => ({ ...p, floorPlans: { ...blankPlans(levels), ...res.plans }, plan: { ...p.plan, showSketch: false } }));
    setNotes(
      res.needHall.length
        ? [
            `${res.needHall.length === 1 ? "These rooms are" : "These pairs of rooms are"} connected in your sketch but don't share a wall yet: ${res.needHall
              .map((h) => `${h.a} and ${h.b}`)
              .join("; ")}. Push rooms together, or draw a hallway between them with the Room tool.`,
          ]
        : [],
    );
    setSelection([]);
    setChoosing(false);
  }

  /** An empty floor on every level, with the flow sketch showing underneath to trace over. */
  function startBlank() {
    update((p) => ({ ...p, floorPlans: blankPlans(levels), plan: { ...p.plan, showSketch: sketchHasRooms } }));
    setNotes([]);
    setSelection([]);
    setChoosing(false);
  }

  /** Back to the start choices. The plan stays until a new start is picked (and Undo brings it back after). */
  function startOver() {
    setNotes([]);
    setSelection([]);
    setLotMode(false);
    setTool("select");
    setChoosing(true);
  }

  function saveBasics(b: PlanBasics) {
    update((p) => ({ ...p, plan: { ...p.plan, basics: b } }));
    setEditingBasics(false);
  }

  const hasGarage = Boolean(brief?.rooms.some((r) => r.type === "garage") || brief?.garageBays);
  const hasStairs = levels.length > 1;

  // ---- Plan basics ----
  if (!basics || editingBasics) {
    return <PlanBasicsForm basics={basics} levels={levels} hasGarage={hasGarage} hasStairs={hasStairs} onSave={saveBasics} onCancel={basics ? () => setEditingBasics(false) : undefined} />;
  }

  // ---- Choose how to start ----
  if (choosing) {
    return (
      <div className="card mx-auto max-w-2xl px-8 py-12 text-center">
        <h2 className="text-xl font-semibold tracking-tight">Start your floor plan</h2>
        <p className="mx-auto mt-2 max-w-lg text-sm text-muted">
          Turn your flow sketch into rooms with real walls: each bubble becomes a room of the same size, in the same spot, pushed together so neighbors share walls, with
          doors between the rooms you connected. Or start with an empty floor and trace over your sketch yourself.
        </p>
        {filled && <p className="mx-auto mt-3 max-w-lg text-sm text-amber-800">Either choice replaces the floor plan you have now on every floor. Undo brings it back.</p>}
        <div className="mt-6 flex justify-center gap-3">
          {filled && (
            <button className="btn" onClick={() => setChoosing(false)}>
              Keep my plan
            </button>
          )}
          <button className="btn" onClick={startBlank}>
            Start blank
          </button>
          <button className="btn-primary" onClick={fromSketch} disabled={!sketchHasRooms}>
            Turn my sketch into a plan
          </button>
        </div>
        {!sketchHasRooms && (
          <p className="mt-4 text-sm text-muted">
            Your flow sketch is empty.{" "}
            <button className="text-accent hover:underline" onClick={onGoToSketch}>
              Go to the flow sketch
            </button>{" "}
            or start blank.
          </p>
        )}
        <button className="mt-6 text-xs text-muted hover:text-ink hover:underline" onClick={() => setEditingBasics(true)}>
          Change the plan basics
        </button>
      </div>
    );
  }

  // ---- The editor ----
  const totals = houseTotals(levels.map((l) => planOf(plans, l.id)));
  const hint = lotOn ? "Drag anywhere to slide the lot under your house. Your rooms stay put." : PLAN_TOOLS.find((t) => t.id === tool)?.hint;
  const counts = Object.fromEntries(levels.map((l) => [l.id, plans[l.id]?.rooms.length ?? 0]));
  const box = "size-4 accent-[var(--color-accent)]";

  return (
    <div className="space-y-4 pb-10">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight">Floor plan</h2>
          <p className="mt-1 text-sm text-muted">{totals.living + totals.garage + totals.outdoor > 0 ? `Whole house: ${totalsText(totals)}.` : "Rooms with real walls, doors and windows."}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button className="btn" onClick={() => setEditingBasics(true)}>
            Plan basics
          </button>
          <button className="btn" onClick={startOver} title="Choose Start blank or Turn my sketch into a plan again">
            Start over
          </button>
          <button className="btn-primary" onClick={onContinue}>
            Next: interior →
          </button>
        </div>
      </div>

      {notes.map((n) => (
        <Note key={n} text={n} />
      ))}
      {flash && <p className="rounded-md bg-accent-soft px-3 py-2 text-sm text-accent">{flash}</p>}

      <LevelTabs
        levels={levels}
        current={level.id}
        counts={counts}
        onSelect={(id) => {
          setLevelId(id);
          setSelection([]);
        }}
      />

      <ViewOptions
        snap={snap}
        onSnap={setSnap}
        hasPlot={Boolean(plot)}
        flat={!drawing?.downhill}
        overlays={overlays}
        onOverlay={(key, on) => {
          setOverlay(key, on);
          if (!on && key !== "arrow" && key !== "sun") setLotMode(false);
        }}
        lotMode={lotOn}
        canMoveLot={canMoveLot}
        onLotMode={setLotMode}
        extra={
          <>
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" className={box} checked={showDims} onChange={(e) => setView({ showDims: e.target.checked })} />
              Wall lengths
            </label>
            <label className={`flex items-center gap-2 ${sketch.bubbles.length ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`}>
              <input type="checkbox" className={box} checked={showSketch} disabled={!sketch.bubbles.length} onChange={(e) => setView({ showSketch: e.target.checked })} />
              Flow sketch
            </label>
          </>
        }
      />

      <div className="grid grid-cols-[44px_1fr_260px] items-start gap-3">
        <div className="card flex flex-col gap-1 p-1" role="toolbar" aria-label="Drawing tools" aria-orientation="vertical">
          {PLAN_TOOLS.map((t) => (
            <button
              key={t.id}
              aria-label={t.label}
              aria-pressed={tool === t.id}
              title={`${t.label} (${t.key})`}
              onClick={() => chooseTool(t.id)}
              className={`flex size-9 items-center justify-center rounded-md ${tool === t.id ? "bg-accent text-white" : "text-ink hover:bg-stone-100"}`}
            >
              <ToolIcon tool={t.id} />
            </button>
          ))}
        </div>

        <div className="relative min-w-0">
          <PlanCanvas
            plan={plan}
            level={level}
            levels={levels}
            basics={basics}
            below={below}
            sketch={showSketch && sketch.bubbles.length ? sketch : null}
            tool={tool}
            placeOpening={placeOpening}
            placeFixture={placeFixture}
            selection={sel}
            snap={snap}
            showDims={showDims}
            sides={sides}
            height={CANVAS_HEIGHT}
            land={land}
            lotMode={lotOn}
            onLotMove={(offset) => update((p) => ({ ...p, sketch: { ...p.sketch, lotOffset: offset } }))}
            onSelect={setSelection}
            onChange={setLevelPlan}
            onToolDone={() => setTool("select")}
            onDrafting={setDrafting}
            onMessage={setFlash}
          />
          {lotOn && (
            <div className="absolute top-10 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full bg-ink px-4 py-1.5 text-sm text-white shadow-md" role="status">
              <span>Drag to slide the lot under your house.</span>
              <button className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium hover:bg-white/25" onClick={() => setLotMode(false)}>
                Done (Esc)
              </button>
            </div>
          )}
          <p className="mt-2 text-xs text-muted">{hint} Pinch or hold Control and scroll to zoom; scroll to move around. Arrow keys nudge what&apos;s selected.</p>
        </div>

        <PlanSidePanel
          plan={plan}
          level={level}
          levels={levels}
          brief={brief}
          basics={basics}
          selection={sel}
          tool={tool}
          placeOpening={placeOpening}
          placeFixture={placeFixture}
          onPlaceOpening={setPlaceOpening}
          onPlaceFixture={setPlaceFixture}
          onChange={setLevelPlan}
          onSelect={setSelection}
        />
      </div>
    </div>
  );
}

/** Simple line icons for the tool bar. */
function ToolIcon({ tool }: { tool: PlanTool }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (tool) {
    case "select":
      return (
        <svg {...common}>
          <path d="M5 3l14 8-6 2-2 6z" />
        </svg>
      );
    case "room":
      return (
        <svg {...common}>
          <path d="M4 5h16v14H4z" />
          <path d="M4 12h7v7" strokeWidth={1.3} />
        </svg>
      );
    case "wall":
      return (
        <svg {...common}>
          <path d="M4 19V8h11" strokeWidth={3.2} strokeLinecap="square" />
        </svg>
      );
    case "door":
      return (
        <svg {...common}>
          <path d="M3 20h4M17 20h4" strokeWidth={2.6} />
          <path d="M7 20V8" />
          <path d="M7 8a12 12 0 0110 12" strokeDasharray="2 2" />
        </svg>
      );
    case "stairs":
      return (
        <svg {...common}>
          <path d="M4 20h4v-4h4v-4h4V8h4V4" />
        </svg>
      );
    case "fixture":
      return (
        <svg {...common}>
          <rect x="7" y="3" width="10" height="5" rx="1" />
          <ellipse cx="12" cy="15" rx="5" ry="6" />
        </svg>
      );
    case "pan":
      return (
        <svg {...common}>
          <path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" />
        </svg>
      );
  }
}
