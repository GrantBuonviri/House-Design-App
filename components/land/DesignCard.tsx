"use client";

/** The pinned card in the land carousel that opens the land designer. */
export default function DesignCard({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="card flex flex-col items-center justify-center gap-3 border-2 border-dashed border-accent/50 p-6 text-center ring-2 ring-accent/20 hover:bg-stone-50"
    >
      <svg width="120" height="90" viewBox="0 0 120 90" aria-hidden="true">
        <polygon points="14,20 96,12 108,70 24,78" fill="#e3ecd6" stroke="#1f2421" strokeWidth="2" strokeDasharray="6 4" />
        {[[14, 20], [96, 12], [108, 70], [24, 78]].map(([x, y]) => (
          <circle key={`${x}${y}`} cx={x} cy={y} r="5" fill="#fff" stroke="#2f6f4f" strokeWidth="2" />
        ))}
      </svg>
      <span className="text-lg font-semibold">Design your own land</span>
      <span className="text-sm text-muted">Set the size, shape, north and slope yourself, then use it for your house.</span>
      <span className="btn-primary pointer-events-none">Open the designer</span>
    </button>
  );
}
