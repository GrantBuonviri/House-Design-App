"use client";

import { useEffect, useRef, useState } from "react";
import { useProjectStore, type HistoryItem } from "@/lib/store/projectStore";

/**
 * Undo and Redo. Hovering one says what it will do ("Undo: move Kitchen");
 * the label is worked out on hover so dragging stays smooth.
 */
export default function UndoButtons({ className = "btn" }: { className?: string }) {
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const canUndo = useProjectStore((s) => s.canUndo);
  const canRedo = useProjectStore((s) => s.canRedo);
  const [undoTitle, setUndoTitle] = useState("Undo (⌘Z)");
  const [redoTitle, setRedoTitle] = useState("Redo (⇧⌘Z)");

  const showUndo = () => {
    const l = useProjectStore.getState().undoLabel();
    setUndoTitle(l ? `Undo: ${l} (⌘Z)` : "Nothing to undo");
  };
  const showRedo = () => {
    const l = useProjectStore.getState().redoLabel();
    setRedoTitle(l ? `Redo: ${l} (⇧⌘Z)` : "Nothing to redo");
  };

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<HistoryItem[]>([]);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const toggle = () => {
    if (!open) setItems(useProjectStore.getState().historyList());
    setOpen(!open);
  };
  const goTo = (i: number) => {
    useProjectStore.getState().goToVersion(i);
    setOpen(false);
  };

  return (
    <>
      <span ref={box} className="relative inline-flex">
      <button className={className} onClick={undo} disabled={!canUndo} title={undoTitle} onMouseEnter={showUndo} onFocus={showUndo} data-testid="undo">
        Undo
      </button>
      <button className={`${className} -ml-1 px-1.5`} onClick={toggle} disabled={!canUndo && !canRedo} aria-label="History" aria-expanded={open} title="History: jump back to an earlier step" data-testid="history-toggle">
        ▾
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-80 w-64 overflow-auto rounded-lg border border-line bg-white py-1 text-sm shadow-lg" data-testid="history-list" role="menu">
          {items.map((it) => (
            <button key={it.index} role="menuitem" onClick={() => goTo(it.index)} className={`block w-full truncate px-3 py-1.5 text-left hover:bg-black/5 ${it.undone ? "text-ink/45" : ""} ${it.current ? "font-semibold" : ""}`} title={it.label}>
              {it.current ? "● " : ""}{it.label}
            </button>
          ))}
          <button role="menuitem" onClick={() => goTo(0)} className="block w-full border-t border-line px-3 py-1.5 text-left text-ink/70 hover:bg-black/5">
            Back to when it was opened
          </button>
        </div>
      )}
      </span>
      <button className={className} onClick={redo} disabled={!canRedo} title={redoTitle} onMouseEnter={showRedo} onFocus={showRedo} data-testid="redo">
        Redo
      </button>
    </>
  );
}

/** The note after an undo or redo, for a couple of seconds at the bottom of the window. */
export function UndoNotice() {
  const notice = useProjectStore((s) => s.notice);
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    if (!notice) return;
    setShown(notice.id);
    const t = setTimeout(() => setShown(null), 2200);
    return () => clearTimeout(t);
  }, [notice]);
  if (!notice || shown !== notice.id) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[70] flex justify-center" data-testid="undo-notice">
      <div className="rounded-full bg-ink/90 px-4 py-2 text-sm text-white shadow-lg">{notice.text}</div>
    </div>
  );
}
