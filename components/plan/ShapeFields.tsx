"use client";

import { useState } from "react";
import type { FloorPlan } from "@/lib/model/schema";
import { addBay, DEFAULT_BAY_DEPTH_IN, DEFAULT_BAY_WIDTH_IN, DEFAULT_CORNER_RADIUS_IN, roundAllCorners, whyNoBay } from "@/lib/plan/shapes";
import { LengthField } from "./PlanSidePanel";

/** Room panel: round the corners to a radius you type (2' to start). */
export function RoundCornerFields({ plan, roomId, onChange }: { plan: FloorPlan; roomId: string; onChange: (p: FloorPlan) => void }) {
  const [note, setNote] = useState("");
  const [radius, setRadius] = useState(DEFAULT_CORNER_RADIUS_IN);
  return (
    <div className="mt-4">
      <p className="field-label">Round the corners</p>
      <LengthField label="Radius" value={radius} onCommit={setRadius} />
      <button
        className="btn mt-2 w-full text-sm"
        onClick={() => {
          const out = roundAllCorners(plan, roomId, radius);
          if (out) onChange(out);
          setNote(out ? "" : "No corner here can be rounded. Curved walls and very short walls are left alone.");
        }}
      >
        Round all corners
      </button>
      <p className="field-hint">{note || "To round just one, right-click its corner dot and pick Round corner."}</p>
    </div>
  );
}

/** Wall panel: add a half-round bay on an outside wall. */
export function BayFields({ plan, roomId, edge, onChange }: { plan: FloorPlan; roomId: string; edge: number; onChange: (p: FloorPlan) => void }) {
  const [width, setWidth] = useState(DEFAULT_BAY_WIDTH_IN);
  const [depth, setDepth] = useState(DEFAULT_BAY_DEPTH_IN);
  const why = whyNoBay(plan, roomId, edge);
  return (
    <div className="mt-4">
      <p className="field-label">Half-round bay</p>
      <div className="grid grid-cols-2 gap-2">
        <LengthField label="Width" value={width} onCommit={setWidth} />
        <LengthField label="Depth" value={depth} onCommit={setDepth} />
      </div>
      <button className="btn mt-2 w-full text-sm" disabled={!!why} title={why ?? undefined} onClick={() => { const out = addBay(plan, roomId, edge, width, depth); if (out) onChange(out); }}>
        Add half-round bay
      </button>
      <p className="field-hint">{why ?? "A curved bump out of this wall, with the room growing into it. A depth of half the width makes a half circle."}</p>
    </div>
  );
}
