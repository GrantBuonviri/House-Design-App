"use client";

import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import InteriorDesign from "@/components/interior/InteriorDesign";
import ExteriorDesign from "@/components/exterior/ExteriorDesign";

export type DesignWindowKind = "interior" | "exterior";

/** How much of the screen the design window covers: 45% of the width, at least 460px. */
export const WINDOW_WIDTH = "max(460px, 45vw)";

/**
 * The Interior (I) or Exterior (X) design window, docked on the right of the
 * walkthrough. Walking is paused while it's open; the house on the left
 * changes as you pick.
 */
export function DesignWindow({ kind, roomId, onWalk, onClose }: { kind: DesignWindowKind; roomId: string | null; onWalk: () => void; onClose: () => void }) {
  return (
    <aside
      className="absolute top-[var(--walk-bar,4rem)] right-0 bottom-0 z-10 flex max-w-full flex-col overflow-hidden rounded-tl-xl bg-white shadow-2xl"
      style={{ width: WINDOW_WIDTH }}
      data-testid={`${kind}-window`}
      aria-label={kind === "interior" ? "Interior design" : "Exterior design"}
    >
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
        <div>
          <h2 className="text-base font-semibold">{kind === "interior" ? "Interior design" : "Exterior design"}</h2>
          <p className="text-xs text-muted">{kind === "interior" ? "I opens and closes this" : "X opens and closes this"} · Esc closes</p>
        </div>
        <div className="flex items-center gap-3">
          <button className="btn-primary px-3 py-1 text-sm" onClick={onWalk} data-testid="window-keep-walking">
            Keep walking
          </button>
          <button className="text-sm text-muted hover:text-ink" onClick={onClose} aria-label="Close window" data-testid="window-close">
            Close ✕
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">{kind === "interior" ? <InteriorDesign startRoomId={roomId} /> : <ExteriorDesign />}</div>
    </aside>
  );
}

/**
 * Moves the middle of the 3D view to the middle of the part the window leaves
 * open, so what you were looking at stays in sight.
 */
export function ViewShift({ open }: { open: boolean }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const { width, height } = useThree((s) => s.size);
  useEffect(() => {
    if (!camera.isPerspectiveCamera) return;
    // Half the window's width (WINDOW_WIDTH in pixels).
    const s = open ? Math.min(width, Math.max(460, 0.45 * window.innerWidth)) / 2 : 0;
    if (s > 0) {
      // A view 2s wider, showing all but its right-hand 2s: the middle lands s to the left.
      camera.aspect = (width + 2 * s) / height;
      camera.setViewOffset(width + 2 * s, height, 2 * s, 0, width, height);
    } else {
      camera.aspect = width / height;
      camera.clearViewOffset();
    }
    camera.updateProjectionMatrix();
  }, [camera, open, width, height]);
  return null;
}
