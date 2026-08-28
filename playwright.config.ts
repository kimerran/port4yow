import { defineConfig, devices } from "@playwright/test";
import { STORAGE_STATE_PATH } from "./e2e/global-setup.ts";

/**
 * End-to-end suite (#39, SPEC §16, BRAND §9).
 *
 * ## Against a production build, not `astro dev`
 *
 * #33 established that the two differ where it matters: `astro dev` emits **no
 * CSP at all**, so a dev-server run would have "passed" the accessibility and
 * behaviour checks while telling us nothing about the page a visitor gets. The
 * `webServer` below builds and boots the real adapter entry point.
 *
 * ## Viewports
 *
 * #39 names 375, 768 and 1440. They are separate projects rather than
 * `page.setViewportSize` calls inside tests, so a layout failure at one width
 * reads as one named failing project instead of one test with a loop in it.
 * Only the checks that are about layout run at all three; behaviour runs once.
 */
const PORT = 4321;
const BASE_URL = `http://localhost:${String(PORT)}`;

export default defineConfig({
  testDir: "./e2e",
  /**
   * Serial. The suite drives one admin account and one database, the same
   * constraint #38 measured on the integration suite — concurrent workers
   * publish and unpublish each other's projects.
   */
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  globalSetup: "./e2e/global-setup.ts",

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    /**
     * Every context starts having already passed the viewing gate.
     *
     * Without it the overlay covers the page in every spec, and each one would
     * have to dismiss it before asserting anything — turning one feature into a
     * precondition repeated fifty times, and hiding the specs' real subject.
     *
     * `gate.spec.ts` clears this and tests the gate directly. That is the one
     * place it should be exercised.
     */
    storageState: STORAGE_STATE_PATH,
  },

  projects: [
    {
      name: "desktop-1440",
      /**
       * Everything except the reduced-motion specs. Without this the default
       * project has no `testMatch` and therefore runs *every* file, including
       * ones that assert animations are disabled — under a context where they
       * are not. Six tests failed that way, and the failure read as "the site
       * ignores reduced motion" rather than "this project should not be running
       * these".
       */
      testIgnore: /motion\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "tablet-768",
      testMatch: /(responsive|a11y)\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 768, height: 1024 },
      },
    },
    {
      name: "mobile-375",
      testMatch: /(responsive|a11y)\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      /**
       * BRAND §9 — `prefers-reduced-motion: reduce` must render everything in
       * its final state. Set on the **context**, because that is how a real
       * visitor arrives: the preference is in place before the first paint
       * rather than toggled after it, which is exactly the difference between
       * "the animation is skipped" and "the animation ran and then stopped".
       *
       * `contextOptions`, not a bare `reducedMotion` under `use` — Playwright
       * 1.62 exposes `colorScheme` at the top level but not this one. Checked
       * against the shipped `types/test.d.ts` rather than assumed.
       */
      name: "reduced-motion",
      testMatch: /motion\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        contextOptions: { reducedMotion: "reduce" },
      },
    },
  ],

  webServer: {
    /**
     * Build every run, so a stale `dist/` cannot make a broken change pass.
     *
     * `--env-file-if-exists` rather than `--env-file`: the built entry point
     * does not read `.env` itself (only `astro.config.mjs` does, at build
     * time), so a developer needs the file loaded — while CI has no `.env` at
     * all and supplies the same variables through the job environment. One
     * command that is correct in both places beats two that can disagree.
     */
    command:
      "pnpm build && node --env-file-if-exists=.env ./dist/server/entry.mjs",
    url: `${BASE_URL}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
