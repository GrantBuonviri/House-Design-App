"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createProject, duplicateProject } from "@/lib/model/project";
import type { Project } from "@/lib/model/schema";
import {
  DELETED_DAYS,
  deleteProject,
  listDeleted,
  listProjects,
  loadProject,
  saveProject,
  type DeletedSummary,
  type ProjectSummary,
} from "@/lib/storage/db";
import { importAnyJson } from "@/lib/storage/exchange";
import { downloadAllProjects, downloadProject } from "@/lib/download";
import { STAGE_INFO, shownStage } from "@/lib/stages";
import { houseThumb, shownHouses, type HouseSort, type HouseThumb } from "@/lib/home/cards";
import BackupsList from "./BackupsList";
import RecentlyDeleted from "./RecentlyDeleted";
import { formatDate } from "./formatDate";

function ThumbPicture({ thumb }: { thumb: HouseThumb | null }) {
  return (
    <div className="mb-3 flex h-32 items-center justify-center rounded-md bg-accent-soft/40">
      {thumb ? (
        <svg viewBox={thumb.box.join(" ")} className="h-full w-full p-2" role="img" aria-label="Floor plan picture">
          {thumb.rooms.map((pts, i) => (
            <polygon key={i} points={pts} fill="white" stroke="currentColor" strokeWidth={thumb.box[2] / 120} strokeLinejoin="round" className="text-ink" />
          ))}
          {thumb.walls.map((w, i) => (
            <line key={i} x1={w[0]} y1={w[1]} x2={w[2]} y2={w[3]} stroke="currentColor" strokeWidth={thumb.box[2] / 120} className="text-ink" />
          ))}
        </svg>
      ) : (
        <span className="text-xs text-muted">No floor plan yet</span>
      )}
    </div>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [deleted, setDeleted] = useState<DeletedSummary[]>([]);
  /** The house card showing its backups, or null. */
  const [backupsOf, setBackupsOf] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<HouseSort>("edited");
  /** Each house's floor plan picture; null when nothing is drawn yet or its data won't open. */
  const [thumbs, setThumbs] = useState<Record<string, HouseThumb | null>>({});

  async function refresh() {
    const list = await listProjects();
    setProjects(list);
    setDeleted(await listDeleted());
    const next: Record<string, HouseThumb | null> = {};
    for (const s of list) {
      try {
        const p = await loadProject(s.id);
        next[s.id] = p ? houseThumb(p) : null;
      } catch {
        next[s.id] = null;
      }
    }
    setThumbs(next);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const p = createProject(newName);
    await saveProject(p);
    router.push(`/project/${p.id}`);
  }

  /** Load a house, or say why it can't be loaded. */
  async function loadSafely(id: string) {
    try {
      return await loadProject(id);
    } catch {
      setMessage({ kind: "error", text: "That house's saved data is damaged, so it can't be opened." });
      return null;
    }
  }

  async function handleRename(id: string) {
    const name = renameText.trim();
    setRenamingId(null);
    if (!name) return;
    const p = await loadSafely(id);
    if (!p) return;
    await saveProject({ ...p, name, updatedAt: new Date().toISOString() });
    await refresh();
  }

  async function handleDuplicate(id: string) {
    const p = await loadSafely(id);
    if (!p) return;
    await saveProject(duplicateProject(p));
    await refresh();
  }

  async function handleExport(id: string) {
    const p = await loadSafely(id);
    if (p) downloadProject(p);
  }

  async function handleDelete(summary: ProjectSummary) {
    if (!confirm(`Delete "${summary.name}"? It goes to Recently deleted at the bottom of this page, where you can restore it for ${DELETED_DAYS} days.`)) return;
    await deleteProject(summary.id);
    await refresh();
  }

  /** Download every house in one file. Houses that won't open are left out and named. */
  async function handleExportAll() {
    const all: Project[] = [];
    const damaged: string[] = [];
    for (const s of projects ?? []) {
      try {
        const p = await loadProject(s.id);
        if (p) all.push(p);
      } catch {
        damaged.push(s.name);
      }
    }
    if (all.length) downloadAllProjects(all);
    if (damaged.length) setMessage({ kind: "error", text: `Left out because its saved data is damaged: ${damaged.join(", ")}.` });
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const taken = new Set((projects ?? []).map((p) => p.id));
      const { projects: imported, skipped } = importAnyJson(await file.text(), taken);
      for (const p of imported) await saveProject(p);
      await refresh();
      const what = imported.length === 1 ? `"${imported[0].name}"` : `${imported.length} houses`;
      const left = skipped ? ` ${skipped} ${skipped === 1 ? "house was" : "houses were"} damaged and left out.` : "";
      setMessage({ kind: skipped ? "error" : "info", text: `Imported ${what}.${left}` });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Import failed." });
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your houses</h1>
          <p className="mt-1 text-sm text-muted">
            Houses are saved in this browser, with backups kept automatically. Export all houses to keep a copy outside it.
          </p>
        </div>
        <div className="flex gap-2">
          {!!projects?.length && (
            <button className="btn" onClick={() => void handleExportAll()}>
              Export all houses
            </button>
          )}
          <button className="btn" onClick={() => fileInput.current?.click()}>
            Import
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={handleImport}
          />
          <button className="btn-primary" onClick={() => setCreating(true)}>
            New project
          </button>
        </div>
      </div>

      {message && (
        <div
          className={`mb-6 flex items-center justify-between rounded-md px-4 py-3 text-sm ${
            message.kind === "error" ? "bg-red-50 text-red-800" : "bg-accent-soft text-accent"
          }`}
        >
          <span>{message.text}</span>
          <button className="text-xs underline" onClick={() => setMessage(null)}>
            Dismiss
          </button>
        </div>
      )}

      {creating && (
        <form onSubmit={handleCreate} className="card mb-8 flex items-end gap-3 p-5">
          <div className="flex-1">
            <label className="field-label" htmlFor="new-name">
              What should we call this house?
            </label>
            <input
              id="new-name"
              autoFocus
              className="input"
              placeholder="e.g. Foothills cabin"
              value={newName}
              maxLength={120}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <button type="button" className="btn" onClick={() => setCreating(false)}>
            Cancel
          </button>
          <button type="submit" className="btn-primary">
            Create
          </button>
        </form>
      )}

      {projects === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : projects.length === 0 && !creating ? (
        <div className="card flex flex-col items-center px-6 py-16 text-center">
          <h2 className="text-lg font-semibold">No houses yet</h2>
          <p className="mt-2 max-w-md text-sm text-muted">
            Start a project, tell us a little about who will live there, then pick land and
            sketch the house.
          </p>
          <button className="btn-primary mt-6" onClick={() => setCreating(true)}>
            Start your first house
          </button>
        </div>
      ) : (
        <>
        {projects.length > 1 && (
          <div className="mb-4 flex items-center gap-3">
            <input
              className="input max-w-xs"
              type="search"
              aria-label="Search your houses"
              placeholder="Search your houses"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <label className="flex items-center gap-2 whitespace-nowrap text-sm text-muted">
              Sort by
              <select className="input" value={sort} onChange={(e) => setSort(e.target.value as HouseSort)}>
                <option value="edited">Last edited</option>
                <option value="name">Name (A to Z)</option>
              </select>
            </label>
          </div>
        )}
        {shownHouses(projects, query, sort).length === 0 && (
          <p className="text-sm text-muted">No house has &ldquo;{query}&rdquo; in its name.</p>
        )}
        <ul className="grid grid-cols-3 gap-4">
          {shownHouses(projects, query, sort).map((p) => (
            <li
              key={p.id}
              className="card flex cursor-pointer flex-col p-5 hover:border-accent"
              onClick={(e) => {
                if (renamingId !== p.id && !(e.target as HTMLElement).closest("button, input, a, form")) {
                  router.push(`/project/${p.id}`);
                }
              }}
            >
              <ThumbPicture thumb={thumbs[p.id] ?? null} />
              {renamingId === p.id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleRename(p.id);
                  }}
                >
                  <input
                    autoFocus
                    className="input"
                    value={renameText}
                    maxLength={120}
                    onChange={(e) => setRenameText(e.target.value)}
                    onBlur={() => void handleRename(p.id)}
                    onKeyDown={(e) => e.key === "Escape" && setRenamingId(null)}
                  />
                </form>
              ) : (
                <button
                  className="text-left text-lg font-semibold hover:text-accent"
                  onClick={() => router.push(`/project/${p.id}`)}
                >
                  {p.name}
                </button>
              )}
              <p className="mt-1 text-xs text-muted">
                {STAGE_INFO.find((s) => s.id === shownStage(p.stage))?.label} · edited {formatDate(p.updatedAt)}
              </p>
              <div className="mt-5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                <button className="font-medium text-accent hover:underline" onClick={() => router.push(`/project/${p.id}`)}>
                  Open
                </button>
                <button
                  className="hover:text-ink"
                  onClick={() => {
                    setRenamingId(p.id);
                    setRenameText(p.name);
                  }}
                >
                  Rename
                </button>
                <button className="hover:text-ink" onClick={() => void handleDuplicate(p.id)}>
                  Duplicate
                </button>
                <button className="hover:text-ink" onClick={() => void handleExport(p.id)}>
                  Export
                </button>
                <button
                  className={backupsOf === p.id ? "text-ink" : "hover:text-ink"}
                  onClick={() => setBackupsOf(backupsOf === p.id ? null : p.id)}
                >
                  Backups
                </button>
                <button className="hover:text-red-700" onClick={() => void handleDelete(p)}>
                  Delete
                </button>
              </div>
              {backupsOf === p.id && (
                <BackupsList
                  projectId={p.id}
                  onRestored={(name) => {
                    void refresh();
                    setMessage({ kind: "info", text: `Restored the backup of "${name}".` });
                  }}
                />
              )}
            </li>
          ))}
        </ul>
        </>
      )}

      <RecentlyDeleted
        houses={deleted}
        onChange={(text) => {
          void refresh();
          if (text) setMessage({ kind: text.includes("damaged") ? "error" : "info", text });
        }}
      />
    </main>
  );
}
