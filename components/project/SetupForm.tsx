"use client";

import { useState } from "react";
import { useProjectStore } from "@/lib/store/projectStore";

export default function SetupForm({ onContinue }: { onContinue: () => void }) {
  const project = useProjectStore((s) => s.project)!;
  const update = useProjectStore((s) => s.update);
  const [nameDraft, setNameDraft] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Let&apos;s get started</h2>
        <p className="mt-1 text-sm text-muted">You can change these any time.</p>
      </div>

      <section className="card space-y-5 p-6">
        <div>
          <label className="field-label" htmlFor="owner-name">
            Your name
          </label>
          <input
            id="owner-name"
            className="input"
            maxLength={120}
            autoComplete="name"
            value={project.profile.ownerName ?? ""}
            onChange={(e) =>
              update(
                (p) => ({ ...p, profile: { ...p.profile, ownerName: e.target.value || undefined } }),
                { coalesce: "profile.ownerName" },
              )
            }
          />
        </div>
        <div>
          <label className="field-label" htmlFor="house-name">
            House name
          </label>
          <input
            id="house-name"
            className="input"
            maxLength={120}
            value={nameDraft ?? project.name}
            onChange={(e) => {
              const name = e.target.value;
              setNameDraft(name);
              if (name.trim()) update((p) => ({ ...p, name: name.trim() }), { coalesce: "name" });
            }}
            onBlur={() => setNameDraft(null)}
          />
        </div>
      </section>

      <div className="flex justify-end pb-10">
        <button className="btn-primary" onClick={onContinue}>
          Next: pick your land →
        </button>
      </div>
    </div>
  );
}
