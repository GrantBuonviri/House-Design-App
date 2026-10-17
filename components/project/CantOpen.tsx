"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { downloadSavedData } from "@/lib/download";
import { loadRawProject, repairSavedProject } from "@/lib/storage/db";
import type { RepairResult } from "@/lib/model/repair";
import BackupsList from "@/components/home/BackupsList";

/**
 * The screen for a house that can't be opened: why, its backups, "Download
 * its saved data" (the raw file), and, for damaged data, "Try to repair".
 * `onOpen` opens the house again after a repair or a restored backup.
 */
export default function CantOpen({ id, message, damaged, onOpen }: { id: string; message: string; damaged: boolean; onOpen: (repair?: RepairResult) => void }) {
  const [raw, setRaw] = useState<unknown>(undefined);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    void loadRawProject(id).then(setRaw, () => setRaw(null));
  }, [id]);

  const name = raw && typeof raw === "object" && typeof (raw as { name?: unknown }).name === "string" ? (raw as { name: string }).name : "house";

  async function repair() {
    if (!confirm("Try to repair puts the parts that don't read back to their defaults, and may take out a broken room or wall. Download its saved data first if you want a copy of it as it is now. Repair it?")) return;
    setBusy(true);
    setFailed(null);
    try {
      const result = await repairSavedProject(id);
      if (result) onOpen(result);
      else setFailed("This house isn't in this browser anymore.");
    } catch (e) {
      console.error("Repair failed", e);
      setFailed(e instanceof Error && e.message.includes("newer version") ? e.message : "The repair didn't work. Download its saved data to keep it.");
    }
    setBusy(false);
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10" data-testid="cant-open">
      <h1 className="text-xl font-semibold">This house can&apos;t be opened</h1>
      <p className="mt-2 text-sm">{message}</p>
      <div className="mt-5 flex flex-wrap gap-2">
        {damaged && (
          <button className="btn btn-primary" disabled={busy} onClick={() => void repair()} data-testid="repair">
            {busy ? "Repairing…" : "Try to repair"}
          </button>
        )}
        <button className="btn" disabled={!raw} onClick={() => downloadSavedData(raw, name)} data-testid="download-raw">
          Download its saved data
        </button>
      </div>
      {failed && <p className="mt-3 text-sm text-red-700">{failed}</p>}
      <p className="mt-4 text-xs text-muted">
        {damaged
          ? "Try to repair keeps everything that still reads. The download is the saved data exactly as it is, to keep or to send to someone who can look at it."
          : "Update the app to open it (git pull, then npm install). The download is the saved data exactly as it is."}
      </p>
      <h2 className="mt-8 text-sm font-semibold">Or go back to a backup</h2>
      <BackupsList projectId={id} onRestored={() => onOpen()} />
      <Link href="/" className="mt-6 inline-block text-sm text-accent underline">
        Back to your houses
      </Link>
    </main>
  );
}
