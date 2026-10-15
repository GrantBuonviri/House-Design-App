import type { Product } from "@/lib/model/schema";
import Swatch from "./Swatch";

const UNIT: Record<Product["unit"], string> = { sqft: "sq ft", each: "each", linft: "linear ft", gallon: "gallon", set: "set" };

export function priceText(p: Pick<Product, "price" | "unit">): string {
  if (p.price === undefined) return "No price";
  const money = p.price >= 100 ? `$${Math.round(p.price).toLocaleString("en-US")}` : `$${p.price.toFixed(2)}`;
  return p.unit === "each" ? money : `${money} / ${UNIT[p.unit]}`;
}

export function checkedText(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** One product: a drawn swatch, name, brand, price, when it was checked, and a link to its page. */
export default function ProductCard({
  product,
  picked,
  note,
  action,
  onAction,
}: {
  product: Product & { priceNote?: string };
  picked?: boolean;
  note?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className={`card flex flex-col overflow-hidden ${picked ? "ring-2 ring-accent" : ""}`}>
      <Swatch product={product} className="h-24 w-full" />
      <div className="flex flex-1 flex-col p-3">
        <div className="text-sm font-medium leading-snug">{product.name}</div>
        <div className="mt-0.5 text-xs text-muted">
          {product.brand}
          {product.line && !product.name.includes(product.line) ? ` · ${product.line}` : ""}
          {product.sku ? ` · ${product.sku}` : ""}
        </div>
        <div className="mt-2 flex items-baseline gap-2 text-sm">
          <span className="font-medium tabular-nums">{priceText(product)}</span>
          {product.priceSource === "estimated" && (
            <span className="rounded bg-amber-100 px-1.5 text-[11px] text-amber-900" title={product.priceNote}>
              estimated
            </span>
          )}
        </div>
        <div className="mt-1 text-[11px] text-muted" title={product.priceNote}>
          Last checked {checkedText(product.lastChecked)}
        </div>
        {note && <div className="mt-1 text-[11px] text-accent">{note}</div>}
        <div className="mt-auto flex items-center justify-between gap-2 pt-3">
          <a href={product.url} target="_blank" rel="noreferrer" className="text-xs text-accent underline">
            View product ↗
          </a>
          {action && onAction && (
            <button className={picked ? "btn px-2 py-1 text-xs" : "btn-primary px-2 py-1 text-xs"} onClick={onAction}>
              {action}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
