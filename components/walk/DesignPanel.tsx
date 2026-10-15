"use client";

import { useMemo, useState } from "react";
import { WHOLE_HOUSE, type FurnitureItem, type Selection } from "@/lib/model/schema";
import { interiorCategory, type InteriorCategoryId } from "@/lib/catalog/categories";
import { pickFor, toProduct } from "@/lib/interior/picks";
import { applyPick, currentPick, scopesFor, type FinishAim, type Scope } from "@/lib/interior/scope";
import { ranked, type Answers } from "@/lib/interior/style";
import { FURNITURE, FURNITURE_COLORS, furnitureType } from "@/lib/plan/furniture";
import ProductCard from "@/components/interior/ProductCard";

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
            {now.pick.product.brand} {now.pick.product.name} <span className="text-xs text-muted">({FROM_TEXT[now.from]})</span>
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

/** The panel for a piece of furniture you clicked: move, turn, color or remove it. */
export function FurniturePanel({
  item,
  warning,
  onColor,
  onMove,
  onTurn,
  onRemove,
}: {
  item: FurnitureItem;
  warning?: string;
  onColor: (color: string) => void;
  onMove: () => void;
  onTurn: (deg: number) => void;
  onRemove: () => void;
}) {
  const t = furnitureType(item.kind);
  return (
    <div className="space-y-4" data-testid="furniture-panel">
      <div>
        <h3 className="text-lg font-semibold leading-tight">{t?.label ?? "Furniture"}</h3>
        <p className="text-xs text-muted">
          {Math.round(item.widthIn)}&quot; × {Math.round(item.depthIn)}&quot;. Furniture isn&apos;t part of the build cost.
        </p>
      </div>
      {warning && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{warning}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button className="btn-primary justify-center" onClick={onMove}>
          Move
        </button>
        <button className="btn justify-center" onClick={onRemove}>
          Remove
        </button>
        <button className="btn justify-center" onClick={() => onTurn(-15)}>
          ↺ Turn left
        </button>
        <button className="btn justify-center" onClick={() => onTurn(15)}>
          Turn right ↻
        </button>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium">Color</p>
        <div className="flex flex-wrap gap-2">
          {FURNITURE_COLORS.map((c) => (
            <button
              key={c.color}
              title={c.label}
              aria-label={c.label}
              onClick={() => onColor(c.color)}
              className={`size-8 rounded-full border border-black/15 ${item.color === c.color ? "ring-2 ring-accent ring-offset-2" : ""}`}
              style={{ background: c.color }}
            />
          ))}
          <label className="flex size-8 cursor-pointer items-center justify-center rounded-full border border-dashed border-line text-xs text-muted" title="Any color">
            +
            <input type="color" className="sr-only" value={item.color ?? "#cfcac0"} onChange={(e) => onColor(e.target.value)} />
          </label>
        </div>
      </div>
      <p className="text-xs text-muted">While walking with Design on: aim at a piece and press R to turn it, or Delete to remove it.</p>
    </div>
  );
}

/** The list of furniture to add. */
export function AddFurniturePanel({ onPick }: { onPick: (kind: string) => void }) {
  const groups = [...new Set(FURNITURE.map((f) => f.group))];
  return (
    <div className="space-y-4" data-testid="add-furniture">
      <div>
        <h3 className="text-lg font-semibold leading-tight">Add furniture</h3>
        <p className="text-xs text-muted">Pick one, then aim at the floor where it goes and click. R turns it.</p>
      </div>
      {groups.map((g) => (
        <div key={g}>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">{g}</p>
          <div className="grid grid-cols-2 gap-2">
            {FURNITURE.filter((f) => f.group === g).map((f) => (
              <button key={f.id} className="btn justify-start text-left text-sm" onClick={() => onPick(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
