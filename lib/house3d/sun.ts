import { sunPosition } from "@/lib/land/sun";
import type { Vec3 } from "./mesh";

/** Spring equinox, for an in-between sun. */
export const EQUINOX = 80;
export { SUMMER_SOLSTICE as SUMMER, WINTER_SOLSTICE as WINTER } from "@/lib/land/sun";

/** Unit direction toward the sun in the scene (x east, y up, z south). */
export function sunDirection(dayOfYear: number, solarHour: number): Vec3 {
  const s = sunPosition(dayOfYear, solarHour);
  const az = (s.azimuthDeg * Math.PI) / 180;
  const alt = (Math.max(s.altitudeDeg, 2) * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt)];
}
