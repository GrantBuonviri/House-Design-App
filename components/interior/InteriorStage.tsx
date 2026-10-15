"use client";

import { useMemo, useState } from "react";
import { WHOLE_HOUSE, type Selection } from "@/lib/model/schema";
import { useProjectStore } from "@/lib/store/projectStore";
import { effectiveAnswers, guessAnswers, moodBoard } from "@/lib/interior/style";
import { interiorRooms } from "@/lib/interior/picks";
import StyleQuestions from "./StyleQuestions";
import MoodBoard from "./MoodBoard";
import FinishPicker from "./FinishPicker";
import Interior3D from "./Interior3D";

type Step = "style" | "board" | "pick";

const STEPS: { id: Step; label: string }[] = [
  { id: "style", label: "Style" },
  { id: "board", label: "Mood board" },
  { id: "pick", label: "Pick finishes" },
];

/** Stage 6: interior design. Style questions, a mood board, then finishes picked for the house and room by room. */
export default function InteriorStage({ onContinue, onGoToPlan }: { onContinue: () => void; onGoToPlan: () => void }) {
  const project = useProjectStore((s) => s.project)!;
  const update = useProjectStore((s) => s.update);
  const interior = project.interior;
  const answered = Object.keys(interior.answers).length > 0;
  const [step, setStep] = useState<Step>(interior.selections.length ? "pick" : answered ? "board" : "style");

  const feel = project.discovery.answers.feel ?? "";
  const guessed = useMemo(() => guessAnswers(feel), [feel]);
  const answers = useMemo(() => effectiveAnswers(interior.answers, feel), [interior.answers, feel]);
  const board = useMemo(() => moodBoard(answers, interior.shuffle), [answers, interior.shuffle]);
  const rooms = useMemo(() => interiorRooms(project), [project]);
  const [target, setTarget] = useState<string>(WHOLE_HOUSE);
  const [show3d, setShow3d] = useState(false);
  const canShow3d = rooms.length > 0 && !!project.plan.basics;

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
    window.scrollTo({ top: 0 });
  };
  const i = STEPS.findIndex((s) => s.id === step);

  return (
    <div className="space-y-6 pb-10">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Interior design</h2>
          <p className="mt-1 text-sm text-muted">
            {step === "style"
              ? "A few questions about the look you want. The mood board and product picks follow your answers."
              : step === "board"
                ? "Paint colors and finishes that fit your answers. Shuffle to see other matches."
                : "Pick finishes for the whole house, then change any room you like. Real products, with links and prices."}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {rooms.length === 0 && (
            <button className="btn" onClick={onGoToPlan}>
              ← Floor plan
            </button>
          )}
          {i < STEPS.length - 1 ? (
            <button className="btn-primary" onClick={() => go(STEPS[i + 1].id)}>
              Next: {STEPS[i + 1].label.toLowerCase()} →
            </button>
          ) : (
            <button className="btn-primary" onClick={onContinue}>
              Next: exterior →
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-1 border-b border-line">
        {STEPS.map((s, k) => (
          <button
            key={s.id}
            onClick={() => go(s.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${s.id === step ? "border-accent font-medium text-ink" : "border-transparent text-muted hover:text-ink"}`}
          >
            {k + 1}. {s.label}
          </button>
        ))}
      </div>

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
      {step === "pick" && (
        <>
          <FinishPicker rooms={rooms} selections={interior.selections} answers={answers} onChange={onPicks} target={target} setTarget={setTarget} />
          {canShow3d && (
            <section className="border-t border-line pt-4">
              <button className="btn" onClick={() => setShow3d(!show3d)} aria-expanded={show3d}>
                {show3d ? "Hide 3D view" : "See it in 3D"}
              </button>
              {show3d && (
                <div className="mt-3">
                  <Interior3D project={project} roomId={target === WHOLE_HOUSE ? null : target} />
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
