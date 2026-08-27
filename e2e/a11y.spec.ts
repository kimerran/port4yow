import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  DECORATION_MAX_CHARS,
  hiddenFactsFor,
  isDecorative,
  isInlineProseLink,
  isTooSmall,
} from "./a11y-rules.ts";

import { fixture } from "./fixture.ts";

/**
 * axe-core plus the structural checks #39 names (BRAND §9, AGENT §7).
 *
 * Runs at all three viewports, because a landmark or a heading level can be
 * emitted conditionally on width and a desktop-only scan would not see it.
 *
 * #39's acceptance says **zero critical violations**. This asserts zero
 * critical *and* zero serious, and lists anything at any level in the failure
 * message — the sweep in #43 found a `serious` contrast issue on the home page
 * that a critical-only gate would have waved through.
 */

interface AxeNode {
  target: unknown[];
  html: string;
  failureSummary?: string;
}
interface AxeViolation {
  id: string;
  impact?: string | null;
  nodes: AxeNode[];
}

/** Names the element, because "4 nodes" is not something you can act on. */
const summarise = (violations: AxeViolation[]): string =>
  violations
    .map(
      (v) =>
        `${v.impact ?? "?"}: ${v.id}\n` +
        v.nodes
          .map(
            (n) =>
              `    ${String(n.target.join(" "))}\n      ${n.html.slice(0, 160)}`,
          )
          .join("\n"),
    )
    .join("\n");

const PUBLIC_PAGES = ["/", "/privacy", "/404"] as const;

const scan = async (page: import("@playwright/test").Page) =>
  new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

/**
 * `color-contrast` on text that is already hidden from the accessibility tree.
 *
 * axe checks contrast on **visible** text regardless of `aria-hidden`, and it is
 * right to: hiding something from a screen reader does not help someone with low
 * vision who can still see it. But WCAG 1.4.3 exempts *incidental* text — pure
 * decoration that conveys nothing — and this site has exactly two kinds:
 *
 * - the gold card ranks and tile indices. BRAND §2 makes this an explicit
 *   decision: "gold is a MARKER, never text", and `RankIndex.astro` already
 *   records that it measures ~1.9:1 and would fail badly if it were text. The
 *   sequence it marks is also in the tile's own heading.
 * - the hero monogram watermark at 10% opacity, which duplicates the name in the
 *   `<h1>` directly above it.
 *
 * Restyling them is a brand change, not a test change, and BRAND is the source
 * of truth (AGENT's preamble). So these are filtered — but **only** when the
 * element really is `aria-hidden`, and the next test asserts that the filter
 * never covers anything else. A blanket `disableRules(["color-contrast"])`
 * would have hidden the real `serious` finding this suite is here to catch.
 */
/**
 * Is this violating node itself hidden from the accessibility tree?
 *
 * Resolved **against the DOM**, not by matching the node's HTML string. The
 * first version tested `/aria-hidden="true"/` on `node.html`, and `node.html`
 * is the element's markup *including its children* — so any element containing
 * a decorative child was exempted along with it:
 *
 * ```
 * <p class="lede">Low-contrast body copy <span aria-hidden="true">*</span> continues</p>
 * ```
 *
 * Real text, exempted, silently. Worse, the guard written to catch exactly that
 * tested the **same string**, so it agreed with the filter by construction —
 * a guard that shares its subject's predicate is not a guard.
 *
 * `closest()` also fixes the other direction: an element inheriting
 * `aria-hidden` from an ancestor really is hidden, and the string test missed
 * those.
 */
async function isHiddenFromTree(
  page: import("@playwright/test").Page,
  node: AxeNode,
): Promise<boolean> {
  const selector = node.target[0];
  if (typeof selector !== "string") return false;
  try {
    return isDecorative(await hiddenFactsFor(page.locator(selector)));
  } catch {
    // A selector we cannot resolve is not evidence of decoration.
    return false;
  }
}

/** Blocking = serious or critical, minus decoration WCAG 1.4.3 exempts. */
async function blocking(
  page: import("@playwright/test").Page,
  violations: AxeViolation[],
): Promise<AxeViolation[]> {
  const out: AxeViolation[] = [];
  for (const violation of violations) {
    if (violation.impact !== "critical" && violation.impact !== "serious")
      continue;

    const kept: AxeNode[] = [];
    for (const node of violation.nodes) {
      const exempt =
        violation.id === "color-contrast" &&
        (await isHiddenFromTree(page, node));
      if (!exempt) kept.push(node);
    }
    if (kept.length > 0) out.push({ ...violation, nodes: kept });
  }
  return out;
}

test.describe("axe-core", () => {
  for (const path of PUBLIC_PAGES) {
    test(`${path} has no serious or critical violations`, async ({ page }) => {
      await page.goto(path);
      const { violations } = await scan(page);
      expect(await blocking(page, violations), summarise(violations)).toEqual(
        [],
      );
    });
  }

  test("a project detail page has none", async ({ page }) => {
    const { slugs } = fixture();
    await page.goto(`/work/${slugs[0] as string}`);
    const { violations } = await scan(page);
    expect(await blocking(page, violations), summarise(violations)).toEqual([]);
  });

  test("the admin dashboard has none", async ({ page }, testInfo) => {
    const { username, password } = fixture();
    const { forwardedFor } = await import("./fixture.ts");
    await page.setExtraHTTPHeaders({
      "x-forwarded-for": forwardedFor(testInfo),
    });
    await page.goto("/admin/login");
    await page.locator("#login-username").fill(username);
    await page.locator("#login-password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/admin$/);

    const { violations } = await scan(page);
    expect(await blocking(page, violations), summarise(violations)).toEqual([]);
  });
});

test.describe("the exemptions cannot grow", () => {
  /**
   * Both exemptions, asserted against **the real predicates** rather than a
   * copy of them.
   *
   * The first attempt at these inlined the rule inside `page.evaluate` and
   * asserted the concept. Mutating the actual implementation left them green:
   * reverting `isDecorative` to a string match on the element's HTML, and
   * widening `isInlineProseLink` to every link in prose, both passed. A guard
   * that reimplements its subject is documentation.
   *
   * Now the browser only collects facts (`a11y-rules.ts`), the decisions are
   * pure functions, and these tables call them.
   */

  test("isDecorative exempts decoration, never real text carrying it", async ({
    page,
  }) => {
    await page.goto("/");

    // Injected into a real page so `closest()` answers about a real tree, then
    // read through the SAME collector the specs use — no second copy of it.
    await page.evaluate(() => {
      const host = document.createElement("div");
      host.id = "exemption-cases";
      host.innerHTML = `
        <span id="c1" aria-hidden="true">01</span>
        <p id="c2">Low-contrast body copy <span aria-hidden="true">*</span> continues here at length</p>
        <h2 id="c3">Selected work <svg aria-hidden="true"></svg></h2>
        <p id="c4">Plain low-contrast body copy with no decoration at all</p>
        <div aria-hidden="true"><span id="c5">inherited</span></div>
        <div aria-hidden="true"><a id="c6" href="/x">a hidden control</a></div>
        <div aria-hidden="true"><p id="c7">A whole paragraph of prose that happens to sit inside a hidden wrapper</p></div>
      `;
      document.body.appendChild(host);
    });

    const verdicts: { id: string; exempt: boolean }[] = [];
    for (const id of ["c1", "c2", "c3", "c4", "c5", "c6", "c7"]) {
      const facts = await hiddenFactsFor(page.locator(`#${id}`));
      verdicts.push({ id, exempt: isDecorative(facts) });
    }

    await page.evaluate(() =>
      document.getElementById("exemption-cases")?.remove(),
    );

    expect(verdicts).toEqual([
      { id: "c1", exempt: true }, // the decorative rank itself
      { id: "c2", exempt: false }, // real text containing decoration
      { id: "c3", exempt: false }, // a heading with a decorative glyph
      { id: "c4", exempt: false }, // plain real text
      { id: "c5", exempt: true }, // inherits aria-hidden from an ancestor
      { id: "c6", exempt: false }, // hidden, but a control
      { id: "c7", exempt: false }, // hidden, but far too much text for decoration
    ]);
  });

  test("isInlineProseLink exempts a link in a sentence, never a standalone one", () => {
    // Pure facts, so the rule is exercised with nothing in between.
    const target = (
      overrides: Partial<Parameters<typeof isInlineProseLink>[0]>,
    ): Parameters<typeof isInlineProseLink>[0] => ({
      tag: "a",
      text: "",
      width: 90,
      height: 19,
      ariaHidden: false,
      srOnly: false,
      focusable: true,
      proseTextLength: 0,
      ownTextLength: 0,
      textAfterLength: 0,
      ...overrides,
    });

    expect(
      [
        // "Send the request through the contact form — say what you want removed."
        {
          id: "inline-in-prose",
          ownTextLength: 12,
          proseTextLength: 70,
          textAfterLength: 124,
        },
        /**
         * The footer, measured on the served page:
         * `<p>© 2026 Mark Hugh Neri <a>Privacy</a></p>` — 28 characters of
         * prose around a 7-character link, which cleared the 20-character
         * margin by ONE and un-guarded the `min-h-11` this PR added to it.
         * Nothing follows the link, so it is not a link in a sentence.
         */
        {
          id: "footer-privacy",
          ownTextLength: 7,
          proseTextLength: 28,
          textAfterLength: 0,
        },
        // <li><a>GitHub</a></li> — the parent's text IS the link's.
        {
          id: "standalone-in-li",
          ownTextLength: 6,
          proseTextLength: 6,
          textAfterLength: 0,
        },
        {
          id: "standalone-in-p",
          ownTextLength: 7,
          proseTextLength: 7,
          textAfterLength: 0,
        },
        // The margin boundary, still pinned — now with text after it, so the
        // margin is the only thing deciding.
        {
          id: "just-inside-margin",
          ownTextLength: 10,
          proseTextLength: 30,
          textAfterLength: 20,
        },
        {
          id: "just-outside-margin",
          ownTextLength: 10,
          proseTextLength: 31,
          textAfterLength: 21,
        },
        // Long block, but the link ends it: a heading-like row, not a sentence.
        {
          id: "nothing-after-the-link",
          ownTextLength: 7,
          proseTextLength: 90,
          textAfterLength: 0,
        },
        // A button in prose is still a control, never exempt.
        {
          id: "button-in-prose",
          tag: "button",
          ownTextLength: 4,
          proseTextLength: 90,
          textAfterLength: 60,
        },
      ].map(({ id, ...facts }) => ({
        id,
        exempt: isInlineProseLink(target(facts)),
      })),
    ).toEqual([
      { id: "inline-in-prose", exempt: true },
      { id: "footer-privacy", exempt: false },
      { id: "standalone-in-li", exempt: false },
      { id: "standalone-in-p", exempt: false },
      { id: "just-inside-margin", exempt: false },
      { id: "just-outside-margin", exempt: true },
      { id: "nothing-after-the-link", exempt: false },
      { id: "button-in-prose", exempt: false },
    ]);
  });

  /**
   * Every clause of `isTouchTarget`, pinned.
   *
   * Mutating `!facts.ariaHidden` failed nothing at first — not because the
   * clause is wrong, but because no aria-hidden focusable element under 44px
   * exists on the pages this suite visits. An untested clause and a redundant
   * one look identical from the outside, so it gets a case rather than a guess.
   */
  test("isTouchTarget excludes what the 44px floor does not apply to", () => {
    const base: Parameters<typeof isTooSmall>[0] = {
      tag: "a",
      text: "x",
      width: 20,
      height: 20,
      ariaHidden: false,
      srOnly: false,
      focusable: true,
      proseTextLength: 0,
      ownTextLength: 1,
      textAfterLength: 0,
    };

    expect(
      [
        { id: "a-real-small-target", facts: base },
        { id: "aria-hidden", facts: { ...base, ariaHidden: true } },
        { id: "sr-only", facts: { ...base, srOnly: true } },
        { id: "not-focusable", facts: { ...base, focusable: false } },
        { id: "zero-sized", facts: { ...base, width: 0, height: 0 } },
        { id: "big-enough", facts: { ...base, width: 44, height: 44 } },
      ].map(({ id, facts }) => ({ id, tooSmall: isTooSmall(facts) })),
    ).toEqual([
      { id: "a-real-small-target", tooSmall: true },
      { id: "aria-hidden", tooSmall: false },
      { id: "sr-only", tooSmall: false },
      { id: "not-focusable", tooSmall: false },
      { id: "zero-sized", tooSmall: false },
      { id: "big-enough", tooSmall: false },
    ]);
  });

  test("isTooSmall still reports a standalone small link", () => {
    // The other direction: the exemption must not swallow a real finding.
    expect(
      isTooSmall({
        tag: "a",
        text: "GitHub",
        width: 52,
        height: 19,
        ariaHidden: false,
        srOnly: false,
        focusable: true,
        proseTextLength: 6,
        ownTextLength: 6,
        textAfterLength: 0,
      }),
    ).toBe(true);
  });

  test("what is exempted on the real home page is only decoration", async ({
    page,
  }) => {
    await page.goto("/");
    const { violations } = await scan(page);

    const exempted: AxeNode[] = [];
    for (const violation of violations) {
      if (violation.id !== "color-contrast") continue;
      for (const node of violation.nodes) {
        if (await isHiddenFromTree(page, node)) exempted.push(node);
      }
    }

    for (const node of exempted) {
      const selector = node.target[0] as string;
      const facts = await hiddenFactsFor(page.locator(selector));
      expect(facts.hiddenAncestor, `${selector} is not aria-hidden`).toBe(true);
      expect(facts.interactive, `${selector} is interactive`).toBe(false);
      expect(
        facts.ownTextLength,
        `${selector} carries ${String(facts.ownTextLength)} characters`,
      ).toBeLessThanOrEqual(DECORATION_MAX_CHARS);
    }

    expect(exempted.length).toBeLessThanOrEqual(8);
  });
});

test.describe("document structure", () => {
  for (const path of PUBLIC_PAGES) {
    test(`${path} has exactly one h1 and skips no heading level`, async ({
      page,
    }) => {
      await page.goto(path);

      const levels = await page
        .locator("h1, h2, h3, h4, h5, h6")
        .evaluateAll((nodes) => nodes.map((n) => Number(n.tagName.slice(1))));

      expect(levels.filter((l) => l === 1)).toHaveLength(1);

      // Never jump more than one level going down the document.
      for (let i = 1; i < levels.length; i++) {
        const previous = levels[i - 1] as number;
        const current = levels[i] as number;
        expect(
          current - previous,
          `heading level jumped from h${String(previous)} to h${String(current)}`,
        ).toBeLessThanOrEqual(1);
      }
    });

    test(`${path} has the landmarks a screen reader navigates by`, async ({
      page,
    }) => {
      await page.goto(path);
      await expect(page.locator("main")).toHaveCount(1);
      await expect(page.locator("footer")).toHaveCount(1);
      await expect(page.getByRole("navigation").first()).toBeAttached();
    });
  }

  test("a suit glyph is decorative and never the only label", async ({
    page,
  }) => {
    await page.goto("/");

    const glyphs = page.locator("svg[data-suit], svg.suit-glyph, svg");
    const count = await glyphs.count();
    expect(count, "no glyphs found — the selector is wrong").toBeGreaterThan(0);

    // Every inline SVG is hidden from the tree; the text beside it carries the
    // meaning. A glyph exposed as an unlabelled graphic is the failure here.
    for (let i = 0; i < count; i++) {
      const svg = glyphs.nth(i);
      const hidden = await svg.getAttribute("aria-hidden");
      const label = await svg.getAttribute("aria-label");
      const role = await svg.getAttribute("role");
      expect(
        hidden === "true" || Boolean(label) || role === "img",
        `an svg is neither aria-hidden nor labelled`,
      ).toBe(true);
    }
  });

  test("the contact form has one polite live region, present from first render", async ({
    page,
  }) => {
    await page.goto("/#contact");
    const status = page.locator("[data-form-status]");
    // In the DOM before it has anything to say — a live region added at the
    // moment it gains text is frequently not announced.
    await expect(status).toHaveCount(1);
    await expect(status).toHaveAttribute("aria-live", "polite");
    await expect(status).toHaveAttribute("role", "status");
  });

  test("the first tab stop is a skip link", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const focused = page.locator(":focus");
    await expect(focused).toHaveText(/skip to content/i);
    await expect(focused).toHaveAttribute("href", "#main");
  });
});

/**
 * The tap-target exemption, held to the same standard as the contrast one.
 *
 * `responsive.spec.ts` skips inline links in prose, which WCAG 2.5.8 exempts
 * because a link in a sentence cannot take a 44px box without breaking the
 * line. That is a real exemption and therefore a place something can hide, so
 * the predicate is asserted on both shapes it has to tell apart — on a real
 * page, so `closest()` and `textContent` answer about a real tree.
 */
test.describe("the tap-target exemption is narrow", () => {
  test("exempts a link inside a sentence, never a standalone one", async ({
    page,
  }) => {
    await page.goto("/");

    const verdicts = await page.evaluate(() => {
      const host = document.createElement("div");
      host.innerHTML = `
        <p id="t1">Send the request through the <a href="/x">contact form</a> — say what you want removed.</p>
        <li id="t2-li"><a id="t2" href="/x">GitHub</a></li>
        <li id="t3-li"><a id="t3" href="/x">LinkedIn</a></li>
        <p id="t4-p"><a id="t4" href="/x">Privacy</a></p>
        <p id="t5">A sentence with <a id="t5a" href="/x">a link</a> and rather a lot more text after it.</p>
      `;
      document.body.appendChild(host);

      const exempt = (id: string): boolean => {
        const el = document.getElementById(id);
        if (!el) return false;
        const prose = el.closest("p, li, figcaption");
        return Boolean(
          el.tagName === "A" &&
          prose &&
          (prose.textContent ?? "").trim().length >
            (el.textContent ?? "").trim().length + 20,
        );
      };

      const out = ["t1", "t2", "t3", "t4", "t5a"].map((id) => ({
        id,
        exempt: id === "t1" ? false : exempt(id),
      }));
      // t1 is the paragraph, not the link — check the link inside it instead.
      const link = document.querySelector("#t1 a");
      out[0] = {
        id: "t1-link",
        exempt: Boolean(
          link &&
          (link.closest("p")?.textContent ?? "").trim().length >
            (link.textContent ?? "").trim().length + 20,
        ),
      };
      host.remove();
      return out;
    });

    expect(verdicts).toEqual([
      { id: "t1-link", exempt: true }, // inline in a sentence — WCAG 2.5.8
      { id: "t2", exempt: false }, // standalone in a list — must be 44px
      { id: "t3", exempt: false }, // standalone in a list — must be 44px
      { id: "t4", exempt: false }, // alone in a paragraph — must be 44px
      { id: "t5a", exempt: true }, // inline in a sentence
    ]);
  });
});
