"use client";

import { useEffect, useRef } from "react";
import type { Estimate } from "@/lib/cost/estimate";
import { shortMoney } from "@/lib/cost/estimate";
import { SEASONS, clockTime, type SeasonId } from "@/lib/house3d/sun";
import type { Spot, walkWorld } from "@/lib/house3d/walk";
import type { DoorMode } from "@/lib/house3d/doors";
import DoorsPicker from "@/components/house3d/DoorsPicker";
import UndoButtons from "@/components/project/UndoButtons";
import GraphicsToggle from "@/components/project/GraphicsToggle";
import { usePlace } from "@/lib/location/usePlace";

/** The parts of the walkthrough drawn over the 3D view (Walkthrough.tsx keeps the state). */

/** Where you are, design mode, undo and the cost, and the way out. */
export function WalkTopBar(props: {
  name: string;
  where: { levelName: string; roomName: string };
  cost?: Estimate | null;
  design: boolean;
  /** The Design panel's tab. */
  tab: "finishes" | "place";
  locked: boolean;
  onDesign: () => void;
  onPlace: () => void;
  onTopDown: () => void;
  /** The design window that's open (I or X), if any. */
  win: "interior" | "exterior" | null;
  onWindow: (kind: "interior" | "exterior") => void;
  onClose: () => void;
  labelsOn: boolean;
  tapeOn: boolean;
  hasTape: boolean;
  onLabels: () => void;
  onLabelSettings: () => void;
  onTape: () => void;
  onClearTape: () => void;
}) {
  const { name, where, cost, design, tab, locked, onDesign, onPlace, onTopDown, win, onWindow, onClose, labelsOn, tapeOn, hasTape, onLabels, onLabelSettings, onTape, onClearTape } = props;
  // The bar wraps to two rows on narrow screens: panels and windows start below it (--walk-bar on the walkthrough).
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = bar.current;
    const host = el?.parentElement;
    if (!el || !host) return;
    const ro = new ResizeObserver(() => host.style.setProperty("--walk-bar", `${Math.ceil(el.getBoundingClientRect().height)}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={bar} className="pointer-events-none absolute top-0 right-0 left-0 z-20 flex items-start justify-between gap-3 p-4">
      <div className="rounded-lg bg-black/55 px-3 py-2 text-white">
        <p className="text-xs text-white/70">{name}</p>
        <p className="text-sm font-medium" data-testid="walk-where">
          {where.roomName}
          {where.roomName !== "Outside" && where.levelName ? <span className="font-normal text-white/70"> · {where.levelName}</span> : null}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {cost && (
          <span className="rounded-md bg-black/55 px-3 py-1.5 text-sm text-white tabular-nums" data-testid="walk-cost" title="The materials estimate, with your picks">
            {cost.source === "rough" ? "Rough materials" : "Materials"} about {shortMoney(cost.total.likely)}
          </span>
        )}
        {!win && (
        <button
          className={`pointer-events-auto rounded-md px-3 py-1.5 text-sm font-medium shadow ${design ? "bg-accent text-white" : "bg-white/90 text-ink hover:bg-white"}`}
          onClick={onDesign}
          aria-pressed={design}
          title="Aim at something and click to change it (E). Tab switches between Finishes and Place."
          data-testid="design-toggle"
        >
          Design {design ? (tab === "place" ? "on · Place" : "on · Finishes") : "off"}
        </button>
        )}
        {!win && (
        <button
          className={`pointer-events-auto rounded-md px-3 py-1.5 text-sm font-medium shadow ${labelsOn ? "bg-accent text-white" : "bg-white/90 text-ink hover:bg-white"}`}
          onClick={onLabels}
          aria-pressed={labelsOn}
          title="Show room labels on the floor (L)"
          data-testid="labels-toggle"
        >
          Labels {labelsOn ? "on" : "off"}
        </button>
        )}
        {!locked && !win && (
          <button className="pointer-events-auto rounded-md bg-white/90 px-2.5 py-1.5 text-sm text-ink shadow hover:bg-white" onClick={onLabelSettings} aria-label="Label settings" title="Label settings" data-testid="label-settings-button">
            ⚙
          </button>
        )}
        {!win && (
        <button
          className={`pointer-events-auto rounded-md px-3 py-1.5 text-sm font-medium shadow ${tapeOn ? "bg-accent text-white" : "bg-white/90 text-ink hover:bg-white"}`}
          onClick={onTape}
          aria-pressed={tapeOn}
          title="Measure: click two points (T)"
          data-testid="tape-toggle"
        >
          Tape {tapeOn ? "on" : "off"}
        </button>
        )}
        {!locked && !win && hasTape && (
          <button className="pointer-events-auto rounded-md bg-white/90 px-3 py-1.5 text-sm text-ink shadow hover:bg-white" onClick={onClearTape}>
            Clear tape
          </button>
        )}
        {!locked &&
          (["interior", "exterior"] as const).map((k) => (
            <button
              key={k}
              className={`pointer-events-auto rounded-md px-3 py-1.5 text-sm shadow ${win === k ? "bg-accent font-medium text-white" : "bg-white/90 text-ink hover:bg-white"}`}
              onClick={() => onWindow(k)}
              aria-pressed={win === k}
              title={k === "interior" ? "Interior design: style, mood board, finishes by room (I)" : "Exterior design: roof, siding, windows, doors and yard (X)"}
              data-testid={`${k}-button`}
            >
              {k === "interior" ? "Interior" : "Exterior"}
            </button>
          ))}
        {!locked && !win && (
          <button className="pointer-events-auto rounded-md bg-white/90 px-3 py-1.5 text-sm text-ink shadow hover:bg-white" onClick={onPlace} title="Furniture, fixtures, cabinets, outlets, doors, windows and walls (F)" data-testid="place-button">
            Place
          </button>
        )}
        {!locked && !win && (
          <button className="pointer-events-auto rounded-md bg-white/90 px-3 py-1.5 text-sm text-ink shadow hover:bg-white" onClick={onTopDown} title="See this floor from above, with the Furnish tools (M)" data-testid="top-down-button">
            Top-down
          </button>
        )}
        {!locked && (
          <>
            <UndoButtons className="pointer-events-auto rounded-md bg-white/90 px-3 py-1.5 text-sm text-ink shadow hover:bg-white disabled:opacity-50" />
            <span className="pointer-events-auto">
              <GraphicsToggle dark />
            </span>
          </>
        )}
        <button className="pointer-events-auto rounded-md bg-white/90 px-3 py-1.5 text-sm font-medium text-ink shadow hover:bg-white" onClick={onClose}>
          Close walkthrough
        </button>
      </div>
    </div>
  );
}

/** The dot in the middle while walking, and what it's on (or what's being placed, and whether it fits there). */
export function AimDot({ design, aimText, aimable, carry }: { design: boolean; aimText?: string; aimable: boolean; carry: { label: string; ok: boolean; problem?: string; note?: string; keys: string } | null }) {
  return (
    <>
      <div className={`pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 ring-black/40 ${design ? "size-2.5 bg-accent ring-white/80" : "size-1.5 bg-white/80"}`} />
      {(carry || (design && aimText)) && (
        <div className="pointer-events-none absolute top-1/2 left-1/2 mt-5 -translate-x-1/2 rounded-md bg-black/65 px-3 py-1.5 text-center text-sm text-white" data-testid="aim-label">
          {carry ? (
            <>
              <span className="font-medium">{carry.label}</span>
              <span className={carry.ok ? "text-white/80" : "text-red-300"}>{carry.ok ? ` · ${carry.note ?? "click to put it down"}` : ` · ${carry.problem ?? "it can't go there"}`}</span>
              <span className="block text-xs text-white/60">{carry.keys}</span>
            </>
          ) : (
            <>
              {aimText}
              {aimable && <span className="text-white/60"> · click to change</span>}
            </>
          )}
        </div>
      )}
    </>
  );
}

/** "Click to walk" and the keys, shown before walking starts. */
export function WalkHelp({ onStart }: { onStart: () => void }) {
  return (
    <>
      <button className="absolute inset-0 cursor-pointer bg-black/25" onClick={onStart} aria-label="Start walking" />
      <div className="pointer-events-none absolute top-1/2 left-1/2 w-[min(92vw,440px)] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white/95 p-5 text-center shadow-lg">
        <p className="text-base font-semibold">Click to walk</p>
        <ul className="mt-2 space-y-0.5 text-sm text-muted">
          <li>Move the mouse to look around</li>
          <li>W A S D or the arrow keys to walk</li>
          <li>Hold Shift to walk faster</li>
          <li>E turns Design on. Finishes: aim at a floor, wall, counter, or outside at the siding, roof, doors and yard, and click to pick its finish</li>
          <li>F opens Place: furniture, fixtures, cabinets, outlets, hookups, built-ins, doors, windows and walls. Aim at anything placed and click to move, turn, size, swap or delete it. Stair railings are there too: aim at one and click to change its kind or look, or press Delete to remove it. Tab switches between Finishes and Place</li>
          <li>I opens Interior design (style, mood board, finishes room by room) and X opens Exterior design (roof, siding, windows, doors, yard). The house changes as you pick; Esc closes it</li>
          <li>M shows this floor from above with the Furnish tools; M or Esc comes back</li>
          <li>Walk into a door to open it, or click it to open and close it by hand. K locks the door you aim at (a locked door only opens when clicked). O changes the Doors setting</li>
          <li>L shows room labels on the floor (the ⚙ button sets what they say). Shift+L locks them to the floor plan&apos;s direction instead of turning with you</li>
          <li>T is the tape measure: click two points. Shift keeps it level or upright, C clears</li>
          <li>P pins a measurement so it stays. Aim at a pin and click to delete it</li>
          <li>Esc to stop, and Esc again to close</li>
        </ul>
      </div>
    </>
  );
}

/** Time of day, season, and jumping around. Hidden while walking so the mouse stays in the view. */
export function WalkControls(props: {
  hour: number;
  sunrise: number;
  sunset: number;
  daylightSaving: boolean;
  season: SeasonId;
  world: ReturnType<typeof walkWorld>;
  doorMode: DoorMode;
  onDoorMode: (m: DoorMode) => void;
  onHour: (h: number) => void;
  onSeason: (s: SeasonId) => void;
  onJump: (spot: Spot, keepYaw?: boolean) => void;
}) {
  const { hour, sunrise, sunset, daylightSaving, season, world, doorMode, onDoorMode, onHour, onSeason, onJump } = props;
  const place = usePlace();
  return (
    <div className="absolute right-0 bottom-0 left-0 flex flex-wrap items-end gap-x-6 gap-y-3 bg-black/60 px-4 py-3 text-white">
      <label className="min-w-[240px] flex-1 text-sm">
        <span className="flex justify-between text-xs text-white/75">
          <span>Time of day</span>
          <span data-testid="walk-time">{clockTime(hour, daylightSaving, place)}</span>
        </span>
        <input type="range" className="mt-1 w-full accent-white" min={sunrise} max={sunset} step={0.25} value={hour} onChange={(e) => onHour(Number(e.target.value))} aria-label="Time of day" />
        <span className="flex justify-between text-[11px] text-white/60">
          <span>Sunrise {clockTime(sunrise, daylightSaving, place)}</span>
          <span>Sunset {clockTime(sunset, daylightSaving, place)}</span>
        </span>
      </label>
      <div className="text-sm">
        <span className="block text-xs text-white/75">Season</span>
        <div className="mt-1 flex overflow-hidden rounded-md border border-white/30" role="radiogroup" aria-label="Season">
          {SEASONS.map((s) => (
            <button key={s.id} role="radio" aria-checked={season === s.id} onClick={() => onSeason(s.id)} className={`px-3 py-1 text-sm ${season === s.id ? "bg-white text-ink" : "hover:bg-white/15"}`}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className="text-sm">
        <span className="block text-xs text-white/75">Doors</span>
        <DoorsPicker dark value={doorMode} onChange={onDoorMode} />
      </div>
      <label className="text-sm">
        <span className="block text-xs text-white/75">Go to</span>
        <select
          className="mt-1 rounded-md border border-white/30 bg-black/40 px-2 py-1 text-sm"
          value=""
          onChange={(e) => {
            const v = e.target.value;
            if (v === "front") onJump(world.start, false);
            else {
              const r = world.rooms.find((x) => `${x.levelId}:${x.id}` === v);
              if (r) onJump(r.spot);
            }
          }}
        >
          <option value="" disabled>
            Pick a room…
          </option>
          <option value="front">The front door (outside)</option>
          {world.levels.map((l) => (
            <optgroup key={l.id} label={l.name}>
              {world.rooms
                .filter((r) => r.levelId === l.id)
                .map((r) => (
                  <option key={r.id} value={`${r.levelId}:${r.id}`}>
                    {r.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
    </div>
  );
}
