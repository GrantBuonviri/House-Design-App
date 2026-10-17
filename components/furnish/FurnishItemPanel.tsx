"use client";

import { useState } from "react";
import type { FloorPlan } from "@/lib/model/schema";
import { swapChoices } from "@/lib/furnish/catalog";
import type { LayerItem } from "@/lib/furnish/layer";
import { copyToRooms, deleteItem, duplicateItem, patchItem, sameTypeRooms, setWallGap, swapTo, wallGaps } from "@/lib/furnish/stage";
import { FURNITURE_COLORS } from "@/lib/plan/furniture";
import type { Product } from "@/lib/model/schema";
import type { CatalogProduct } from "@/lib/catalog/catalog";
import ProductList from "./ProductList";
import { LengthField, Panel, TurnButtons } from "@/components/plan/PlanSidePanel";

const SIDE = { up: "To the wall above", down: "To the wall below", left: "To the wall on the left", right: "To the wall on the right" } as const;

type Done = { plan: FloorPlan; id: string | null };

/**
 * The right panel of the Furnish page for one picked item: sizes typed in feet
 * and inches, turn, distances to the walls around it, color, Swap for…,
 * Delete, Duplicate and Copy to the other rooms of its kind.
 */
export default function FurnishItemPanel({
  plan,
  item,
  ceilingIn,
  roomName,
  onApply,
  onDelete,
  onMessage,
  faucet,
  onFaucet,
  onPotFiller,
  productPick,
}: {
  plan: FloorPlan;
  item: LayerItem;
  ceilingIn: number;
  roomName?: string;
  /** A new plan and which item to keep picked (null when nothing is left picked); `coalesce` joins typing/color changes into one undo step. */
  onApply: (out: Done, coalesce?: string) => void;
  onDelete: (plan: FloorPlan) => void;
  onMessage: (text: string) => void;
  /** The faucet of a sink, vanity, tub or shower: Edit faucet / Put the faucet back. */
  faucet?: { removed: boolean };
  onFaucet?: (action: "edit" | "restore") => void;
  /** A range: "Add a pot filler above". */
  onPotFiller?: () => void;
  /** A pot filler: the room's Interior design product list. */
  productPick?: { label: string; usedFor: string; products: CatalogProduct[]; picked: Product | null; onPick: (p: Product | null) => void };
}) {
  const [swapKey, setSwapKey] = useState(0);
  const patch = (p: Parameters<typeof patchItem>[2], coalesce?: string) => onApply(patchItem(plan, item, p), coalesce);
  const sizeable = item.kind !== "device";
  const tall = item.kind === "addon" || item.kind === "cabinet";
  const colorable = item.kind === "furniture" || item.kind === "addon";
  const gaps = wallGaps(plan, item);
  const swaps = swapChoices(item.entryId);
  const siblings = sameTypeRooms(plan, item);

  return (
    <Panel title={item.label}>
      <p className="-mt-2 mb-3 text-xs text-muted" data-testid="furnish-item-note">
        {roomName ? `In ${roomName}. ` : "Not in a room. "}
        {item.auto ? "Placed by the app. Changing it makes it yours." : ""}
      </p>
      {sizeable && (
        <div className="grid grid-cols-2 gap-2">
          <LengthField label="Width" value={item.widthIn} onCommit={(v) => patch({ widthIn: Math.max(2, v) })} />
          {item.kind !== "device" && <LengthField label="Depth" value={Math.max(item.depthIn, 1)} onCommit={(v) => patch({ depthIn: Math.max(1, v) })} />}
          {tall && <LengthField label="Height" value={item.heightIn} onCommit={(v) => patch({ heightIn: Math.max(1, v) })} />}
          {item.mount === "wall" && tall && <LengthField label="Off the floor" value={Math.max(item.bottomIn, 1)} onCommit={(v) => patch({ bottomIn: Math.max(0, v) })} />}
        </div>
      )}
      <TurnButtons onTurn={(deg) => patch({ rotation: item.rotation + deg })} />
      {gaps.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {gaps.map((g) => (
            <LengthField key={g.side} label={SIDE[g.side]} value={g.inches} onCommit={(v) => onApply(setWallGap(plan, item, g, v), "gap")} />
          ))}
        </div>
      )}
      {colorable && (
        <div className="mt-4">
          <p className="field-label">Color</p>
          <div className="flex flex-wrap gap-1">
            {FURNITURE_COLORS.map((c) => (
              <button key={c.color} className="size-6 rounded-full border border-line" style={{ background: c.color, outline: item.color === c.color ? "2px solid var(--color-accent)" : undefined }} title={c.label} aria-label={c.label} onClick={() => patch({ color: c.color })} />
            ))}
          </div>
        </div>
      )}
      {swaps.length > 0 && (
        <div className="mt-4">
          <label className="field-label" htmlFor="furnish-swap">
            Swap for…
          </label>
          <select
            id="furnish-swap"
            key={swapKey}
            className="input"
            defaultValue=""
            onChange={(e) => {
              if (!e.target.value) return;
              onApply(swapTo(plan, item, e.target.value, ceilingIn));
              setSwapKey((k) => k + 1);
            }}
          >
            <option value="">Pick something else of the same kind</option>
            {swaps.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {faucet && onFaucet && (
        <div className="mt-4 flex items-center justify-between gap-2 rounded-md border border-line px-2 py-1.5 text-sm" data-testid="furnish-faucet-line">
          <span>Faucet: {faucet.removed ? "taken off" : "on"}</span>
          <button className="btn px-2 py-0.5 text-xs" onClick={() => onFaucet(faucet.removed ? "restore" : "edit")} data-testid={faucet.removed ? "furnish-faucet-restore" : "furnish-faucet-edit"}>
            {faucet.removed ? "Put the faucet back" : "Edit faucet"}
          </button>
        </div>
      )}
      {productPick && (
        <div className="mt-4" data-testid="furnish-product-pick">
          <p className="field-label">{productPick.label}</p>
          <p className="mb-2 text-xs text-muted">{productPick.usedFor}</p>
          <ProductList products={productPick.products} picked={productPick.picked} onPick={productPick.onPick} idPrefix="potfiller" />
        </div>
      )}
      {onPotFiller && (
        <button className="btn mt-4 w-full justify-center text-sm" onClick={onPotFiller} data-testid="furnish-add-pot-filler">
          Add a pot filler above
        </button>
      )}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          className="btn text-sm"
          data-testid="furnish-duplicate"
          onClick={() => {
            const out = duplicateItem(plan, item, undefined, ceilingIn);
            if (out) onApply(out);
            else onMessage("There's no room for another one next to it.");
          }}
        >
          Duplicate
        </button>
        <button
          className="btn text-sm"
          disabled={siblings.length === 0}
          title={siblings.length ? `Copy it to the same spot in ${siblings.map((r) => r.name).join(", ")}` : "No other room of this kind"}
          onClick={() => {
            const out = copyToRooms(plan, item, ceilingIn);
            if (out.placed) onApply({ plan: out.plan, id: item.id });
            onMessage(
              out.placed
                ? `Copied to ${out.placed} other ${out.placed === 1 ? "room" : "rooms"}.${out.skipped.length ? ` No room in ${out.skipped.join(", ")}.` : ""}`
                : `It doesn't fit in ${out.skipped.join(", ") || "another room"}.`,
            );
          }}
        >
          Copy to other rooms
        </button>
      </div>
      <button className="mt-4 text-sm text-red-700 hover:underline" data-testid="furnish-delete" onClick={() => onDelete(deleteItem(plan, item))}>
        Delete this {item.label.toLowerCase()}
      </button>
    </Panel>
  );
}
