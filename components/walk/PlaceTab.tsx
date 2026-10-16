"use client";

import type { CatalogEntry } from "@/lib/furnish/catalog";
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
export function FinishesHelp() {
  return (
    <div className="space-y-2 text-sm text-muted" data-testid="finishes-help">
      <p>Aim at a floor, a wall, a counter, a fixture or a door and click to pick its finish. Outside, aim at the siding, the roof, the windows or the yard.</p>
      <p>Furniture, built-ins and outlets can be clicked here too, to move or change them. Tab switches to Place.</p>
    </div>
  );
}

/**
 * The Place tab: everything Furnish can put in the house, by group with a
 * search box (furniture too), and Furnish for me for the room you're in.
 */
export function PlaceTab({ picked, onPick, roomName, canFurnish, onFurnishForMe, notes }: { picked: string | null; onPick: (e: CatalogEntry) => void; roomName: string | null; canFurnish: boolean; onFurnishForMe: () => void; notes: string[] }) {
  return (
    <div className="space-y-3" data-testid="place-tab">
      <p className="text-xs text-muted">
        Pick something, then aim where it goes and click. Floor things back onto a wall when they&apos;re close; wall things stick flat to the wall you aim at, and the scroll wheel raises or lowers shelves and cabinets. R turns it, Esc cancels. Doors and windows go on the wall you aim at. For a wall, click where it starts and where it ends.
      </p>
      <FurnishCatalog isPicked={(e) => e.id === picked} onPick={onPick} />
      <div className="card space-y-2 p-3 text-sm" data-testid="walk-furnish-for-me">
        <h3 className="text-sm font-semibold">Furnish for me</h3>
        <p className="text-xs text-muted">{roomName ? `Fills in what the ${roomName.toLowerCase()} needs, skipping anything already there.` : "Walk into a room first."}</p>
        <button className="btn-primary w-full" disabled={!canFurnish} onClick={onFurnishForMe} data-testid="walk-furnish-for-me-go">
          {roomName ? `Furnish the ${roomName.toLowerCase()} for me` : "Furnish for me"}
        </button>
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
