"use client";

import { useEffect, useState } from "react";
import type { Stage } from "@/lib/model/schema";
import { keyIsForPage } from "@/lib/keys";
import { PAGE_HELP } from "@/lib/tour/help";
import { MINI_TOURS, type MiniTour } from "@/lib/tour/help";

/** The ? button and card for the page you're on (the floor plan has its own card, which the button opens by sending it the ? key), and the "How do I…" list of short tours. */
export default function PageHelp({ stage, onMiniTour }: { stage: Stage; onMiniTour: (t: MiniTour) => void }) {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const card = stage === "plan" ? null : PAGE_HELP[stage as keyof typeof PAGE_HELP];

  // The card belongs to a page: moving on closes it.
  useEffect(() => setOpen(false), [stage]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setMenu(false);
      }
      if (e.key !== "?" || e.metaKey || e.ctrlKey || e.altKey || !card || !keyIsForPage(e)) return;
      setOpen((o) => !o);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card]);

  const toggle = () => {
    if (card) setOpen((o) => !o);
    else window.dispatchEvent(new KeyboardEvent("keydown", { key: "?" }));
  };

  return (
    <span className="relative flex items-center gap-2">
      <button className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline" onClick={() => setMenu((m) => !m)} aria-expanded={menu} data-testid="howdoi">
        How do I…
      </button>
      <button className="flex h-5 w-5 items-center justify-center rounded-full border border-line text-xs text-muted hover:text-ink" onClick={toggle} title="Keys and tips for this page (press ?)" aria-label="Help for this page" data-testid="help-open">
        ?
      </button>
      {menu && (
        <ul className="card absolute right-0 top-7 z-30 w-52 p-1 text-sm shadow-lg" data-testid="howdoi-list">
          {MINI_TOURS.map((t) => (
            <li key={t.id}>
              <button
                className="w-full rounded px-3 py-1.5 text-left hover:bg-paper"
                onClick={() => {
                  setMenu(false);
                  onMiniTour(t);
                }}
              >
                {t.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && card && (
        <div className="card absolute right-0 top-7 z-30 w-80 p-4 shadow-lg" role="dialog" aria-label="Help for this page" data-testid="help-card">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{card.title}</h3>
            <button className="text-xs text-muted hover:underline" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
          <dl className="mt-2 space-y-1 text-xs">
            {card.lines.map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <dt className="w-24 shrink-0 font-semibold">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-muted">Press ? to show or hide this card.</p>
        </div>
      )}
    </span>
  );
}
