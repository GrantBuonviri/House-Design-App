"use client";

import dynamic from "next/dynamic";
import type { BubbleDiagram, Level } from "@/lib/model/schema";
import type { Alternative } from "@/lib/bubbles/alternatives";
import type { Diagrams } from "@/lib/bubbles/arrange";
import { emptyDiagram } from "@/lib/bubbles/shapes";
import { Note, SourceBadge } from "@/components/brief/bits";
import LevelTabs from "./LevelTabs";

const MiniSketch = dynamic(() => import("./MiniSketch"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded bg-stone-100" />,
});

const SIZE = 250;

function frameOf(diagrams: BubbleDiagram[]) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const d of diagrams) {
    for (const b of d.bubbles) {
      const r = Math.max(b.rx, b.ry);
      x0 = Math.min(x0, b.x - r);
      y0 = Math.min(y0, b.y - r);
      x1 = Math.max(x1, b.x + r);
      y1 = Math.max(y1, b.y + r);
    }
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : { x0: -240, y0: -240, x1: 240, y1: 240 };
}

/** "Show me alternatives": the user's sketch next to three others, to pick one or take ideas from them. */
export default function AlternativesView({
  mine,
  alternatives,
  source,
  note,
  message,
  levels,
  levelId,
  busy,
  onLevel,
  onUse,
  onCopyRoom,
  onAgain,
  onClose,
}: {
  mine: Diagrams;
  alternatives: Alternative[];
  source: "ai" | "rules";
  note?: string;
  message?: string;
  levels: Level[];
  levelId: string;
  busy: boolean;
  onLevel: (id: string) => void;
  onUse: (index: number, levelOnly: boolean) => void;
  onCopyRoom: (index: number, bubbleId: string) => void;
  onAgain: () => void;
  onClose: () => void;
}) {
  const on = (d: Diagrams) => d[levelId] ?? emptyDiagram();
  const frame = frameOf([on(mine), ...alternatives.map((a) => on(a.diagrams))]);
  const multiLevel = levels.filter((l) => (mine[l.id]?.bubbles.length ?? 0) > 0).length > 1;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-6">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold tracking-tight">{alternatives.length === 3 ? "Three alternatives" : "Alternatives"}</h2>
            <SourceBadge source={source} aiLabel="Suggested by Claude" />
          </div>
          <p className="mt-1 text-sm text-muted">
            Use one as it is, or click a room in any of them to move your room to that spot. Your pen marks and notes are always kept.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button className="btn" onClick={onAgain} disabled={busy}>
            Show me different ones
          </button>
          <button className="btn-primary" onClick={onClose}>
            Back to my sketch
          </button>
        </div>
      </div>
      <Note text={note} />
      {message && <p className="rounded-md bg-accent-soft px-3 py-2 text-sm text-accent">{message}</p>}
      <LevelTabs levels={levels} current={levelId} onSelect={onLevel} counts={Object.fromEntries(levels.map((l) => [l.id, mine[l.id]?.bubbles.length ?? 0]))} />

      <div className="grid grid-cols-4 gap-4">
        <figure className="card overflow-hidden ring-2 ring-accent/40">
          <div className="border-b border-line bg-paper" style={{ height: SIZE }}>
            <MiniSketch diagram={on(mine)} width={SIZE} height={SIZE} frame={frame} />
          </div>
          <figcaption className="p-3">
            <p className="text-sm font-semibold">Yours</p>
            <p className="mt-1 text-xs text-muted">Your sketch as it is now.</p>
          </figcaption>
        </figure>
        {alternatives.map((alt, i) => (
          <figure key={i} className="card flex flex-col overflow-hidden">
            <div className="border-b border-line bg-paper" style={{ height: SIZE }}>
              <MiniSketch diagram={on(alt.diagrams)} width={SIZE} height={SIZE} frame={frame} onBubbleClick={(id) => onCopyRoom(i, id)} />
            </div>
            <figcaption className="flex flex-1 flex-col p-3">
              <p className="text-sm font-semibold">{alt.title}</p>
              <p className="mt-1 flex-1 text-xs text-muted">{alt.why}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="btn px-2.5 py-1.5" onClick={() => onUse(i, false)}>
                  Use this design
                </button>
                {multiLevel && (
                  <button className="btn px-2.5 py-1.5" onClick={() => onUse(i, true)}>
                    Use this floor only
                  </button>
                )}
              </div>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
