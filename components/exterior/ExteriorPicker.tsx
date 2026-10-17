"use client";

import { useMemo, useState } from "react";
import { WHOLE_HOUSE, type DesignChoices, type Selection } from "@/lib/model/schema";
import { exteriorCatalog, type ExteriorCategory, type ExteriorCategoryId } from "@/lib/catalog/exterior";
import { accentPlaceFor, exteriorPick, sidingPaintApplies } from "@/lib/exterior/picks";
import { rankedExterior, type Answers } from "@/lib/exterior/style";
import { setPick, toProduct } from "@/lib/interior/picks";
import ProductCard, { priceText } from "@/components/interior/ProductCard";
import Swatch from "@/components/interior/Swatch";

const GROUPS: ExteriorCategory["group"][] = ["Roof and walls", "Windows and doors", "Outdoor living", "Yard"];

/** What a part covers, in a few words, under its name. */
const ABOUT: Partial<Record<ExteriorCategoryId, string>> = {
  "siding-paint": "Paint for lap, board and batten, shingle or panel siding",
  accent: "Stone, brick or wood on part of the walls",
  "trim-paint": "Fascia, soffits, corners and window trim",
  "exterior-lighting": "By each outside door and the garage",
  patio: "Open patios on the floor plan",
  walk: "From the front door to the driveway",
  driveway: "From the garage to the road",
  beds: "Along the outside walls",
};

/**
 * Pick exterior finishes: the parts of the outside on the left, products for
 * the chosen part (best style match first) in the middle, and what's picked
 * on the right.
 */
export default function ExteriorPicker({
  parts,
  exterior,
  answers,
  hasGables,
  onChange,
  onAccentPlace,
  part,
  setPart,
}: {
  parts: ExteriorCategory[];
  exterior: DesignChoices;
  answers: Answers;
  hasGables: boolean;
  onChange: (next: Selection[]) => void;
  onAccentPlace: (place: "base" | "gables") => void;
  part: ExteriorCategoryId;
  setPart: (id: ExteriorCategoryId) => void;
}) {
  const selections = exterior.selections;
  const cat = parts.find((c) => c.id === part) ?? parts[0];
  const [showAll, setShowAll] = useState(false);
  const products = useMemo(() => (cat ? rankedExterior(cat.id, answers) : []), [cat, answers]);
  const shown = showAll ? products : products.slice(0, 9);
  const current = cat ? exteriorPick(selections, cat.id) : undefined;
  const pick = (id: ExteriorCategoryId, p: Parameters<typeof toProduct>[0] | null) => onChange(setPick(selections, WHOLE_HOUSE, id, p ? toProduct(p) : null));
  const paintOff = cat?.id === "siding-paint" && !sidingPaintApplies(selections);
  const place = accentPlaceFor(exterior, hasGables);

  return (
    <div className="@container">
    <div className="grid grid-cols-[170px_1fr] gap-4 @4xl:grid-cols-[210px_1fr_250px] @4xl:gap-5">
      <nav className="space-y-3 text-sm">
        {GROUPS.map((g) => {
          const items = parts.filter((c) => c.group === g);
          if (!items.length) return null;
          return (
            <div key={g}>
              <div className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted">{g}</div>
              {items.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    setPart(c.id);
                    setShowAll(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left ${c.id === cat?.id ? "bg-accent text-white" : "hover:bg-stone-100"}`}
                >
                  <span className="truncate">{c.label}</span>
                  {exteriorPick(selections, c.id) && <span className={c.id === cat?.id ? "text-white" : "text-accent"}>✓</span>}
                </button>
              ))}
            </div>
          );
        })}
      </nav>

      <div className="min-w-0">
        {cat && (
          <>
            <div className="mb-3 space-y-2 text-sm text-muted">
              {ABOUT[cat.id] && <p>{ABOUT[cat.id]}.</p>}
              {paintOff ? (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-900">
                  The siding you picked keeps its own color, so a paint color won&apos;t change it. Pick a paintable siding (lap, board and batten, shingles or panels) to paint it.
                </p>
              ) : current ? (
                <p>
                  Picked for the house.{" "}
                  <button className="text-accent underline" onClick={() => pick(cat.id, null)}>
                    Clear it
                  </button>
                </p>
              ) : (
                <p>No {cat.one} picked yet, so it&apos;s priced at mid-range.</p>
              )}
              {cat.id === "accent" && (
                <div className="flex items-center gap-2 text-ink">
                  <span className="text-muted">Where it goes:</span>
                  <div className="flex overflow-hidden rounded-md border border-line" role="radiogroup" aria-label="Where the accent goes">
                    {(["base", "gables"] as const).map((pl) => (
                      <button
                        key={pl}
                        role="radio"
                        aria-checked={place === pl}
                        disabled={pl === "gables" && !hasGables}
                        onClick={() => onAccentPlace(pl)}
                        className={`px-3 py-1 text-xs ${place === pl ? "bg-accent text-white" : "bg-white hover:bg-stone-100"} disabled:opacity-40`}
                        title={pl === "gables" && !hasGables ? "This roof has no gable ends" : undefined}
                      >
                        {pl === "base" ? "Band along the base (3 ft)" : "Gable ends"}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {products.length === 0 ? (
              <p className="text-sm text-muted">No products for this yet. Add some to data/catalog/{cat.file}.json.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 @4xl:grid-cols-3">
                {shown.map((p) => {
                  const picked = current?.product.id === p.id;
                  return <ProductCard key={p.id} product={p} picked={picked} action={picked ? "Picked" : "Use this"} onAction={() => (picked ? undefined : pick(cat.id, p))} />;
                })}
              </div>
            )}
            {products.length > shown.length && (
              <button className="btn mt-3" onClick={() => setShowAll(true)}>
                Show all {products.length}
              </button>
            )}
          </>
        )}
      </div>

      <aside className="col-span-2 space-y-2 text-sm @4xl:col-span-1">
        <h3 className="font-medium">The outside</h3>
        <ul className="divide-y divide-line">
          {parts.map((c) => {
            const s = exteriorPick(selections, c.id);
            return (
              <li key={c.id} className="flex items-center gap-2 py-1.5">
                {s ? <Swatch product={s.product} className="size-6 shrink-0 rounded" /> : <span className="size-6 shrink-0 rounded border border-dashed border-line" />}
                <button className="min-w-0 flex-1 text-left" onClick={() => setPart(c.id)}>
                  <span className="block text-xs text-muted">{c.label}</span>
                  <span className="block truncate text-xs">{s ? `${s.product.name} · ${priceText(s.product)}` : "Mid-range allowance"}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="pt-2 text-xs text-muted">The cost total at the top changes with every pick. Prices are from each product&apos;s page on the date shown and may have changed.</p>
        <p className="text-xs text-muted">{exteriorCatalog().length} outside products in the catalog.</p>
      </aside>
    </div>
    </div>
  );
}
