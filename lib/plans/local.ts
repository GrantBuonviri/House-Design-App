import { changedBy, codeSet } from "@/lib/codes/data";

export { hillsideNote } from "@/lib/codes/data";

/**
 * The place's names for the plan sheets, from the active code set: who
 * reviews the plans, whose design criteria they are, who licenses the
 * engineer. A place without a city file gets plain wording.
 */

/** The building department's facts for the open project's place. */
export const localFacts = () => codeSet().local;

/** "Denver": the city, or the state for a place off the list. */
export const placeShort = (): string => localFacts().cityName ?? localFacts().stateName;

export const verifyNote = (): string => `Verify all dimensions and code requirements with ${localFacts().reviewer} before construction.`;

/** The disclaimer's last lines. */
export const reviewNote = (): string => `Plan review by ${localFacts().reviewer} is the real check. ${verifyNote()}`;

/** "an engineer licensed in Colorado". */
export const licensedEngineer = (): string => `an engineer licensed in ${localFacts().stateName}`;

/** "IRC Table R302.6 as amended by Oregon", or just the section where the number is the model code's. */
export function amendedRef(ref: string, key: string): string {
  const who = changedBy(key);
  return who ? `${ref} as amended by ${who}` : ref;
}

/** The zoning code the lot answers to. */
export const zoningCode = (): string => localFacts().zoningCode ?? "your city or county zoning code";
