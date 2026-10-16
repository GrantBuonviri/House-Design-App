"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FloorPlan, Level, Point, WallHeight } from "@/lib/model/schema";
import { useProjectStore } from "@/lib/store/projectStore";
import { MAIN_LEVEL_ID } from "@/lib/brief/levels";
import { ceilingFor } from "@/lib/plan/basics";
import { planOf, planHasContent } from "@/lib/plan/edit";
import { dismissWarning, planWarnings, restoreWarning, splitDismissed, type PlanWarning } from "@/lib/plan/checks";
import { cabinetsEdited, resetCabinets } from "@/lib/plan/cabinets";
import { devicesEdited, resetDevices } from "@/lib/plan/devices";
import { layerItems, moveInside } from "@/lib/furnish/layer";
import { OPENING_TYPES } from "@/lib/plan/catalog";
import { catalogEntry, type CatalogEntry } from "@/lib/furnish/catalog";
import { furnishLayouts, deleteItem, patchItem, stageItems } from "@/lib/furnish/stage";
import { Note } from "@/components/brief/bits";
import LevelTabs from "@/components/bubbles/LevelTabs";
import PlanSidePanel from "@/components/plan/PlanSidePanel";
import PlanChecks from "@/components/plan/PlanChecks";
import type { PlanSelection } from "@/components/plan/types";
import FurnishCatalog from "./FurnishCatalog";
import FurnishItemPanel from "./FurnishItemPanel";

const PlanCanvas = dynamic(() => import("@/components/plan/PlanCanvas"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-lg bg-stone-100" />,
});

const CANVAS_HEIGHT = 640;

type FurnishTool = "select" | "place" | "wall" | "door" | "pan";

const TOOLS: { id: FurnishTool | "window" | "measure"; label: string; key: string; hint: string }[] = [
  { id: "select", label: "Select", key: "V", hint: "Click something to change it, or drag it to move it. Doors and windows slide along their walls. Walls and rooms are locked here: change those on the floor plan." },
  { id: "place", label: "Place", key: "P", hint: "Pick something in the list, then click to put it down. It backs up against a wall when it's near one, and goes red when it can't go there. R turns it, Esc stops." },
  { id: "wall", label: "Wall", key: "W", hint: "Click to start a wall, click again at each turn, and double-click or press Enter to finish. Walls you add here show up on the floor plan too. You can't remove a wall from here." },
  { id: "door", label: "Door", key: "D", hint: "Pick a door in the list, then click a wall to put it there." },
  { id: "window", label: "Window", key: "N", hint: "Pick a window in the list, then click a wall to put it there." },
  { id: "measure", label: "Measure", key: "M", hint: "Click two points to measure the distance. Escape clears it." },
];

/**
 * The Furnish stage: fixtures, cabinets, outlets and hookups, built-ins and
 * furniture on their own layer apart from the floor plan's rooms and walls.
 * It reuses the floor plan canvas with the rooms locked. Doors and windows
 * can be added and moved here but not deleted, and walls can be added but
 * not removed; those still live on the floor plan.
 */
export default function FurnishStage({ onContinue, onGoToPlan, initialLevelId }: { onContinue: () => void; onGoToPlan: () => void; initialLevelId?: string }) {
  const project = useProjectStore((s) => s.project)!;
  const update = useProjectStore((s) => s.update);
  const plans = project.floorPlans;
  const { basics, labels } = project.plan;
  const levels = useMemo(() => [...project.levels].sort((a, b) => a.elevationIn - b.elevationIn), [project.levels]);

  const [levelId, setLevelId] = useState(initialLevelId ?? MAIN_LEVEL_ID);
  const [tool, setTool] = useState<FurnishTool>("select");
  const [pick, setPick] = useState<string | null>(null);
  const [placeOpening, setPlaceOpening] = useState("door-hinged");
  const [wallHeight, setWallHeight] = useState<WallHeight>("full");
  const [selection, setSelection] = useState<PlanSelection>([]);
  const [tape, setTape] = useState(false);
  const [turn, setTurn] = useState(0);
  const [snap, setSnap] = useState(true);
  const [flash, setFlash] = useState<string>();
  const [drafting, setDrafting] = useState(false);
  const [focus, setFocus] = useState<{ at: Point; key: number } | null>(null);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(undefined), 6000);
    return () => clearTimeout(t);
  }, [flash]);

  const level: Level = levels.find((l) => l.id === levelId) ?? levels.find((l) => l.id === MAIN_LEVEL_ID) ?? levels[0];
  const plan = planOf(plans, level.id);
  const ceilingIn = ceilingFor(basics, level);
  const layouts = useMemo(() => furnishLayouts(project, level), [project, level]);
  const items = useMemo(() => stageItems(plan, layouts), [plan, layouts]);
  const counts = Object.fromEntries(levels.map((l) => [l.id, plans[l.id]?.rooms.length ?? 0]));

  // What's picked and still there (Undo can take things away).
  const live = new Set([...items.map((i) => i.id), ...plan.openings.map((o) => o.id)]);
  const sel = selection.filter((s) => live.has(s.id));
  const single = sel.length === 1 ? sel[0] : null;
  const item = single?.kind === "furnish" ? items.find((i) => i.id === single.id) : undefined;

  const setLevelPlan = useCallback(
    (pl: FloorPlan, coalesce?: string) => update((p) => ({ ...p, floorPlans: { ...p.floorPlans, [level.id]: pl } }), coalesce ? { coalesce: `furnish.${coalesce}` } : undefined),
    [update, level.id],
  );
  const setPlansFor = (id: string, pl: FloorPlan) => update((p) => ({ ...p, floorPlans: { ...p.floorPlans, [id]: pl } }));
  const apply = (out: { plan: FloorPlan; id: string | null }, coalesce?: string) => {
    setLevelPlan(out.plan, coalesce);
    setSelection(out.id ? [{ kind: "furnish", id: out.id }] : []);
  };

  const chooseTool = (t: FurnishTool) => {
    setTool(t);
    setTape(false);
    if (t !== "select") setSelection([]);
  };

  function pickEntry(e: CatalogEntry) {
    setTape(false);
    if (e.kind === "opening") {
      setPlaceOpening(e.type);
      setTool("door");
    } else if (e.kind === "wall") {
      setWallHeight(e.type as WallHeight);
      setTool("wall");
    } else {
      setPick(e.id);
      setTool("place");
    }
    setSelection([]);
    setTurn(0);
  }

  const entryPicked = (e: CatalogEntry) =>
    e.kind === "opening" ? tool === "door" && placeOpening === e.type : e.kind === "wall" ? tool === "wall" && wallHeight === e.type : tool === "place" && pick === e.id;

  // Keyboard: tool letters, R to turn, Delete, arrows to nudge, Escape to let go.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (e.key === "Escape") {
        if (drafting) return;
        if (tape) setTape(false);
        else {
          setTool("select");
          setSelection([]);
        }
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && single) {
        e.preventDefault();
        if (item) {
          setLevelPlan(deleteItem(plan, item));
          setSelection([]);
        } else if (single.kind === "opening") setFlash("Doors and windows can't be deleted from Furnish. Delete them on the floor plan.");
        return;
      }
      const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (nudge && item) {
        e.preventDefault();
        const step = e.shiftKey ? 12 : 1;
        apply(patchItem(plan, item, { x: item.x + nudge[0] * step, y: item.y + nudge[1] * step }), "nudge");
        return;
      }
      if (k === "r") {
        e.preventDefault();
        if (tool === "place") setTurn((d) => (d + 90) % 360);
        else if (item) apply(patchItem(plan, item, { rotation: item.rotation + 90 }));
        return;
      }
      if (k === "m") {
        e.preventDefault();
        setTape((on) => !on);
        return;
      }
      if (k === "n") {
        e.preventDefault();
        setPlaceOpening("window");
        chooseTool("door");
        return;
      }
      const hit = TOOLS.find((x) => x.key.toLowerCase() === k && x.id !== "measure" && x.id !== "window");
      if (hit) chooseTool(hit.id as FurnishTool);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [single, item, plan, tool, tape, drafting]);

  // Things to check: the ones about furnishings (the floor plan lists the rest). Picking one jumps to its floor.
  const warnings = useMemo(() => (basics ? planWarnings(plans, { levels, brief: project.brief, basics }).filter((w) => w.furnish) : []), [plans, levels, project.brief, basics]);
  const split = useMemo(() => splitDismissed(warnings, project.plan.dismissed), [warnings, project.plan.dismissed]);
  const checkProps = {
    warnings: split.active,
    dismissed: split.dismissed,
    onDismiss: (w: PlanWarning) => {
      update((p) => ({ ...p, plan: { ...p.plan, dismissed: dismissWarning(p.plan.dismissed, w.id, warnings) } }));
      setFlash("Dismissed. Undo or Show dismissed brings it back.");
    },
    onRestore: (w: PlanWarning) => update((p) => ({ ...p, plan: { ...p.plan, dismissed: restoreWarning(p.plan.dismissed, w.id) } })),
    onRestoreAll: () => update((p) => ({ ...p, plan: { ...p.plan, dismissed: [] } })),
  };
  function pickWarning(w: PlanWarning) {
    setLevelId(w.levelId);
    setTool("select");
    setSelection(w.furnish ? [{ kind: "furnish", id: w.furnish.id }] : []);
    if (w.at) setFocus({ at: w.at, key: Date.now() });
  }
  function fixWarning(w: PlanWarning, action?: "inside" | "delete") {
    const p = planOf(plans, w.levelId);
    const it = w.furnish && layerItems(p).find((x) => x.id === w.furnish!.id);
    if (!it) return;
    setPlansFor(w.levelId, action === "delete" ? deleteItem(p, it) : moveInside(p, it));
    setFlash(`${action === "delete" ? "Deleted" : "Moved"} the ${it.label.toLowerCase()}. Undo puts it back.`);
  }

  if (!planHasContent(plans)) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 py-8" data-testid="furnish-stage">
        <h2 className="text-xl font-semibold">Furnish</h2>
        <p className="text-sm text-muted">There are no rooms yet. Draw the floor plan first, then come back here to place fixtures, cabinets, outlets, built-ins and furniture.</p>
        <button className="btn-primary" onClick={onGoToPlan}>
          Go to the floor plan
        </button>
      </div>
    );
  }

  const toolActive = (id: (typeof TOOLS)[number]["id"]) =>
    id === "measure" ? tape : id === "window" ? !tape && tool === "door" && OPENING_TYPES.find((o) => o.id === placeOpening)?.kind === "window" : id === "door" ? !tape && tool === "door" && OPENING_TYPES.find((o) => o.id === placeOpening)?.kind !== "window" : !tape && tool === id;
  const onTool = (id: (typeof TOOLS)[number]["id"]) => {
    if (id === "measure") setTape((on) => !on);
    else if (id === "window") {
      setPlaceOpening("window");
      chooseTool("door");
    } else {
      if (id === "door" && OPENING_TYPES.find((o) => o.id === placeOpening)?.kind === "window") setPlaceOpening("door-hinged");
      chooseTool(id);
    }
  };
  const hint = tape ? TOOLS.find((t) => t.id === "measure")!.hint : TOOLS.find((t) => toolActive(t.id))?.hint;
  const pickedEntry = pick ? catalogEntry(pick) : undefined;
  const roomName = item?.roomId ? plan.rooms.find((r) => r.id === item.roomId)?.name : undefined;

  return (
    <div className="space-y-4 pb-10" data-testid="furnish-stage">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight">Furnish</h2>
          <p className="mt-1 text-sm text-muted">Fixtures, appliances, cabinets, outlets, hookups, built-ins and furniture, on their own layer apart from the floor plan. Walls, doors and windows are still shaped on the floor plan.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button className="btn" onClick={onGoToPlan}>
            Back to the floor plan
          </button>
          <button className="btn-primary" onClick={onContinue} data-testid="furnish-continue">
            Next: interior →
          </button>
        </div>
      </div>

      {flash && <Note text={flash} />}

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
        <div className="flex items-center gap-1" role="toolbar" aria-label="Furnish tools">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              className={`rounded-md border px-3 py-1 text-sm ${toolActive(t.id) ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white" : "border-line bg-white hover:bg-stone-50"}`}
              aria-pressed={toolActive(t.id)}
              title={`${t.label} (${t.key})`}
              onClick={() => onTool(t.id)}
              data-testid={`furnish-tool-${t.id}`}
            >
              {t.label}
            </button>
          ))}
          <label className="ml-3 flex cursor-pointer items-center gap-1.5 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
            Snap
          </label>
        </div>
      </div>

      <div className="grid grid-cols-[230px_1fr_270px] items-start gap-3">
        <FurnishCatalog isPicked={entryPicked} onPick={pickEntry} />

        <div className="relative min-w-0">
          <PlanCanvas
            plan={plan}
            level={level}
            levels={levels}
            basics={basics}
            below={null}
            support={null}
            above={null}
            sketch={null}
            tool={tool}
            placeOpening={placeOpening}
            selection={sel}
            snap={snap}
            labels={labels}
            tape={tape}
            sides={{ N: [], E: [], S: [], W: [] }}
            height={CANVAS_HEIGHT}
            land={null}
            lotMode={false}
            mode="furnish"
            furnish={{ layouts, pick, turn, wallHeight, ceilingIn }}
            focus={focus}
            onLotMove={() => {}}
            onSelect={setSelection}
            onChange={setLevelPlan}
            onToolDone={() => setTool("select")}
            onDrafting={setDrafting}
            onMessage={setFlash}
          />
          <p className="mt-2 text-xs text-muted">
            {hint}
            {tool === "place" && pickedEntry ? ` Placing: ${pickedEntry.label}.` : ""} Pinch or hold Control and scroll to zoom; scroll to move around. Arrow keys nudge what&apos;s selected.
          </p>
        </div>

        <div className="space-y-3">
          {item ? (
            <FurnishItemPanel plan={plan} item={item} ceilingIn={ceilingIn} roomName={roomName} onApply={apply} onDelete={(pl) => { setLevelPlan(pl); setSelection([]); }} onMessage={setFlash} />
          ) : single?.kind === "opening" ? (
            <PlanSidePanel
              plan={plan}
              overhangs={[]}
              level={level}
              levels={levels}
              brief={project.brief}
              basics={basics}
              selection={sel}
              tool="select"
              placeOpening={placeOpening}
              onPlaceOpening={setPlaceOpening}
              onChange={setLevelPlan}
              onSelect={setSelection}
              noDelete
            />
          ) : (
            <div className="card p-4 text-sm text-muted" data-testid="furnish-empty-panel">
              <h3 className="mb-2 text-sm font-semibold text-ink">Nothing picked</h3>
              <p>Pick something in the list to place it, or click a toilet, cabinet, outlet or other item on the plan to change its size, turn it, move it away from a wall, swap it or delete it.</p>
              <p className="mt-2">{items.length} {items.length === 1 ? "item" : "items"} on {level.name.toLowerCase()}, counting the cabinets and outlets the app placed.</p>
              {(cabinetsEdited(plan) || devicesEdited(plan)) && (
                <div className="mt-3 space-y-1">
                  {cabinetsEdited(plan) && (
                    <button className="btn w-full text-xs" onClick={() => setLevelPlan(resetCabinets(plan))}>
                      Put the cabinets back to automatic
                    </button>
                  )}
                  {devicesEdited(plan) && (
                    <button className="btn w-full text-xs" onClick={() => setLevelPlan(resetDevices(plan))}>
                      Put outlets, lights and hookups back to automatic
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          <PlanChecks {...checkProps} levels={levels} levelId={level.id} onPick={pickWarning} onFix={fixWarning} />
        </div>
      </div>
    </div>
  );
}
