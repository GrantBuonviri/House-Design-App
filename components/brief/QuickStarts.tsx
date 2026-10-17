"use client";

import { useEffect, useState } from "react";
import type { DiscoveryAnswers } from "@/lib/model/schema";
import { allStarts, cleanStartName, startFromAnswers, startPatch, type QuickStart, type SavedStart } from "@/lib/brief/starts";
import { deleteStart, listStarts, renameStart, saveStart } from "@/lib/storage/db";
import { newId } from "@/lib/model/project";

/** "Start from a typical house" at the top of the rooms page: three built-in starts and the user's own saved ones. */
export default function QuickStarts({
  answers: a,
  setAnswers,
}: {
  answers: DiscoveryAnswers;
  setAnswers: (patch: Partial<DiscoveryAnswers>, key: string) => void;
}) {
  const [saved, setSaved] = useState<SavedStart[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState("");

  const refresh = async () => {
    try {
      setSaved(await listStarts());
      setError("");
    } catch {
      setError("Saved quick starts can't be read in this browser right now.");
    }
  };
  useEffect(() => {
    void refresh();
  }, []);

  const apply = (s: QuickStart) => {
    if (a.rooms.length > 0 && !window.confirm(`Replace your rooms? "${s.name}" will take the place of the ${a.rooms.length} you have now. You can undo it.`)) return;
    setAnswers(startPatch(s.answers), `start.${s.id}`);
  };

  const save = async () => {
    const name = cleanStartName(saving ?? "");
    if (!name) return;
    try {
      await saveStart({ id: newId(), name, updatedAt: new Date().toISOString(), answers: startFromAnswers(a) });
      setSaving(null);
      await refresh();
    } catch {
      setError("That quick start couldn't be saved.");
    }
  };

  const rename = async () => {
    const name = cleanStartName(renaming?.name ?? "");
    if (!renaming || !name) return;
    await renameStart(renaming.id, name);
    setRenaming(null);
    await refresh();
  };

  const remove = async (s: QuickStart) => {
    if (!window.confirm(`Delete the quick start "${s.name}"? Houses you already made from it are not changed.`)) return;
    await deleteStart(s.id);
    await refresh();
  };

  return (
    <section className="card p-6" data-testid="quick-starts">
      <h3 className="font-semibold">Start from a typical house</h3>
      <p className="mb-4 text-sm text-muted">Fills in the floors and rooms for you. Change anything after. Sizes are left for the app to pick.</p>
      <ul className="grid grid-cols-3 gap-3">
        {allStarts(saved).map((s) => (
          <li key={s.id} className="flex flex-col rounded-md border border-line bg-white p-3" data-testid="quick-start">
            {renaming?.id === s.id ? (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void rename();
                }}
              >
                <input className="input" autoFocus aria-label="New name" maxLength={60} value={renaming.name} onChange={(e) => setRenaming({ id: s.id, name: e.target.value })} />
                <button className="btn" type="submit" disabled={!cleanStartName(renaming.name)}>
                  Save
                </button>
              </form>
            ) : (
              <>
                <button type="button" className="text-left" onClick={() => apply(s)} aria-label={`Use ${s.name}`}>
                  <span className="block font-medium">{s.name}</span>
                  <span className="block text-xs text-muted">{s.blurb}</span>
                </button>
                {!s.builtIn && (
                  <div className="mt-2 flex gap-3 text-xs">
                    <button type="button" className="text-accent hover:underline" onClick={() => setRenaming({ id: s.id, name: s.name })}>
                      Rename
                    </button>
                    <button type="button" className="text-muted hover:text-red-700" onClick={() => void remove(s)}>
                      Delete
                    </button>
                  </div>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-4">
        {saving === null ? (
          <button type="button" className="text-sm text-accent hover:underline disabled:opacity-50" disabled={a.rooms.length === 0} onClick={() => setSaving("")}>
            Save as a quick start
          </button>
        ) : (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <input className="input max-w-xs" autoFocus aria-label="Name for your quick start" placeholder="Name, for example Lake cabin" maxLength={60} value={saving} onChange={(e) => setSaving(e.target.value)} />
            <button className="btn-primary" type="submit" disabled={!cleanStartName(saving)}>
              Save
            </button>
            <button className="btn" type="button" onClick={() => setSaving(null)}>
              Cancel
            </button>
            <span className="text-xs text-muted">Keeps these floors, rooms, connections, feel and priorities for any house.</span>
          </form>
        )}
        {a.rooms.length === 0 && saving === null && <span className="ml-2 text-xs text-muted">Check a room first.</span>}
        {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      </div>
    </section>
  );
}
