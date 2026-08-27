import { expect, test } from "@playwright/test";
import { isTooSmall, tapTargetFactsFor } from "./a11y-rules.ts";
import { fixture, forwardedFor } from "./fixture.ts";

/**
 * Layout at 375, 768 and 1440 (#39, BRAND §9).
 *
 * Runs under all three viewport projects, so a failure names the width. The
 * two claims are the ones a visitor notices: **nothing scrolls sideways**, and
 * **every touch target is big enough to hit**.
 */

const pages = (): string[] => {
  const { slugs } = fixture();
  return ["/", `/work/${slugs[0] as string}`, "/privacy", "/404"];
};

test.describe("no horizontal scroll", () => {
  for (const path of ["/", "/privacy", "/404"]) {
    test(`${path} fits the viewport`, async ({ page }) => {
      await page.goto(path);
      await checkNoOverflow(page, path);
    });
  }

  test("a project detail page fits the viewport", async ({ page }) => {
    const [, detail] = pages();
    await page.goto(detail as string);
    await checkNoOverflow(page, detail as string);
  });
});

async function checkNoOverflow(
  page: import("@playwright/test").Page,
  label: string,
): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    // Name the culprit — "the page is 40px too wide" is not actionable.
    const offenders: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.right > doc.clientWidth + 1 || rect.left < -1) {
        offenders.push(
          `${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 50)} right=${String(Math.round(rect.right))}`,
        );
      }
    }
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      offenders: offenders.slice(0, 5),
    };
  });

  expect(
    overflow.scrollWidth,
    `${label} scrolls sideways. Widest offenders:\n  ${overflow.offenders.join("\n  ")}`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

test.describe("tap targets", () => {
  /**
   * Every public page, not just `/`.
   *
   * The first version visited the home page only. The footer link is global so
   * it happened to be covered, but a small target introduced on `/privacy` or a
   * project page would have gone unseen — and the three this test found were
   * exactly that kind of thing: ordinary links nobody thought of as controls.
   */
  /**
   * The rules live in `a11y-rules.ts`, not here.
   *
   * They were inline first, and a copy of them sat in `a11y.spec.ts` as the
   * "guard". Mutating the rules left both green, because neither the spec nor
   * the guard was calling the thing under test. The browser now only collects
   * facts; every decision is a pure function the case tables also call.
   */
  const smallTargets = async (
    page: import("@playwright/test").Page,
  ): Promise<string[]> =>
    (await tapTargetFactsFor(page))
      .filter(isTooSmall)
      .map(
        (f) =>
          `<${f.tag}> "${f.text}" ${String(Math.round(f.width))}x${String(Math.round(f.height))}`,
      );

  for (const path of ["/", "/privacy", "/404"]) {
    test(`${path}: every interactive element is at least 44x44 (BRAND §9)`, async ({
      page,
    }, testInfo) => {
      test.skip(
        !testInfo.project.name.includes("375"),
        "the 44px floor is a touch requirement",
      );

      await page.goto(path);
      const small = await smallTargets(page);
      expect(
        small,
        `${path} targets under 44px:\n  ${small.join("\n  ")}`,
      ).toEqual([]);
    });
  }

  test("a project detail page: every interactive element is at least 44x44", async ({
    page,
  }, testInfo) => {
    test.skip(
      !testInfo.project.name.includes("375"),
      "the 44px floor is a touch requirement",
    );

    const [, detail] = pages();
    await page.goto(detail as string);
    const small = await smallTargets(page);
    expect(
      small,
      `the detail page has targets under 44px:\n  ${small.join("\n  ")}`,
    ).toEqual([]);
  });

  test("the admin dashboard: every interactive element is at least 44x44", async ({
    page,
  }, testInfo) => {
    test.skip(
      !testInfo.project.name.includes("375"),
      "the 44px floor is a touch requirement",
    );

    const { username, password } = fixture();
    await page.setExtraHTTPHeaders({
      "x-forwarded-for": forwardedFor(testInfo),
    });
    await page.goto("/admin/login");
    await page.locator("#login-username").fill(username);
    await page.locator("#login-password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/admin$/);

    const small = await smallTargets(page);
    expect(small, `admin targets under 44px:\n  ${small.join("\n  ")}`).toEqual(
      [],
    );
  });
});

test("the work grid reflows rather than shrinking the cards", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const tiles = page.locator("#work li");
  await expect(tiles.first()).toBeVisible();

  const width = await tiles
    .first()
    .evaluate((el) => el.getBoundingClientRect().width);

  // A tile that has been squeezed below a readable width means the grid is
  // scaling instead of changing column count.
  expect(
    width,
    `${testInfo.project.name}: tile is ${String(Math.round(width))}px`,
  ).toBeGreaterThan(240);
});
