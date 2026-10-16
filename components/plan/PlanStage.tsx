"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FloorPlan, Level, PlanBasics, Point, Roof } from "@/lib/model/schema";
import { useProjectStore } from "@/lib/store/projectStore";
import { diagramOf } from "@/lib/bubbles/edit";
import { WINTER_RING, defaultLotOffset, houseCenter, landDrawing, lotCenter } from "@/lib/bubbles/land";
import { siteOf } from "@/lib/bubbles/site";
import { MAIN_LEVEL_ID } from "@/lib/brief/levels";
import { nearestSide } from "@/lib/land/generate";
import { blankPlans, moveMany, planHasContent, planOf, removeMany } from "@/lib/plan/edit";
import { removeWall } from "@/lib/plan/openWalls";
import { plansFromSketch } from "@/lib/plan/fromSketch";
import { suggestPlanAlternatives, type PlanAlternative } from "@/lib/plan/alternatives";
import { planWarnings, type PlanWarning } from "@/lib/plan/checks";
import { suggestPlans } from "@/lib/plan/suggest";
import { boundsOf, dist } from "@/lib/plan/geometry";
import { houseTotals, totalsText } from "@/lib/plan/measure";
import { lotOffsetFor } from "@/lib/house3d/site";
import { canPreview } from "@/lib/house3d/windowView";
import { Note } from "@/components/brief/bits";
import LevelTabs from "@/components/bubbles/LevelTabs";
import LabelSettings from "./LabelSettings";
import ViewOptions, { type Overlay } from "@/components/bubbles/ViewOptions";
import type { LandView, Side } from "@/components/bubbles/types";
import PlanBasicsForm from "./PlanBasicsForm";
import PlanAlternativesView from "./PlanAlternativesView";
import PlanChecks from "./PlanChecks";
import PlanContextMenu, { contextItems, type ContextAt } from "./PlanContextMenu";
import KeyboardHelp from "./KeyboardHelp";
import { duplicateAndSelect } from "./ArrangeButtons";
import { levelAbove } from "@/lib/plan/basics";
import { closeGap } from "@/lib/plan/overlaps";
import { fillBelow, fillShapes, overhangsOf, pullBack, supportOf } from "@/lib/plan/support";
import { copyableIds } from "@/lib/plan/arrange";
import PlanSidePanel from "./PlanSidePanel";
import House3DPanel from "@/components/house3d/House3DPanel";
import type { WallsShown } from "@/components/house3d/House3DView";
import { PLAN_TOOLS, parseEdgeId, type PlanSelection, type PlanTool } from "./types";
import { DisplayTabs, LotModeBanner, PlanStartChoices, PlanToolbar, type Display } from "./PlanStageParts";

const PlanCanvas = dynamic(() => import("./PlanCanvas"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-lg bg-stone-100" />,
});

const WindowPreview = dynamic(() => import("@/components/house3d/WindowPreview"), { ssr: false });

const House3DView = dynamic(() => import("@/components/house3d/House3DView"), {
  ssr: false,
  loading: () => <div className="w-full animate-pulse rounded-lg bg-stone-100" style={{ height: CANVAS_HEIGHT }} />,
});

const CANVAS_HEIGHT = 640;

const FT = 12;

type Compare = { alternatives: PlanAlternative[]; note?: string; basis: Record<string, FloorPlan> };

/** Stage 5: the floor plan. Rooms with real walls, doors, windows, stairs and fixtures, one tab per floor. */
export default function PlanStage({ onContinue, onGoToSketch }: { onContinue: () => void; onGoToSketch: () => void }) {
  const project = useProjectStore((s) => s.project)!;
  const update = useProjectStore((s) => s.update);
  const { brief, plot } = project;
  const plans = project.floorPlans;
  const sketches = project.bubbles;
  const { overlays, lotOffset } = project.sketch;
  const { basics, showSketch, labels } = project.plan;
  const levels = useMemo(() => [...project.levels].sort((a, b) => a.elevationIn - b.elevationIn), [project.levels]);

  const [levelId, setLevelId] = useState(MAIN_LEVEL_ID);
  const [tool, setTool] = useState<PlanTool>("select");
  const [selection, setSelection] = useState<PlanSelection>([]);
  const [snap, setSnap] = useState(true);
  const [placeOpening, setPlaceOpening] = useState("door-hinged");
  const [placeFixture, setPlaceFixture] = useState("counter");
  const [fillMode, setFillMode] = useState(false);
  const [lotMode, setLotMode] = useState(false);
  const [tape, setTape] = useState(false);
  const [menu, setMenu] = useState<ContextAt | null>(null);
  const [help, setHelp] = useState(false);
  const [editingBasics, setEditingBasics] = useState(false);
  const [choosing, setChoosing] = useState(() => !planHasContent(plans));
  const [notes, setNotes] = useState<string[]>([]);
  const [flash, setFlash] = useState<string>();
  const [drafting, setDrafting] = useState(false);
  const [focus, setFocus] = useState<{ at: Point; key: number } | null>(null);
  const [error, setError] = useState<string>();
  const [compare, setCompare] = useState<Compare | null>(null);
  const [comparing, setComparing] = useState(false);
  const [display, setDisplay] = useState<Display>("plan");
  const [cutAway, setCutAway] = useState(false);
  // 3D view settings, just for looking (not saved).
  const [editing3d, setEditing3d] = useState(false);
  const [showRoof, setShowRoof] = useState(true);
  const [walls3d, setWalls3d] = useState<WallsShown>("all");
  // The Preview window popup: which window, and the 2D plan mid-drag so it follows along.
  const [previewing, setPreviewing] = useState<{ levelId: string; openingId: string } | null>(null);
  const [dragged, setDragged] = useState<FloorPlan | null>(null);

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
  const sup = useMemo(() => supportOf(plans, levels, level), [plans, levels, level]);
  const support = useMemo(() => (sup ? { name: sup.below.name, regions: sup.regions } : null), [sup]);
  const aboveLevel = levelAbove(levels, level);
  const above = useMemo(() => (aboveLevel && aboveLevel.kind !== "main" && aboveLevel.kind !== "basement" && plans[aboveLevel.id]?.rooms.length ? { name: aboveLevel.name, plan: plans[aboveLevel.id] } : null), [aboveLevel, plans]);
  const canFill = sup ? fillShapes(plan, sup.regions).length > 0 : false;
  const overhangs = useMemo(() => (sup ? overhangsOf(plan.rooms, sup.regions) : []), [sup, plan.rooms]);
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

  // The preview switches to another window when one is selected, and closes if its window is deleted.
  const picked = sel.length === 1 && sel[0].kind === "opening" ? plan.openings.find((o) => o.id === sel[0].id) : undefined;
  const pickedId = picked && canPreview(plan, picked, basics) ? picked.id : null;
  const previewGone = previewing !== null && !plans[previewing.levelId]?.openings.some((o) => o.id === previewing.openingId);
  useEffect(() => {
    if (previewGone) {
      setPreviewing(null);
      setDragged(null);
    }
    else if (pickedId && previewing && pickedId !== previewing.openingId) setPreviewing({ levelId: level.id, openingId: pickedId });
  }, [pickedId, previewGone]); // eslint-disable-line react-hooks/exhaustive-deps
  const previewPlans = useMemo(() => (dragged && display === "plan" ? { ...plans, [level.id]: dragged } : plans), [dragged, display, plans, level.id]);

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
  const setRoof = (patch: Partial<Roof>) => update((p) => ({ ...p, house3d: { ...p.house3d, roof: { ...p.house3d.roof, ...patch } } }));

  // Where the house sits on the lot in 3D. Kept as the same object while its value doesn't change.
  const offsetKey = JSON.stringify(lotOffsetFor(project));
  const offset = useMemo<Point>(() => JSON.parse(offsetKey), [offsetKey]);

  const chooseDisplay = (d: Display) => {
    if (d !== display) {
      // 3D always opens out of edit mode, with nothing selected.
      setEditing3d(false);
      if (d === "3d") setSelection([]);
    }
    setDisplay(d);
    setTool("select");
    setLotMode(false);
  };

  const chooseTool = (t: PlanTool) => {
    setTool(t);
    setLotMode(false);
    setTape(false);
    if (t !== "select") setSelection([]);
  };

  // Keyboard: tool letters, Delete to remove, arrows to nudge, Escape to let go.
  useEffect(() => {
    if (choosing || editingBasics || comparing || !basics) return;
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      // In 3D, nothing can be deleted or moved outside edit mode.
      const locked = display === "3d" && !editing3d;
      // Cmd+D (Ctrl+D) copies what's picked.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        const ids = copyableIds(plan, sel.filter((s) => s.kind !== "edge" && s.kind !== "opening").map((s) => s.id));
        if (!locked && ids.length) duplicateAndSelect(plan, ids, setLevelPlan, setSelection);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "?" && display === "plan") {
        e.preventDefault();
        setHelp((h) => !h);
        return;
      }
      const removable = locked ? [] : sel.filter((s) => s.kind !== "edge");
      if ((e.key === "Delete" || e.key === "Backspace") && removable.length) {
        e.preventDefault();
        setLevelPlan(removeMany(plan, removable.map((s) => s.id)));
        setSelection([]);
        return;
      }
      // One wall of a room picked: Delete takes the wall out (outside walls stay).
      if ((e.key === "Delete" || e.key === "Backspace") && !locked && sel.length === 1 && sel[0].kind === "edge") {
        const { roomId, edge } = parseEdgeId(sel[0].id);
        const out = removeWall(plan, roomId, edge);
        if (out) {
          e.preventDefault();
          setLevelPlan(out.plan);
          return;
        }
      }
      const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      const movable = locked ? [] : sel.filter((s) => s.kind === "room" || s.kind === "wall" || s.kind === "stairs" || s.kind === "fixture");
      if (nudge && movable.length) {
        e.preventDefault();
        const step = e.shiftKey ? 12 : 1;
        setLevelPlan(moveMany(plan, movable.map((s) => s.id), nudge[0] * step, nudge[1] * step), "nudge");
        return;
      }
      if (display === "plan" && !locked) {
        if (e.key === "l" || e.key === "L") {
          e.preventDefault();
          setView({ labels: { ...labels, hideAll: !labels.hideAll } });
          return;
        }
        if (e.key === "m" || e.key === "M") {
          e.preventDefault();
          setTape((on) => !on);
          return;
        }
      }
      if (e.key === "Escape") {
        if (drafting) return;
        if (tape) {
          setTape(false);
          return;
        }
        if (lotOn) setLotMode(false);
        else {
          setTool("select");
          setSelection([]);
        }
        return;
      }
      // The drawing tools belong to the 2D plan.
      const hit = display === "plan" && PLAN_TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
      if (hit) chooseTool(hit.id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choosing, editingBasics, comparing, basics, sel, plan, drafting, lotOn, setLevelPlan, display, editing3d, labels, tape, help]);

  /** The sketch as a plan, plus hallways, closets, windows and doors from the built-in rules. */
  function suggest() {
    const res = suggestPlans(sketches, { brief, plot, levels, basics });
    update((p) => ({ ...p, floorPlans: { ...blankPlans(levels), ...res.plans }, plan: { ...p.plan, showSketch: false } }));
    setNotes(res.notes);
    setSelection([]);
    setChoosing(false);
  }

  function fromSketch() {
    const res = plansFromSketch(sketches, { brief, plot, levels, basics });
    update((p) => ({ ...p, floorPlans: { ...blankPlans(levels), ...res.plans }, plan: { ...p.plan, showSketch: false } }));
    setNotes([
      ...(res.needHall.length
        ? [
            `${res.needHall.length === 1 ? "These rooms are" : "These pairs of rooms are"} connected in your sketch but don't share a wall yet: ${res.needHall
              .map((h) => `${h.a} and ${h.b}`)
              .join("; ")}. Push rooms together, or draw a hallway between them with the Room tool.`,
          ]
        : []),
      ...res.notes,
    ]);
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

  /** Three variations on the plan as it is now. The last ones come back if the plan hasn't changed since. */
  function showAlternatives(again = false) {
    if (compare && compare.basis === plans && !again) {
      setComparing(true);
      return;
    }
    setError(undefined);
    const res = suggestPlanAlternatives(plans, { brief, plot, levels, basics }, again ? compare?.alternatives.map((a) => a.title) : undefined);
    if (res.alternatives.length === 0) {
      setError(res.note ?? "There were no alternatives to show. Try adding a few more rooms first.");
      return;
    }
    setCompare({ ...res, basis: plans });
    setComparing(true);
    window.scrollTo({ top: 0 });
  }

  function takeAlternative(i: number, levelOnly: boolean) {
    if (!compare) return;
    const alt = compare.alternatives[i];
    setPlans((ps) => (levelOnly ? { ...ps, [level.id]: alt.plans[level.id] } : { ...ps, ...alt.plans }));
    setComparing(false);
    setSelection([]);
    setNotes([]);
    setFlash(`Using “${alt.title}”${levelOnly ? ` for the ${level.name.toLowerCase()}` : ""}. Undo brings back your own plan.`);
  }

  function saveBasics(b: PlanBasics) {
    update((p) => ({ ...p, plan: { ...p.plan, basics: b } }));
    setEditingBasics(false);
  }

  const warnings = useMemo(() => (basics && !choosing ? planWarnings(plans, { levels, brief, basics, land: { plot, offset } }) : []), [plans, levels, brief, basics, choosing, plot, offset]);

  /** A warning was clicked: go to its floor, select its rooms and center them. */
  function pickWarning(w: PlanWarning) {
    setLevelId(w.levelId);
    setSelection(w.roomIds.map((id) => ({ kind: "room" as const, id })));
    // Picking a warning in 3D selects its rooms, which needs edit mode.
    if (display === "3d" && w.roomIds.length) setEditing3d(true);
    setTool("select");
    setLotMode(false);
    if (w.at) setFocus({ at: w.at, key: Date.now() });
  }

  /** Close gap on a warning: push the two rooms together. */
  function fixWarning(w: PlanWarning) {
    const p = planOf(plans, w.levelId);
    if (w.pullBack) {
      const lv = levels.find((l) => l.id === w.levelId);
      const sup = lv && supportOf(plans, levels, lv);
      if (!sup) return;
      setPlans((ps) => ({ ...ps, [w.levelId]: pullBack(p, w.pullBack!.roomId, sup.regions) }));
      setFlash("Pulled the room back over the floor below. Undo puts it back.");
      return;
    }
    if (!w.gap) return;
    setPlans((ps) => ({ ...ps, [w.levelId]: closeGap(p, w.gap!) }));
    setFlash("Closed the gap. Undo puts it back.");
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
      <PlanStartChoices
        filled={filled}
        sketchHasRooms={sketchHasRooms}
        onKeep={() => setChoosing(false)}
        onBlank={startBlank}
        onFromSketch={fromSketch}
        onSuggest={suggest}
        onGoToSketch={onGoToSketch}
        onEditBasics={() => setEditingBasics(true)}
      />
    );
  }

  // ---- Comparing alternatives ----
  if (comparing && compare) {
    return (
      <div className="pb-10">
        <PlanAlternativesView
          mine={plans}
          alternatives={compare.alternatives}
          note={compare.note}
          levels={levels}
          level={level}
          basics={basics}
          labels={labels}
          onLevel={setLevelId}
          onUse={takeAlternative}
          onAgain={() => showAlternatives(true)}
          onClose={() => setComparing(false)}
        />
        <Note text={error} />
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
          <button className="btn" onClick={startOver} title="Choose Suggest a plan, Turn my sketch into a plan or Start blank again">
            Start over
          </button>
          <button className="btn" onClick={() => showAlternatives()} disabled={!filled}>
            Show me alternatives
          </button>
          <button className="btn-primary" onClick={onContinue}>
            Next: interior →
          </button>
        </div>
      </div>

      <Note text={error} />
      {notes.map((n) => (
        <Note key={n} text={n} />
      ))}
      {flash && <p className="rounded-md bg-accent-soft px-3 py-2 text-sm text-accent">{flash}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <LevelTabs
          levels={levels}
          current={level.id}
          counts={counts}
          onSelect={(id) => {
            setLevelId(id);
            setSelection([]);
          }}
        />
        <DisplayTabs display={display} onDisplay={chooseDisplay} />
      </div>

      {display !== "plan" ? (
        <div className="grid grid-cols-[1fr_260px] items-start gap-3">
          <div className="min-w-0">
            <House3DView
              plans={plans}
              levels={levels}
              basics={basics}
              house3d={project.house3d}
              interior={project.interior.selections}
              exterior={project.exterior}
              plot={plot}
              offset={offset}
              levelId={level.id}
              cutAway={cutAway}
              roof={showRoof}
              walls={walls3d}
              editing={editing3d}
              onEditing={(on) => {
                setEditing3d(on);
                if (!on) setSelection([]);
              }}
              selection={sel}
              snap={snap}
              height={CANVAS_HEIGHT}
              onSelect={(id, s) => {
                if (id !== level.id) setLevelId(id);
                setSelection(s);
              }}
              onChange={(id, pl, coalesce) => setPlans((ps) => ({ ...ps, [id]: pl }), coalesce)}
            />
            <p className="mt-2 text-xs text-muted">
              {editing3d
                ? "Changes here change the 2D plan too, and Undo works the same. Delete removes what's selected and the arrow keys nudge it."
                : "Press Edit to select and move things in 3D. Changes there change the 2D plan too."}
            </p>
          </div>
          <div className="space-y-3">
            <House3DPanel
              editing={editing3d}
              roof={project.house3d.roof}
              levelName={level.name}
              canCutAway={levels.some((l) => l.elevationIn > level.elevationIn && (plans[l.id]?.rooms.length ?? 0) > 0)}
              cutAway={cutAway}
              showRoof={showRoof}
              walls={walls3d}
              onCutAway={setCutAway}
              onShowRoof={setShowRoof}
              onWalls={setWalls3d}
              onRoof={setRoof}
            />
            {sel.length > 0 && (
              <PlanSidePanel
                plan={plan}
                overhangs={overhangs}
                level={level}
                levels={levels}
                brief={brief}
                basics={basics}
                selection={sel}
                tool="select"
                placeOpening={placeOpening}
                placeFixture={placeFixture}
                onPlaceOpening={setPlaceOpening}
                onPlaceFixture={setPlaceFixture}
                onChange={setLevelPlan}
                onSelect={setSelection}
                onPreviewWindow={(id) => setPreviewing({ levelId: level.id, openingId: id })}
              />
            )}
            <PlanChecks warnings={warnings} levels={levels} levelId={level.id} onPick={pickWarning} onFix={fixWarning} />
          </div>
        </div>
      ) : (
        <>
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
              <LabelSettings labels={labels} onChange={(l) => setView({ labels: l })} />
              <button className={`flex items-center gap-1.5 rounded border px-2 py-0.5 ${tape ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white" : "border-line bg-white hover:bg-stone-50"}`} onClick={() => setTape(!tape)} title="Click two points to measure the distance (key M). Escape clears it.">
                <span aria-hidden>📏</span>
                Measure{tape ? " (click two points)" : ""}
              </button>
              <label className={`flex items-center gap-2 ${sketch.bubbles.length ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`}>
                <input type="checkbox" className={box} checked={showSketch} disabled={!sketch.bubbles.length} onChange={(e) => setView({ showSketch: e.target.checked })} />
                Flow sketch
              </label>
            </>
          }
        />

        <div className="grid grid-cols-[44px_1fr_260px] items-start gap-3">
          <PlanToolbar tool={tool} onTool={chooseTool} />

          <div className="relative min-w-0">
            <PlanCanvas
              plan={plan}
              level={level}
              levels={levels}
              basics={basics}
              below={below}
              support={support}
              above={above}
              sketch={showSketch && sketch.bubbles.length ? sketch : null}
              tool={tool}
              fillMode={fillMode}
              placeOpening={placeOpening}
              placeFixture={placeFixture}
              selection={sel}
              snap={snap}
              labels={labels}
              tape={tape}
              sides={sides}
              height={CANVAS_HEIGHT}
              land={land}
              lotMode={lotOn}
              focus={focus}
              onLotMove={(offset) => update((p) => ({ ...p, sketch: { ...p.sketch, lotOffset: offset } }))}
              onSelect={setSelection}
              onChange={setLevelPlan}
              onToolDone={() => setTool("select")}
              onDrafting={setDrafting}
              onMessage={setFlash}
              onPreview={previewing ? setDragged : undefined}
              onContext={setMenu}
            />
            {canFill && sup && (
              <button
                className="btn absolute top-2 right-3 px-2 py-1 text-xs"
                title={`Make a room over everything the ${sup.below.name.toLowerCase()} covers. Cut it up with the Split tool.`}
                onClick={() => {
                  setLevelPlan(fillBelow(plan, sup.regions));
                  setFlash(`Filled the space over the ${sup.below.name.toLowerCase()}. Use Split to cut it into rooms. Undo puts it back.`);
                }}
              >
                Fill the floor below
              </button>
            )}
            {menu && <PlanContextMenu at={menu} items={contextItems(plan, menu, sel, { change: setLevelPlan, select: setSelection, message: setFlash })} onClose={() => setMenu(null)} />}
            {lotOn && <LotModeBanner onDone={() => setLotMode(false)} />}
            <p className="mt-2 text-xs text-muted">{hint} Pinch or hold Control and scroll to zoom; scroll to move around. Arrow keys nudge what&apos;s selected.</p>
          </div>

          <div className="space-y-3">
            <PlanSidePanel
              plan={plan}
              overhangs={overhangs}
              level={level}
              levels={levels}
              brief={brief}
              basics={basics}
              selection={sel}
              tool={tool}
              fillMode={fillMode}
              onFillMode={setFillMode}
              placeOpening={placeOpening}
              placeFixture={placeFixture}
              onPlaceOpening={setPlaceOpening}
              onPlaceFixture={setPlaceFixture}
              onChange={setLevelPlan}
              onSelect={setSelection}
              onPreviewWindow={(id) => setPreviewing({ levelId: level.id, openingId: id })}
            />
            {help && <KeyboardHelp onClose={() => setHelp(false)} />}
            <PlanChecks warnings={warnings} levels={levels} levelId={level.id} onPick={pickWarning} onFix={fixWarning} />
            {!help && (
              <button className="text-xs text-muted hover:underline" onClick={() => setHelp(true)}>
                Keyboard shortcuts (press ?)
              </button>
            )}
          </div>
        </div>
        </>
      )}

      {previewing && (
        <WindowPreview
          plans={previewPlans}
          levels={levels}
          basics={basics}
          house3d={project.house3d}
          interior={project.interior.selections}
          exterior={project.exterior}
          plot={plot}
          offset={offset}
          levelId={previewing.levelId}
          openingId={previewing.openingId}
          onClose={() => {
            setPreviewing(null);
            setDragged(null);
          }}
        />
      )}
    </div>
  );
}
