"use client";

import type { FloorPlan } from "@/lib/model/schema";
import { formatFeetInches } from "@/lib/model/units";
import { bendInfo, bendToDepth, bendToRadius, bendWall, maxBow, sharedEdges, straighten, type BendTarget } from "@/lib/plan/bend";
import { LengthField } from "./PlanSidePanel";

/** The side panel's curve boxes for one wall: Radius, Bow depth and Make straight (or a way to start a curve). */
export default function CurveFields({ plan, target, onChange }: { plan: FloorPlan; target: BendTarget; onChange: (p: FloorPlan) => void }) {
  const info = bendInfo(plan, target);
  if (!info || info.chord < 6) return null;
  const shared = "roomId" in target && sharedEdges(plan, target.roomId, target.edge).length > 0;
  return (
    <div className="mt-4">
      <p className="field-label">Curve</p>
      {info.radius ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <LengthField label="Radius" value={info.radius} onCommit={(v) => onChange(bendToRadius(plan, target, v))} />
            <LengthField label="Bow depth" value={Math.abs(info.left)} onCommit={(v) => onChange(bendToDepth(plan, target, v))} />
          </div>
          <p className="field-hint">
            {formatFeetInches(info.length)} along the curve, {formatFeetInches(info.chord)} straight across.
            {shared ? " The room on the other side bends with it." : ""}
          </p>
          <button className="btn mt-2 w-full text-sm" onClick={() => onChange(straighten(plan, target))}>
            Make straight
          </button>
        </>
      ) : (
        <>
          <LengthField label="Bow depth" value={0} onCommit={(v) => onChange(bendToDepth(plan, target, Math.min(v, maxBow(info.chord))))} />
          <p className="field-hint">Type how far the middle of the wall bows out, or drag the diamond on the wall.</p>
          <button className="btn mt-2 w-full text-sm" onClick={() => onChange(bendWall(plan, target, "roomId" in target ? info.out * Math.min(info.chord * 0.2, 48) : Math.min(info.chord * 0.2, 48)))}>
            Curve this wall
          </button>
        </>
      )}
    </div>
  );
}
