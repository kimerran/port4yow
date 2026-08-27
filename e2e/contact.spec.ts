import { expect, test } from "@playwright/test";
import { contactMessageByEmail } from "./db.ts";
import { forwardedFor } from "./fixture.ts";

/**
 * The contact form, with and without JavaScript (#39, SPEC §7).
 *
 * The no-JS path is the one worth having: SPEC §7 requires the form to work as
 * a plain POST, and nothing else in the suite can tell whether it does. It is
 * exercised by disabling JavaScript **in the browser context**, not by
 * intercepting the fetch — the acceptance criterion says "JS disabled in the
 * browser context", and a page whose script never ran behaves differently from
 * one whose script was blocked mid-flight.
 */

/** Distinct per run so a stale row cannot cross tests. */
const unique = (): string => Math.random().toString(36).slice(2, 10);

const fill = async (
  page: import("@playwright/test").Page,
  suffix: string,
): Promise<void> => {
  await page.locator("#contact-name").fill(`E2E Visitor ${suffix}`);
  await page.locator("#contact-email").fill(`e2e-${suffix}@example.test`);
  await page
    .locator("#contact-message")
    .fill(
      `This is an end-to-end submission ${suffix}, long enough to pass validation.`,
    );
};

test.describe("with JavaScript", () => {
  test("submits and shows 'Message sent'", async ({ page }, testInfo) => {
    await page.setExtraHTTPHeaders({
      "x-forwarded-for": forwardedFor(testInfo),
    });
    await page.goto("/#contact");
    await fill(page, unique());

    /**
     * #21's HMAC gate rejects anything faster than 3 seconds as a bot. Waiting
     * is the honest way to satisfy it: skipping it would mean the test proves
     * the spam gate works rather than that the form does.
     */
    await page.waitForTimeout(3200);

    await page.getByRole("button", { name: "Send message" }).click();

    // The button keeps the verb through the flow (BRAND §8).
    await expect(
      page.getByRole("button", { name: "Message sent" }),
    ).toBeVisible();

    // And the live region carries the sentence a screen reader announces.
    const status = page.locator("[data-form-status]");
    await expect(status).toHaveText(/Message sent/);
    await expect(status).toHaveAttribute("aria-live", "polite");
  });

  test("a validation failure is announced, not just coloured", async ({
    page,
  }, testInfo) => {
    await page.setExtraHTTPHeaders({
      "x-forwarded-for": forwardedFor(testInfo),
    });
    await page.goto("/#contact");
    await page.locator("#contact-name").fill("J");
    await page.locator("#contact-email").fill("not-an-email");
    await page.locator("#contact-message").fill("too short");
    await page.waitForTimeout(3200);
    await page.getByRole("button", { name: "Send message" }).click();

    // BRAND §9 — errors reach the accessibility tree.
    await expect(page.locator('[data-error-for="email"]')).not.toBeEmpty();
    await expect(page.locator("#contact-email")).toHaveAttribute(
      "aria-describedby",
      "contact-email-error",
    );
  });
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the form still posts and the submission is accepted", async ({
    page,
  }, testInfo) => {
    const suffix = unique();
    await page.setExtraHTTPHeaders({
      "x-forwarded-for": forwardedFor(testInfo),
    });
    await page.goto("/#contact");
    await fill(page, suffix);

    /**
     * #21's HMAC gate treats anything under 3 seconds as a bot, and the
     * endpoint answers **200 either way** — SPEC §7's indistinguishable
     * response. Without this wait the test passed while the server logged
     * `classified as spam: too-fast`, so it was asserting that the endpoint
     * answers rather than that the submission was accepted.
     */
    await page.waitForTimeout(3200);

    const [response] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/api/contact") && r.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Send message" }).click(),
    ]);

    expect(response.status()).toBe(200);

    // The status code cannot distinguish accepted from spam. The row can.
    const row = await contactMessageByEmail(`e2e-${suffix}@example.test`);
    expect(row?.status).toBe("NEW");

    /**
     * The proof that this is genuinely the no-JS path, and it has to be an
     * observation rather than an assertion about the context.
     *
     * `page.evaluate` still works under `javaScriptEnabled: false` — Playwright
     * runs it in an isolated world — so "can I evaluate?" tells you nothing. I
     * used that as the probe first and it reported the context had JS.
     *
     * What actually distinguishes the two paths is the navigation.
     * `initContactForm` calls `preventDefault` and posts with `fetch`, so the
     * enhanced path never leaves the page. A real form submit does. Landing on
     * `/api/contact` is therefore only possible if the page's script never ran.
     */
    await page.waitForURL(/\/api\/contact$/);
    expect(new URL(page.url()).pathname).toBe("/api/contact");
  });

  test("the enhanced path, by contrast, never navigates", async ({
    browser,
  }, testInfo) => {
    // The control for the test above: same actions with JS on must stay put.
    // Without it, "we landed on /api/contact" proves nothing about JS at all.
    const context = await browser.newContext({
      javaScriptEnabled: true,
      extraHTTPHeaders: {
        "x-forwarded-for": forwardedFor(testInfo),
      },
    });
    const page = await context.newPage();
    await page.goto("/#contact");
    await fill(page, unique());
    await page.waitForTimeout(3200);
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(
      page.getByRole("button", { name: "Message sent" }),
    ).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/");
    await context.close();
  });

  test("the form's action and method are real, not script-dependent", async ({
    page,
  }) => {
    // The enhanced path hijacks submit; without these attributes there is
    // nothing to fall back to, and the failure is silent in a JS browser.
    await page.goto("/#contact");
    const form = page.locator("#contact-form");
    await expect(form).toHaveAttribute("action", "/api/contact");
    // Case-insensitive: the attribute is `method="POST"` in the markup, and
    // HTML treats it case-insensitively — asserting the literal lowercase was
    // my error, not the code's.
    await expect(form).toHaveAttribute("method", /^post$/i);
  });
});
