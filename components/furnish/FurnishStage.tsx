"use client";

/**
 * The Furnish stage: where fixtures, cabinets, outlets and hookups, built-ins
 * and furniture are placed, apart from the floor plan's walls and rooms.
 * The editor itself comes next; until then this page says so.
 */
export default function FurnishStage({ onContinue, onGoToPlan }: { onContinue: () => void; onGoToPlan: () => void }) {
  return (
    <div className="mx-auto max-w-2xl space-y-4 py-8" data-testid="furnish-stage">
      <h2 className="text-xl font-semibold">Furnish</h2>
      <p className="text-sm text-muted">
        Coming next: a separate editor for placing toilets, sinks, appliances, cabinets, outlets, water and gas hookups, built-ins and furniture, here in 2D and in the walkthrough. Walls,
        doors and windows stay on the floor plan.
      </p>
      <p className="text-sm text-muted">For now, fixtures are still placed with the Fixture tool on the floor plan.</p>
      <div className="flex gap-2">
        <button className="btn" onClick={onGoToPlan}>
          Back to the floor plan
        </button>
        <button className="btn-primary" onClick={onContinue} data-testid="furnish-continue">
          Next: interior →
        </button>
      </div>
    </div>
  );
}
