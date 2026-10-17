"use client";

/**
 * The Anchor / Unanchor button for stairs and their stair halls (see
 * lib/plan/anchor.ts), with one line saying what it does.
 */
export default function AnchorBox({ anchored, hall, onAnchor }: { anchored: boolean; hall?: boolean; onAnchor: (on: boolean) => void }) {
  return (
    <div className={`mb-4 rounded border p-2 text-xs ${anchored ? "border-accent/40 bg-accent/10" : "border-line"}`} data-testid="anchor-box">
      {anchored ? (
        <p>
          <span className="font-semibold">⚓ Anchored.</span>{" "}
          {hall
            ? "This stair hall is locked to the stairs and lines up on every floor. Its walls can still be moved, up to 3' past the stairs; doors and windows are per floor."
            : "These stairs and their stair halls are locked on every floor. Railings can still be changed in Furnish."}
        </p>
      ) : (
        <p>
          {hall
            ? "This stair hall moves with its stairs on every floor, and stays no bigger than the stairs plus 3' at each end."
            : "Locks these stairs and their stair halls on every floor so they line up and can't be moved by accident."}
        </p>
      )}
      <button className="btn mt-2 w-full text-sm" onClick={() => onAnchor(!anchored)} data-testid="anchor-button">
        {anchored ? "Unanchor" : "Anchor"}
      </button>
    </div>
  );
}
