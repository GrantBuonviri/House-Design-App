"use client";

import type { Point } from "@/lib/model/schema";
import FurnishStage from "@/components/furnish/FurnishStage";

/**
 * The walkthrough's top-down view (key M): the Furnish page's canvas and
 * tools over the whole screen, on the floor you were on, with a "you are
 * here" marker. M or Esc goes back to walking at the same spot; the walk
 * view rebuilds with whatever changed.
 */
export default function TopDown({ here, onBack }: { here: { levelId: string; p: Point; dir: Point }; onBack: () => void }) {
  return (
    <div className="absolute inset-0 z-30 overflow-y-auto bg-[var(--color-paper)] px-6 pt-5" data-testid="top-down">
      <FurnishStage initialLevelId={here.levelId} onContinue={onBack} onGoToPlan={onBack} walk={{ here, onBack }} />
    </div>
  );
}
