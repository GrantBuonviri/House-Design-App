"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { BubbleDiagram, Level } from "@/lib/model/schema";
import { useProjectStore } from "@/lib/store/projectStore";
import { addMissingRooms, missingRooms, type Diagrams, type SketchContext } from "@/lib/bubbles/arrange";
import type { Alternative } from "@/lib/bubbles/alternatives";
import { copyBubbleFrom, diagramOf, findBubble, moveBubbleToLevel, removeAny, takeAlternative } from "@/lib/bubbles/edit";
import { siteOf } from "@/lib/bubbles/site";
import { MAIN_LEVEL_ID, isExtraLevel } from "@/lib/brief/levels";
import { nearestSide } from "@/lib/land/generate";
import { Note, SourceBadge, Working } from "@/components/brief/bits";
import AlternativesView from "./AlternativesView";
import LevelTabs from "./LevelTabs";
import SidePanel from "./SidePanel";
import { TOOLS, type Selection, type Side, type Tool } from "./types";

const SketchCanvas = dynamic(() => import("./SketchCanvas"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-lg bg-stone-100" />,
});

type Source = "ai" | "rules";
type Compare = { alternatives: Alternative[]; source: Source; note?: string };

const CANVAS_HEIGHT = 620;

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `The app's server answered ${res.status}.`);
  return res.json() as Promise<T>;
}

function hasContent(ds: Diagrams): boolean {
  return Object.values(ds).some((d) => d.bubbles.length + d.strokes.length + d.notes.length > 0);
}

/** Stage 4: the flow sketch. Rooms as bubbles on each floor, how you move between them, and notes. */
export default function BubbleStage({ onContinue, onGoToRooms }: { onContinue: () => void; onGoToRooms: () => void }) {
  const project = useProjectStore((s) => s.project)!;
  const update = useProjectStore((s) => s.update);
  const { brief, plot } = project;
  const diagrams = project.bubbles;
  const levels = useMemo(() => [...project.levels].sort((a, b) => a.elevationIn - b.elevationIn), [project.levels]);

  const [levelId, setLevelId] = useState(MAIN_LEVEL_ID);
  const [tool, setTool] = useState<Tool>("select");
  const [selection, setSelection] = useState<Selection>(null);
  const [focusNote, setFocusNote] = useState<string | null>(null);
  const [snap, setSnap] = useState(true);
  const [busy, setBusy] = useState<null | "suggest" | "alternatives">(null);
  const [made, setMade] = useState<{ source?: Source; idea?: string; note?: string }>({});
  const [error, setError] = useState<string>();
  const [compare, setCompare] = useState<Compare | null>(null);
  const [comparing, setComparing] = useState(false);
  const [message, setMessage] = useState<string>();
  const [started, setStarted] = useState(() => hasContent(diagrams));

  const level: Level = levels.find((l) => l.id === levelId) ?? levels.find((l) => l.id === MAIN_LEVEL_ID) ?? levels[0];
  const diagram = diagramOf(diagrams, level.id);
  const belowLevel = [...levels].reverse().find((l) => l.elevationIn < level.elevationIn);
  const below = belowLevel && diagrams[belowLevel.id]?.bubbles.length ? { name: belowLevel.name, diagram: diagrams[belowLevel.id] } : null;
  const ctx: SketchContext | null = brief ? { brief, plot, levels } : null;
  const missing = brief && started ? missingRooms(brief, diagrams) : [];

  const sides = useMemo(() => {
    const out: Record<Side, string[]> = { N: [], E: [], S: ["Sunny side"], W: [] };
    if (plot) {
      out[plot.roadSide].unshift("Road");
      const site = siteOf(plot);
      if (site.walkout) out[nearestSide(plot.slope.downhillDeg)].push("Downhill");
    }
    return out;
  }, [plot]);

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
    if (!s) setFocusNote(null);
  };

  // Keyboard: tool letters, Delete to remove, Escape to let go.
  useEffect(() => {
    if (comparing || !started) return;
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest("input, textarea, select, [contenteditable]")) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selection) {
        e.preventDefault();
        setLevelDiagram(removeAny(diagram, selection.id));
        setSelection(null);
        return;
      }
      if (e.key === "Escape") {
        setTool("select");
        setSelection(null);
        return;
      }
      const hit = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
      if (hit) setTool(hit.id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [comparing, started, selection, diagram, setLevelDiagram]);

  async function suggest() {
    if (!ctx) return;
    if (hasContent(diagrams) && !window.confirm("Replace the rooms on every floor with a new suggestion? Your pen marks and notes stay, and Undo brings your sketch back.")) {
      return;
    }
    setBusy("suggest");
    setError(undefined);
    try {
      const res = await post<{ diagrams: Diagrams; source: Source; idea?: string; note?: string }>("/api/bubbles/suggest", {
        brief: ctx.brief,
        plot: ctx.plot,
        levels: ctx.levels,
        fresh: Boolean(made.source),
      });
      setDiagrams((ds) => takeAlternative(ds, res.diagrams));
      setMade({ source: res.source, idea: res.idea, note: res.note });
      setStarted(true);
      setSelection(null);
      setCompare(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't make a suggestion.");
    } finally {
      setBusy(null);
    }
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
    try {
      const res = await post<Compare>("/api/bubbles/alternatives", { brief: ctx.brief, plot: ctx.plot, levels: ctx.levels, current: diagrams, fresh });
      if (res.alternatives.length === 0) {
        setError(res.note ?? "There were no alternatives to show.");
        return;
      }
      setCompare(res);
      setComparing(true);
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't make alternatives.");
    } finally {
      setBusy(null);
    }
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
  if (!brief && !started) {
    return (
      <div className="card mx-auto max-w-xl px-8 py-12 text-center">
        <h2 className="text-xl font-semibold tracking-tight">Your flow sketch starts from your rooms</h2>
        <p className="mt-2 text-sm text-muted">Pick your rooms and build your brief first, and the app can lay them out for you. Or start with a blank page.</p>
        <div className="mt-6 flex justify-center gap-3">
          <button className="btn" onClick={() => setStarted(true)}>
            Start blank
          </button>
          <button className="btn-primary" onClick={onGoToRooms}>
            Go to Rooms
          </button>
        </div>
      </div>
    );
  }

  // ---- First visit: offer a starting sketch ----
  if (!started) {
    return (
      <div className="card mx-auto max-w-2xl px-8 py-12 text-center">
        <h2 className="text-xl font-semibold tracking-tight">Start your flow sketch</h2>
        <p className="mx-auto mt-2 max-w-lg text-sm text-muted">
          Each room becomes a bubble sized to its area, with lines for how you move between rooms. A starting sketch puts the entry and
          garage toward the road, living spaces on the sunny side and bedrooms somewhere quieter. Then make it yours.
        </p>
        {busy ? (
          <div className="flex justify-center">
            <Working text="Sketching your rooms…" />
          </div>
        ) : (
          <div className="mt-6 flex justify-center gap-3">
            <button className="btn" onClick={() => setStarted(true)}>
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
            setSelection(null);
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
            setSelection(null);
          }}
          onAdd={addLevel}
          onRemove={removeLevel}
        />
        <label className="flex shrink-0 items-center gap-2 text-sm text-muted">
          <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
          Snap to grid
        </label>
      </div>

      <div className="grid grid-cols-[44px_1fr_250px] items-start gap-3">
        <div className="card flex flex-col gap-1 p-1" role="toolbar" aria-label="Drawing tools" aria-orientation="vertical">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              aria-label={t.label}
              aria-pressed={tool === t.id}
              title={`${t.label} (${t.key})`}
              onClick={() => setTool(t.id)}
              className={`flex size-9 items-center justify-center rounded-md ${tool === t.id ? "bg-accent text-white" : "text-ink hover:bg-stone-100"}`}
            >
              <ToolIcon tool={t.id} />
            </button>
          ))}
        </div>

        <div className="min-w-0">
          <SketchCanvas
            diagram={diagram}
            below={below}
            tool={tool}
            selection={selection}
            snap={snap}
            sides={sides}
            height={CANVAS_HEIGHT}
            onSelect={select}
            onChange={setLevelDiagram}
            onToolDone={() => setTool("select")}
            onEditNote={(id) => {
              setSelection({ kind: "note", id });
              setFocusNote(id);
            }}
          />
          <p className="mt-2 text-xs text-muted">
            {TOOLS.find((t) => t.id === tool)?.hint} Pinch or hold Control and scroll to zoom; scroll to move around.
          </p>
        </div>

        <SidePanel
          diagram={diagram}
          level={level}
          levels={levels}
          brief={brief}
          selection={selection}
          focusNote={focusNote}
          onChange={setLevelDiagram}
          onSelect={select}
          onMoveToLevel={(id, to) => {
            setDiagrams((ds) => moveBubbleToLevel(ds, id, level.id, to));
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
    case "flow":
      return (
        <svg {...common}>
          <circle cx="5" cy="17" r="2.5" />
          <circle cx="19" cy="7" r="2.5" />
          <path d="M7.2 15.5l9.6-7" />
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
