import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
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
const isDecorativeContrast = (
  violation: AxeViolation,
  node: AxeNode,
): boolean =>
  violation.id === "color-contrast" && /aria-hidden="true"/.test(node.html);

/** Blocking = serious or critical, minus decoration WCAG 1.4.3 exempts. */
const blocking = (violations: AxeViolation[]): AxeViolation[] =>
  violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .map((v) => ({
      ...v,
      nodes: v.nodes.filter((n) => !isDecorativeContrast(v, n)),
    }))
    .filter((v) => v.nodes.length > 0);

test.describe("axe-core", () => {
  for (const path of PUBLIC_PAGES) {
    test(`${path} has no serious or critical violations`, async ({ page }) => {
      await page.goto(path);
      const { violations } = await scan(page);
      expect(blocking(violations), summarise(violations)).toEqual([]);
    });
  }

  test("a project detail page has none", async ({ page }) => {
    const { slugs } = fixture();
    await page.goto(`/work/${slugs[0] as string}`);
    const { violations } = await scan(page);
    expect(blocking(violations), summarise(violations)).toEqual([]);
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
    expect(blocking(violations), summarise(violations)).toEqual([]);
  });
});

test.describe("the contrast exemption cannot grow", () => {
  /**
   * The filter above is the only place this suite forgives a `serious` finding,
   * so it gets its own guard. Everything it excludes must be `aria-hidden`
   * decoration, and there must not be much of it — an exemption that quietly
   * spreads to real text is worse than no scan at all.
   */
  test("only covers aria-hidden decoration, and little of it", async ({
    page,
  }) => {
    await page.goto("/");
    const { violations } = await scan(page);

    const exempted = violations.flatMap((v) =>
      v.nodes.filter((n) => isDecorativeContrast(v, n)),
    );

    for (const node of exempted) {
      expect(node.html).toContain('aria-hidden="true"');
      // Decoration, not content: no interactive element is ever exempted.
      expect(node.html).not.toMatch(/<(a|button|input|select|textarea)\b/);
    }

    // If this ever trips, someone has started exempting real text.
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
