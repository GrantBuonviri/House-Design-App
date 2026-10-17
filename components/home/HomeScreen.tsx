"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createProject, duplicateProject } from "@/lib/model/project";
import {
  deleteProject,
  listProjects,
  loadProject,
  saveProject,
  type ProjectSummary,
} from "@/lib/storage/db";
import { importProjectJson } from "@/lib/storage/exchange";
import { downloadProject } from "@/lib/download";
import { STAGE_INFO, shownStage } from "@/lib/stages";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function HomeScreen() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function refresh() {
    setProjects(await listProjects());
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
    if (!confirm(`Delete "${summary.name}"? This can't be undone. Export it first if you want a backup.`)) return;
    await deleteProject(summary.id);
    await refresh();
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const taken = new Set((projects ?? []).map((p) => p.id));
      const p = importProjectJson(await file.text(), taken);
      await saveProject(p);
      await refresh();
      setMessage({ kind: "info", text: `Imported "${p.name}".` });
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
            Projects are saved in this browser. Export one to keep a backup file.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn" onClick={() => fileInput.current?.click()}>
            Import project
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
        <ul className="grid grid-cols-3 gap-4">
          {projects.map((p) => (
            <li key={p.id} className="card flex flex-col p-5">
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
                <button className="hover:text-red-700" onClick={() => void handleDelete(p)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
