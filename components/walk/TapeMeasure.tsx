"use client";

import { useMemo } from "react";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { IN_PER_UNIT, type Frame } from "@/lib/house3d/mesh";
import { reading, showParts, type Tape, type TapePin, type TapePoint } from "@/lib/house3d/tape";
import { formatLength } from "@/lib/plan/labels";
import type { WalkLabels } from "@/lib/model/schema";

/** The tape measure's yellow lines and their length labels in the 3D view. State lives in Walkthrough.tsx. */

function toWorld(p: TapePoint, f: Frame) {
  return new THREE.Vector3((p.x - f.ox) / IN_PER_UNIT, p.z / IN_PER_UNIT, (p.y - f.oy) / IN_PER_UNIT);
}

function Dot({ at, frame }: { at: TapePoint; frame: Frame }) {
  return (
    <mesh position={toWorld(at, frame)} renderOrder={10}>
      <sphereGeometry args={[0.12, 10, 10]} />
      <meshBasicMaterial color="#facc15" depthTest={false} />
    </mesh>
  );
}

function Measured({ tape, frame, units, live, pinned, aimed, onPin }: { tape: Tape; frame: Frame; units: WalkLabels["units"]; live?: boolean; pinned?: boolean; aimed?: boolean; onPin?: () => void }) {
  const a = toWorld(tape.a, frame);
  const b = toWorld(tape.b, frame);
  const line = useMemo(() => {
    const g = new THREE.BufferGeometry().setFromPoints([a, b]);
    const m = new THREE.LineBasicMaterial({ color: aimed ? "#ffffff" : pinned ? "#fde047" : "#facc15", depthTest: false, transparent: true });
    const l = new THREE.Line(g, m);
    l.renderOrder = 10;
    return l;
  }, [a.x, a.y, a.z, b.x, b.y, b.z, pinned, aimed]); // eslint-disable-line react-hooks/exhaustive-deps
  const r = reading(tape);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const f = (n: number) => formatLength(n, units);
  return (
    <>
      <primitive object={line} />
      <Dot at={tape.a} frame={frame} />
      <Dot at={tape.b} frame={frame} />
      <Html position={mid} center zIndexRange={[15, 0]} style={{ pointerEvents: onPin ? "auto" : "none" }}>
        <div className={`whitespace-nowrap rounded bg-black/75 px-2 py-0.5 text-center text-yellow-300 ${live ? "opacity-90" : ""} ${aimed ? "outline outline-2 outline-white" : ""}`} data-testid={pinned ? "pin-label" : "tape-label"}>
          <span className="text-sm font-semibold">{pinned ? "📌 " : ""}{f(r.length)}</span>
          {showParts(r) && (
            <span className="block text-[11px] font-normal text-yellow-100/90">
              level {f(r.level)} · height {f(r.height)}
            </span>
          )}
          {onPin && (
            <button className="mt-0.5 block w-full rounded bg-yellow-300 px-2 text-[11px] font-medium text-black" onClick={onPin} data-testid="pin-button">
              Pin (P)
            </button>
          )}
        </div>
      </Html>
    </>
  );
}

export function TapeMeasure({ done, first, hover, frame, units, pins = [], aimedPin, canPin, onPin }: { done: Tape[]; first: TapePoint | null; hover: TapePoint | null; frame: Frame; units: WalkLabels["units"]; pins?: TapePin[]; aimedPin?: string | null; canPin?: boolean; onPin?: (index: number) => void }) {
  return (
    <>
      {pins.map((p) => (
        <Measured key={p.id} tape={p} frame={frame} units={units} pinned aimed={p.id === aimedPin} />
      ))}
      {done.map((t, i) => (
        <Measured key={i} tape={t} frame={frame} units={units} onPin={canPin && onPin ? () => onPin(i) : undefined} />
      ))}
      {first && <Dot at={first} frame={frame} />}
      {first && hover && <Measured tape={{ a: first, b: hover }} frame={frame} units={units} live />}
    </>
  );
}
