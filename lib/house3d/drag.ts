import type { FloorPlan, Point } from "@/lib/model/schema";
import { moveMany, moveOpeningTo } from "@/lib/plan/edit";
import { snapMove } from "@/lib/plan/snap";
import type { PickKind } from "./build";

/** How close (inches) a moved room's corner must come to another room's corner to snap to it. */
export const SNAP_IN = 6;
/** How far (inches) from a wall a dragged door or window can be and still hop onto it. */
export const WALL_REACH_IN = 24;

/**
 * Where things end up when dragged in 3D, from where the drag started
 * (`base`, `from`) to the point now under the pointer on their floor. Rooms,
 * stairs and fixtures move together; doors and windows slide along walls.
 */
export function dragPlan(base: FloorPlan, kind: PickKind, ids: string[], from: Point, to: Point, snap: boolean): FloorPlan {
  if (kind === "opening") return moveOpeningTo(base, ids[0], to, WALL_REACH_IN);
  let dx = to.x - from.x;
  let dy = to.y - from.y;
  const moving = base.rooms.filter((r) => ids.includes(r.id)).flatMap((r) => r.polygon);
  const still = base.rooms.filter((r) => !ids.includes(r.id)).flatMap((r) => r.polygon);
  if (moving.length) ({ dx, dy } = snapMove(moving, still, dx, dy, SNAP_IN, snap));
  else if (snap) {
    dx = Math.round(dx);
    dy = Math.round(dy);
  }
  return moveMany(base, ids, dx, dy);
}
