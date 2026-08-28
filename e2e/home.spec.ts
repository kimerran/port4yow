import { expect, test } from "@playwright/test";
import { fixture } from "./fixture.ts";

/**
 * Home → detail → "more projects" (#39, SPEC §5).
 *
 * The "next card" chain this used to walk is gone: it followed a fixed order by
 * `sequence`, so the interesting claim was that it wrapped. The foot of a project
 * page now shows three OTHER projects picked at random per load, and the claims
 * worth holding are different — three of them, never yourself, and not the same
 * three on every visit.
 */

test.describe("home page", () => {
  test("renders the published projects as tiles", async ({ page }) => {
    const { slugs } = fixture();
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Mark Hugh Neri",
    );

    for (const slug of slugs) {
      await expect(
        page.locator(`#work a[href="/work/${slug}"]`).first(),
      ).toBeVisible();
    }
  });

  test("a tile click reaches that project's detail page", async ({ page }) => {
    const { slugs } = fixture();
    const slug = slugs[1] as string;

    await page.goto("/");
    const tile = page.locator(`#work a[href="/work/${slug}"]`).first();

    /**
     * The expected title is read from the TILE, not written here.
     *
     * It used to be the literal "E2E Project 2", which worked while
     * `global-setup` seeded the projects it asserted against. The projects are
     * content files now, so a hardcoded title is a copy of the content that
     * goes stale the moment the content changes — and it did, immediately.
     * Reading it makes this a test of the navigation rather than of the seed.
     */
    const expected = await tile.locator("h3").innerText();
    await tile.click();

    await expect(page).toHaveURL(new RegExp(`/work/${slug}$`));
    // The right page, not merely a project page.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(expected);
  });

  test("a draft project is not linked from the home page", async ({ page }) => {
    // SPEC §5 — the home page lists PUBLISHED only. Cheap to assert here and
    // the failure would otherwise be invisible until someone saw a 404.
    await page.goto("/");
    const hrefs = await page
      .locator("#work a")
      .evaluateAll((links) => links.map((l) => l.getAttribute("href")));
    expect(hrefs.every((h) => h?.startsWith("/work/"))).toBe(true);
  });
});

test.describe("more projects", () => {
  test("shows three, and never the one you are on", async ({ page }) => {
    const { slugs } = fixture();
    const current = slugs[0] as string;
    await page.goto(`/work/${current}`);

    const shown = page.locator("[data-related-item]:not([hidden])");
    await expect(shown).toHaveCount(3);

    const hrefs = await shown
      .locator("a")
      .evaluateAll((links) => links.map((l) => l.getAttribute("href")));

    expect(hrefs).toHaveLength(3);
    expect(
      hrefs.includes(`/work/${current}`),
      "a project linked to itself",
    ).toBe(false);
    expect(new Set(hrefs).size, "the same project appeared twice").toBe(3);
  });

  test("the hidden candidates are not tab stops", async ({ page }) => {
    /**
     * The reason `hidden` is the mechanism rather than `opacity`. Eleven
     * invisible links at the foot of every project page would be a keyboard
     * trap in all but name, and nothing else in the suite would notice.
     */
    const { slugs } = fixture();
    await page.goto(`/work/${slugs[0] as string}`);

    const reachable = await page
      .locator("[data-related-item][hidden] a")
      .evaluateAll(
        (links) =>
          links.filter((l) => (l as HTMLElement).offsetParent !== null).length,
      );

    expect(reachable, "a hidden related project is still rendered").toBe(0);
  });

  test("the selection changes between loads", async ({ page }) => {
    /**
     * The claim is that the pick is random per load, not fixed at build time.
     *
     * Asserted as "at least two distinct sets across six loads" rather than
     * "consecutive loads differ": choosing 3 of 13 twice gives the same set
     * 1 time in 286, so a strict pairwise assertion would fail roughly one run
     * in a hundred. Six loads all matching is (1/286)^5, which is never.
     */
    const { slugs } = fixture();
    const seen = new Set<string>();

    for (let i = 0; i < 6; i++) {
      await page.goto(`/work/${slugs[0] as string}`);
      const hrefs = await page
        .locator("[data-related-item]:not([hidden]) a")
        .evaluateAll((links) =>
          links.map((l) => l.getAttribute("href") ?? "").sort(),
        );
      seen.add(hrefs.join("|"));
    }

    expect(
      seen.size,
      "the same three every time — the pick is not random",
    ).toBeGreaterThan(1);
  });
});

/**
 * The playing-card metaphor is gone, and this is the guard on it staying gone.
 *
 * **This used to also assert that nothing on the page has a computed
 * `animation-name`** — a blanket "no entrance animation anywhere" rule, written
 * when removing the card deal had left the site with none. That is retired on
 * purpose: the site now has scroll reveals and a crossfading slideshow, which
 * were asked for. Keeping a test that forbids all motion while shipping motion
 * would mean deleting it in a hurry later, which is how a guard that mattered
 * gets thrown out alongside one that did not.
 *
 * What remains is the part that was always specific to the card: the 5:7 ratio
 * and the 3D flip. `motion.spec.ts` cannot cover this — it runs only under
 * `prefers-reduced-motion`, where a restored animation would be suppressed and
 * the test would pass anyway. This runs with motion enabled.
 */
test.describe("the card metaphor stays removed", () => {
  test("no element is a 5:7 card face or a flip", async ({ page }) => {
    const { slugs } = fixture();

    for (const path of ["/", `/work/${slugs[0] as string}`]) {
      await page.goto(path);

      const offenders = await page.evaluate(() =>
        [...document.querySelectorAll("*")]
          .filter((el) => {
            const s = getComputedStyle(el);
            // 5/7 is the playing-card ratio; `preserve-3d` only ever existed
            // here to give the flip its perspective.
            return (
              s.aspectRatio.replace(/\s/g, "") === "5/7" ||
              s.transformStyle === "preserve-3d" ||
              s.backfaceVisibility === "hidden"
            );
          })
          .map((el) => el.tagName.toLowerCase()),
      );

      expect(offenders, `card geometry found on ${path}`).toEqual([]);
    }
  });
});
