"use client";

import { useState } from "react";
import type { Product } from "@/lib/model/schema";
import { FAUCET_SHAPES, SHAPES_FOR, type Faucet, type FaucetShape } from "@/lib/furnish/faucets";
import { faucetCategoryLabel, faucetProducts } from "@/lib/furnish/faucetPick";
import { toProduct, productTitle } from "@/lib/interior/picks";
import { priceText } from "@/components/interior/ProductCard";
import { Panel } from "@/components/plan/PlanSidePanel";

export type FaucetChangeIn = { shape?: FaucetShape | null; alongIn?: number } | "remove" | "restore";

const KIND_NAME: Record<Faucet["kind"], string> = { kitchen: "Kitchen faucet", prep: "Bar or prep sink faucet", bath: "Bath faucet", laundry: "Laundry sink faucet", tub: "Tub spout and handles", shower: "Shower head and valve" };

/**
 * The right panel for a picked faucet, tub spout or shower: shape, product
 * (the room's Interior design pick), slide along the basin, Remove or Put
 * back. Shared by the Furnish page and the walkthrough's Place tab.
 */
export default function FaucetPanel({
  faucet,
  fixtureLabel,
  usedFor,
  onChange,
  onPick,
}: {
  faucet: Faucet;
  fixtureLabel: string;
  /** One line saying whose pick this is. */
  usedFor: string;
  onChange: (c: FaucetChangeIn) => void;
  /** Pick a product for the room (null clears the pick). */
  onPick: (p: Product | null) => void;
}) {
  const [all, setAll] = useState(false);
  const products = faucetProducts(faucet.kind);
  const shown = all ? products : products.slice(0, 6);
  const shapes = SHAPES_FOR[faucet.kind];
  return (
    <Panel title={KIND_NAME[faucet.kind]}>
      <p className="-mt-2 mb-3 text-xs text-muted" data-testid="faucet-note">
        On the {fixtureLabel.toLowerCase()}. {faucet.removed ? "Taken off." : faucet.auto ? "Placed by the app. Changing it makes it yours." : "Changed by you."}
      </p>
      {faucet.removed ? (
        <button className="btn-primary w-full justify-center" onClick={() => onChange("restore")} data-testid="faucet-restore">
          Put the faucet back
        </button>
      ) : (
        <>
          <p className="field-label">Shape</p>
          <div className="space-y-1" role="radiogroup" aria-label="Shape of the faucet">
            {shapes.map((s) => (
              <button key={s} role="radio" aria-checked={faucet.shape === s} onClick={() => faucet.shape !== s && onChange({ shape: s })} className={`w-full rounded-md border px-2 py-1.5 text-left text-sm ${faucet.shape === s ? "border-accent bg-stone-100 font-medium" : "border-line hover:bg-stone-50"}`} data-testid={`faucet-shape-${s}`}>
                {FAUCET_SHAPES[s].label}
              </button>
            ))}
          </div>
          {faucet.maxAlongIn > 0 && (
            <div className="mt-4">
              <label className="field-label" htmlFor="faucet-along">
                Slide along the {faucet.kind === "shower" ? "wall" : "basin"}
              </label>
              <input id="faucet-along" type="range" className="w-full" min={-faucet.maxAlongIn} max={faucet.maxAlongIn} step={0.5} value={faucet.alongIn} onChange={(e) => onChange({ alongIn: Number(e.target.value) })} data-testid="faucet-along" />
              <p className="text-xs text-muted">{faucet.alongIn === 0 ? "In the middle" : `${Math.abs(faucet.alongIn)}" to the ${faucet.alongIn < 0 ? "left" : "right"}`}</p>
            </div>
          )}
          <p className="field-label mt-4">{faucetCategoryLabel(faucet.kind)}</p>
          <p className="mb-2 text-xs text-muted" data-testid="faucet-used-for">
            {usedFor}
          </p>
          {faucet.product && (
            <p className="mb-2 text-xs">
              Picked: <span className="font-medium">{productTitle(faucet.product)}</span>{" "}
              <button className="text-accent underline" onClick={() => onPick(null)} data-testid="faucet-clear-pick">
                Clear
              </button>
            </p>
          )}
          <ul className="space-y-1" data-testid="faucet-products">
            {shown.map((p) => {
              const picked = faucet.product?.id === p.id;
              return (
                <li key={p.id}>
                  <button disabled={picked} onClick={() => onPick(toProduct(p))} className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs ${picked ? "border-accent bg-stone-100" : "border-line hover:bg-stone-50"}`} data-testid={`faucet-product-${p.id}`}>
                    <span className="size-4 shrink-0 rounded-full border border-line" style={{ background: p.color }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{p.name}</span>
                      <span className="block truncate text-muted">{p.brand}</span>
                    </span>
                    <span className="shrink-0 text-muted">{picked ? "Picked" : priceText(p)}</span>
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
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button className="btn text-sm" disabled={faucet.auto} onClick={() => onChange({ shape: null, alongIn: 0 })} data-testid="faucet-auto">
              Back to automatic
            </button>
            <button className="btn text-sm text-red-700" onClick={() => onChange("remove")} data-testid="faucet-remove">
              Remove
            </button>
          </div>
        </>
      )}
    </Panel>
  );
}
