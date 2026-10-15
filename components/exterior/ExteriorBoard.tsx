import type { ExteriorBoard as Board } from "@/lib/exterior/style";
import { exteriorLabel } from "@/lib/exterior/picks";
import Swatch from "@/components/interior/Swatch";

/** The exterior mood board: the house's colors along the top, then the best-matching products. */
export default function ExteriorBoard({ board }: { board: Board }) {
  if (!board.picks.length && !board.palette.length) {
    return <p className="text-sm text-muted">The product catalog is empty, so there&apos;s nothing to show yet.</p>;
  }
  return (
    <div className="space-y-4">
      <div className="flex h-32 overflow-hidden rounded-xl border border-line">
        {board.palette.map(({ label, product: p }) => (
          <div key={label} className="relative flex flex-1 flex-col justify-end p-2">
            <Swatch product={p} className="absolute inset-0" />
            <span className="relative w-fit rounded bg-white/85 px-1.5 py-0.5 text-[11px] leading-tight">
              <span className="text-muted">{label}</span>
              <br />
              {p.name}
            </span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {board.picks.map(({ category, product: p }) => (
          <a key={`${category}:${p.id}`} href={p.url} target="_blank" rel="noreferrer" className="card group overflow-hidden">
            <Swatch product={p} className="h-28 w-full" />
            <div className="p-2">
              <div className="text-[11px] uppercase tracking-wide text-muted">{exteriorLabel(category)}</div>
              <div className="text-sm leading-snug group-hover:underline">{p.name}</div>
              <div className="text-xs text-muted">{p.brand}</div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
