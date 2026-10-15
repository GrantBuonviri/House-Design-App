"use client";

import { create } from "zustand";
import { readStorage, writeStorage } from "@/lib/browserStorage";

/**
 * How the 3D views are drawn on this computer. Pretty has shadows and smooth
 * edges; Fast drops them so older or busier computers stay smooth. Kept in
 * this browser, not in the house, since it's about the computer.
 */
export type Quality = "pretty" | "fast";

const KEY = "graphics-quality";

export const useGraphics = create<{ quality: Quality; setQuality: (q: Quality) => void }>((set) => ({
  quality: "pretty",
  setQuality(quality) {
    writeStorage(() => localStorage, KEY, quality);
    set({ quality });
  },
}));

/** Read the saved choice once the page is in the browser. */
export function loadGraphics() {
  const saved = readStorage(() => localStorage, KEY);
  if (saved === "fast" || saved === "pretty") useGraphics.setState({ quality: saved });
}

/** Canvas settings for each quality. */
export function canvasSettings(quality: Quality, maxDpr = 2) {
  const fast = quality === "fast";
  return {
    shadows: !fast,
    dpr: fast ? 1 : ([1, maxDpr] as [number, number]),
    gl: { antialias: !fast, preserveDrawingBuffer: true },
  };
}
