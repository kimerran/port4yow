import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { forwardedFor } from "./fixture.ts";

/**
 * The viewing gate.
 *
 * Every other spec starts from a storage state that has already passed it, so
 * this is the one file that sees it. That is deliberate — the alternative is
 * fifty specs each dismissing an overlay before they can assert their real
 * subject.
 *
 * An EXPLICIT empty state, not `storageState: undefined`. Playwright reads
 * `undefined` as "not specified" and falls through to the project's value, so
 * these tests inherited the bypass and reported the gate as absent — passing
 * while testing nothing, which is the failure mode a gate spec must not have.
 */
test.use({ storageState: { cookies: [], origins: [] } });

const KEY = "mhn.access.v1";

test.describe("the viewing gate", () => {
  test("blocks the page until an email is given", async ({ page }) => {
    await page.goto("/");

    const gate = page.locator("[data-access-gate]");
    await expect(gate).toBeVisible();

    /**
     * The page must not scroll behind the overlay. Asserted on the computed
     * style rather than by trying to scroll: a failed scroll is indistinguishable
     * from a page that is simply short.
     */
    await expect(page.locator("body")).toHaveCSS("overflow", "hidden");

    // Focus is placed in the form, not left on <body> where the first Tab would
    // walk into the page behind.
    await expect(page.locator("#gate-email")).toBeFocused();
  });

  test("refuses an invalid address without opening", async ({ page }) => {
    await page.goto("/");

    await page.locator("#gate-email").fill("not-an-email");
    await page.getByRole("button", { name: "View the portfolio" }).click();

    await expect(page.locator("[data-access-gate]")).toBeVisible();
    await expect(page.locator("[data-access-error]")).toHaveText(/incomplete/i);
  });

  test("opens on a valid address, and stays open on the next page", async ({
    page,
  }, testInfo) => {
    await page.setExtraHTTPHeaders({
      "x-forwarded-for": forwardedFor(testInfo),
    });
    await page.goto("/");

    await page.locator("#gate-email").fill("visitor@example.test");
    await page.getByRole("button", { name: "View the portfolio" }).click();

    await expect(page.locator("[data-access-gate]")).toBeHidden();
    await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");

    const stored = await page.evaluate(
      (key: string) => localStorage.getItem(key),
      KEY,
    );
    expect(stored, "the answer was not remembered").toContain(
      "visitor@example.test",
    );

    // The point of remembering it: a second page does not ask again.
    await page.goto("/privacy");
    await expect(page.locator("[data-access-gate]")).toBeHidden();
  });

  test("Tab does not escape the dialog", async ({ page }) => {
    /**
     * `aria-modal` tells assistive tech the page behind is inert; it does
     * nothing for the physical Tab key. Without a trap, tabbing off the last
     * control lands on links the visitor cannot see — worse than no gate.
     */
    await page.goto("/");
    const gate = page.locator("[data-access-gate]");
    await expect(gate).toBeVisible();

    const insideGate = async (): Promise<boolean> =>
      page.evaluate(
        () =>
          document.activeElement !== null &&
          document.activeElement.closest("[data-access-gate]") !== null,
      );

    // More presses than there are controls, so it has to wrap at least twice.
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      expect(
        await insideGate(),
        `focus escaped on press ${String(i + 1)}`,
      ).toBe(true);
    }
  });

  test("Escape does not dismiss it", async ({ page }) => {
    // It is a gate. An Escape key that opens it is a bypass with a shortcut.
    await page.goto("/");
    await expect(page.locator("[data-access-gate]")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-access-gate]")).toBeVisible();
  });

  test("has no serious or critical accessibility violations", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("[data-access-gate]")).toBeVisible();

    const { violations } = await new AxeBuilder({ page })
      .include("[data-access-gate]")
      .analyze();

    const blocking = violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );

    expect(
      blocking.map((v) => `${v.id}: ${v.nodes.length} node(s)`),
      "the gate is the first thing every visitor meets",
    ).toEqual([]);
  });
});
