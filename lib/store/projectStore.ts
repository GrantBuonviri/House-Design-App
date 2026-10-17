"use client";

import { create } from "zustand";
import type { Project, Stage } from "@/lib/model/schema";
import { listBackups, loadHistory, loadProject, saveBackup, saveHistory, saveProject, type HistoryRow } from "@/lib/storage/db";
import { describeChange } from "./describe";
import { setCodeLocation } from "@/lib/codes/data";

/** Undo steps kept while a house is open. */
const HISTORY_LIMIT = 100;
/** Undo steps kept in the browser for next time the house is opened. */
export const SAVED_HISTORY = 30;
const AUTOSAVE_MS = 400;
/** A backup copy is kept after this much time editing, and when the house is closed. */
export const BACKUP_MS = 15 * 60_000;

export type SaveState = "saved" | "saving" | "unsaved" | "error";

export type HistoryItem = { index: number; label: string; current: boolean; undone: boolean };

type Version = { n: number; project: Project };

type State = {
  project: Project | null;
  loading: boolean;
  notFound: boolean;
  /** Why the house couldn't be opened (a damaged save), or null. */
  loadError: string | null;
  /** The house can't be opened because its saved data is damaged (not from a newer app), so it can be repaired. */
  damaged: boolean;
  saveState: SaveState;
  /**
   * Every version of the project, oldest first. versions[at] is the one open
   * now; the ones before it can be undone back to, the ones after it redone.
   */
  versions: Version[];
  at: number;
  canUndo: boolean;
  canRedo: boolean;
  /** A short note after undo or redo, like "Undid: move Kitchen". `id` changes each time. */
  notice: { text: string; id: number } | null;
  open: (id: string) => Promise<void>;
  /** Close the house, saving anything not saved yet. Resolves when that save is done. */
  close: () => Promise<void>;
  /**
   * Save now anything still waiting on the autosave timer (when the tab is
   * hidden or closed). `closing` (the tab is going away) also keeps a backup
   * of any edits since the last one.
   */
  flush: (opts?: { closing?: boolean }) => void;
  /**
   * Change the project. Every change is undoable and autosaved. Changes that
   * share a `coalesce` key within a second (like typing in one field) become
   * one undo step.
   */
  update: (change: (draft: Project) => Project, opts?: { coalesce?: string }) => void;
  /** Go to another stage. Not an undo step: undo and redo stay on the page you're on. */
  setStage: (stage: Stage) => void;
  undo: () => void;
  redo: () => void;
  /** Jump straight to any version in the list (see `historyList`). */
  goToVersion: (index: number) => void;
  /** The last steps by name, newest first, worked out when asked (the list is long and labels diff whole projects). */
  historyList: (limit?: number) => HistoryItem[];
  /** What Undo and Redo would do, like "move Kitchen", or null when there's nothing. */
  undoLabel: () => string | null;
  redoLabel: () => string | null;
};

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastCoalesce: { key: string; at: number } | null = null;
/** History versions changed since the last save. */
let dirty = new Set<number>();
/** When the last backup was kept (or the house opened), and whether it's been changed since. */
let lastBackupAt = 0;
let editedSinceBackup = false;

export const useProjectStore = create<State>((set, get) => {
  /** Set the versions and which one is open, keeping the flags in step. */
  function place(versions: Version[], at: number, project: Project) {
    set({ versions, at, project, canUndo: at > 0, canRedo: at < versions.length - 1 });
  }

  /** Save the open house; keep a backup too when `closing`, or BACKUP_MS after the last one, if it's been changed. */
  async function saveNow(closing = false) {
    const { project: p, versions, at } = get();
    if (!p) return;
    const backup = editedSinceBackup && (closing || Date.now() - lastBackupAt >= BACKUP_MS);
    if (backup) {
      editedSinceBackup = false;
      lastBackupAt = Date.now();
    }
    const changed = [...dirty];
    dirty = new Set();
    set({ saveState: "saving" });
    try {
      await saveProject(p);
      const from = Math.max(0, at - SAVED_HISTORY);
      const kept = versions.slice(from);
      const put: HistoryRow[] = kept.filter((v) => changed.includes(v.n)).map((v) => ({ projectId: p.id, n: v.n, project: v.project }));
      await saveHistory({ projectId: p.id, current: versions[at].n, first: kept[0].n, last: kept[kept.length - 1].n }, put);
      if (backup) await saveBackup(p);
      if (get().project === p) set({ saveState: "saved" });
    } catch (e) {
      console.error("Save failed", e);
      set({ saveState: "error" });
    }
  }

  function scheduleSave(...changed: number[]) {
    for (const n of changed) dirty.add(n);
    editedSinceBackup = true;
    set({ saveState: "unsaved" });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void saveNow();
    }, AUTOSAVE_MS);
  }

  /** Move to another saved version, staying on the page you're on. */
  function goTo(to: number) {
    lastCoalesce = null;
    const { versions, at, project } = get();
    if (!project || to < 0 || to >= versions.length || to === at) return;
    const label = to < at ? describeChange(versions[to].project, versions[at].project) : describeChange(versions[at].project, versions[to].project);
    const next = { ...versions[to].project, stage: project.stage };
    const list = versions.slice();
    list[to] = { n: versions[to].n, project: next };
    place(list, to, next);
    set({ notice: { text: `${to < at ? "Undid" : "Redid"}: ${label}`, id: Date.now() } });
    scheduleSave(versions[to].n);
  }

  return {
    project: null,
    loading: false,
    notFound: false,
    loadError: null,
    damaged: false,
    saveState: "saved",
    versions: [],
    at: 0,
    canUndo: false,
    canRedo: false,
    notice: null,

    async open(id) {
      set({ loading: true, notFound: false, loadError: null, damaged: false, project: null, versions: [], at: 0, canUndo: false, canRedo: false });
      dirty = new Set();
      lastBackupAt = Date.now();
      editedSinceBackup = false;
      let p: Project | null;
      try {
        p = await loadProject(id);
      } catch (e) {
        console.error("Couldn't open the house", e);
        const newer = e instanceof Error && e.message.includes("newer version");
        set({ loading: false, damaged: !newer, loadError: newer ? (e as Error).message : "This house's saved data is damaged, so it can't be opened." });
        return;
      }
      if (!p) {
        set({ loading: false, notFound: true });
        return;
      }
      // A closing tab can be gone before its backup is written: keep one now if the house changed after its newest backup.
      const opened = p;
      void listBackups(id)
        .then(([newest]) => {
          if (newest ? newest.at < opened.updatedAt : opened.updatedAt > opened.createdAt) return saveBackup(opened);
        })
        .catch((e) => console.error("Couldn't keep a backup", e));
      let versions: Version[] = [{ n: 0, project: p }];
      let at = 0;
      try {
        const saved = await loadHistory(id);
        const i = saved ? saved.versions.findIndex((v) => v.n === saved.meta.current) : -1;
        if (saved && i >= 0) {
          // The saved project is the truth for the open version (it may have been renamed from the home screen).
          // A rename from the home screen carries to the other versions too, so undo doesn't bring the old name back.
          const oldName = saved.versions[i].project.name;
          versions = saved.versions.map((v, j) => ({ n: v.n, project: j === i ? p : oldName !== p.name && v.project.name === oldName ? { ...v.project, name: p.name } : v.project }));
          at = i;
        }
      } catch (e) {
        console.error("Couldn't load undo history", e);
      }
      // With no saved history yet, the version opened is saved with the first change, so it can be undone back to.
      if (versions.length === 1) dirty.add(versions[0].n);
      set({ loading: false, saveState: "saved" });
      place(versions, at, p);
    },

    close() {
      lastCoalesce = null;
      // Save right away anything still waiting on the autosave timer, and keep a backup of this visit's edits.
      let saving = Promise.resolve();
      if (saveTimer) clearTimeout(saveTimer);
      if (get().project && (saveTimer || editedSinceBackup)) saving = saveNow(true);
      saveTimer = null;
      set({ project: null, versions: [], at: 0, canUndo: false, canRedo: false, notice: null, saveState: "saved" });
      return saving;
    },

    flush(opts) {
      const closing = !!opts?.closing && editedSinceBackup;
      if (!saveTimer && !closing) return;
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = null;
      void saveNow(closing);
    },

    update(change, opts) {
      const { project: current, versions, at } = get();
      if (!current) return;
      const next = { ...change(current), updatedAt: new Date().toISOString() };
      const now = Date.now();
      const merge =
        opts?.coalesce !== undefined &&
        lastCoalesce?.key === opts.coalesce &&
        now - lastCoalesce.at < 1000 &&
        at > 0;
      lastCoalesce = opts?.coalesce !== undefined ? { key: opts.coalesce, at: now } : null;
      // A new change drops anything that could have been redone.
      const kept = versions.slice(0, at + 1);
      if (merge) {
        kept[at] = { n: kept[at].n, project: next };
        place(kept, at, next);
        scheduleSave(kept[at].n);
        return;
      }
      const n = kept[at].n + 1;
      const list = [...kept, { n, project: next }].slice(-(HISTORY_LIMIT + 1));
      place(list, list.length - 1, next);
      scheduleSave(n);
    },

    setStage(stage) {
      const { project, versions, at } = get();
      if (!project || project.stage === stage) return;
      lastCoalesce = null;
      const next = { ...project, stage };
      const list = versions.slice();
      list[at] = { n: versions[at].n, project: next };
      place(list, at, next);
      scheduleSave(versions[at].n);
    },

    undo() {
      goTo(get().at - 1);
    },

    redo() {
      goTo(get().at + 1);
    },

    goToVersion(index) {
      goTo(index);
    },

    historyList(limit = SAVED_HISTORY) {
      const { versions, at } = get();
      const out: HistoryItem[] = [];
      // Step i is what changed between version i-1 and i; going to version i keeps that step.
      for (let i = versions.length - 1; i >= 1 && out.length < limit + (versions.length - 1 - at); i--) {
        out.push({ index: i, label: describeChange(versions[i - 1].project, versions[i].project), current: i === at, undone: i > at });
      }
      return out;
    },

    undoLabel() {
      const { versions, at } = get();
      return at > 0 ? describeChange(versions[at - 1].project, versions[at].project) : null;
    },

    redoLabel() {
      const { versions, at } = get();
      return at < versions.length - 1 ? describeChange(versions[at].project, versions[at + 1].project) : null;
    },
  };
});

// The code numbers follow the open project's place (open, edit, undo and redo all go through set()).
useProjectStore.subscribe((s) => setCodeLocation(s.project?.location));
