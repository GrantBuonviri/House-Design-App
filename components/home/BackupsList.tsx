"use client";

import { useEffect, useState } from "react";
import { listBackups, restoreBackup, type BackupSummary } from "@/lib/storage/db";
import { formatDate } from "./formatDate";

/** A house card's backups, newest first, each with "Restore this backup". */
export default function BackupsList({ projectId, onRestored }: { projectId: string; onRestored: (name: string) => void }) {
  const [backups, setBackups] = useState<BackupSummary[] | null>(null);

  useEffect(() => {
    void listBackups(projectId).then(setBackups);
  }, [projectId]);

  async function restore(b: BackupSummary) {
    if (!confirm(`Go back to the backup from ${formatDate(b.at)}? The house as it is now is kept as a backup too.`)) return;
    try {
      const p = await restoreBackup(b.id);
      if (p) onRestored(p.name);
    } catch {
      alert("That backup is damaged, so it can't be restored.");
    }
    setBackups(await listBackups(projectId));
  }

  if (backups === null) return <p className="mt-3 text-xs text-muted">Loading backups…</p>;
  return (
    <div className="mt-3 rounded-md border border-line bg-paper px-3 py-2" data-testid="backups">
      {backups.length === 0 ? (
        <p className="text-xs text-muted">
          No backups yet. One is kept each time you close this house after changing it, and every 15 minutes while you work.
        </p>
      ) : (
        <ul className="space-y-1">
          {backups.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-2 text-xs">
              <span>{formatDate(b.at)}</span>
              <button className="font-medium text-accent hover:underline" onClick={() => void restore(b)}>
                Restore this backup
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
