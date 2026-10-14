"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BubbleDiagram, Level, Point } from "@/lib/model/schema";
import { useProjectStore } from "@/lib/store/projectStore";
import { addMissingRooms, missingRooms, type Diagrams, type SketchContext } from "@/lib/bubbles/arrange";
import type { Alternative } from "@/lib/bubbles/alternatives";
import { copyBubbleFrom, diagramOf, findBubble, moveBubblesToLevel, removeMany, takeAlternative, toggleFlow } from "@/lib/bubbles/edit";
import { WINTER_RING, defaultLotOffset, houseCenter, houseReach, landDrawing } from "@/lib/bubbles/land";
import { blankSketch, createRequestGate, hasContent, ifCurrent } from "@/lib/bubbles/start";
import { siteOf } from "@/lib/bubbles/site";
import { MAIN_LEVEL_ID, isExtraLevel } from "@/lib/brief/levels";
import { nearestSide } from "@/lib/land/generate";
import { Note, SourceBadge, Working } from "@/components/brief/bits";
import AlternativesView from "./AlternativesView";
import LevelTabs from "./LevelTabs";
import SidePanel from "./SidePanel";
import ViewOptions, { type Overlay } from "./ViewOptions";
import { TOOLS, type LandView, type Selection, type Side, type Tool } from "./types";

const SketchCanvas = dynamic(() => import("./SketchCanvas"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-lg bg-stone-100" />,
});

type Source = "ai" | "rules";
type Compare = { alternatives: Alternative[]; source: Source; note?: string };

const CANVAS_HEIGHT = 620;
const FT = 12;

async function post<T>(path: string, body: unknown, signal: AbortSignal): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `The app's server answered ${res.status}.`);
  return res.json() as Promise<T>;
}

/** Stage 4: the flow sketch. Rooms as bubbles on each floor, how you move between them, and notes. */
export default function BubbleStage({ onContinue, onGoToRooms }: { onContinue: () => void; onGoToRooms: () => void }) {
  const project = useProjectStore((s) => s.project)!;
  const update = useProjectStore((s) => s.update);
  const { brief, plot } = project;
  const diagrams = project.bubbles;
  const { overlays, lotOffset } = project.sketch;
  const levels = useMemo(() => [...project.levels].sort((a, b) => a.elevationIn - b.elevationIn), [project.levels]);

  const [levelId, setLevelId] = useState(MAIN_LEVEL_ID);
  const [tool, setTool] = useState<Tool>("select");
  const [selection, setSelection] = useState<Selection>([]);
  const [focusNote, setFocusNote] = useState<string | null>(null);
  const [snap, setSnap] = useState(true);
  const [busy, setBusy] = useState<null | "suggest" | "alternatives">(null);
  const [made, setMade] = useState<{ source?: Source; idea?: string; note?: string }>({});
  const [error, setError] = useState<string>();
  const [compare, setCompare] = useState<Compare | null>(null);
  const [comparing, setComparing] = useState(false);
  const [message, setMessage] = useState<string>();
  const [choosing, setChoosing] = useState(() => !hasContent(diagrams));
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [lotMode, setLotMode] = useState(false);

  // Only the latest request to Claude may change the sketch, and none once you've left the page.
  const gate = useRef(createRequestGate()).current;
  useEffect(() => () => gate.cancel(), [gate]);

  // Back on the drawing whenever there's something to show (after Undo, say).
  const filled = hasContent(diagrams);
  useEffect(() => {
    if (choosing && filled) setChoosing(false);
  }, [choosing, filled]);

  const level: Level = levels.find((l) => l.id === levelId) ?? levels.find((l) => l.id === MAIN_LEVEL_ID) ?? levels[0];
  const diagram = diagramOf(diagrams, level.id);
  const belowLevel = [...levels].reverse().find((l) => l.elevationIn < level.elevationIn);
  const below = belowLevel && diagrams[belowLevel.id]?.bubbles.length ? { name: belowLevel.name, diagram: diagrams[belowLevel.id] } : null;
  const ctx: SketchContext | null = brief ? { brief, plot, levels } : null;
  const missing = brief && !choosing ? missingRooms(brief, diagrams) : [];

  // What's selected and still there (Undo can take things away).
  const live = new Set([...diagram.bubbles, ...diagram.flows, ...diagram.notes, ...diagram.strokes].map((x) => x.id));
  const sel = selection.filter((s) => live.has(s.id));
  const picking = connectFrom && sel.length === 1 && sel[0].id === connectFrom ? connectFrom : null;
  const pickingName = picking ? diagram.bubbles.find((b) => b.id === picking)?.label : undefined;

  const sides = useMemo(() => {
    const out: Record<Side, string[]> = { N: [], E: [], S: ["Sunny side"], W: [] };
    if (plot) {
      out[plot.roadSide].unshift("Road");
      const site = siteOf(plot);
      if (site.walkout) out[nearestSide(plot.slope.downhillDeg)].push("Downhill");
    }
    return out;
  }, [plot]);

  // ---- The land under the sketch ----
  const drawing = useMemo(() => (plot ? landDrawing(plot) : null), [plot]);
  const mainBubbles = diagramOf(diagrams, MAIN_LEVEL_ID).bubbles;
  const allBubbles = Object.values(diagrams).flatMap((d) => d.bubbles);
  const center = houseCenter(mainBubbles.length ? mainBubbles : allBubbles);
  const land: LandView | null =
    drawing && plot && (overlays.property || overlays.land || overlays.sun)
      ? {
          drawing,
          offset: lotOffset ?? defaultLotOffset(plot, mainBubbles),
          show: overlays,
          // The winter path (the inner one) clears the house; summer goes around it.
          sun: { center, radius: Math.max((houseReach(allBubbles, center) + 8 * FT) / WINTER_RING, 25 * FT) },
        }
      : null;
  const canMoveLot = Boolean(land && (overlays.property || overlays.land));
  const lotOn = lotMode && canMoveLot;

  function setOverlay(key: Overlay, on: boolean) {
    update((p) => ({
      ...p,
      sketch: {
        ...p.sketch,
        overlays: { ...p.sketch.overlays, [key]: on },
        lotOffset: p.sketch.lotOffset ?? (on && p.plot && key !== "sun" ? defaultLotOffset(p.plot, diagramOf(p.bubbles, MAIN_LEVEL_ID).bubbles) : null),
      },
    }));
  }

  const setLotOffset = (offset: Point) => update((p) => ({ ...p, sketch: { ...p.sketch, lotOffset: offset } }));

  const setDiagrams = useCallback(
    (change: (ds: Diagrams) => Diagrams, coalesce?: string) =>
      update((p) => ({ ...p, bubbles: change(p.bubbles) }), coalesce ? { coalesce: `sketch.${coalesce}` } : undefined),
    [update],
  );
  const setLevelDiagram = useCallback(
    (d: BubbleDiagram, coalesce?: string) => setDiagrams((ds) => ({ ...ds, [level.id]: d }), coalesce),
    [setDiagrams, level.id],
  );

  const select = (s: Selection) => {
    setSelection(s);
    if (s.length === 0) setFocusNote(null);
  };

  const chooseTool = (t: Tool) => {
    setTool(t);
    setConnectFrom(null);
    setLotMode(false);
  };

  // Keyboard: tool letters, Delete to remove, Escape to let go.
  useEffect(() => {
    if (comparing || choosing) return;
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest("input, textarea, select, [contenteditable]")) return;
      if ((e.key === "Delete" || e.key === "Backspace") && sel.length) {
        e.preventDefault();
        setLevelDiagram(removeMany(diagram, sel.map((s) => s.id)));
        setSelection([]);
        setConnectFrom(null);
        return;
      }
      if (e.key === "Escape") {
        if (picking) setConnectFrom(null);
        else if (lotOn) setLotMode(false);
        else {
          setTool("select");
          setSelection([]);
        }
        return;
      }
      const hit = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
      if (hit) chooseTool(hit.id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [comparing, choosing, sel, picking, lotOn, diagram, setLevelDiagram]);

  /** Leave the sketch completely empty: no rooms, lines, stairs, marks or notes. */
  function startBlank() {
    gate.cancel();
    setBusy(null);
    if (hasContent(diagrams)) setDiagrams(() => blankSketch(levels));
    setMade({});
    setCompare(null);
    setError(undefined);
    setSelection([]);
    setChoosing(false);
  }

  function startOver() {
    if (!window.confirm("Clear every floor and choose how to start again? Undo brings your sketch back.")) return;
    gate.cancel();
    setBusy(null);
    setDiagrams(() => blankSketch(levels));
    setMade({});
    setCompare(null);
    setComparing(false);
    setMessage(undefined);
    setError(undefined);
    setSelection([]);
    setConnectFrom(null);
    setLotMode(false);
    setChoosing(true);
  }

  async function suggest() {
    if (!ctx) return;
    if (hasContent(diagrams) && !window.confirm("Replace the rooms on every floor with a new suggestion? Your pen marks and notes stay, and Undo brings your sketch back.")) {
      return;
    }
    setBusy("suggest");
    setError(undefined);
    let res;
    try {
      res = await ifCurrent(gate, (signal) =>
        post<{ diagrams: Diagrams; source: Source; idea?: string; note?: string }>(
          "/api/bubbles/suggest",
          { brief: ctx.brief, plot: ctx.plot, levels: ctx.levels, fresh: Boolean(made.source), current: diagrams },
          signal,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't make a suggestion.");
      setBusy(null);
      return;
    }
    // Overtaken: Start blank, Start over or leaving the page cancelled it.
    if (!res) return;
    const { value } = res;
    setBusy(null);
    setDiagrams((ds) => takeAlternative(ds, value.diagrams));
    setMade({ source: value.source, idea: value.idea, note: value.note });
    setChoosing(false);
    setSelection([]);
    setCompare(null);
  }

  async function showAlternatives(fresh = false) {
    if (!ctx) return;
    if (compare && !fresh) {
      setComparing(true);
      return;
    }
    setBusy("alternatives");
    setError(undefined);
    setMessage(undefined);
    let res;
    try {
      res = await ifCurrent(gate, (signal) => post<Compare>("/api/bubbles/alternatives", { brief: ctx.brief, plot: ctx.plot, levels: ctx.levels, current: diagrams, fresh }, signal));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't make alternatives.");
      setBusy(null);
      return;
    }
    if (!res) return;
    setBusy(null);
    if (res.value.alternatives.length === 0) {
      setError(res.value.note ?? "There were no alternatives to show.");
      return;
    }
    setCompare(res.value);
    setComparing(true);
    window.scrollTo({ top: 0 });
  }

  function addLevel(l: Level) {
    update((p) => ({ ...p, levels: [...p.levels, l] }));
    setLevelId(l.id);
  }

  function removeLevel(id: string) {
    const l = levels.find((x) => x.id === id);
    if (hasContent({ [id]: diagramOf(diagrams, id) }) && !window.confirm(`Remove the ${l?.name ?? "level"} and everything drawn on it?`)) return;
    update((p) => {
      const bubbles = { ...p.bubbles };
      delete bubbles[id];
      return { ...p, levels: p.levels.filter((x) => x.id !== id), bubbles };
    });
    if (levelId === id) setLevelId(MAIN_LEVEL_ID);
  }

  const counts = Object.fromEntries(levels.map((l) => [l.id, diagrams[l.id]?.bubbles.length ?? 0]));

  // ---- No brief yet ----
  if (!brief && choosing) {
    return (
      <div className="card mx-auto max-w-xl px-8 py-12 text-center">
        <h2 className="text-xl font-semibold tracking-tight">Your flow sketch starts from your rooms</h2>
        <p className="mt-2 text-sm text-muted">Pick your rooms and build your brief first, and the app can lay them out for you. Or start with a blank page.</p>
        <div className="mt-6 flex justify-center gap-3">
          <button className="btn" onClick={startBlank}>
            Start blank
          </button>
          <button className="btn-primary" onClick={onGoToRooms}>
            Go to Rooms
          </button>
        </div>
      </div>
    );
  }

  // ---- Choose how to start ----
  if (choosing) {
    return (
      <div className="card mx-auto max-w-2xl px-8 py-12 text-center">
        <h2 className="text-xl font-semibold tracking-tight">Start your flow sketch</h2>
        <p className="mx-auto mt-2 max-w-lg text-sm text-muted">
          Each room becomes a bubble sized to its area, with lines for how you move between rooms. A starting sketch puts the entry and
          garage toward the road, living spaces on the sunny side and bedrooms somewhere quieter. Or start with an empty page and draw it
          yourself.
        </p>
        {busy ? (
          <div className="flex flex-col items-center gap-2">
            <Working text="Sketching your rooms…" />
            <button className="text-sm text-muted hover:text-ink hover:underline" onClick={startBlank}>
              Stop and start blank instead
            </button>
          </div>
        ) : (
          <div className="mt-6 flex justify-center gap-3">
            <button className="btn" onClick={startBlank}>
              Start blank
            </button>
            <button className="btn-primary" onClick={() => void suggest()}>
              Suggest a starting sketch
            </button>
          </div>
        )}
        <div className="mt-4">
          <Note text={error} />
        </div>
      </div>
    );
  }

  // ---- Comparing alternatives ----
  if (comparing && compare) {
    return (
      <div className="pb-10">
        <AlternativesView
          mine={diagrams}
          alternatives={compare.alternatives}
          source={compare.source}
          note={compare.note}
          message={message}
          levels={levels}
          levelId={level.id}
          busy={busy !== null}
          onLevel={setLevelId}
          onUse={(i, levelOnly) => {
            const alt = compare.alternatives[i];
            setDiagrams((ds) => takeAlternative(ds, alt.diagrams, levelOnly ? [level.id] : undefined));
            setComparing(false);
            setSelection([]);
            setMessage(`Using “${alt.title}”${levelOnly ? ` for the ${level.name.toLowerCase()}` : ""}. Undo brings back your own.`);
          }}
          onCopyRoom={(i, id) => {
            const alt = compare.alternatives[i];
            const label = findBubble(diagrams, id)?.bubble.label ?? findBubble(alt.diagrams, id)?.bubble.label ?? "That room";
            setDiagrams((ds) => copyBubbleFrom(ds, alt.diagrams, id));
            setMessage(`${label} now sits where it does in “${alt.title}”.`);
          }}
          onAgain={() => void showAlternatives(true)}
          onClose={() => {
            setComparing(false);
            setMessage(undefined);
          }}
        />
        {busy === "alternatives" && <Working text="Thinking up three more…" />}
      </div>
    );
  }

  // ---- The editor ----
  const hint = picking
    ? "Click a room to connect it, or click it again to disconnect it."
    : lotOn
      ? "Drag anywhere to slide the lot under your house. Your rooms stay put."
      : TOOLS.find((t) => t.id === tool)?.hint;
  return (
    <div className="space-y-4 pb-10">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold tracking-tight">Flow sketch</h2>
            <SourceBadge source={made.source} aiLabel="Suggested by Claude" />
          </div>
          <p className="mt-1 text-sm text-muted">Rooms as bubbles, sized to their area. No walls yet: just what goes where and how you move around.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button className="btn" onClick={startOver} disabled={busy !== null} title="Clear the sketch and choose Start blank or a suggestion again">
            Start over
          </button>
          {brief && (
            <button className="btn" onClick={() => void suggest()} disabled={busy !== null}>
              New suggestion
            </button>
          )}
          {brief && (
            <button className="btn" onClick={() => void showAlternatives()} disabled={busy !== null || !Object.values(diagrams).some((d) => d.bubbles.length)}>
              Show me alternatives
            </button>
          )}
          <button className="btn-primary" onClick={onContinue}>
            Next: floor plan →
          </button>
        </div>
      </div>

      {busy && <Working text={busy === "suggest" ? "Sketching your rooms…" : "Thinking up three alternatives. With Claude this can take a minute…"} />}
      {made.idea && <p className="rounded-md bg-violet-50 px-3 py-2 text-sm text-violet-900">{made.idea}</p>}
      <Note text={made.note} />
      <Note text={error} />
      {message && <p className="rounded-md bg-accent-soft px-3 py-2 text-sm text-accent">{message}</p>}
      {missing.length > 0 && ctx && (
        <div className="flex items-center justify-between gap-4 rounded-md border border-line bg-white px-3 py-2 text-sm">
          <span>
            <span className="text-muted">Not in your sketch yet:</span> {missing.map((r) => r.name).join(", ")}
          </span>
          <button
            className="shrink-0 text-accent hover:underline"
            onClick={() => setDiagrams((ds) => addMissingRooms(ctx, ds, missing.map((r) => r.id)))}
          >
            Add {missing.length === 1 ? "it" : "them"}
          </button>
        </div>
      )}

      <div className="flex items-center justify-between gap-4">
        <LevelTabs
          levels={levels}
          current={level.id}
          counts={counts}
          onSelect={(id) => {
            setLevelId(id);
            setSelection([]);
          }}
          onAdd={addLevel}
          onRemove={removeLevel}
        />
      </div>

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
        onLotMode={(on) => {
          setLotMode(on);
          if (on) setConnectFrom(null);
        }}
      />

      <div className="grid grid-cols-[44px_1fr_250px] items-start gap-3">
        <div className="card flex flex-col gap-1 p-1" role="toolbar" aria-label="Drawing tools" aria-orientation="vertical">
          {TOOLS.map((t) => (
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
          <SketchCanvas
            diagram={diagram}
            below={below}
            tool={tool}
            selection={sel}
            snap={snap}
            sides={sides}
            height={CANVAS_HEIGHT}
            land={land}
            lotMode={lotOn}
            onLotMove={setLotOffset}
            connectFrom={picking}
            onToggleConnection={(id) => picking && setLevelDiagram(toggleFlow(diagram, picking, id))}
            onSelect={select}
            onChange={setLevelDiagram}
            onToolDone={() => setTool("select")}
            onEditNote={(id) => {
              setSelection([{ kind: "note", id }]);
              setFocusNote(id);
            }}
          />
          {(picking || lotOn) && (
            <div className="absolute top-10 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full bg-ink px-4 py-1.5 text-sm text-white shadow-md" role="status">
              <span>{picking ? `Click rooms to connect them to ${pickingName ?? "this room"}.` : "Drag to slide the lot under your house."}</span>
              <button
                className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium hover:bg-white/25"
                onClick={() => (picking ? setConnectFrom(null) : setLotMode(false))}
              >
                Done (Esc)
              </button>
            </div>
          )}
          <p className="mt-2 text-xs text-muted">
            {hint} Pinch or hold Control and scroll to zoom; scroll to move around.
          </p>
        </div>

        <SidePanel
          diagram={diagram}
          level={level}
          levels={levels}
          brief={brief}
          selection={sel}
          focusNote={focusNote}
          connectFrom={picking}
          onChange={setLevelDiagram}
          onSelect={select}
          onPickConnections={(id) => {
            setConnectFrom(id);
            if (id) {
              setTool("select");
              setLotMode(false);
            }
          }}
          onMoveToLevel={(ids, to) => {
            setDiagrams((ds) => moveBubblesToLevel(ds, ids, level.id, to));
            setSelection(sel.filter((s) => ids.includes(s.id)));
            setLevelId(to);
          }}
        />
      </div>
      {levels.some((l) => isExtraLevel(l.id)) && (
        <p className="text-xs text-muted">Lofts and split levels you add here are kept even when you change your floors on the Rooms page.</p>
      )}
    </div>
  );
}

/** Simple line icons for the tool bar. */
function ToolIcon({ tool }: { tool: Tool }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (tool) {
    case "select":
      return (
        <svg {...common}>
          <path d="M5 3l14 8-6 2-2 6z" />
        </svg>
      );
    case "circle":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
        </svg>
      );
    case "oval":
      return (
        <svg {...common}>
          <ellipse cx="12" cy="12" rx="10" ry="6" />
        </svg>
      );
    case "room":
      return (
        <svg {...common}>
          <path d="M5 8c2-4 8-5 11-3s5 6 2 10-9 5-12 3-3-6-1-10z" />
          <path d="M9 12h6M12 9v6" strokeWidth={1.4} />
        </svg>
      );
    case "pen":
      return (
        <svg {...common}>
          <path d="M4 20l4-1 11-11-3-3L5 16z" />
          <path d="M14 7l3 3" />
        </svg>
      );
    case "eraser":
      return (
        <svg {...common}>
          <path d="M8 20h12" />
          <path d="M4.5 15.5l9-9a2 2 0 012.8 0l2.2 2.2a2 2 0 010 2.8L12 18H7z" />
        </svg>
      );
    case "note":
      return (
        <svg {...common}>
          <path d="M5 4h14v11l-5 5H5z" />
          <path d="M14 20v-5h5" />
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
