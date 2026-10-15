import raw from "./data/boise-2018.json";

/**
 * The building-code numbers the plan checks use, for a new house in Boise.
 * Every number lives in data/boise-2018.json with its code section, edition,
 * any Idaho or Boise amendment, where it came from and when it was checked.
 * Only numbers and section references are kept, never the code's own text.
 */

/** A number, a yes/no, short text, or a table as the code prints it (keyed by its rows and columns). */
export type CodeValue = number | string | boolean | string[] | { [key: string]: unknown };

export type CodeEntry = {
  value: CodeValue;
  unit: string;
  /** "IRC 2018", "IECC 2018", "NEC 2023", "ISPC 2017" or "Boise design criteria". */
  code: string;
  section: string;
  /** The Idaho or Boise amendment that changed the number, if any. */
  amendment: string | null;
  source: string;
  checked: string;
  note?: string;
  /** The gathered number couldn't be confirmed from a source; not used by any check. */
  unverified?: boolean;
  /** The second, separate check of the number against its source. */
  secondCheck?: { verdict: "agree" | "disagree" | "could-not-confirm"; source?: string | null };
  /** How a disagreement between the two checks was settled. */
  resolved?: string;
};

export type CodeEdition = { code: string; edition: string; amendments?: string; source?: string };

type CodeData = {
  meta: { jurisdiction: string; checked: string; editions: CodeEdition[] };
  values: Record<string, CodeEntry>;
};

export const CODE_DATA = raw as unknown as CodeData;

/** The code editions Boise uses, for the cover sheet and code summary. */
export const CODE_EDITIONS: { label: string; detail: string }[] = [
  { label: "Residential: 2018 International Residential Code (IRC)", detail: "With Idaho amendments (IDAPA 24.39.30) and Boise City Code Title 9" },
  { label: "Energy: 2018 International Energy Conservation Code (IECC)", detail: "With Idaho amendments, climate zone 5B" },
  { label: "Electrical: 2023 National Electrical Code (NEC)", detail: "In force in Boise since April 26, 2024" },
  { label: "Plumbing: 2017 Idaho State Plumbing Code", detail: "Based on the 2015 Uniform Plumbing Code" },
  { label: "Mechanical and fuel gas: 2018 IRC chapters 12 to 24", detail: "With Idaho amendments" },
];

export function codeEntry(key: string): CodeEntry {
  const e = CODE_DATA.values[key];
  if (!e) throw new Error(`No code value "${key}" in boise-2018.json`);
  return e;
}

export function codeNum(key: string): number {
  const v = codeEntry(key).value;
  if (typeof v !== "number") throw new Error(`Code value "${key}" isn't a number`);
  return v;
}

export function codeText(key: string): string {
  const v = codeEntry(key).value;
  return Array.isArray(v) ? v.join(", ") : String(v);
}

/** A table kept as the code prints it. */
export function codeTable<T>(key: string): Record<string, T> {
  const v = codeEntry(key).value;
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error(`Code value "${key}" isn't a table`);
  return v as Record<string, T>;
}

/** "IRC R310.2.1", for printing next to a rule. */
export function codeRef(key: string): string {
  const e = codeEntry(key);
  const book = e.code.replace(/ \d{4}$/, "");
  return book === "Boise design criteria" ? `IRC ${e.section}` : `${book} ${e.section}`;
}
