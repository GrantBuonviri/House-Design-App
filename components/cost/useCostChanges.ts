"use client";

import { useEffect, useRef, useState } from "react";
import type { Project } from "@/lib/model/schema";
import type { Estimate } from "@/lib/cost/estimate";
import { changeNote, type CostChange } from "@/lib/cost/breakdown";
import { describeChange } from "@/lib/store/describe";

/** How long the estimate has to sit still before a change is noted, so a drag makes one note, not dozens. */
const SETTLE_MS = 900;
const KEEP = 5;

/**
 * "+$4,200: add a bathroom" notes, newest first. Each compares the estimate
 * once edits pause with where it stood at the last note, and names the edit
 * the way the Undo button does. Kept for this visit only.
 */
export function useCostChanges(project: Project | null, cost: Estimate | null): { changes: CostChange[]; latest: CostChange | null; dismiss: () => void } {
  const base = useRef<{ id: string; project: Project; total: number } | null>(null);
  const [changes, setChanges] = useState<CostChange[]>([]);
  const [latest, setLatest] = useState<CostChange | null>(null);

  useEffect(() => {
    if (!project || !cost) return;
    const b = base.current;
    if (!b || b.id !== project.id) {
      base.current = { id: project.id, project, total: cost.total.likely };
      if (b) setChanges([]);
      return;
    }
    const t = setTimeout(() => {
      const note = changeNote(b.total, cost.total.likely, describeChange(b.project, project));
      base.current = { id: project.id, project, total: cost.total.likely };
      if (!note) return;
      const c = { ...note, id: Date.now() };
      setChanges((list) => [c, ...list].slice(0, KEEP));
      setLatest(c);
    }, SETTLE_MS);
    return () => clearTimeout(t);
  }, [project, cost]);

  // The note by the top-bar total goes away after a few seconds; the panel keeps the list.
  useEffect(() => {
    if (!latest) return;
    const t = setTimeout(() => setLatest(null), 6000);
    return () => clearTimeout(t);
  }, [latest]);

  return { changes, latest, dismiss: () => setLatest(null) };
}
