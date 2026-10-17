"use client";

import { useState } from "react";
import type { WalkView } from "@/lib/model/schema";

/** The walkthrough's saved camera spots: go to one, rename or delete it, save where you are, or take a screenshot. */
export function SavedViewsPanel({ views, onGo, onSave, onRename, onDelete, onScreenshot }: { views: WalkView[]; onGo: (v: WalkView) => void; onSave: () => void; onRename: (id: string, name: string) => void; onDelete: (id: string) => void; onScreenshot: () => void }) {
  return (
    <div className="space-y-3" data-testid="saved-views-panel">
      <div>
        <h3 className="text-sm font-semibold">Saved spots</h3>
        <p className="mt-1 text-xs text-muted">A saved spot keeps where you stood and which way you looked, so you can come back to the same view after changing things. While walking, V saves one and G takes a screenshot.</p>
      </div>
      <div className="flex gap-2">
        <button className="btn-primary flex-1 justify-center" onClick={onSave} data-testid="save-view">
          Save this spot (V)
        </button>
        <button className="btn flex-1 justify-center" onClick={onScreenshot} data-testid="screenshot">
          Screenshot (G)
        </button>
      </div>
      {views.length === 0 ? (
        <p className="text-sm text-muted">No saved spots yet.</p>
      ) : (
        <ul className="space-y-2">
          {views.map((v) => (
            <ViewRow key={v.id} view={v} onGo={() => onGo(v)} onRename={(name) => onRename(v.id, name)} onDelete={() => onDelete(v.id)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ViewRow({ view, onGo, onRename, onDelete }: { view: WalkView; onGo: () => void; onRename: (name: string) => void; onDelete: () => void }) {
  const [name, setName] = useState(view.name);
  return (
    <li className="flex items-center gap-2" data-testid="saved-view">
      <input
        className="input min-w-0 flex-1 text-sm"
        value={name}
        aria-label="Spot name"
        onChange={(e) => setName(e.target.value)}
        onBlur={() => (name.trim() ? onRename(name) : setName(view.name))}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      <button className="btn px-2 py-1 text-sm" onClick={onGo}>
        Go
      </button>
      <button className="px-1 text-sm text-red-700 hover:text-red-900" onClick={onDelete} aria-label={`Delete ${view.name}`}>
        Delete
      </button>
    </li>
  );
}
