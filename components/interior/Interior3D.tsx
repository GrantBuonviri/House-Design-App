"use client";

import { useProjectStore } from "@/lib/store/projectStore";
import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { Point, Project } from "@/lib/model/schema";
import { lotOffsetFor } from "@/lib/house3d/site";
import type { WallsShown } from "@/components/house3d/House3DView";

const HEIGHT = 520;

const House3DView = dynamic(() => import("@/components/house3d/House3DView"), {
  ssr: false,
  loading: () => <div className="w-full animate-pulse rounded-lg bg-stone-100" style={{ height: HEIGHT }} />,
});

/** The house in 3D with the picked finishes, roof off, looking into the floor of the room being picked for. */
export default function Interior3D({ project, roomId }: { project: Project; roomId: string | null }) {
  const update = useProjectStore((s) => s.update);
  const levels = useMemo(() => [...project.levels].sort((a, b) => a.elevationIn - b.elevationIn), [project.levels]);
  const offsetKey = JSON.stringify(lotOffsetFor(project));
  const offset = useMemo<Point>(() => JSON.parse(offsetKey), [offsetKey]);
  const roomLevel = roomId ? levels.find((l) => project.floorPlans[l.id]?.rooms.some((r) => r.id === roomId))?.id : undefined;
  const firstUsed = levels.find((l) => (project.floorPlans[l.id]?.rooms.length ?? 0) > 0)?.id ?? levels[0].id;
  const [walls, setWalls] = useState<WallsShown>("all");
  const levelId = roomLevel ?? firstUsed;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-muted">Roof off, looking into {levels.find((l) => l.id === levelId)?.name ?? "the house"}. Drag to turn, scroll to zoom.</span>
        <label className="flex items-center gap-2">
          Walls
          <select className="input w-auto py-1" value={walls} onChange={(e) => setWalls(e.target.value as WallsShown)}>
            <option value="all">All</option>
            <option value="outside">Outside only</option>
            <option value="none">None</option>
          </select>
        </label>
      </div>
      <House3DView
        plans={project.floorPlans}
        levels={levels}
        basics={project.plan.basics}
        house3d={project.house3d}
        interior={project.interior.selections}
        exterior={project.exterior}
        plot={project.plot}
        offset={offset}
        levelId={levelId}
        cutAway
        roof={false}
        walls={walls}
        editing={false}
        viewOnly
        onEditing={() => {}}
        selection={roomId ? [{ kind: "room", id: roomId }] : []}
        snap={false}
        height={HEIGHT}
        onSelect={() => {}}
        onChange={() => {}}
        onTopLabels={(topLabels) => update((p) => ({ ...p, house3d: { ...p.house3d, topLabels } }))}
      />
    </div>
  );
}
