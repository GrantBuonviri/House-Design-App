"use client";

import type { CustomLand } from "@/lib/model/schema";
import type { MyLandRow } from "@/lib/storage/db";
import { acresOf, boxFeet } from "@/lib/land/designer";

/** The land you designed before, saved in this browser, ready to use for any house. */
export default function MyLandList({
  rows,
  onUse,
  onEdit,
  onDelete,
}: {
  rows: MyLandRow[];
  onUse: (l: CustomLand) => void;
  onEdit: (l: CustomLand) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <section className="mb-5" aria-label="My land">
      <h3 className="mb-2 text-xs font-medium tracking-wide text-accent uppercase">My land</h3>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {rows.map(({ id, land }) => {
          const b = boxFeet(land.outline);
          return (
            <div key={id} className="card flex w-64 shrink-0 flex-col gap-1 p-3">
              <p className="truncate font-semibold">{land.name}</p>
              <p className="text-xs text-muted">
                {acresOf(land.outline).toFixed(2)} acres · {Math.round(b.widthFt)}′ × {Math.round(b.depthFt)}′ · {land.slope.percent}% slope
              </p>
              <div className="mt-1 flex gap-1.5">
                <button className="btn-primary !px-3 !py-1.5" onClick={() => onUse(land)}>
                  Use
                </button>
                <button className="btn !px-3 !py-1.5" onClick={() => onEdit(land)}>
                  Edit
                </button>
                <button className="btn ml-auto !px-3 !py-1.5" aria-label={`Delete ${land.name}`} onClick={() => onDelete(id)}>
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
