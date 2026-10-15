import { QUESTIONS, type Answers, type Question } from "@/lib/interior/style";

/** Style questions (the interior ones unless others are given), each a row of drawn choices. */
export default function StyleQuestions({
  answers,
  guessed,
  onAnswer,
  questions = QUESTIONS,
  guessText = "From what you wrote on the Rooms page",
}: {
  /** What the user picked. */
  answers: Answers;
  /** Guesses from the Rooms page, shown where the user hasn't answered. */
  guessed: Answers;
  onAnswer: (id: string, value: string | null) => void;
  questions?: Question[];
  /** Shown next to a question whose answer is a guess. */
  guessText?: string;
}) {
  return (
    <div className="space-y-6">
      {questions.map((q) => {
        const value = answers[q.id] ?? guessed[q.id];
        const isGuess = answers[q.id] === undefined && guessed[q.id] !== undefined;
        return (
          <section key={q.id}>
            <div className="mb-2 flex items-baseline gap-2">
              <h3 className="text-sm font-medium">{q.label}</h3>
              {q.hint && <span className="text-xs text-muted">{q.hint}</span>}
              {isGuess && <span className="text-xs text-accent">{guessText}</span>}
            </div>
            <div className="flex flex-wrap gap-2">
              {q.options.map((o) => {
                const on = value === o.id;
                return (
                  <button
                    key={o.id}
                    onClick={() => onAnswer(q.id, on && q.optional ? null : o.id)}
                    className={`flex w-36 flex-col overflow-hidden rounded-lg border text-left text-sm ${on ? "border-accent ring-2 ring-accent" : "border-line bg-white hover:border-stone-400"}`}
                    aria-pressed={on}
                  >
                    <span className="flex h-10 w-full">
                      {o.swatch.map((c, i) => (
                        <span key={i} className="flex-1" style={{ backgroundColor: c }} />
                      ))}
                    </span>
                    <span className="px-2 py-1.5">{o.label}</span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
