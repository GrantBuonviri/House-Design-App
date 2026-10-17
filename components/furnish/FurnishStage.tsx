"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FloorPlan, Level, Point, Product, WallHeight } from "@/lib/model/schema";
import { useProjectStore } from "@/lib/store/projectStore";
import { MAIN_LEVEL_ID } from "@/lib/brief/levels";
import { ceilingFor, exteriorWallIn } from "@/lib/plan/basics";
import { planOf, planHasContent } from "@/lib/plan/edit";
import { dismissWarning, planWarnings, restoreWarning, splitDismissed, type PlanWarning } from "@/lib/plan/checks";
import { cabinetsEdited, resetCabinets } from "@/lib/plan/cabinets";
import { devicesEdited, resetDevices } from "@/lib/plan/devices";
import { layerItems, moveInside, placeCheck } from "@/lib/furnish/layer";
import { OPENING_TYPES } from "@/lib/plan/catalog";
import { catalogEntry, type CatalogEntry } from "@/lib/furnish/catalog";
import { furnishLayouts, deleteItem, patchItem, stageItems } from "@/lib/furnish/stage";
import { CLOSET_SIZES, clampClosetSize, isClosetRod, type ClosetSize, type ClosetType } from "@/lib/furnish/closets";
import { canAutoFurnish, furnishLevel, furnishRoom, furnishSummary } from "@/lib/furnish/autoFurnish";
import { formatFeetInches } from "@/lib/model/units";
import { Note } from "@/components/brief/bits";
import LevelTabs from "@/components/bubbles/LevelTabs";
import PlanSidePanel from "@/components/plan/PlanSidePanel";
import PlanChecks, { type FixAction } from "@/components/plan/PlanChecks";
import type { PlanSelection } from "@/components/plan/types";
import FurnishCatalog from "./FurnishCatalog";
import FurnishItemPanel from "./FurnishItemPanel";
import RailingPanel from "./RailingPanel";
import FaucetPanel from "./FaucetPanel";
import { faucetsOn } from "@/lib/furnish/faucets";
import { applyFaucetChange, isRange, pickFaucetProduct, pickPotFiller, potFillerAbove, potFillerPick, usedFor } from "@/lib/furnish/faucetPick";
import { fixtureType } from "@/lib/plan/catalog";
import { changeRailingIn, railingTarget, stageRailings, type RailingChange } from "@/lib/furnish/railings";

const PlanCanvas = dynamic(() => import("@/components/plan/PlanCanvas"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-lg bg-stone-100" />,
});

const CANVAS_HEIGHT = 640;

const CLOSET_DELETED = "Took out the closet's rod and shelf. Its walls and door stay: Things to check can remove them on the floor plan.";

type FurnishTool = "select" | "place" | "wall" | "door" | "pan";

const TOOLS: { id: FurnishTool | "window" | "measure"; label: string; key: string; hint: string }[] = [
  { id: "select", label: "Select", key: "V", hint: "Click something to change it, or drag it to move it. Doors and windows slide along their walls. Walls and rooms are locked here: change those on the floor plan." },
  { id: "place", label: "Place", key: "P", hint: "Pick something in the list, then click to put it down. It backs up against a wall when it's near one, and goes red when it can't go there. R turns it, Esc stops." },
  { id: "wall", label: "Wall", key: "W", hint: "Click to start a wall, click again at each turn, and double-click or press Enter to finish. Walls you add here show up on the floor plan too. You can't remove a wall from here." },
  { id: "door", label: "Door", key: "D", hint: "Pick a door in the list, then click a wall to put it there." },
  { id: "window", label: "Window", key: "N", hint: "Pick a window in the list, then click a wall to put it there." },
  { id: "measure", label: "Measure", key: "M", hint: "Click two points to measure the distance. P pins it so it stays. Escape clears it." },
];

/**
 * The Furnish stage: fixtures, cabinets, outlets and hookups, built-ins and
 * furniture on their own layer apart from the floor plan's rooms and walls.
 * It reuses the floor plan canvas with the rooms locked. Doors and windows
 * can be added and moved here but not deleted, and walls can be added but
 * not removed; those still live on the floor plan.
 */
export default function FurnishStage({
  onContinue,
  onGoToPlan,
  initialLevelId,
  walk,
}: {
  onContinue: () => void;
  onGoToPlan: () => void;
  initialLevelId?: string;
  /** Shown inside the walkthrough (key M): a "you are here" marker, and M or Esc goes back to walking. */
  walk?: { here: { levelId: string; p: Point; dir: Point }; onBack: () => void };
}) {
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
  const [closetSize, setClosetSize] = useState<ClosetSize>(CLOSET_SIZES["reach-in"]);
  const [autoRoom, setAutoRoom] = useState("all");
  const [autoNotes, setAutoNotes] = useState<string[]>([]);

  // From the walkthrough: center on where you were standing, once the canvas has its size.
  useEffect(() => {
    if (!walk) return;
    const t = setTimeout(() => setFocus({ at: walk.here.p, key: Date.now() }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(undefined), 6000);
    return () => clearTimeout(t);
  }, [flash]);

  const level: Level = levels.find((l) => l.id === levelId) ?? levels.find((l) => l.id === MAIN_LEVEL_ID) ?? levels[0];
  const plan = planOf(plans, level.id);
  const ceilingIn = ceilingFor(basics, level);
  const layouts = useMemo(() => furnishLayouts(project, level), [project, level]);
  const items = useMemo(() => stageItems(plan, layouts, ceilingIn), [plan, layouts, ceilingIn]);
  const stairRails = useMemo(() => stageRailings(plans, levels, basics, level.id), [plans, levels, basics, level.id]);
  const selections = project.interior.selections;
  const exteriorIn = exteriorWallIn(basics);
  const faucets = useMemo(() => faucetsOn(plan, level.id, selections, { exteriorIn, removed: true }), [plan, level.id, selections, exteriorIn]);
  const counts = Object.fromEntries(levels.map((l) => [l.id, plans[l.id]?.rooms.length ?? 0]));

  // What's picked and still there (Undo can take things away).
  const live = new Set([...items.map((i) => i.id), ...plan.openings.map((o) => o.id), ...stairRails.railings.map((r) => r.key), ...stairRails.bare.map((x) => x.key), ...faucets.map((f) => f.fixtureId)]);
  const sel = selection.filter((s) => live.has(s.id));
  const single = sel.length === 1 ? sel[0] : null;
  const item = single?.kind === "furnish" ? items.find((i) => i.id === single.id) : undefined;

  const railTarget = single?.kind === "railing" ? railingTarget(stairRails, single.id) : null;
  const faucetFx = single?.kind === "faucet" ? plan.fixtures.find((f) => f.id === single.id) : undefined;
  const faucet = faucetFx ? faucets.find((f) => f.fixtureId === faucetFx.id) : undefined;
  const changeFaucetHere = (change: Parameters<typeof applyFaucetChange>[2], id = faucetFx?.id) => {
    if (!id) return;
    setLevelPlan(applyFaucetChange(plan, id, change), typeof change === "object" ? "faucet" : undefined);
    if (change === "remove") setFlash("Took the faucet off. Undo puts it back, or use Put the faucet back.");
  };
  const pickFaucet = (product: Product | null) => {
    if (!faucetFx || !faucet) return;
    update((p) => ({ ...p, interior: { ...p.interior, selections: pickFaucetProduct(plan, faucetFx, faucet.kind, p.interior.selections, product) } }));
  };
  const changeRail = (change: RailingChange) => {
    if (!railTarget) return;
    const pl = changeRailingIn(plans, railTarget, change);
    if (pl) setPlansFor(railTarget.stairsLevelId, pl);
    // Pick the same side again: its key stays the same unless it was removed.
    if (change === "remove") setFlash("Removed the railing. Undo puts it back, or pick the dotted line to add one.");
  };

  /** The sink, tub or shower's Faucet line, and the range's pot filler button. */
  const faucetProps = (it: { entryId: string; id: string; x: number; y: number; rotation: number; depthIn: number; widthIn: number }) => {
    const f = it.entryId.startsWith("fixture:") ? faucets.find((x) => x.fixtureId === it.id) : undefined;
    return {
      ...(f ? { faucet: { removed: Boolean(f.removed) }, onFaucet: (a: "edit" | "restore") => (a === "edit" ? setSelection([{ kind: "faucet", id: it.id }]) : changeFaucetHere("restore", it.id)) } : {}),
      ...(it.entryId === "addon:pot-filler"
        ? (() => {
            const pk = potFillerPick(plan, it, project.interior.selections);
            return { productPick: { label: pk.label, usedFor: pk.usedFor, products: pk.products, picked: pk.picked, onPick: (prod: Product | null) => update((p) => ({ ...p, interior: { ...p.interior, selections: pickPotFiller(plan, it, p.interior.selections, prod) } })) } };
          })()
        : {}),
      ...(isRange(it.entryId)
        ? {
            onPotFiller: () => {
              const out = potFillerAbove(plan, it);
              if (!out) setFlash("There's no wall behind the range to put a pot filler on.");
              else if ("already" in out) setFlash("There's already a pot filler over this range.");
              else {
                setLevelPlan(out.plan);
                setSelection([{ kind: "furnish", id: out.id }]);
              }
            },
          }
        : {}),
    };
  };

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
      if (e.kind === "closet") setClosetSize(CLOSET_SIZES[e.type as ClosetType]);
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
      const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      // A held key repeats: only the arrows keep nudging.
      if (e.repeat && !nudge) return;
      const k = e.key.toLowerCase();
      if (e.key === "Escape") {
        if (drafting) return;
        if (walk && !tape && tool === "select" && !sel.length) walk.onBack();
        else if (tape) setTape(false);
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
          if (isClosetRod(item.id)) setFlash(CLOSET_DELETED);
        } else if (single.kind === "faucet") {
          changeFaucetHere("remove");
        } else if (single.kind === "railing") {
          const t = railingTarget(stairRails, single.id);
          if (t?.railing) {
            const pl = changeRailingIn(plans, t, "remove");
            if (pl) setPlansFor(t.stairsLevelId, pl);
            setFlash("Removed the railing. Undo puts it back.");
          }
        } else if (single.kind === "opening") setFlash("Doors and windows can't be deleted from Furnish. Delete them on the floor plan.");
        return;
      }
      if (nudge && item) {
        e.preventDefault();
        const step = e.shiftKey ? 12 : 1;
        apply(patchItem(plan, item, { x: item.x + nudge[0] * step, y: item.y + nudge[1] * step }), "nudge");
        return;
      }
      if (k === "r") {
        e.preventDefault();
        if (tool === "place") setTurn((d) => (d + 90) % 360);
        else if (item) {
          // Only if it fits turned, as in the walkthrough.
          const check = placeCheck(plan, { ...item, rotation: item.rotation + 90 }, items.filter((x) => x.id !== item.id));
          if (!check.ok) setFlash(`It can't turn there: ${check.problem?.toLowerCase() ?? "it doesn't fit."}`);
          else apply(patchItem(plan, item, { rotation: item.rotation + 90 }));
        }
        return;
      }
      if (k === "m") {
        e.preventDefault();
        if (walk) walk.onBack();
        else setTape((on) => !on);
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
  }, [single, item, items, plan, tool, tape, drafting, sel.length, walk]);

  // Things to check: the ones about furnishings (the floor plan lists the rest). Picking one jumps to its floor.
  const warnings = useMemo(() => (basics ? planWarnings(plans, { levels, brief: project.brief, basics }).filter((w) => w.furnish || w.closetWalls || w.noFaucet) : []), [plans, levels, project.brief, basics]);
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
    setSelection(w.furnish ? [{ kind: "furnish", id: w.furnish.id }] : w.noFaucet ? [{ kind: "faucet", id: w.noFaucet.fixtureId }] : []);
    if (w.at) setFocus({ at: w.at, key: Date.now() });
  }
  function fixWarning(w: PlanWarning, action?: FixAction) {
    if (action === "plan") return onGoToPlan();
    const p = planOf(plans, w.levelId);
    if (w.noFaucet) {
      setPlansFor(w.levelId, applyFaucetChange(p, w.noFaucet.fixtureId, "restore"));
      setFlash("Put the faucet back. Undo takes it off again.");
      return;
    }
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
  const closetType = tool === "place" && pickedEntry?.kind === "closet" ? (pickedEntry.type as ClosetType) : null;
  const autoRooms = plan.rooms.filter(canAutoFurnish);
  const autoPick = autoRooms.some((r) => r.id === autoRoom) ? autoRoom : "all";

  /** Furnish for me: the picked room, or every room on this floor, in one step. */
  function furnishForMe() {
    const res = autoPick === "all" ? furnishLevel(plan, ceilingIn) : furnishRoom(plan, autoPick, ceilingIn);
    if (res.placed) setLevelPlan(res.plan);
    setSelection([]);
    setAutoNotes(res.notes);
    setFlash(furnishSummary(res));
  }

  return (
    <div className="space-y-4 pb-10" data-testid="furnish-stage">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight">{walk ? "Top-down view" : "Furnish"}</h2>
          <p className="mt-1 text-sm text-muted">
            {walk
              ? "The Furnish tools from above, with you marked where you were standing. Changes show up when you go back to walking."
              : "Fixtures, appliances, cabinets, outlets, hookups, built-ins and furniture, on their own layer apart from the floor plan. Walls, doors and windows are still shaped on the floor plan."}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {walk ? (
            <button className="btn-primary" onClick={walk.onBack} data-testid="top-down-back">
              Back to walking (M)
            </button>
          ) : (
            <>
              <button className="btn" onClick={onGoToPlan}>
                Back to the floor plan
              </button>
              <button className="btn-primary" onClick={onContinue} data-testid="furnish-continue">
                Walk through and design →
              </button>
            </>
          )}
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
            furnish={{ faucets, railings: stairRails.railings, bareRailings: stairRails.bare, layouts, pick, turn, wallHeight, ceilingIn, closetSize, here: walk && walk.here.levelId === level.id ? walk.here : undefined }}
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
          {closetType && !item ? (
            <div className="card space-y-2 p-4 text-sm" data-testid="closet-size-panel">
              <h3 className="text-sm font-semibold">{pickedEntry!.label}</h3>
              <p className="text-muted">
                Click next to a wall of a room. It adds the walls on the open sides, {closetType === "walk-in" ? "a door, and the rod and shelf. A walk-in becomes its own closet room." : "a bifold door, and the rod and shelf."} In a corner it uses the walls already there.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {(["widthIn", "depthIn"] as const).map((k) => (
                  <label key={k} className="text-xs text-muted">
                    {k === "widthIn" ? "Width (in)" : "Depth (in)"}
                    <input
                      type="number"
                      className="input mt-1 w-full"
                      value={closetSize[k]}
                      min={CLOSET_SIZES[closetType].min[k]}
                      max={CLOSET_SIZES[closetType].max[k]}
                      onChange={(e) => setClosetSize((s) => ({ ...s, [k]: Number(e.target.value) || s[k] }))}
                      onBlur={() => setClosetSize((s) => clampClosetSize(closetType, s))}
                      data-testid={`closet-${k}`}
                    />
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted">
                {formatFeetInches(closetSize.widthIn)} wide, {formatFeetInches(closetSize.depthIn)} deep. Deleting the closet later takes out the rod and shelf only; the walls stay until you remove them on the floor plan.
              </p>
            </div>
          ) : item ? (
            <FurnishItemPanel plan={plan} item={item} ceilingIn={ceilingIn} roomName={roomName} onApply={apply} onDelete={(pl) => { setLevelPlan(pl); setSelection([]); if (isClosetRod(item.id)) setFlash(CLOSET_DELETED); }} onMessage={setFlash} {...faucetProps(item)} />
          ) : faucetFx && faucet ? (
            <FaucetPanel faucet={faucet} fixtureLabel={fixtureType(faucetFx.kind).label} usedFor={usedFor(plan, faucetFx, faucet.kind)} onChange={changeFaucetHere} onPick={pickFaucet} />
          ) : railTarget ? (
            <RailingPanel target={railTarget} edited={!!plans[railTarget.stairsLevelId]?.stairs.find((x) => x.id === railTarget.stairsId)?.railings?.some((e) => e.edge === railTarget.edge)} onChange={changeRail} />
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
              <p>Pick something in the list to place it, or click a toilet, cabinet, outlet or other item on the plan to change its size, turn it, move it away from a wall, swap it or delete it. Faucets and shower heads are there too: click one to change its shape or product. Stair railings: click one to change its kind or look, or a dotted line along the stairs to add one.</p>
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
          <div className="card space-y-2 p-4 text-sm" data-testid="furnish-for-me">
            <h3 className="text-sm font-semibold">Furnish for me</h3>
            <p className="text-xs text-muted">Fills in what each room needs: kitchen counters and appliances, bath fixtures, laundry, bedroom closets, the water heater and furnace, coat hooks. It skips anything already there.</p>
            <select className="input w-full" value={autoPick} onChange={(e) => setAutoRoom(e.target.value)} aria-label="Room to furnish" data-testid="furnish-for-me-room">
              <option value="all">Every room on {level.name.toLowerCase()}</option>
              {autoRooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <button className="btn-primary w-full" onClick={furnishForMe} disabled={!autoRooms.length} data-testid="furnish-for-me-go">
              Furnish for me
            </button>
            {autoNotes.length > 0 && (
              <ul className="list-disc space-y-1 pl-4 text-xs text-amber-900" data-testid="furnish-for-me-notes">
                {autoNotes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
          </div>
          <PlanChecks {...checkProps} levels={levels} levelId={level.id} onPick={pickWarning} onFix={fixWarning} inFurnish />
        </div>
      </div>
    </div>
  );
}
