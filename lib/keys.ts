/**
 * Is this key press for a page's own shortcuts? One answer for every page's key listener:
 * not while typing in a box, not while a window sits over the page (a dialog marked
 * `aria-modal`, the walkthrough, the Plans page), unless the listener's own part of the page is inside it.
 */

/** Boxes that take typed keys. */
export const TYPING = "input, textarea, select, [contenteditable]";
/** The same, without checkboxes, radios, sliders and buttons, which keep focus after a click but take no letters. */
export const TEXT_ENTRY = 'input:not([type="checkbox"], [type="radio"], [type="range"], [type="button"]), textarea, select, [contenteditable]';
/** A window over the page: a modal dialog, or a full-screen view marked `data-over-page` (the walkthrough, the Plans page). */
export const OVER_PAGE = '[aria-modal="true"], [data-over-page]';

const pageDocument = () => (typeof document === "undefined" ? undefined : document);

export type KeyScope = {
  /** The listener's own element: a dialog or the walkthrough it sits inside doesn't stop its keys. */
  here?: Element | null;
  /** Checkboxes, radios and sliders don't count as typing (for undo, which they have none of). */
  toggles?: boolean;
  /** What counts as a window over the page, when it isn't every one in `OVER_PAGE`. */
  covers?: string;
};

/** Whether the key was pressed in a box that takes typing. */
export function isTyping(e: Pick<KeyboardEvent, "target">, toggles = false): boolean {
  const t = e.target as Element | null;
  return !!t?.closest?.(toggles ? TEXT_ENTRY : TYPING);
}

/** Whether a window (dialog or walkthrough) covers the part of the page at `here`. */
export function coveredBy(here: Element | null | undefined, doc: Pick<Document, "querySelectorAll"> | undefined = pageDocument(), covers = OVER_PAGE): boolean {
  if (!doc) return false;
  return Array.from(doc.querySelectorAll(covers)).some((o) => !(here && o.contains(here)));
}

export function keyIsForPage(e: Pick<KeyboardEvent, "target">, scope: KeyScope = {}, doc = pageDocument()): boolean {
  return !isTyping(e, scope.toggles) && !coveredBy(scope.here, doc, scope.covers);
}
