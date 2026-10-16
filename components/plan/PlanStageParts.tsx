"use client";

import { PLAN_TOOLS, type PlanTool } from "./types";

/** Pieces of the floor plan page (PlanStage.tsx) that only draw what they are given. */

export type Display = "plan" | "3d";

const DISPLAYS: { id: Display; label: string; hint: string }[] = [
  { id: "plan", label: "2D plan", hint: "The floor plan editor" },
  { id: "3d", label: "3D", hint: "The whole house on your land" },
];

/** How to start the floor plan: Suggest a plan, Turn my sketch into a plan, or Start blank. */
export function PlanStartChoices(props: {
  filled: boolean;
  sketchHasRooms: boolean;
  onKeep: () => void;
  onBlank: () => void;
  onFromSketch: () => void;
  onSuggest: () => void;
  onGoToSketch: () => void;
  onEditBasics: () => void;
}) {
  const { filled, sketchHasRooms, onKeep, onBlank, onFromSketch, onSuggest, onGoToSketch, onEditBasics } = props;
  return (
    <div className="card mx-auto max-w-2xl px-8 py-12 text-center">
      <h2 className="text-xl font-semibold tracking-tight">Start your floor plan</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm text-muted">
        Turn your flow sketch into rooms with real walls: each bubble becomes a room of the same size, in the same spot, pushed together so neighbors share walls.
      </p>
      <ul className="mx-auto mt-4 max-w-lg space-y-2 text-left text-sm text-muted">
        <li>
          <span className="font-medium text-ink">Suggest a plan</span> also adds what a real plan needs: hallways so bedrooms don&apos;t open off each other, closets,
          windows (more on the sunny side), and doors so every room can be reached.
        </li>
        <li>
          <span className="font-medium text-ink">Turn my sketch into a plan</span> only adds doors between the rooms you connected, and a front door.
        </li>
        <li>
          <span className="font-medium text-ink">Start blank</span> gives you an empty floor to trace over your sketch yourself.
        </li>
      </ul>
      {filled && <p className="mx-auto mt-3 max-w-lg text-sm text-amber-800">Either choice replaces the floor plan you have now on every floor. Undo brings it back.</p>}
      <div className="mt-6 flex justify-center gap-3">
        {filled && (
          <button className="btn" onClick={onKeep}>
            Keep my plan
          </button>
        )}
        <button className="btn" onClick={onBlank}>
          Start blank
        </button>
        <button className="btn" onClick={onFromSketch} disabled={!sketchHasRooms}>
          Turn my sketch into a plan
        </button>
        <button className="btn-primary" onClick={onSuggest} disabled={!sketchHasRooms}>
          Suggest a plan
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
      <button className="mt-6 text-xs text-muted hover:text-ink hover:underline" onClick={onEditBasics}>
        Change the plan basics
      </button>
    </div>
  );
}

/** The 2D plan / 3D switch. */
export function DisplayTabs({ display, onDisplay }: { display: Display; onDisplay: (d: Display) => void }) {
  return (
    <div className="flex rounded-md border border-line bg-white p-0.5" role="tablist" aria-label="View">
      {DISPLAYS.map((d) => (
        <button
          key={d.id}
          role="tab"
          aria-selected={display === d.id}
          title={d.hint}
          onClick={() => onDisplay(d.id)}
          className={`rounded px-3 py-1 text-sm font-medium ${display === d.id ? "bg-ink text-white" : "text-muted hover:text-ink"}`}
        >
          {d.label}
        </button>
      ))}
    </div>
  );
}

/** The drawing tools down the left side. */
export function PlanToolbar({ tool, onTool }: { tool: PlanTool; onTool: (t: PlanTool) => void }) {
  return (
    <div className="card flex flex-col gap-1 p-1" role="toolbar" aria-label="Drawing tools" aria-orientation="vertical">
      {PLAN_TOOLS.map((t) => (
        <button
          key={t.id}
          aria-label={t.label}
          aria-pressed={tool === t.id}
          title={`${t.label} (${t.key})`}
          onClick={() => onTool(t.id)}
          className={`flex size-9 items-center justify-center rounded-md ${tool === t.id ? "bg-accent text-white" : "text-ink hover:bg-stone-100"}`}
        >
          <ToolIcon tool={t.id} />
        </button>
      ))}
    </div>
  );
}

/** Shown over the drawing while the lot is being slid under the house. */
export function LotModeBanner({ onDone }: { onDone: () => void }) {
  return (
      <div className="absolute top-10 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full bg-ink px-4 py-1.5 text-sm text-white shadow-md" role="status">
        <span>Drag to slide the lot under your house.</span>
        <button className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium hover:bg-white/25" onClick={onDone}>
          Done (Esc)
        </button>
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
    case "curve":
      return (
        <svg {...common}>
          <path d="M4 19C4 11 9 6 19 5" strokeWidth={3.2} />
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
