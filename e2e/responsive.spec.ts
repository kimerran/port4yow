import { expect, test } from "@playwright/test";
import { fixture } from "./fixture.ts";

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
  test("every interactive element is at least 44x44 (BRAND §9)", async ({
    page,
  }, testInfo) => {
    test.skip(
      !testInfo.project.name.includes("375"),
      "the 44px floor is a touch requirement",
    );

    await page.goto("/");

    const small = await page.evaluate(() => {
      const results: string[] = [];
      const selector = "a, button, input, select, textarea, [role='button']";
      for (const el of document.querySelectorAll<HTMLElement>(selector)) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (el.getAttribute("aria-hidden") === "true") continue;
        if (el.tabIndex < 0) continue;
        /**
         * Skip visually-hidden elements — the skip link and the honeypot.
         *
         * The skip link is `sr-only` until focused, so its unfocused box is
         * 32x16 and measuring that is measuring nothing: it is not a touch
         * target at all, it is a keyboard affordance that becomes a padded box
         * the moment it receives focus. `keyboard.spec.ts` covers it there.
         */
        if (el.closest(".sr-only") ?? el.classList.contains("sr-only"))
          continue;
        if (rect.height < 44 || rect.width < 44) {
          results.push(
            `<${el.tagName.toLowerCase()}> "${(el.textContent ?? "").trim().slice(0, 30)}" ${String(Math.round(rect.width))}x${String(Math.round(rect.height))}`,
          );
        }
      }
      return results;
    });

    expect(small, `targets under 44px:\n  ${small.join("\n  ")}`).toEqual([]);
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
