"use client";

import { useMemo, useRef, useState } from "react";
import type { Selection } from "@/lib/model/schema";
import { useProjectStore } from "@/lib/store/projectStore";
import { effectiveAnswers, guessAnswers, moodBoard } from "@/lib/interior/style";
import { interiorRooms, startTarget } from "@/lib/interior/picks";
import StyleQuestions from "./StyleQuestions";
import MoodBoard from "./MoodBoard";
import FinishPicker from "./FinishPicker";

type Step = "style" | "board" | "pick";

const STEPS: { id: Step; label: string }[] = [
  { id: "style", label: "Style" },
  { id: "board", label: "Mood board" },
  { id: "pick", label: "Pick finishes" },
];

const HINTS: Record<Step, string> = {
  style: "A few questions about the look you want. The mood board and product picks follow your answers.",
  board: "Paint colors and finishes that fit your answers. Shuffle to see other matches.",
  pick: "Pick finishes for the whole house, then change any room you like. Real products, with links and prices.",
};

/**
 * Interior design without a page around it: style questions, a mood board,
 * then finishes for the house and room by room. The walkthrough's Interior
 * window (key I) shows it; Pick finishes starts on `startRoomId` when that
 * room takes finishes.
 */
export default function InteriorDesign({ startRoomId }: { startRoomId?: string | null }) {
  const project = useProjectStore((s) => s.project)!;
  const update = useProjectStore((s) => s.update);
  const interior = project.interior;
  const answered = Object.keys(interior.answers).length > 0;
  const [step, setStep] = useState<Step>(interior.selections.length ? "pick" : answered ? "board" : "style");
  const top = useRef<HTMLDivElement>(null);

  const feel = project.discovery.answers.feel ?? "";
  const guessed = useMemo(() => guessAnswers(feel), [feel]);
  const answers = useMemo(() => effectiveAnswers(interior.answers, feel), [interior.answers, feel]);
  const board = useMemo(() => moodBoard(answers, interior.shuffle), [answers, interior.shuffle]);
  const rooms = useMemo(() => interiorRooms(project), [project]);
  const [target, setTarget] = useState<string>(() => startTarget(rooms, startRoomId));

  const setInterior = (patch: Partial<typeof interior>, coalesce?: string) =>
    update((p) => ({ ...p, interior: { ...p.interior, ...patch } }), coalesce ? { coalesce } : undefined);

  const onAnswer = (id: string, value: string | null) => {
    const next = { ...interior.answers };
    if (value === null) delete next[id];
    else next[id] = value;
    setInterior({ answers: next, shuffle: 0 });
  };
  const onPicks = (selections: Selection[]) => setInterior({ selections });

  const go = (s: Step) => {
    setStep(s);
    top.current?.scrollIntoView({ block: "start" });
  };
  const i = STEPS.findIndex((s) => s.id === step);

  return (
    <div ref={top} className="space-y-4" data-testid="interior-design">
      <StepTabs step={step} onStep={go} />
      <p className="text-sm text-muted">{HINTS[step]}</p>

      {step === "style" && <StyleQuestions answers={interior.answers} guessed={guessed} onAnswer={onAnswer} />}
      {step === "board" && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button className="btn" onClick={() => setInterior({ shuffle: interior.shuffle + 1 }, "interior.shuffle")}>
              Shuffle
            </button>
          </div>
          <MoodBoard board={board} />
        </div>
      )}
      {step === "pick" && <FinishPicker rooms={rooms} selections={interior.selections} answers={answers} onChange={onPicks} target={target} setTarget={setTarget} />}

      {i < STEPS.length - 1 && (
        <div className="flex justify-end">
          <button className="btn-primary" onClick={() => go(STEPS[i + 1].id)}>
            Next: {STEPS[i + 1].label.toLowerCase()} →
          </button>
        </div>
      )}
    </div>
  );
}

/** The Style / Mood board / Pick finishes tabs, shared by the Interior and Exterior windows. */
export function StepTabs({ step, onStep }: { step: Step; onStep: (s: Step) => void }) {
  return (
    <div className="flex gap-1 border-b border-line" role="tablist">
      {STEPS.map((s, k) => (
        <button
          key={s.id}
          role="tab"
          aria-selected={s.id === step}
          onClick={() => onStep(s.id)}
          className={`-mb-px border-b-2 px-3 py-2 text-sm ${s.id === step ? "border-accent font-medium text-ink" : "border-transparent text-muted hover:text-ink"}`}
        >
          {k + 1}. {s.label}
        </button>
      ))}
    </div>
  );
}

export { STEPS as DESIGN_STEPS, type Step as DesignStep };
