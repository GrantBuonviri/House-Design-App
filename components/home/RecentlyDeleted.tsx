"use client";

import { useState } from "react";
import { DELETED_DAYS, deleteForever, restoreDeleted, type DeletedSummary } from "@/lib/storage/db";
import { formatDate } from "./formatDate";

/** Deleted houses kept for DELETED_DAYS, each with Restore and Delete forever. */
export default function RecentlyDeleted({
  houses,
  onChange,
}: {
  houses: DeletedSummary[];
  onChange: (message?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!houses.length) return null;

  async function restore(h: DeletedSummary) {
    try {
      const p = await restoreDeleted(h.id);
      onChange(p ? `Restored "${p.name}".` : undefined);
    } catch {
      onChange(`"${h.name}" is damaged, so it can't be restored.`);
    }
  }

  async function remove(h: DeletedSummary) {
    if (!confirm(`Delete "${h.name}" for good? This can't be undone.`)) return;
    await deleteForever(h.id);
    onChange();
  }

  return (
    <section className="mt-10" data-testid="recently-deleted">
      <button className="text-sm font-medium text-muted hover:text-ink" onClick={() => setOpen(!open)}>
        {open ? "▾" : "▸"} Recently deleted ({houses.length})
      </button>
      {open && (
        <div className="mt-3">
          <p className="mb-2 text-xs text-muted">Deleted houses are kept here for {DELETED_DAYS} days, then removed for good.</p>
          <ul className="divide-y divide-line rounded-md border border-line bg-white">
            {houses.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-4 px-4 py-2 text-sm">
                <span>
                  {h.name} <span className="text-xs text-muted">· deleted {formatDate(h.deletedAt)}</span>
                </span>
                <span className="flex gap-4 text-xs">
                  <button className="font-medium text-accent hover:underline" onClick={() => void restore(h)}>
                    Restore
                  </button>
                  <button className="text-muted hover:text-red-700" onClick={() => void remove(h)}>
                    Delete forever
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
