"use client";

import type { CatalogEntry } from "@/lib/furnish/catalog";
import { FURNISH_PRESETS, type FurnishPreset } from "@/lib/furnish/autoFurnish";
import FurnishCatalog from "@/components/furnish/FurnishCatalog";

export type DesignTab = "finishes" | "place";

/** The two tabs at the top of the walkthrough's Design panel. Tab switches between them. */
export function DesignTabs({ tab, onTab }: { tab: DesignTab; onTab: (t: DesignTab) => void }) {
  return (
    <div className="flex overflow-hidden rounded-md border border-line text-sm" role="tablist" aria-label="Design" data-testid="design-tabs">
      {(["finishes", "place"] as const).map((t) => (
        <button key={t} role="tab" aria-selected={tab === t} onClick={() => onTab(t)} className={`flex-1 px-3 py-1.5 ${tab === t ? "bg-ink text-white" : "hover:bg-stone-100"}`} data-testid={`design-tab-${t}`}>
          {t === "finishes" ? "Finishes" : "Place"}
        </button>
      ))}
    </div>
  );
}

/** The Finishes tab before anything is clicked. */
export function FinishesHelp({ onOpenWindow }: { onOpenWindow?: (kind: "interior" | "exterior") => void }) {
  return (
    <div className="space-y-2 text-sm text-muted" data-testid="finishes-help">
      <p>Aim at a floor, a wall, a counter, a fixture or a door and click to pick its finish. Outside, aim at the siding, the roof, the windows or the yard.</p>
      <p>Furniture, built-ins and outlets can be clicked here too, to move or change them. Tab switches to Place.</p>
      {onOpenWindow && (
        <div className="space-y-1.5 pt-1">
          <p>To pick a style and finishes for the whole house or room by room:</p>
          <button className="btn w-full justify-center" onClick={() => onOpenWindow("interior")} data-testid="open-interior-window">
            Open Interior design (I)
          </button>
          <button className="btn w-full justify-center" onClick={() => onOpenWindow("exterior")} data-testid="open-exterior-window">
            Open Exterior design (X)
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The Place tab: everything Furnish can put in the house, by group with a
 * search box (furniture too), and Furnish for me for the room you're in
 * (Minimal or Full, shown see-through in the house before it's put in).
 */
export function PlaceTab(props: {
  picked: string | null;
  onPick: (e: CatalogEntry) => void;
  roomName: string | null;
  canFurnish: boolean;
  preset: FurnishPreset;
  onPreset: (p: FurnishPreset) => void;
  /** What the preview would put in, by room, while one is shown. */
  preview: { room: string; items: string }[] | null;
  onPreview: () => void;
  onFurnishForMe: () => void;
  onCancelPreview: () => void;
  notes: string[];
  onAddRailing?: () => void;
}) {
  const { picked, onPick, roomName, canFurnish, preset, onPreset, preview, onPreview, onFurnishForMe, onCancelPreview, notes, onAddRailing } = props;
  return (
    <div className="space-y-3" data-testid="place-tab">
      <p className="text-xs text-muted">
        Pick something, then aim where it goes and click. Floor things back onto a wall when they&apos;re close; wall things stick flat to the wall you aim at, and the scroll wheel raises or lowers shelves and cabinets. R turns it, Esc cancels. Doors and windows go on the wall you aim at. For a wall, click where it starts and where it ends.
      </p>
      <FurnishCatalog isPicked={(e) => e.id === picked} onPick={onPick} />
      {onAddRailing && (
        <div className="card space-y-2 p-3 text-sm" data-testid="walk-add-railing">
          <h3 className="text-sm font-semibold">Stair railing</h3>
          <p className="text-xs text-muted">Aim at a side of the stairs or stairwell with no railing and click to add one. Click a railing that&apos;s there to change or remove it.</p>
          <button className="btn w-full justify-center" onClick={onAddRailing} data-testid="walk-add-railing-go">
            Add a railing
          </button>
        </div>
      )}
      <div className="card space-y-2 p-3 text-sm" data-testid="walk-furnish-for-me">
        <h3 className="text-sm font-semibold">Furnish for me</h3>
        <div className="flex overflow-hidden rounded-md border border-line" role="radiogroup" aria-label="How much to put in">
          {FURNISH_PRESETS.map((pr) => (
            <button key={pr.id} role="radio" aria-checked={preset === pr.id} className={`flex-1 px-2 py-1 text-xs ${preset === pr.id ? "bg-ink font-medium text-white" : "hover:bg-stone-100"}`} onClick={() => onPreset(pr.id)} data-testid={`walk-furnish-preset-${pr.id}`}>
              {pr.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted">{roomName ? `${FURNISH_PRESETS.find((pr) => pr.id === preset)!.hint} It skips anything already in the ${roomName.toLowerCase()}.` : "Walk into a room first."}</p>
        {preview ? (
          <div className="space-y-2 rounded-md bg-sky-50 p-2" data-testid="walk-furnish-preview">
            <p className="text-xs font-medium">Shown see-through in blue in the room. Nothing is saved yet.</p>
            <ul className="space-y-1 text-xs">
              {preview.map((l, i) => (
                <li key={i}>
                  <span className="font-medium">{l.room}:</span> {l.items}
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <button className="btn-primary flex-1 justify-center" onClick={onFurnishForMe} data-testid="walk-furnish-for-me-go">
                Put these in
              </button>
              <button className="btn flex-1 justify-center" onClick={onCancelPreview}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button className="btn-primary w-full" disabled={!canFurnish} onClick={onPreview} data-testid="walk-furnish-for-me-preview">
            {roomName ? `Preview: furnish the ${roomName.toLowerCase()}` : "Furnish for me"}
          </button>
        )}
        {notes.length > 0 && (
          <ul className="list-disc space-y-1 pl-4 text-xs text-amber-900">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
