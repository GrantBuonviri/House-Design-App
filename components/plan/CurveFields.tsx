"use client";

import { useState } from "react";
import type { FloorPlan } from "@/lib/model/schema";
import { curveTogether, isRun, runInfo, runOf, runToDepth, runToRadius, straightenRun, type RunEdit } from "@/lib/plan/curveRun";
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

/** The same boxes for two or more picked walls that meet end to end: they bend together as one curve. */
export function RunCurveFields({ plan, targets, onChange }: { plan: FloorPlan; targets: BendTarget[]; onChange: (p: FloorPlan) => void }) {
  const [why, setWhy] = useState<string | null>(null);
  const run = runOf(plan, targets);
  if (!isRun(run)) return <p className="field-hint mt-4">To bend these walls together, pick walls that meet end to end. {run.why}</p>;
  const info = runInfo(plan, run);
  const apply = (out: RunEdit) => {
    if ("why" in out) return setWhy(out.why);
    setWhy(null);
    onChange(out.plan);
  };
  return (
    <div className="mt-4">
      <p className="field-label">Curve these {run.pieces.length} walls together</p>
      {info.radius ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <LengthField label="Radius" value={info.radius} onCommit={(v) => apply(runToRadius(plan, run, v))} />
            <LengthField label="Bow depth" value={Math.abs(info.left)} onCommit={(v) => apply(runToDepth(plan, run, v))} />
          </div>
          <p className="field-hint">
            One curve, {formatFeetInches(info.length)} along it and {formatFeetInches(info.chord)} straight across. The corners between them stay on the curve.
          </p>
          <button className="btn mt-2 w-full text-sm" onClick={() => apply(straightenRun(plan, run))}>
            Make straight
          </button>
        </>
      ) : (
        <>
          <LengthField label="Bow depth" value={0} onCommit={(v) => apply(runToDepth(plan, run, Math.min(v, maxBow(info.chord))))} />
          <p className="field-hint">They bend as one curve from end to end, with the corners between them kept on it. Drag the diamond, or:</p>
          <button className="btn mt-2 w-full text-sm" onClick={() => apply(curveTogether(plan, run))}>
            Curve together
          </button>
        </>
      )}
      {why && <p className="field-hint text-red-700">{why}</p>}
    </div>
  );
}
