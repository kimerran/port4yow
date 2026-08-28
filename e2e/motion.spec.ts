import { expect, test } from "@playwright/test";
import { fixture } from "./fixture.ts";

/**
 * `prefers-reduced-motion: reduce` (#39, BRAND §9).
 *
 * The requirement is not "the animation is shorter" — it is that **everything
 * renders in its final state**. So each check asserts the end condition (opacity
 * 1, no transform, no transition) rather than timing anything, which is both the
 * correct reading and the only way to write this without a flaky sleep.
 *
 * The preference is set on the browser context in `playwright.config.ts`, so it
 * is in place before the first paint — the difference between "the animation was
 * skipped" and "it ran and then stopped".
 *
 * Two checks here used to cover the playing-card metaphor: the hero's deal-in
 * entrance and the next-card flip. Both mechanics were removed with the metaphor,
 * so the tests are gone rather than rewritten — there is no reduced-motion
 * behaviour left to assert about animations that no longer exist. The stronger
 * claim that replaces them ("nothing animates on entrance for anyone, reduced
 * motion or not") is not a reduced-motion property, so it lives in `home.spec.ts`
 * where it runs in a context that has motion enabled.
 */

/**
 * "Nothing transitions" has two shapes in this codebase, and asserting only one
 * of them reports a false failure.
 *
 * Tailwind's `motion-reduce:transition-none` sets **`transition-property: none`**
 * and leaves `transition-duration` at its authored `0.5s` — so the element does
 * not animate, but the duration still reads `0.5s`. `global.css` takes the other
 * route for tile lifts, writing `transition: none` inside the media query, which
 * zeroes the duration. Both are correct; asserting `duration === "0s"` alone
 * fails the first one, which is exactly what my first version did.
 */
const nothingTransitions = (style: {
  property: string;
  duration: string;
}): boolean =>
  style.property === "none" ||
  style.duration.split(",").every((d) => Number.parseFloat(d.trim()) === 0);

const transitionOf = (
  locator: import("@playwright/test").Locator,
): Promise<{ property: string; duration: string }> =>
  locator.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      property: style.transitionProperty,
      duration: style.transitionDuration,
    };
  });

test("the context really is in reduced-motion mode", async ({ page }) => {
  // The control. Every assertion below is vacuous if the emulation is not on,
  // and "no animation ran" is exactly what a mis-configured project also looks
  // like.
  await page.goto("/");
  const reduced = await page.evaluate(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  expect(reduced).toBe(true);
});

test("a tile lift is disabled and the tile stays put on hover", async ({
  page,
}) => {
  await page.goto("/");
  const tile = page.locator("#work a").first();

  /**
   * Scroll it into view **before** measuring. `hover()` scrolls on its own, so
   * measuring before and after otherwise compares two different scroll
   * positions — the first version of this reported a 480px "lift" that was the
   * page moving, not the tile.
   */
  await tile.scrollIntoViewIfNeeded();
  const before = await tile.boundingBox();
  await tile.hover();
  const after = await tile.boundingBox();

  expect(before).not.toBeNull();
  expect(after?.y).toBeCloseTo(before?.y ?? 0, 0);

  expect(nothingTransitions(await transitionOf(tile))).toBe(true);
});

test("the next-project link does not lift on hover", async ({ page }) => {
  const { slugs } = fixture();
  await page.goto(`/work/${slugs[0] as string}`);

  const link = page
    .getByRole("navigation", { name: "Next project" })
    .getByRole("link");

  // Same shape as the tile-lift check: scroll first, or `hover()`'s own scroll
  // shows up as a lift.
  await link.scrollIntoViewIfNeeded();
  const before = await link.boundingBox();
  await link.hover();
  const after = await link.boundingBox();

  expect(before).not.toBeNull();
  expect(after?.y).toBeCloseTo(before?.y ?? 0, 0);
  expect(nothingTransitions(await transitionOf(link))).toBe(true);
});

test("the image scale on a project tile is disabled", async ({ page }) => {
  await page.goto("/");

  /**
   * The scale is on a wrapper `div`, not on the `<img>` — it renders whether or
   * not a cover image exists, so this needs no seeded asset. Targeting `img`
   * made the test skip itself, which is worse than failing: a test that never
   * runs looks exactly like a test that passes.
   */
  const scaled = page
    .locator('#work a div[class*="group-hover:scale-105"]')
    .first();
  await expect(scaled).toHaveCount(1);

  await page.locator("#work a").first().hover();

  const transform = await scaled.evaluate(
    (el) => getComputedStyle(el).transform,
  );
  expect(["none", "matrix(1, 0, 0, 1, 0, 0)"]).toContain(transform);
  expect(nothingTransitions(await transitionOf(scaled))).toBe(true);
});

test("the scroll rail renders full and stops tracking scroll", async ({
  page,
}) => {
  await page.goto("/");

  /**
   * Asserting the *behaviour* `scroll-rail.ts` actually implements, rather than
   * a transition duration. Under reduced motion it sets every fill's
   * `strokeDashoffset` to 0 — the rail is drawn complete — and returns before
   * attaching any scroll listener. So "does not animate" here means "is already
   * final, and scrolling does not change it".
   */
  const fills = page.locator("[data-scroll-rail-fill]");
  const count = await fills.count();
  expect(count, "no rail fills found — the selector is wrong").toBeGreaterThan(
    0,
  );

  const offsetsBefore = await fills.evaluateAll((nodes) =>
    nodes.map((n) => (n as SVGElement).style.strokeDashoffset),
  );
  expect(offsetsBefore.every((o) => o === "0")).toBe(true);

  await page.mouse.wheel(0, 2000);
  await page.waitForTimeout(200);

  const offsetsAfter = await fills.evaluateAll((nodes) =>
    nodes.map((n) => (n as SVGElement).style.strokeDashoffset),
  );
  expect(offsetsAfter).toEqual(offsetsBefore);
});
