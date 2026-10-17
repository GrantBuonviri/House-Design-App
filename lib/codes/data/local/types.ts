import type { CodeEntry, EditionLine } from "../../data";

/** One adopted code: which model edition, and the state's or city's name for its changes. */
export type AdoptedCode = {
  edition: string;
  /** "Idaho amendments (IDAPA 24.39.30)". */
  amendments?: string;
  effective?: string;
  source?: string;
  /** The adoption couldn't be confirmed from a source; the app keeps the 2021 numbers. */
  unverified?: boolean;
};

export type AdoptedPlumbing = AdoptedCode & {
  /** Which model the plumbing code follows. "IRC" = the IRC's own plumbing chapters. */
  model: "IRC" | "IPC" | "UPC" | "state";
  /** "2017 Idaho State Plumbing Code (2015 UPC)". */
  name?: string;
};

/** The codes a state or city adopted for new one- and two-family houses. */
export type AdoptedCodes = {
  irc?: AdoptedCode;
  /** The energy code. `name` is set for a state's own energy code (California Title 24, Washington State Energy Code). */
  iecc?: AdoptedCode & { name?: string };
  nec?: AdoptedCode;
  plumbing?: AdoptedPlumbing;
};

/** A change to one tracked number, with the amendment that made it. */
export type OverlayValue = Partial<CodeEntry> &
  Pick<CodeEntry, "value"> & {
    /** Only in these climate zones ("5B", or "5" for all of zone 5); a state's own energy table by zone. */
    zones?: string[];
  };

/**
 * State and city code changes, layered over the 2021 base (see `lib/codes/data.ts`).
 * A state file is `state-<st>.json`, a city file `<cityId>.json`.
 */
export type CodeOverlay = {
  /** "Idaho" for a state; "City of Boise, Ada County, Idaho" for a city, for the PDF. */
  jurisdiction?: string;
  /** statewide = the state code applies everywhere; local-only = each city or county adopts its own. */
  adoption?: "statewide" | "statewide-local-option" | "local-only";
  /** The editions adopted. A city's list replaces its state's code by code. */
  codes?: AdoptedCodes;
  /** Replaces the cover sheet's code list worked out from `codes`. */
  editionLines?: EditionLine[];
  /** For "Elsewhere in <state>": what applies outside the listed cities. */
  elsewhere?: string;
  /** The office that issues building permits. */
  permitOffice?: string;
  /** "Boise City Code Title 11 (Zoning)". */
  zoningCode?: string;
  /** Who issues electrical and plumbing permits where it isn't the building department: "the State of Idaho (DOPL)". */
  electricalPermit?: string;
  plumbingPermit?: string;
  /** A local rule for steep lots, for the foundation sheet: "Boise asks for ...". */
  hillsideRule?: string;
  /** The building department's own list of required sheets: "Boise checklist #402". */
  checklist?: string;
  /** Whether new houses need fire sprinklers here, for the cover sheet (IRC R313.2, which many places delete). */
  sprinklers?: string;
  /** Where the facts came from and when they were checked. */
  sources?: string[];
  checked?: string;
  /** Changes to tracked numbers. Each carries the amendment that made it. */
  values: Record<string, OverlayValue>;
};

/** What the model editions change, per edition: from `data/editions.json`. */
export type EditionTables = {
  checked: string;
  /** IECC prescriptive tables by climate zone, same shape as `iecc-2021-zones.json` zones. */
  iecc: Record<string, { source: string; secondSource?: string; zones: Record<string, Record<string, CodeEntry["value"]>>; values?: Record<string, OverlayValue> }>;
  /** Tracked numbers that differ from the 2021 IRC, by IRC edition. */
  irc: Record<string, Record<string, OverlayValue>>;
  /** Tracked numbers that differ from the 2023 NEC, by NEC edition. */
  nec: Record<string, Record<string, OverlayValue>>;
  /** Tracked plumbing numbers by model and edition ("UPC 2015", "IPC 2021"), where they differ from the IRC plumbing chapters. */
  plumbing: Record<string, Record<string, OverlayValue>>;
};
