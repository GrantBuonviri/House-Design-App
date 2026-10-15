"use client";

import { useEffect, useState } from "react";
import { useProjectStore } from "@/lib/store/projectStore";

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

  return (
    <>
      <button className={className} onClick={undo} disabled={!canUndo} title={undoTitle} onMouseEnter={showUndo} onFocus={showUndo} data-testid="undo">
        Undo
      </button>
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
