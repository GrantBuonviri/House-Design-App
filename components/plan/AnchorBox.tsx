"use client";

/**
 * The Anchor / Unanchor button for stairs (see lib/plan/anchor.ts), with one
 * line saying what it does.
 */
export default function AnchorBox({ anchored, onAnchor }: { anchored: boolean; onAnchor: (on: boolean) => void }) {
  return (
    <div className={`mb-4 rounded border p-2 text-xs ${anchored ? "border-accent/40 bg-accent/10" : "border-line"}`} data-testid="anchor-box">
      {anchored ? (
        <p>
          <span className="font-semibold">⚓ Anchored.</span>{" "}
          These stairs are locked on every floor they connect. Railings can still be changed in Furnish.
        </p>
      ) : (
        <p>Locks these stairs on every floor they connect so they line up and can&apos;t be moved by accident.</p>
      )}
      <button className="btn mt-2 w-full text-sm" onClick={() => onAnchor(!anchored)} data-testid="anchor-button">
        {anchored ? "Unanchor" : "Anchor"}
      </button>
    </div>
  );
}
