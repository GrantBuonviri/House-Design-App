"use client";

export type Overlay = "property" | "sun" | "land" | "arrow";

/** Snap to grid, the land overlays and Move on lot, in one row over the drawing. */
export default function ViewOptions(props: {
  snap: boolean;
  onSnap: (on: boolean) => void;
  hasPlot: boolean;
  flat: boolean;
  overlays: Record<Overlay, boolean>;
  onOverlay: (key: Overlay, on: boolean) => void;
  lotMode: boolean;
  canMoveLot: boolean;
  onLotMode: (on: boolean) => void;
  /** More checkboxes, after Snap to grid. */
  extra?: React.ReactNode;
}) {
  const { snap, onSnap, hasPlot, flat, overlays, onOverlay, lotMode, canMoveLot, onLotMode, extra } = props;
  const box = "size-4 accent-[var(--color-accent)]";
  const check = (key: Overlay, label: string, small = false, disabled = !hasPlot) => (
    <label className={`flex items-center gap-2 ${small ? "text-xs" : ""} ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}>
      <input type="checkbox" className={small ? "size-3.5 accent-[var(--color-accent)]" : box} checked={overlays[key]} disabled={disabled} onChange={(e) => onOverlay(key, e.target.checked)} />
      {label}
    </label>
  );
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 text-sm text-muted">
      <div className="flex flex-wrap items-start gap-x-5 gap-y-2">
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" className={box} checked={snap} onChange={(e) => onSnap(e.target.checked)} />
          Snap to grid
        </label>
        {extra}
        <span className="h-5 w-px bg-line" aria-hidden />
        {check("property", "Property line")}
        {check("sun", "Sun path")}
        <div className="flex flex-col gap-1">
          {check("land", "Land features")}
          <div className="pl-6" title={flat ? "This lot is flat, so there's no downhill." : undefined}>
            {check("arrow", "Downhill arrow", true, !hasPlot || !overlays.land || flat)}
          </div>
        </div>
        {!hasPlot && <span className="text-xs">Pick land in step 2 to see it here.</span>}
      </div>
      <button
        className={`btn py-1 text-sm ${lotMode ? "border-accent bg-accent-soft text-accent" : ""}`}
        aria-pressed={lotMode}
        disabled={!canMoveLot}
        title={canMoveLot ? "Slide the lot under your house" : "Turn on Property line or Land features first"}
        onClick={() => onLotMode(!lotMode)}
      >
        {lotMode ? "Done moving" : "Move on lot"}
      </button>
    </div>
  );
}

