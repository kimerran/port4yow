import type { Locator, Page } from "@playwright/test";

/**
 * The two places this suite forgives a finding, and the facts they decide on.
 *
 * ## Why the predicates live here rather than inside the specs
 *
 * Both exemptions had a "guard" test that inlined a copy of the rule instead of
 * calling it. Mutating the real rule left both guards green — they asserted the
 * *concept* was sound while the *implementation* went unmeasured, which is the
 * same shape as a guard that shares its subject's predicate.
 *
 * So the browser now only ever **collects facts**, and every decision is a pure
 * function here. The specs import them and so do the case tables, which means a
 * mutation to a rule breaks the table that describes it.
 */

export interface HiddenFacts {
  /** `aria-hidden="true"` on the element or any ancestor. */
  hiddenAncestor: boolean;
  /** Is the element itself a control? Not `closest` — see `isDecorative`. */
  interactive: boolean;
  ownTextLength: number;
}

export interface TapTargetFacts {
  tag: string;
  text: string;
  width: number;
  height: number;
  ariaHidden: boolean;
  srOnly: boolean;
  focusable: boolean;
  /** Length of the enclosing `p`/`li`/`figcaption` text, 0 if there is none. */
  proseTextLength: number;
  ownTextLength: number;
  /** Trimmed text that follows this element inside that prose ancestor. */
  textAfterLength: number;
}

/** Collected in the page for one element, so both callers see the same facts. */
export const HIDDEN_FACTS_FN = (el: Element): HiddenFacts => ({
  hiddenAncestor: Boolean(el.closest('[aria-hidden="true"]')),
  // `matches`, not `closest`: the gold `01` index is decoration *inside* a tile
  // link, and walking up would call it interactive — the wrong question. What
  // must never be exempted is an element that is itself a control.
  interactive: el.matches(
    "a, button, input, select, textarea, [role='button']",
  ),
  ownTextLength: (el.textContent ?? "").trim().length,
});

export const TAP_TARGET_FACTS_FN = (el: Element): TapTargetFacts => {
  const rect = el.getBoundingClientRect();
  const prose = el.closest("p, li, figcaption");
  return {
    tag: el.tagName.toLowerCase(),
    text: (el.textContent ?? "").trim().slice(0, 30),
    width: rect.width,
    height: rect.height,
    ariaHidden: el.getAttribute("aria-hidden") === "true",
    srOnly: Boolean(el.closest(".sr-only")) || el.classList.contains("sr-only"),
    focusable: (el as HTMLElement).tabIndex >= 0,
    proseTextLength: prose ? (prose.textContent ?? "").trim().length : 0,
    ownTextLength: (el.textContent ?? "").trim().length,
    textAfterLength: (() => {
      if (!prose) return 0;
      // Text nodes that come after the element, within the same prose block.
      const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT);
      let passed = false;
      let after = 0;
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (el.contains(node)) {
          passed = true;
          continue;
        }
        if (passed) after += (node.textContent ?? "").trim().length;
      }
      return after;
    })(),
  };
};

/**
 * Decoration WCAG 1.4.3 exempts from contrast.
 *
 * axe checks contrast on **visible** text regardless of `aria-hidden`, and it is
 * right to — hiding something from a screen reader does not help someone with
 * low vision who can still see it. But 1.4.3 exempts *incidental* text, and
 * BRAND §2 makes this an explicit decision: "gold is a MARKER, never text".
 *
 * The length cap is what stops the exemption spreading. `hiddenAncestor` alone
 * would forgive a whole low-contrast paragraph that happens to sit inside an
 * `aria-hidden` wrapper; decoration on this site is a rank, a monogram or a
 * glyph — never prose.
 */
export const DECORATION_MAX_CHARS = 24;

export const isDecorative = (facts: HiddenFacts): boolean =>
  facts.hiddenAncestor &&
  !facts.interactive &&
  facts.ownTextLength <= DECORATION_MAX_CHARS;

/**
 * A link inside a sentence, which WCAG 2.5.8 exempts from the 44px floor.
 *
 * The reason is concrete: a link in running prose cannot take a 44px box
 * without breaking the line it sits in. `/privacy` has one — "send the request
 * through the contact form".
 *
 * Narrow on purpose, and narrowed again after review. The length margin alone
 * was not enough: the footer reads
 *
 *     <p>© 2026 Mark Hugh Neri <a>Privacy</a></p>
 *
 * which is 28 characters of prose around a 7-character link — `28 > 7 + 20` by
 * **one character**, so the footer link was exempted and the `min-h-11` this PR
 * added to it stopped being guarded. Removing that fix passed the suite.
 *
 * Worse, a margin that close to its boundary depends on the length of the site
 * owner's name and on the current year; an unrelated copy edit flips it.
 *
 * `textAfterLength` is the property that actually separates the two cases. A
 * link inside a sentence has words on **both** sides of it: `/privacy`'s
 * "contact form" is followed by 124 characters, the footer's "Privacy" by none.
 * The footer `<p>` is a flex row of discrete items, not running prose, and this
 * asks exactly that question without depending on a constant.
 *
 * `<li><a>GitHub</a></li>` — where the parent's text *is* the link's — was
 * already excluded by the margin and is now excluded twice over.
 */
export const PROSE_MARGIN_CHARS = 20;

export const isInlineProseLink = (facts: TapTargetFacts): boolean =>
  facts.tag === "a" &&
  // Something is written AFTER the link, inside the same block. This is what
  // makes it a link *in a sentence* rather than a link that happens to share a
  // container with other text.
  facts.textAfterLength > 0 &&
  facts.proseTextLength > facts.ownTextLength + PROSE_MARGIN_CHARS;

/** Is this a target the 44px floor applies to at all? */
export const isTouchTarget = (facts: TapTargetFacts): boolean =>
  facts.width > 0 &&
  facts.height > 0 &&
  !facts.ariaHidden &&
  facts.focusable &&
  // The skip link is `sr-only` until focused, so its unfocused 32x16 box is not
  // a touch target at all. `keyboard.spec.ts` covers it where it is one.
  !facts.srOnly &&
  !isInlineProseLink(facts);

export const isTooSmall = (facts: TapTargetFacts): boolean =>
  isTouchTarget(facts) && (facts.width < 44 || facts.height < 44);

/** Facts for one element, by locator. */
export const hiddenFactsFor = (locator: Locator): Promise<HiddenFacts> =>
  locator.first().evaluate(HIDDEN_FACTS_FN);

/**
 * Facts for every candidate control on the current page.
 *
 * One `locator.evaluate` per element rather than a single `$$eval`, because the
 * collector has to be **the same function** the case tables call — and a
 * function passed to `$$eval` cannot close over an import. Shipping its source
 * into the page and rebuilding it there would work, but `new Function` is on
 * AGENT §3's never-list and lint enforces that; a page has a few dozen controls,
 * so the round trips cost nothing worth having a banned construct for.
 */
export async function tapTargetFactsFor(page: Page): Promise<TapTargetFacts[]> {
  const controls = await page
    .locator("a, button, input, select, textarea, [role='button']")
    .all();
  const facts: TapTargetFacts[] = [];
  for (const control of controls) {
    facts.push(await control.evaluate(TAP_TARGET_FACTS_FN));
  }
  return facts;
}
