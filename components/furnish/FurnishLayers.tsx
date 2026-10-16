"use client";

import { Circle, Group, Line, Rect, Text } from "react-konva";
import type { Fixture } from "@/lib/model/schema";
import type { DeviceKind } from "@/lib/model/schema";
import { DEVICE_INFO } from "@/lib/plan/devices";
import type { LayerItem } from "@/lib/furnish/layer";
import type { Ghost } from "@/lib/furnish/stage";
import { ACCENT, FixtureSymbol } from "@/components/plan/PlanShapes";

/**
 * The Furnish layer as drawn on the 2D plan: everything placed (fixtures,
 * built-ins, cabinets, furniture, outlets and hookups), each in its real size.
 * On the Furnish page the items are clickable (the Konva name "furnish");
 * on the floor plan they are drawn faded and can't be clicked.
 */

const RED = "#b3261e";
const SYSTEM_COLOR = { electrical: "#c98a00", plumbing: "#2f6fa3", mechanical: "#6b7280" } as const;
const HOOKUP_COLOR: Partial<Record<DeviceKind, string>> = { water: "#2f6fa3", drain: "#7a5a3a", gas: "#d9541e", "dryer-vent": "#6b7280", "outlet-240": "#c98a00" };
const FILL = { addon: "#ece3cf", cabinet: "#eadfc9", furniture: "#cfcac0" } as const;
const STROKE = { addon: "#8a7a55", cabinet: "#8a7455", furniture: "#6f6658" } as const;

const asFixture = (it: LayerItem): Fixture => ({ id: it.id, kind: it.entryId.slice(it.entryId.indexOf(":") + 1), x: it.x, y: it.y, rotation: it.rotation, widthIn: it.widthIn, depthIn: it.depthIn });

function DeviceDot({ it, selected, s, bad, ghost }: { it: LayerItem; selected: boolean; s: number; bad?: boolean; ghost?: boolean }) {
  const kind = it.entryId.slice(it.entryId.indexOf(":") + 1) as DeviceKind;
  const color = bad ? RED : (HOOKUP_COLOR[kind] ?? SYSTEM_COLOR[DEVICE_INFO[kind]?.system ?? "electrical"]);
  const r = Math.max(3.5, 5 / s);
  return (
    <Group id={ghost ? undefined : it.id} name={ghost ? undefined : "furnish"} x={it.x} y={it.y} rotation={it.rotation} opacity={ghost ? 0.7 : 1} listening={!ghost}>
      <Circle radius={r} fill={color} stroke={selected ? ACCENT : "#fff"} strokeWidth={selected ? 2 : 1} strokeScaleEnabled={false} hitStrokeWidth={8} />
      {it.mount === "wall" && <Line points={[0, 0, 0, -r * 1.8]} stroke={color} strokeWidth={1.4} strokeScaleEnabled={false} listening={false} />}
    </Group>
  );
}

function BoxItem({ it, selected, s, names, bad, ghost }: { it: LayerItem; selected: boolean; s: number; names: boolean; bad?: boolean; ghost?: boolean }) {
  const kind = it.entryId.slice(0, it.entryId.indexOf(":")) as keyof typeof FILL;
  const w = it.widthIn;
  // Thin wall-hung things (a mirror, a towel bar) get a minimum drawn thickness so they can be seen and clicked.
  const d = Math.max(it.depthIn, 3);
  const ceiling = it.mount === "ceiling";
  const stroke = bad ? RED : selected ? ACCENT : (STROKE[kind] ?? "#6f6658");
  return (
    <Group id={ghost ? undefined : it.id} name={ghost ? undefined : "furnish"} x={it.x} y={it.y} rotation={it.rotation} opacity={ghost ? 0.6 : 1} listening={!ghost}>
      {ceiling ? (
        <Circle radius={Math.min(w, it.depthIn) / 2} fill={FILL.addon} stroke={stroke} strokeWidth={selected ? 2 : 1} strokeScaleEnabled={false} dash={[4, 3]} />
      ) : (
        <Rect x={-w / 2} y={-d / 2} width={w} height={d} fill={bad ? "rgba(179,38,30,0.18)" : (FILL[kind] ?? "#eee")} stroke={stroke} strokeWidth={selected ? 2 : 1} strokeScaleEnabled={false} dash={it.mount === "wall" ? [3, 2] : undefined} hitStrokeWidth={6} />
      )}
      {names && Math.min(w, it.depthIn) * s > 26 && <Text x={-w / 2} y={-5 / s} width={w} align="center" text={it.label} fontSize={9.5 / s} fill="#4a463f" wrap="none" ellipsis listening={false} />}
    </Group>
  );
}

function ItemShape({ it, selected, s, names, bad, ghost }: { it: LayerItem; selected: boolean; s: number; names: boolean; bad?: boolean; ghost?: boolean }) {
  if (it.kind === "fixture") return <FixtureSymbol f={asFixture(it)} selected={selected} scale={s} name="furnish" bad={bad} ghost={ghost} />;
  if (it.kind === "device") return <DeviceDot it={it} selected={selected} s={s} bad={bad} ghost={ghost} />;
  return <BoxItem it={it} selected={selected} s={s} names={names} bad={bad} ghost={ghost} />;
}

/** Everything placed on the floor. `faded` is the floor plan's quiet copy, which doesn't answer to the mouse. */
export function FurnishItems({ items, selectedId, badId, s, faded = false, names = true }: { items: LayerItem[]; selectedId?: string; badId?: string; s: number; faded?: boolean; names?: boolean }) {
  // The floor plan shows the big things; outlets and lights stay on the Furnish page and the PDF sheets.
  const shown = faded ? items.filter((it) => it.kind === "fixture" || it.kind === "addon" || it.kind === "furniture") : items;
  return (
    <Group opacity={faded ? 0.38 : 1} listening={!faded}>
      {shown.map((it) => (
        <ItemShape key={it.id} it={it} selected={it.id === selectedId} bad={it.id === badId} s={s} names={names} />
      ))}
    </Group>
  );
}

/** The item that follows the mouse while placing: red when it can't go there. */
export function FurnishGhost({ ghost, label, mount, s }: { ghost: Ghost; label: string; mount: LayerItem["mount"]; s: number }) {
  const it: LayerItem = {
    kind: ghost.entryId.startsWith("fixture:") ? "fixture" : ghost.entryId.startsWith("device:") ? "device" : ghost.entryId.startsWith("cabinet:") ? "cabinet" : ghost.entryId.startsWith("addon:") ? "addon" : "furniture",
    id: "ghost",
    entryId: ghost.entryId,
    label,
    x: ghost.x,
    y: ghost.y,
    rotation: ghost.rotation,
    widthIn: ghost.widthIn,
    depthIn: ghost.depthIn,
    heightIn: ghost.heightIn,
    bottomIn: ghost.bottomIn,
    mount,
    auto: false,
  };
  return <ItemShape it={it} selected={false} s={s} names={false} bad={!ghost.check.ok} ghost />;
}
