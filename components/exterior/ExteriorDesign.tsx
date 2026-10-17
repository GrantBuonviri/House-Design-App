"use client";

import { useMemo, useRef, useState } from "react";
import type { Selection } from "@/lib/model/schema";
import { useProjectStore } from "@/lib/store/projectStore";
import { effectiveAnswers } from "@/lib/interior/style";
import { EXTERIOR_QUESTIONS, effectiveExterior, exteriorBoard, exteriorGuesses } from "@/lib/exterior/style";
import { exteriorPartsFor } from "@/lib/exterior/picks";
import type { ExteriorCategoryId } from "@/lib/catalog/exterior";
import StyleQuestions from "@/components/interior/StyleQuestions";
import { DESIGN_STEPS, StepTabs, type DesignStep } from "@/components/interior/InteriorDesign";
import ExteriorBoard from "./ExteriorBoard";
import ExteriorPicker from "./ExteriorPicker";

const HINTS: Record<DesignStep, string> = {
  style: "A few questions about how the outside should look. The mood board and product picks follow your answers.",
  board: "Colors and products that fit your answers. Shuffle to see other matches.",
  pick: "Pick the roof, siding, windows, doors and yard. Real products, with links and prices.",
};

/**
 * Exterior design without a page around it: style questions, a mood board,
 * then products for each part of the outside and the yard. The walkthrough's
 * Exterior window (key X) shows it; it opens on `startPart` (the part you
 * were looking at) when that's one of this house's parts.
 */
export default function ExteriorDesign({ startPart }: { startPart?: ExteriorCategoryId | null }) {
  const project = useProjectStore((s) => s.project)!;
  const update = useProjectStore((s) => s.update);
  const exterior = project.exterior;
  const answered = Object.keys(exterior.answers).length > 0;
  const parts = useMemo(() => exteriorPartsFor(project), [project]);
  const start = startPart && parts.some((c) => c.id === startPart) ? startPart : null;
  const [step, setStep] = useState<DesignStep>(start || exterior.selections.length ? "pick" : answered ? "board" : "style");
  const [part, setPart] = useState<ExteriorCategoryId>(start ?? "roofing");
  const top = useRef<HTMLDivElement>(null);

  const interiorAnswers = useMemo(() => effectiveAnswers(project.interior.answers, project.discovery.answers.feel ?? ""), [project.interior.answers, project.discovery.answers.feel]);
  const guessed = useMemo(() => exteriorGuesses(exterior.answers, interiorAnswers), [exterior.answers, interiorAnswers]);
  const answers = useMemo(() => effectiveExterior(exterior.answers, interiorAnswers), [exterior.answers, interiorAnswers]);
  const board = useMemo(() => exteriorBoard(answers, exterior.shuffle), [answers, exterior.shuffle]);
  const hasGables = project.house3d.roof.style === "gable" || project.house3d.roof.style === "shed";

  const setExterior = (patch: Partial<typeof exterior>, coalesce?: string) =>
    update((p) => ({ ...p, exterior: { ...p.exterior, ...patch } }), coalesce ? { coalesce } : undefined);
  const onAnswer = (id: string, value: string | null) => {
    const next = { ...exterior.answers };
    if (value === null) delete next[id];
    else next[id] = value;
    setExterior({ answers: next, shuffle: 0 });
  };
  const onPicks = (selections: Selection[]) => setExterior({ selections });

  const go = (s: DesignStep) => {
    setStep(s);
    top.current?.scrollIntoView({ block: "start" });
  };
  const i = DESIGN_STEPS.findIndex((s) => s.id === step);

  return (
    <div ref={top} className="space-y-4" data-testid="exterior-design">
      <StepTabs step={step} onStep={go} />
      <p className="text-sm text-muted">{HINTS[step]}</p>

      {step === "style" && (
        <StyleQuestions questions={EXTERIOR_QUESTIONS} answers={exterior.answers} guessed={guessed} onAnswer={onAnswer} guessText="Suggested from your style" />
      )}
      {step === "board" && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button className="btn" onClick={() => setExterior({ shuffle: exterior.shuffle + 1 }, "exterior.shuffle")}>
              Shuffle
            </button>
          </div>
          <ExteriorBoard board={board} />
        </div>
      )}
      {step === "pick" && (
        <ExteriorPicker
          parts={parts}
          exterior={exterior}
          answers={answers}
          hasGables={hasGables}
          onChange={onPicks}
          onAccentPlace={(accentPlace) => setExterior({ accentPlace })}
          part={part}
          setPart={setPart}
        />
      )}

      {i < DESIGN_STEPS.length - 1 && (
        <div className="flex justify-end">
          <button className="btn-primary" onClick={() => go(DESIGN_STEPS[i + 1].id)}>
            Next: {DESIGN_STEPS[i + 1].label.toLowerCase()} →
          </button>
        </div>
      )}
    </div>
  );
}
