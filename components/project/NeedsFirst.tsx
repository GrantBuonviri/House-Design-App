"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A button for something that isn't ready yet. Instead of sitting greyed out
 * with only a hover tip, a click says what's needed and offers to go there.
 */
export default function NeedsFirst({
  children,
  className = "btn",
  message,
  action,
  onAction,
  testId,
}: {
  children: ReactNode;
  className?: string;
  message: string;
  action: string;
  onAction: () => void;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="relative" ref={box}>
      <button className={`${className} opacity-60`} onClick={() => setOpen(!open)} aria-expanded={open} data-testid={testId}>
        {children}
      </button>
      {open && (
        <div className="card absolute right-0 top-full z-40 mt-2 w-64 p-4 text-left shadow-lg" role="dialog">
          <p className="text-sm">{message}</p>
          <button
            className="btn-primary mt-3 w-full"
            onClick={() => {
              setOpen(false);
              onAction();
            }}
          >
            {action}
          </button>
        </div>
      )}
    </div>
  );
}
