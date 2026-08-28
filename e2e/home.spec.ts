import { expect, test } from "@playwright/test";
import { fixture } from "./fixture.ts";

/**
 * Home → detail → "next card" (#39, SPEC §5).
 *
 * The interesting claim is the last one: **the next-card chain cycles through
 * the full set and wraps.** That is a property of the whole sequence, so it is
 * walked rather than sampled — following the link N times from each of the three
 * seeded projects and checking the path returns to where it started, having
 * visited every project exactly once on the way.
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
    await page.locator(`#work a[href="/work/${slug}"]`).first().click();

    await expect(page).toHaveURL(new RegExp(`/work/${slug}$`));
    // The right page, not merely a project page.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "E2E Project 2",
    );
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

test.describe("the next-card chain", () => {
  test("cycles through every project and wraps back to the start", async ({
    page,
  }) => {
    /**
     * The expected set comes from the **home page**, not from the seed.
     *
     * `admin.spec.ts` publishes a project of its own, and it runs first
     * alphabetically — so a fixture-derived expectation of three slugs was
     * stale by the time this ran, and the failure looked like a broken chain
     * rather than like a stale assumption. Reading what is actually published
     * makes the test a statement about the feature instead of about the seed.
     */
    await page.goto("/");
    const published = await page
      .locator('#work a[href^="/work/"]')
      .evaluateAll((links) => [
        ...new Set(
          links.map((l) =>
            (l.getAttribute("href") ?? "").replace("/work/", ""),
          ),
        ),
      ]);

    expect(
      published.length,
      "no published projects — nothing to cycle through",
    ).toBeGreaterThan(2);

    const start = published[0] as string;
    await page.goto(`/work/${start}`);

    const visited: string[] = [start];
    for (let i = 0; i < published.length; i++) {
      const next = page.getByRole("navigation", { name: "Next project" });
      await expect(next).toBeVisible();
      await next.getByRole("link").click();
      await page.waitForURL(/\/work\//);
      const slug = new URL(page.url()).pathname.replace("/work/", "");

      if (i < published.length - 1) visited.push(slug);
      else expect(slug, "the chain must wrap to where it started").toBe(start);
    }

    // Every published project seen exactly once before the wrap.
    expect([...visited].sort()).toEqual([...published].sort());
    expect(new Set(visited).size).toBe(published.length);
  });

  test("the link is labelled by its visible title", async ({ page }) => {
    /**
     * This used to be "the accessible name comes from the face-up side": the
     * link was a card that flipped, its back was `aria-hidden`, and a name
     * sourced from the back would have left it unlabelled. There are no longer
     * two sides — but the claim worth keeping is the one that outlived the
     * mechanism, so it is asserted against the title rather than against
     * "non-empty", which the old version would have passed on any stray text.
     */
    const { slugs } = fixture();
    await page.goto(`/work/${slugs[0] as string}`);

    const link = page
      .getByRole("navigation", { name: "Next project" })
      .getByRole("link");

    const heading = await page
      .locator("h1")
      .evaluate((el) => el.textContent?.trim() ?? "");
    const name = (
      await link.evaluate((el) => el.textContent?.trim() ?? "")
    ).replace(/\s+/g, " ");

    expect(name.length).toBeGreaterThan(0);
    // It names the project it goes to, and that is a different one.
    expect(name).not.toContain(heading);
  });
});

/**
 * The playing-card metaphor is gone, and these are the guards on it staying gone.
 *
 * Deleting the deal keyframes and the flip classes is the kind of change a later
 * "restore the hero animation" commit reverses without anyone noticing, because
 * nothing else fails when it comes back. `motion.spec.ts` cannot cover it: it
 * runs only under `prefers-reduced-motion`, where a restored animation would be
 * suppressed and the test would pass anyway. This runs with motion enabled.
 */
test.describe("the card metaphor stays removed", () => {
  test("nothing on the home page animates on entrance", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const animated = await page.evaluate(() =>
      [...document.querySelectorAll("*")]
        .filter((el) => {
          const name = getComputedStyle(el).animationName;
          return name !== "none" && name !== "";
        })
        .map((el) => `${el.tagName.toLowerCase()}.${el.className.toString()}`),
    );

    expect(animated, "an entrance animation is back").toEqual([]);
  });

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
