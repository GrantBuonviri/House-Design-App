/**
 * Camera moves for the 3D view: looking straight down, and the smooth trip
 * to the Top view. The camera orbits a target point, described by its
 * distance, its tilt down from straight above (phi) and its turn around
 * the up axis (theta), the same way the orbit controls describe it. Theta 0
 * puts the camera south of the target looking north, so from straight above
 * north is at the top of the screen.
 */

export type Orbit = { radius: number; phi: number; theta: number; target: [number, number, number] };

/** How close to straight down still counts as looking down (and shows the room names). */
export const LOOK_DOWN_DEG = 10;

/**
 * The tilt the Top view stops at: a hair off straight down, so the screen's
 * "up" stays tied to north instead of spinning.
 */
export const TOP_PHI = 1e-4;

export function isLookingDown(phi: number): boolean {
  return phi <= (LOOK_DOWN_DEG * Math.PI) / 180;
}

/** Straight down over the house's middle, far enough back to see all of it. */
export function topViewOrbit(center: [number, number, number], span: number, fovDeg: number): Orbit {
  const fit = (span * 1.3) / 2 / Math.tan((fovDeg * Math.PI) / 360);
  return { radius: fit + center[1], phi: TOP_PHI, theta: 0, target: [center[0], 0, center[2]] };
}

/** An angle as the shortest turn from `from`. */
function nearestAngle(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return from + d;
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** Part way (t from 0 to 1) from one orbit to another, turning the short way round. */
export function tweenOrbit(a: Orbit, b: Orbit, t: number): Orbit {
  const k = ease(Math.min(1, Math.max(0, t)));
  const mix = (x: number, y: number) => x + (y - x) * k;
  return {
    radius: mix(a.radius, b.radius),
    phi: mix(a.phi, b.phi),
    theta: mix(a.theta, nearestAngle(a.theta, b.theta)),
    target: [mix(a.target[0], b.target[0]), mix(a.target[1], b.target[1]), mix(a.target[2], b.target[2])],
  };
}

/** Where the camera sits for an orbit (scene units: x east, y up, z south). */
export function orbitPosition(o: Orbit): [number, number, number] {
  const s = Math.sin(o.phi) * o.radius;
  return [o.target[0] + s * Math.sin(o.theta), o.target[1] + Math.cos(o.phi) * o.radius, o.target[2] + s * Math.cos(o.theta)];
}

/** The orbit a camera position makes around a target. */
export function orbitOf(position: [number, number, number], target: [number, number, number]): Orbit {
  const dx = position[0] - target[0];
  const dy = position[1] - target[1];
  const dz = position[2] - target[2];
  const radius = Math.hypot(dx, dy, dz);
  return { radius, phi: radius ? Math.acos(Math.min(1, Math.max(-1, dy / radius))) : 0, theta: Math.atan2(dx, dz), target };
}
