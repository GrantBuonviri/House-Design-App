import type { Plot } from "@/lib/model/schema";

/** Neighbors' land shown around the plot, as a share of its size. */
export const VIEW_MARGIN = 0.14;

/** The square area drawn around a plot, in plot-local inches. */
export type LandView = { x0: number; y0: number; side: number };

export function landView(plot: Plot): LandView {
  const side = Math.max(plot.widthIn, plot.depthIn) * (1 + VIEW_MARGIN * 2);
  return { x0: plot.widthIn / 2 - side / 2, y0: plot.depthIn / 2 - side / 2, side };
}

/** Earthy tint from low (green) to high (tan), 0 to 255 per channel. t in [0, 1]. */
export function landTint(t: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [
    [0, [122, 145, 104]],
    [0.5, [176, 170, 128]],
    [1, [205, 186, 150]],
  ];
  const c = Math.max(0, Math.min(1, t));
  for (let i = 1; i < stops.length; i++) {
    if (c <= stops[i][0]) {
      const [t0, a] = stops[i - 1];
      const [t1, b] = stops[i];
      const k = (c - t0) / (t1 - t0);
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    }
  }
  return stops[stops.length - 1][1];
}
