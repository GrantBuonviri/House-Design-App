/**
 * Sun position for Boise, Idaho. Simple solar geometry (no refraction or
 * equation of time), accurate to about a degree, which is plenty for
 * orienting rooms and lighting the 3D scene.
 */

export const BOISE = { latitudeDeg: 43.615, longitudeDeg: -116.202 } as const;

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Solar declination in degrees for a day of the year (1 to 365). */
export function declinationDeg(dayOfYear: number): number {
  return -23.44 * Math.cos(rad((360 / 365) * (dayOfYear + 10)));
}

export type SunPosition = {
  /** Degrees clockwise from north. */
  azimuthDeg: number;
  /** Degrees above the horizon (negative when below). */
  altitudeDeg: number;
};

/**
 * Where the sun is at a given local solar time (12 = solar noon).
 */
export function sunPosition(
  dayOfYear: number,
  solarHour: number,
  latitudeDeg: number = BOISE.latitudeDeg,
): SunPosition {
  const decl = rad(declinationDeg(dayOfYear));
  const lat = rad(latitudeDeg);
  const hourAngle = rad(15 * (solarHour - 12));
  const sinAlt = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  const cosAz = (Math.sin(decl) - Math.sin(alt) * Math.sin(lat)) / (Math.cos(alt) * Math.cos(lat));
  let az = deg(Math.acos(Math.max(-1, Math.min(1, cosAz))));
  if (hourAngle > 0) az = 360 - az;
  return { azimuthDeg: az, altitudeDeg: deg(alt) };
}

/** Sunrise and sunset directions plus the noon height, for one day. */
export function dayArc(dayOfYear: number, latitudeDeg: number = BOISE.latitudeDeg) {
  const decl = rad(declinationDeg(dayOfYear));
  const lat = rad(latitudeDeg);
  const cosH = -Math.tan(lat) * Math.tan(decl);
  const halfDayHours = deg(Math.acos(Math.max(-1, Math.min(1, cosH)))) / 15;
  return {
    sunrise: sunPosition(dayOfYear, 12 - halfDayHours, latitudeDeg),
    noon: sunPosition(dayOfYear, 12, latitudeDeg),
    sunset: sunPosition(dayOfYear, 12 + halfDayHours, latitudeDeg),
    daylightHours: halfDayHours * 2,
  };
}

/** Day-of-year for the solstices, used to draw summer and winter sun paths. */
export const SUMMER_SOLSTICE = 172;
export const WINTER_SOLSTICE = 355;

/** 8-way compass name for an angle in degrees clockwise from north. */
export function compassName(angleDeg: number): string {
  const names = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
  const i = Math.round((((angleDeg % 360) + 360) % 360) / 45) % 8;
  return names[i];
}

/** Short 8-way compass label, e.g. "SE". */
export function compassShort(angleDeg: number): string {
  const names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return names[Math.round((((angleDeg % 360) + 360) % 360) / 45) % 8];
}
