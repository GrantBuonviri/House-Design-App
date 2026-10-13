"use client";

import { create } from "zustand";
import type { Project } from "@/lib/model/schema";
import { loadProject, saveProject } from "@/lib/storage/db";

const HISTORY_LIMIT = 100;
const AUTOSAVE_MS = 400;

export type SaveState = "saved" | "saving" | "unsaved" | "error";

type State = {
  project: Project | null;
  loading: boolean;
  notFound: boolean;
  saveState: SaveState;
  past: Project[];
  future: Project[];
  open: (id: string) => Promise<void>;
  close: () => void;
  /**
   * Change the project. Every change is undoable and autosaved. Changes that
   * share a `coalesce` key within a second (like typing in one field) become
   * one undo step.
   */
  update: (change: (draft: Project) => Project, opts?: { coalesce?: string }) => void;
  undo: () => void;
  redo: () => void;
};

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastCoalesce: { key: string; at: number } | null = null;

export const useProjectStore = create<State>((set, get) => {
  function scheduleSave() {
    set({ saveState: "unsaved" });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const p = get().project;
      if (!p) return;
      set({ saveState: "saving" });
      try {
        await saveProject(p);
        if (get().project === p) set({ saveState: "saved" });
      } catch {
        set({ saveState: "error" });
      }
    }, AUTOSAVE_MS);
  }

  return {
    project: null,
    loading: false,
    notFound: false,
    saveState: "saved",
    past: [],
    future: [],

    async open(id) {
      set({ loading: true, notFound: false, project: null, past: [], future: [] });
      const p = await loadProject(id);
      set({ loading: false, project: p, notFound: !p, saveState: "saved" });
    },

    close() {
      lastCoalesce = null;
      // Save right away anything still waiting on the autosave timer.
      const p = get().project;
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
        if (p && get().saveState !== "saved") void saveProject(p);
      }
      set({ project: null, past: [], future: [], saveState: "saved" });
    },

    update(change, opts) {
      const current = get().project;
      if (!current) return;
      const next = { ...change(current), updatedAt: new Date().toISOString() };
      const now = Date.now();
      const merge =
        opts?.coalesce !== undefined &&
        lastCoalesce?.key === opts.coalesce &&
        now - lastCoalesce.at < 1000 &&
        get().past.length > 0;
      lastCoalesce = opts?.coalesce !== undefined ? { key: opts.coalesce, at: now } : null;
      set({
        project: next,
        past: merge ? get().past : [...get().past, current].slice(-HISTORY_LIMIT),
        future: [],
      });
      scheduleSave();
    },

    undo() {
      lastCoalesce = null;
      const { past, project, future } = get();
      if (!project || past.length === 0) return;
      set({
        project: past[past.length - 1],
        past: past.slice(0, -1),
        future: [project, ...future],
      });
      scheduleSave();
    },

    redo() {
      lastCoalesce = null;
      const { past, project, future } = get();
      if (!project || future.length === 0) return;
      set({ project: future[0], past: [...past, project], future: future.slice(1) });
      scheduleSave();
    },
  };
});
