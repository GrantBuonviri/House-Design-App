import type { MoodBoard as Board } from "@/lib/interior/style";
import { categoryLabel } from "@/lib/interior/style";
import Swatch from "./Swatch";

/** The mood board: paint colors along the top, then the best-matching finishes. */
export default function MoodBoard({ board }: { board: Board }) {
  if (!board.picks.length && !board.palette.length) {
    return <p className="text-sm text-muted">The product catalog is empty, so there&apos;s nothing to show yet.</p>;
  }
  return (
    <div className="space-y-4">
      <div className="flex h-28 overflow-hidden rounded-xl border border-line">
        {board.palette.map((p) => (
          <div key={p.id} className="flex flex-1 flex-col justify-end p-2" style={{ backgroundColor: p.color }}>
            <span className="w-fit rounded bg-white/85 px-1.5 py-0.5 text-[11px] leading-tight">
              {p.name}
              <br />
              <span className="text-muted">
                {p.brand}
                {p.sku ? ` ${p.sku}` : ""}
              </span>
            </span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {board.picks.map((p) => (
          <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="card group overflow-hidden">
            <Swatch product={p} className="h-32 w-full" />
            <div className="p-2">
              <div className="text-[11px] uppercase tracking-wide text-muted">{categoryLabel(p.category)}</div>
              <div className="text-sm leading-snug group-hover:underline">{p.name}</div>
              <div className="text-xs text-muted">{p.brand}</div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
