"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import type { Stage } from "@/lib/model/schema";
import { TOUR, type TourStep } from "@/lib/tour/steps";

const CARD_W = 340;
const GAP = 12;
const PAD = 6;

/**
 * The guided tour: the page dims except for the thing being explained, with
 * a card next to it. Arrow keys move through the steps; Esc ends it.
 */
export default function Tour({ onStage, onDone, steps = TOUR, startAt = 0 }: { onStage: (s: Stage) => void; onDone: () => void; steps?: TourStep[]; startAt?: number }) {
  const [i, setI] = useState(startAt);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = steps[i];
  const last = i === steps.length - 1;

  useEffect(() => {
    if (step.stage) onStage(step.stage);
  }, [step, onStage]);

  // Find the thing to point at, and follow it if the page moves or resizes.
  useLayoutEffect(() => {
    if (!step.target) {
      setRect(null);
      return;
    }
    let el: Element | null = null;
    const measure = () => {
      el ??= document.querySelector(`[data-tour="${step.target}"]`);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    const first = requestAnimationFrame(() => {
      el = document.querySelector(`[data-tour="${step.target}"]`);
      el?.scrollIntoView({ block: "nearest" });
      measure();
    });
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const timer = setInterval(measure, 300);
    return () => {
      cancelAnimationFrame(first);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      clearInterval(timer);
    };
  }, [step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDone();
      else if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        if (last) onDone();
        else setI((n) => n + 1);
      } else if (e.key === "ArrowLeft") setI((n) => Math.max(0, n - 1));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [last, onDone]);

  // The card goes under the highlighted thing, or above it when there's no room below.
  const vw = typeof window === "undefined" ? 1200 : window.innerWidth;
  const vh = typeof window === "undefined" ? 800 : window.innerHeight;
  let cardStyle: React.CSSProperties;
  if (rect) {
    const left = Math.min(Math.max(16, rect.left + rect.width / 2 - CARD_W / 2), vw - CARD_W - 16);
    const below = rect.bottom + PAD + GAP;
    cardStyle = below + 220 < vh ? { left, top: below } : { left, bottom: vh - (rect.top - PAD - GAP) };
  } else {
    cardStyle = { left: vw / 2 - CARD_W / 2, top: vh / 2 - 120 };
  }

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-label="Guided tour" data-testid="tour">
      {rect ? (
        <div
          className="pointer-events-none fixed rounded-lg ring-2 ring-white transition-all duration-200"
          style={{
            left: rect.left - PAD,
            top: rect.top - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: "0 0 0 9999px rgba(20, 24, 22, 0.55)",
          }}
        />
      ) : (
        <div className="fixed inset-0 bg-[rgba(20,24,22,0.55)]" />
      )}
      <div className="card fixed p-5 shadow-xl" style={{ ...cardStyle, width: CARD_W }}>
        <p className="text-xs text-muted">
          {i + 1} of {steps.length}
        </p>
        <h2 className="mt-1 text-base font-semibold">{step.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink">{step.body}</p>
        <div className="mt-4 flex items-center gap-2">
          {!last && (
            <button className="mr-auto text-sm text-muted hover:text-ink" onClick={onDone}>
              Skip tour
            </button>
          )}
          {i > 0 && (
            <button className={`btn ${last ? "mr-auto" : ""}`} onClick={() => setI(i - 1)}>
              Back
            </button>
          )}
          <button className="btn-primary" onClick={() => (last ? onDone() : setI(i + 1))} data-testid="tour-next">
            {last ? (steps === TOUR ? "Start designing" : "Done") : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
