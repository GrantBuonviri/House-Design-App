/** All lengths are stored in inches. These helpers show and read feet and inches. */

export function formatFeetInches(totalInches: number): string {
  const sign = totalInches < 0 ? "-" : "";
  const rounded = Math.round(Math.abs(totalInches));
  const feet = Math.floor(rounded / 12);
  const inches = rounded % 12;
  if (feet === 0) return `${sign}${inches}"`;
  if (inches === 0) return `${sign}${feet}'`;
  return `${sign}${feet}' ${inches}"`;
}

/**
 * Read lengths like `12' 6"`, `12'6`, `12 ft 6 in`, `12.5'`, `150"`, or a bare
 * number (treated as feet). Returns inches, or null if it can't be read.
 */
export function parseFeetInches(text: string): number | null {
  const s = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s) * 12;
  const m = s.match(
    /^(?:(-?\d+(?:\.\d+)?) ?(?:'|ft|feet|foot))? ?(?:(\d+(?:\.\d+)?) ?(?:"|in|inch|inches)?)?$/,
  );
  if (!m || (m[1] === undefined && m[2] === undefined)) return null;
  // A lone number with " or in is inches; with ' or ft it's feet.
  if (m[1] === undefined && !/("|in)/.test(s)) return null;
  const feet = m[1] ? parseFloat(m[1]) : 0;
  const inches = m[2] ? parseFloat(m[2]) : 0;
  return feet * 12 + (feet < 0 ? -inches : inches);
}

/** A length typed while drawing: `12'6`, `12' 6"`, or a bare number such as `150` (inches). Returns inches, or null. */
export function parseTypedLength(text: string): number | null {
  const t = text.trim();
  if (/^\d+(\.\d+)?$/.test(t)) return parseFloat(t);
  const v = parseFeetInches(t);
  return v !== null && v > 0 ? v : null;
}

export function sqFt(squareInches: number): number {
  return squareInches / 144;
}

export function formatSqFt(squareInches: number): string {
  return `${Math.round(sqFt(squareInches)).toLocaleString("en-US")} sq ft`;
}

export function formatUsd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
