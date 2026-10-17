"use client";

import { useState } from "react";
import type { Product } from "@/lib/model/schema";
import type { CatalogProduct } from "@/lib/catalog/catalog";
import { toProduct, productTitle } from "@/lib/interior/picks";
import { priceText } from "@/components/interior/ProductCard";

/** The Interior design product list for a furnish item: what's picked (with Clear), then the products, six at first. */
export default function ProductList({ products, picked, onPick, idPrefix }: { products: CatalogProduct[]; picked: Product | null; onPick: (p: Product | null) => void; idPrefix: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? products : products.slice(0, 6);
  return (
    <>
      {picked && (
        <p className="mb-2 text-xs">
          Picked: <span className="font-medium">{productTitle(picked)}</span>{" "}
          <button className="text-accent underline" onClick={() => onPick(null)} data-testid={`${idPrefix}-clear-pick`}>
            Clear
          </button>
        </p>
      )}
      <ul className="space-y-1" data-testid={`${idPrefix}-products`}>
        {shown.map((p) => {
          const isPicked = picked?.id === p.id;
          return (
            <li key={p.id}>
              <button disabled={isPicked} onClick={() => onPick(toProduct(p))} className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs ${isPicked ? "border-accent bg-stone-100" : "border-line hover:bg-stone-50"}`} data-testid={`${idPrefix}-product-${p.id}`}>
                <span className="size-4 shrink-0 rounded-full border border-line" style={{ background: p.color }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="block truncate text-muted">{p.brand}</span>
                </span>
                <span className="shrink-0 text-muted">{isPicked ? "Picked" : priceText(p)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {products.length > shown.length && (
        <button className="mt-1 text-xs text-accent underline" onClick={() => setAll(true)}>
          Show all {products.length}
        </button>
      )}
    </>
  );
}
