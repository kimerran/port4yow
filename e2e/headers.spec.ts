import { expect, test } from "@playwright/test";
import { fixture } from "./fixture.ts";

/**
 * Security headers, asserted against the SERVED RESPONSE (SPEC §14.1, §14.3).
 *
 * ## Why this exists as an e2e test and not a unit test
 *
 * `src/__tests__/middleware.test.ts` covers the middleware and passes. It kept
 * passing while every public page was served with **no security headers at
 * all**: the site became static, `@astrojs/node` serves prerendered HTML from
 * its own file handler, and that handler never calls middleware. The function
 * was correct and simply not invoked.
 *
 * A test of a function cannot see that. This one asks the server.
 *
 * Both shapes are checked because they take different paths through
 * `server.mjs` — a prerendered file and an on-demand route — and a fix for one
 * that misses the other is exactly the failure being guarded.
 */

const REQUIRED: [string, RegExp][] = [
  ["strict-transport-security", /max-age=\d+/],
  ["x-content-type-options", /^nosniff$/],
  ["referrer-policy", /strict-origin-when-cross-origin/],
  ["permissions-policy", /camera=\(\)/],
  ["cross-origin-opener-policy", /same-origin/],
  ["x-frame-options", /^DENY$/],
  // Header-only by specification: browsers ignore it in the <meta> tag Astro
  // emits for a static build, so its absence here is not cosmetic.
  ["content-security-policy", /frame-ancestors 'none'/],
];

const paths = (): string[] => {
  const { slugs } = fixture();
  return ["/", `/work/${slugs[0] as string}`, "/privacy", "/404", "/healthz"];
};

test.describe("security headers reach the browser", () => {
  for (const path of ["/", "/privacy", "/healthz"]) {
    test(`${path} carries all of them`, async ({ request }) => {
      const response = await request.get(path);
      const headers = response.headers();

      const missing = REQUIRED.filter(
        ([name, pattern]) => !pattern.test(headers[name] ?? ""),
      ).map(([name]) => name);

      expect(missing, `${path} is missing headers`).toEqual([]);
    });
  }

  test("a prerendered project page carries them too", async ({ request }) => {
    const [, detail] = paths();
    const headers = (await request.get(detail as string)).headers();
    const missing = REQUIRED.filter(
      ([name, pattern]) => !pattern.test(headers[name] ?? ""),
    ).map(([name]) => name);
    expect(missing).toEqual([]);
  });

  test("the CSP still hashes inline scripts", async ({ page }) => {
    /**
     * The per-page policy lives in a `<meta>` tag for a static build. It carries
     * the hashes, which is the part that matters: without them the inline module
     * scripts would need `unsafe-inline`, and CSP would be decoration.
     */
    await page.goto("/");
    const csp = await page
      .locator('meta[http-equiv="content-security-policy"]')
      .getAttribute("content");

    expect(csp, "no CSP meta tag").not.toBeNull();
    expect(csp).toContain("default-src 'self'");
    expect(csp, "inline scripts are not hashed").toMatch(
      /script-src[^;]*'sha256-/,
    );
  });
});
