"use client";

import { useMemo, useState } from "react";
import { WHOLE_HOUSE, type Selection } from "@/lib/model/schema";
import { interiorCategory, type InteriorCategoryId } from "@/lib/catalog/categories";
import { pickFor, productTitle, toProduct } from "@/lib/interior/picks";
import { applyPick, currentPick, scopesFor, type FinishAim, type Scope } from "@/lib/interior/scope";
import { ranked, type Answers } from "@/lib/interior/style";
import ProductCard from "@/components/interior/ProductCard";
import { exteriorCategory, type ExteriorCategoryId } from "@/lib/catalog/exterior";
import { exteriorPick, sidingPaintApplies } from "@/lib/exterior/picks";
import { rankedExterior } from "@/lib/exterior/style";
import { setPick } from "@/lib/interior/picks";
import type { Aim } from "@/lib/interior/surfaces";

const SCOPE_LABEL: Record<Scope, string> = { wall: "This wall", room: "This room", house: "Whole house" };
const FROM_TEXT: Record<Scope, string> = { wall: "this wall's own paint", room: "this room's own pick", house: "the whole-house pick" };

/** The panel on the right of the walkthrough for changing what you clicked: products that fit, best style match first. */
export function FinishPanel({ aim, selections, answers, onChange }: { aim: FinishAim; selections: Selection[]; answers: Answers; onChange: (next: Selection[]) => void }) {
  const [catId, setCatId] = useState<InteriorCategoryId>(aim.categories[0]);
  const cat = interiorCategory(catId)!;
  const { scopes, start } = useMemo(() => scopesFor(aim, catId, selections), [aim, catId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [scopeChoice, setScope] = useState<{ cat: string; scope: Scope } | null>(null);
  const scope = scopeChoice?.cat === catId && scopes.includes(scopeChoice.scope) ? scopeChoice.scope : start;
  const [showAll, setShowAll] = useState(false);
  const products = useMemo(() => ranked(catId, answers, aim.room?.type), [catId, answers, aim.room?.type]);
  const shown = showAll ? products : products.slice(0, 8);
  const now = currentPick(aim, catId, selections);
  const atScope = scope === "wall" ? (now?.from === "wall" ? now.pick : undefined) : scope === "room" ? pickFor(selections, aim.room!.id, catId) : pickFor(selections, WHOLE_HOUSE, catId);

  return (
    <div className="space-y-4" data-testid="design-panel">
      <div>
        <h3 className="text-lg font-semibold leading-tight">{aim.label}</h3>
        {aim.room && <p className="text-xs text-muted">{aim.room.name}</p>}
      </div>

      {aim.categories.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="What to change">
          {aim.categories.map((id) => (
            <button
              key={id}
              role="tab"
              aria-selected={id === catId}
              onClick={() => {
                setCatId(id);
                setShowAll(false);
              }}
              className={`rounded-full border px-3 py-1 text-xs ${id === catId ? "border-accent bg-accent text-white" : "border-line hover:bg-stone-100"}`}
            >
              {interiorCategory(id)?.label}
            </button>
          ))}
        </div>
      )}

      <div>
        <div className="flex overflow-hidden rounded-md border border-line text-sm" role="radiogroup" aria-label="Where the pick goes">
          {scopes.map((s) => (
            <button
              key={s}
              role="radio"
              aria-checked={scope === s}
              onClick={() => setScope({ cat: catId, scope: s })}
              className={`flex-1 px-2 py-1.5 ${scope === s ? "bg-ink text-white" : "hover:bg-stone-100"}`}
            >
              {SCOPE_LABEL[s]}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-muted">
          {scope === "house"
            ? cat.perRoom
              ? "Every room without its own pick uses this."
              : `${cat.label} are picked for the whole house.`
            : scope === "room"
              ? `Just the ${aim.room!.name.toLowerCase()}.`
              : `Just this wall. The rest of the ${aim.room!.name.toLowerCase()} keeps its paint.`}
        </p>
      </div>

      <div className="rounded-md bg-stone-50 px-3 py-2 text-sm">
        <span className="text-muted">Now: </span>
        {now ? (
          <>
            {productTitle(now.pick.product)} <span className="text-xs text-muted">({FROM_TEXT[now.from]})</span>
          </>
        ) : (
          <span>mid-range allowance, nothing picked</span>
        )}
        {atScope && scope !== "house" && (
          <button className="ml-2 text-xs text-accent underline" onClick={() => onChange(applyPick(aim, catId, scope, selections, null))}>
            {scope === "wall" ? "Use the room's paint" : "Back to whole house"}
          </button>
        )}
        {atScope && scope === "house" && (
          <button className="ml-2 text-xs text-accent underline" onClick={() => onChange(applyPick(aim, catId, scope, selections, null))}>
            Clear
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {shown.map((p) => {
          const picked = atScope?.product.id === p.id;
          return (
            <ProductCard
              key={p.id}
              product={p}
              picked={picked}
              action={picked ? "Picked" : "Use this"}
              onAction={() => !picked && onChange(applyPick(aim, catId, scope, selections, toProduct(p)))}
            />
          );
        })}
      </div>
      {products.length > shown.length && (
        <button className="btn w-full justify-center" onClick={() => setShowAll(true)}>
          Show all {products.length}
        </button>
      )}
    </div>
  );
}

/** The panel for a part of the outside you clicked: products that fit, best style match first, picked for the whole house. */
export function OutsidePanel({
  aim,
  selections,
  answers,
  onChange,
}: {
  aim: Extract<Aim, { kind: "outside" }>;
  selections: Selection[];
  answers: Answers;
  onChange: (next: Selection[]) => void;
}) {
  const [catId, setCatId] = useState<ExteriorCategoryId>(aim.categories[0]);
  const cat = exteriorCategory(catId)!;
  const [showAll, setShowAll] = useState(false);
  const products = useMemo(() => rankedExterior(catId, answers), [catId, answers]);
  const shown = showAll ? products : products.slice(0, 8);
  const now = exteriorPick(selections, catId);
  const pick = (p: Parameters<typeof toProduct>[0] | null) => onChange(setPick(selections, WHOLE_HOUSE, catId, p ? toProduct(p) : null));
  return (
    <div className="space-y-4" data-testid="design-panel">
      <div>
        <h3 className="text-lg font-semibold leading-tight">{aim.label}</h3>
        <p className="text-xs text-muted">Outside picks go on the whole house.</p>
      </div>
      {aim.categories.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="What to change">
          {aim.categories.map((id) => (
            <button
              key={id}
              role="tab"
              aria-selected={id === catId}
              onClick={() => {
                setCatId(id);
                setShowAll(false);
              }}
              className={`rounded-full border px-3 py-1 text-xs ${id === catId ? "border-accent bg-accent text-white" : "border-line hover:bg-stone-100"}`}
            >
              {exteriorCategory(id)?.label}
            </button>
          ))}
        </div>
      )}
      {catId === "siding-paint" && !sidingPaintApplies(selections) && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">The siding picked keeps its own color, so paint won&apos;t change it.</p>
      )}
      <div className="rounded-md bg-stone-50 px-3 py-2 text-sm">
        <span className="text-muted">Now: </span>
        {now ? (
          <>
            {productTitle(now.product)}
            <button className="ml-2 text-xs text-accent underline" onClick={() => pick(null)}>
              Clear
            </button>
          </>
        ) : (
          <span>mid-range {cat.one}, nothing picked</span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {shown.map((p) => {
          const picked = now?.product.id === p.id;
          return <ProductCard key={p.id} product={p} picked={picked} action={picked ? "Picked" : "Use this"} onAction={() => !picked && pick(p)} />;
        })}
      </div>
      {products.length > shown.length && (
        <button className="btn w-full justify-center" onClick={() => setShowAll(true)}>
          Show all {products.length}
        </button>
      )}
    </div>
  );
}
