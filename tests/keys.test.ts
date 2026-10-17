import { describe, expect, it } from "vitest";
import { coveredBy, isTyping, keyIsForPage, OVER_PAGE, TEXT_ENTRY, TYPING } from "@/lib/keys";

/** A stand-in element: `closest` answers for the selectors it matches, `contains` for the elements inside it. */
function el(matches: string[] = [], inside: object[] = []): Element {
  const self = {
    closest: (sel: string) => (matches.includes(sel) ? self : null),
    contains: (other: unknown) => other === self || inside.includes(other as object),
  };
  return self as unknown as Element;
}
const doc = (over: Element[]) => ({ querySelectorAll: (sel: string) => (sel === OVER_PAGE || sel.includes("aria-modal") ? over : []) }) as unknown as Document;
const key = (target: Element | null) => ({ target }) as KeyboardEvent;

describe("keyIsForPage", () => {
  it("lets page keys through with nothing over the page", () => {
    expect(keyIsForPage(key(el()), {}, doc([]))).toBe(true);
  });

  it("skips keys typed in a box", () => {
    const box = el([TYPING, TEXT_ENTRY]);
    expect(isTyping(key(box))).toBe(true);
    expect(keyIsForPage(key(box), {}, doc([]))).toBe(false);
  });

  it("lets undo through from a checkbox, but not page letters", () => {
    const checkbox = el([TYPING]);
    expect(keyIsForPage(key(checkbox), {}, doc([]))).toBe(false);
    expect(keyIsForPage(key(checkbox), { toggles: true }, doc([]))).toBe(true);
  });

  it("skips keys while a dialog or the walkthrough is over the page", () => {
    const page = el();
    const walk = el();
    expect(coveredBy(page, doc([walk]))).toBe(true);
    expect(keyIsForPage(key(el()), { here: page }, doc([walk]))).toBe(false);
  });

  it("keeps a page's keys when it sits inside the window that is open", () => {
    const furnish = el();
    const walk = el([], [furnish]);
    expect(keyIsForPage(key(el()), { here: furnish }, doc([walk]))).toBe(true);
    // A second window on top still stops it.
    expect(keyIsForPage(key(el()), { here: furnish }, doc([walk, el()]))).toBe(false);
  });

  it("works without a document (server render)", () => {
    expect(coveredBy(null, undefined)).toBe(false);
  });
});
