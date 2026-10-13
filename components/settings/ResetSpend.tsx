"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function ResetSpend() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn"
      disabled={busy}
      onClick={async () => {
        if (!window.confirm("Start the spending tally over from zero? Saved answers are kept.")) return;
        setBusy(true);
        await fetch("/api/ai/spend", { method: "DELETE" });
        setBusy(false);
        router.refresh();
      }}
    >
      Reset tally
    </button>
  );
}
