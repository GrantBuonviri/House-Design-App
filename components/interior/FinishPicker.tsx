"use client";

import { useMemo, useState } from "react";
import { WHOLE_HOUSE, type Selection } from "@/lib/model/schema";
import { catalog, type CatalogProduct } from "@/lib/catalog/catalog";
import { categoriesFor, effectivePick, pickFor, setPick, toProduct, type InteriorRoom } from "@/lib/interior/picks";
import { ranked, type Answers } from "@/lib/interior/style";
import type { InteriorCategoryId } from "@/lib/catalog/categories";
import ProductCard, { priceText } from "./ProductCard";
import Swatch from "./Swatch";

/**
 * Pick finishes: the whole house or a room on the left, a category and its
 * products (best style match first) in the middle, and what's picked on the right.
 */
export default function FinishPicker({
  rooms,
  selections,
  answers,
  onChange,
  target,
  setTarget,
}: {
  rooms: InteriorRoom[];
  selections: Selection[];
  answers: Answers;
  onChange: (next: Selection[]) => void;
  /** The room picked for (or "house"). */
  target: string;
  setTarget: (id: string) => void;
}) {
  const room = rooms.find((r) => r.id === target);
  const cats = categoriesFor(room);
  const [catId, setCatId] = useState<InteriorCategoryId>("flooring");
  const cat = cats.find((c) => c.id === catId) ?? cats[0];
  const [showAll, setShowAll] = useState(false);

  const products = useMemo(() => (cat ? ranked(cat.id, answers, room?.type) : []), [cat, answers, room?.type]);
  const shown = showAll ? products : products.slice(0, 9);

  const levels = [...new Set(rooms.map((r) => r.levelName))];
  const current = cat ? (room ? effectivePick(selections, room.id, cat.id) : (() => {
    const s = pickFor(selections, WHOLE_HOUSE, cat.id);
    return s ? { pick: s, own: true } : null;
  })()) : null;

  const pick = (p: CatalogProduct | null) => cat && onChange(setPick(selections, target, cat.id, p ? toProduct(p) : null));
  const ownPicks = (id: string) => selections.filter((s) => s.targetId === id).length;

  return (
    <div className="grid grid-cols-[200px_1fr_240px] gap-5">
      <nav className="space-y-3 text-sm">
        <button
          onClick={() => setTarget(WHOLE_HOUSE)}
          className={`w-full rounded-md px-3 py-2 text-left ${target === WHOLE_HOUSE ? "bg-accent text-white" : "hover:bg-stone-100"}`}
        >
          Whole house
          <span className={`block text-xs ${target === WHOLE_HOUSE ? "text-white/80" : "text-muted"}`}>Every room uses these unless it has its own</span>
        </button>
        {rooms.length === 0 && <p className="px-3 text-xs text-muted">Draw a floor plan to pick finishes room by room. Whole-house picks work now.</p>}
        {levels.map((lv) => (
          <div key={lv}>
            {levels.length > 1 && <div className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted">{lv}</div>}
            {rooms
              .filter((r) => r.levelName === lv)
              .map((r) => (
                <button
                  key={r.id}
                  onClick={() => setTarget(r.id)}
                  className={`flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left ${target === r.id ? "bg-accent text-white" : "hover:bg-stone-100"}`}
                >
                  <span className="truncate">{r.name}</span>
                  {ownPicks(r.id) > 0 && (
                    <span className={`ml-2 rounded-full px-1.5 text-[11px] ${target === r.id ? "bg-white/25" : "bg-accent-soft text-accent"}`} title="Picks just for this room">
                      {ownPicks(r.id)}
                    </span>
                  )}
                </button>
              ))}
          </div>
        ))}
      </nav>

      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {cats.map((c) => {
            const has = room ? effectivePick(selections, room.id, c.id) : pickFor(selections, WHOLE_HOUSE, c.id);
            return (
              <button
                key={c.id}
                onClick={() => {
                  setCatId(c.id);
                  setShowAll(false);
                }}
                className={`rounded-full border px-3 py-1 text-xs ${c.id === cat?.id ? "border-accent bg-accent text-white" : "border-line bg-white hover:border-stone-400"}`}
              >
                {has ? "✓ " : ""}
                {c.label}
              </button>
            );
          })}
        </div>
        {cat && (
          <>
            <div className="mb-3 text-sm text-muted">
              {room ? (
                current ? (
                  current.own ? (
                    <>
                      {room.name} has its own {cat.one}.{" "}
                      <button className="text-accent underline" onClick={() => pick(null)}>
                        {pickFor(selections, WHOLE_HOUSE, cat.id) ? "Use the whole-house pick instead" : "Clear it"}
                      </button>
                    </>
                  ) : (
                    <>Using the whole-house {cat.one}. Pick one below to use something else in {room.name}.</>
                  )
                ) : (
                  <>No {cat.one} picked yet, so {room.name} is priced at mid-range.</>
                )
              ) : current ? (
                <>
                  Every room uses this {cat.one} unless it has its own.{" "}
                  <button className="text-accent underline" onClick={() => pick(null)}>
                    Clear it
                  </button>
                </>
              ) : cat.perRoom ? (
                <>Pick a {cat.one} for the whole house. You can change single rooms after.</>
              ) : (
                <>Pick a {cat.one} for the whole house.</>
              )}
            </div>
            {products.length === 0 ? (
              <p className="text-sm text-muted">No products in this category yet. Add some to data/catalog/{cat.id}.json.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                {shown.map((p) => {
                  const picked = current?.pick.product.id === p.id;
                  return (
                    <ProductCard
                      key={p.id}
                      product={p}
                      picked={picked}
                      note={picked && room && !current?.own ? "Whole-house pick" : undefined}
                      action={picked ? (room && !current?.own ? "Use just here" : "Picked") : room ? "Use in this room" : "Use everywhere"}
                      onAction={() => (picked && (!room || current?.own) ? undefined : pick(p))}
                    />
                  );
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

      <aside className="space-y-2 text-sm">
        <h3 className="font-medium">{room ? room.name : "Whole house"}</h3>
        <p className="text-xs text-muted">{room ? "What this room uses" : "Picked for every room"}</p>
        <ul className="divide-y divide-line">
          {cats.map((c) => {
            const e = room ? effectivePick(selections, room.id, c.id) : (() => {
              const s = pickFor(selections, WHOLE_HOUSE, c.id);
              return s ? { pick: s, own: true } : null;
            })();
            return (
              <li key={c.id} className="flex items-center gap-2 py-1.5">
                {e ? <Swatch product={e.pick.product} className="size-6 shrink-0 rounded" /> : <span className="size-6 shrink-0 rounded border border-dashed border-line" />}
                <button className="min-w-0 flex-1 text-left" onClick={() => setCatId(c.id)}>
                  <span className="block text-xs text-muted">{c.label}</span>
                  <span className="block truncate text-xs">
                    {e ? `${e.pick.product.name} · ${priceText(e.pick.product)}` : "Mid-range allowance"}
                    {e && room && !e.own ? " (whole house)" : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="pt-2 text-xs text-muted">The cost total at the top changes with every pick. Prices are from each product&apos;s page on the date shown and may have changed.</p>
        <p className="text-xs text-muted">{catalog().length} products in the catalog.</p>
      </aside>
    </div>
  );
}
