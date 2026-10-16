"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { Point, Selection } from "@/lib/model/schema";
import { useProjectStore } from "@/lib/store/projectStore";
import { effectiveAnswers } from "@/lib/interior/style";
import { EXTERIOR_QUESTIONS, effectiveExterior, exteriorBoard, exteriorGuesses } from "@/lib/exterior/style";
import { exteriorPartsFor } from "@/lib/exterior/picks";
import type { ExteriorCategoryId } from "@/lib/catalog/exterior";
import { lotOffsetFor } from "@/lib/house3d/site";
import StyleQuestions from "@/components/interior/StyleQuestions";
import ExteriorBoard from "./ExteriorBoard";
import ExteriorPicker from "./ExteriorPicker";

const HEIGHT = 520;
const House3DView = dynamic(() => import("@/components/house3d/House3DView"), {
  ssr: false,
  loading: () => <div className="w-full animate-pulse rounded-lg bg-stone-100" style={{ height: HEIGHT }} />,
});

type Step = "style" | "board" | "pick";

const STEPS: { id: Step; label: string }[] = [
  { id: "style", label: "Style" },
  { id: "board", label: "Mood board" },
  { id: "pick", label: "Pick finishes" },
];

/** Stage 7: exterior design. Style questions, a mood board, then products for each part of the outside and the yard. */
export default function ExteriorStage({ onGoToPlan, onWalk }: { onGoToPlan: () => void; onWalk?: () => void }) {
  const project = useProjectStore((s) => s.project)!;
  const update = useProjectStore((s) => s.update);
  const exterior = project.exterior;
  const answered = Object.keys(exterior.answers).length > 0;
  const [step, setStep] = useState<Step>(exterior.selections.length ? "pick" : answered ? "board" : "style");
  const [part, setPart] = useState<ExteriorCategoryId>("roofing");
  const [show3d, setShow3d] = useState(false);

  const interiorAnswers = useMemo(() => effectiveAnswers(project.interior.answers, project.discovery.answers.feel ?? ""), [project.interior.answers, project.discovery.answers.feel]);
  const guessed = useMemo(() => exteriorGuesses(exterior.answers, interiorAnswers), [exterior.answers, interiorAnswers]);
  const answers = useMemo(() => effectiveExterior(exterior.answers, interiorAnswers), [exterior.answers, interiorAnswers]);
  const board = useMemo(() => exteriorBoard(answers, exterior.shuffle), [answers, exterior.shuffle]);
  const parts = useMemo(() => exteriorPartsFor(project), [project]);
  const hasPlan = Object.values(project.floorPlans).some((pl) => pl.rooms.length > 0);
  const hasGables = project.house3d.roof.style === "gable" || project.house3d.roof.style === "shed";

  const levels = useMemo(() => [...project.levels].sort((a, b) => a.elevationIn - b.elevationIn), [project.levels]);
  const offsetKey = JSON.stringify(lotOffsetFor(project));
  const offset = useMemo<Point>(() => JSON.parse(offsetKey), [offsetKey]);
  const firstUsed = levels.find((l) => (project.floorPlans[l.id]?.rooms.length ?? 0) > 0)?.id ?? levels[0].id;

  const setExterior = (patch: Partial<typeof exterior>, coalesce?: string) =>
    update((p) => ({ ...p, exterior: { ...p.exterior, ...patch } }), coalesce ? { coalesce } : undefined);
  const onAnswer = (id: string, value: string | null) => {
    const next = { ...exterior.answers };
    if (value === null) delete next[id];
    else next[id] = value;
    setExterior({ answers: next, shuffle: 0 });
  };
  const onPicks = (selections: Selection[]) => setExterior({ selections });

  const go = (s: Step) => {
    setStep(s);
    window.scrollTo({ top: 0 });
  };
  const i = STEPS.findIndex((s) => s.id === step);

  return (
    <div className="space-y-6 pb-10">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Exterior design</h2>
          <p className="mt-1 text-sm text-muted">
            {step === "style"
              ? "A few questions about how the outside should look. The mood board and product picks follow your answers."
              : step === "board"
                ? "Colors and products that fit your answers. Shuffle to see other matches."
                : "Pick the roof, siding, windows, doors and yard. Real products, with links and prices."}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!hasPlan && (
            <button className="btn" onClick={onGoToPlan}>
              ← Floor plan
            </button>
          )}
          {i < STEPS.length - 1 ? (
            <button className="btn-primary" onClick={() => go(STEPS[i + 1].id)}>
              Next: {STEPS[i + 1].label.toLowerCase()} →
            </button>
          ) : (
            onWalk && (
              <button className="btn-primary" onClick={onWalk}>
                Walk through it →
              </button>
            )
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
        <>
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
          {hasPlan && project.plan.basics && (
            <section className="border-t border-line pt-4">
              <button className="btn" onClick={() => setShow3d(!show3d)} aria-expanded={show3d}>
                {show3d ? "Hide 3D view" : "See it in 3D"}
              </button>
              {show3d && (
                <div className="mt-3 space-y-2">
                  <p className="text-sm text-muted">Drag to turn, scroll to zoom. The walkthrough lets you click the outside to change it too (E for Design).</p>
                  <House3DView
                    plans={project.floorPlans}
                    levels={levels}
                    basics={project.plan.basics}
                    house3d={project.house3d}
                    interior={project.interior.selections}
                    exterior={exterior}
                    plot={project.plot}
                    offset={offset}
                    levelId={firstUsed}
                    cutAway={false}
                    roof
                    walls="all"
                    editing={false}
                    viewOnly
                    onEditing={() => {}}
                    selection={[]}
                    snap={false}
                    height={HEIGHT}
                    onSelect={() => {}}
                    onChange={() => {}}
                    onTopLabels={(topLabels) => update((p) => ({ ...p, house3d: { ...p.house3d, topLabels } }))}
                  />
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
