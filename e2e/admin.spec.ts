import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { fixture, forwardedFor } from "./fixture.ts";

/**
 * The full admin round trip (#39, SPEC §6): sign in → create → upload → publish
 * → **appears publicly** → sign out invalidates the session.
 *
 * Driven entirely through the interface. Nothing is set up with a database
 * write, because the point of this spec is that the interface can do it — a
 * seeded project would prove the public page renders, which `home.spec.ts`
 * already covers, and would say nothing about the admin.
 *
 * The account comes from `global-setup.ts`, which generates its password per
 * run. There is no password in this file.
 */

test.describe.configure({ mode: "serial" });

/** A 1×1 PNG, built here rather than committed — no binary fixture to drift. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const slug = `e2e-flow-${randomBytes(4).toString("hex")}`;

test("sign in, create, upload, publish, and see it publicly", async ({
  page,
}, testInfo) => {
  const { username, password } = fixture();

  // --- sign in -------------------------------------------------------------
  // Login is 10/15min/IP (SPEC §7). See `forwardedFor` — this suite exceeds
  // that on its own, and the failure reads as "sign in did not navigate".
  await page.setExtraHTTPHeaders({
    "x-forwarded-for": forwardedFor(testInfo),
  });
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login/);

  await page.locator("#login-username").fill(username);
  await page.locator("#login-password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/admin$/);

  // --- create a draft ------------------------------------------------------
  await page.goto("/admin/projects/new");
  await page.locator('[name="title"]').fill("E2E Flow Project");
  await page.locator('[name="slug"]').fill(slug);
  await page.locator('[name="suit"]').selectOption("CLUBS");
  await page.locator('[name="summary"]').fill("Created by the e2e suite.");
  await page.locator('[name="role"]').fill("Lead engineer");
  await page.locator('[name="timeline"]').fill("Jan 2026 – Feb 2026");
  await page.locator('[name="problem"]').fill("A problem worth solving.");
  await page.locator('[name="body"]').fill("## Approach\n\nBody copy.");
  await page.locator('[name="outcome"]').fill("A measurable outcome.");
  await page.getByRole("button", { name: "Create draft" }).click();

  /**
   * `/admin/projects/<id>`, and explicitly **not** `/new`.
   *
   * The first version of this asserted `/admin\/projects\//`, which matches the
   * page the test was already standing on — so a failed create passed here and
   * surfaced twenty lines later as "the project is missing from a dropdown".
   * An assertion that holds on the starting state measures nothing.
   */
  await expect(page).toHaveURL(/\/admin\/projects\/(?!new)[^/]+$/);

  // A DRAFT is not public yet — SPEC §5, and #18's rewrite rather than a 500.
  const draftResponse = await page.request.get(`/work/${slug}`);
  expect(draftResponse.status()).toBe(404);

  // --- upload a cover ------------------------------------------------------
  await page.goto("/admin/media");
  // By label, exactly — `selectOption` takes a string here, not a RegExp.
  await page
    .locator('select[name="projectId"]')
    .selectOption({ label: "E2E Flow Project" });
  await page
    .locator('input[name="file"]')
    .setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: PNG });
  await page.locator('[name="altText"]').first().fill("A test cover image");
  await page.getByRole("button", { name: "Upload" }).click();

  /**
   * The alt text lands in an `<input value=...>` in the media list, not in a
   * text node — `getByText` finds nothing there, which is what it did first.
   * An input value is also the honest thing to assert: it is what the admin
   * would edit, and it proves the row was written rather than that a string
   * appeared somewhere on the page.
   */
  await expect(
    page.locator('input[name="altText"][value="A test cover image"]'),
  ).toHaveCount(1);

  // --- attach the cover and publish ---------------------------------------
  const projectsPage = page.getByRole("link", { name: "E2E Flow Project" });
  await page.goto("/admin/projects");
  await projectsPage.first().click();
  await expect(page).toHaveURL(/\/admin\/projects\//);

  const cover = page.locator('select[name="coverImageId"]');
  await cover.selectOption({ index: 1 });
  await page.getByRole("button", { name: /Save/ }).first().click();

  await page.getByRole("button", { name: "Publish" }).click();

  // --- it is now public ----------------------------------------------------
  await expect
    .poll(async () => (await page.request.get(`/work/${slug}`)).status(), {
      timeout: 10_000,
    })
    .toBe(200);

  const publicPage = await page.context().newPage();
  await publicPage.goto(`/work/${slug}`);
  await expect(publicPage.getByRole("heading", { level: 1 })).toHaveText(
    "E2E Flow Project",
  );
  await publicPage.close();
});

test("signing out invalidates the session", async ({ page }, testInfo) => {
  const { username, password } = fixture();

  await page.setExtraHTTPHeaders({
    "x-forwarded-for": forwardedFor(testInfo),
  });
  await page.goto("/admin/login");
  await page.locator("#login-username").fill(username);
  await page.locator("#login-password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin$/);

  // Keep the cookie, so the check below is about the SESSION being dead rather
  // than about the browser having thrown the cookie away.
  const before = (await page.context().cookies()).find(
    (c) => c.name === "__Host-session",
  );
  expect(before?.value).toBeTruthy();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/admin\/login/);

  // Re-present the old cookie: the row is gone, so it must not authenticate.
  await page.context().addCookies([
    {
      name: "__Host-session",
      value: before?.value ?? "",
      domain: "localhost",
      path: "/",
      httpOnly: true,
      secure: true,
    },
  ]);
  const replay = await page.request.get("/admin", { maxRedirects: 0 });
  expect(replay.status()).toBe(302);
  expect(replay.headers()["location"]).toContain("/admin/login");
});
