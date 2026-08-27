import { describe, expect, it } from "vitest";

const SECRET = "x".repeat(48);
Object.assign(process.env, {
  PUBLIC_SITE_URL: "https://mh.neri.ph",
  DATABASE_URL: "postgresql://a:b@localhost:5432/c",
  SESSION_SECRET: SECRET,
  FORM_SECRET: SECRET,
  IP_HASH_SALT: SECRET,
  S3_ENDPOINT: "http://localhost:9000",
  S3_BUCKET: "portfolio-media",
  S3_ACCESS_KEY_ID: "k",
  S3_SECRET_ACCESS_KEY: "s",
  CONTACT_TO_EMAIL: "a@b.com",
});

const { isSameOrigin } = await import("../origin");
const { env } = await import("../env");

const req = (headers: Record<string, string>): Request =>
  new Request("https://mh.neri.ph/api/contact", { method: "POST", headers });

describe("isSameOrigin — accepts our own origin", () => {
  it("accepts a matching Origin", () => {
    expect(isSameOrigin(req({ Origin: "https://mh.neri.ph" }))).toBe(true);
  });

  it("falls back to Referer when Origin is absent", () => {
    expect(
      isSameOrigin(req({ Referer: "https://mh.neri.ph/admin/login" })),
    ).toBe(true);
  });

  it("prefers Origin over Referer when both are present", () => {
    expect(
      isSameOrigin(
        req({
          Origin: "https://evil.test",
          Referer: "https://mh.neri.ph/admin/login",
        }),
      ),
    ).toBe(false);
  });
});

describe("isSameOrigin — refuses everything else", () => {
  it.each([
    ["a cross-origin Origin", { Origin: "https://evil.test" }],
    ["a cross-origin Referer", { Referer: "https://evil.test/x" }],
    ["a same-host different scheme", { Origin: "http://mh.neri.ph" }],
    ["a subdomain", { Origin: "https://admin.mh.neri.ph" }],
    ["a suffix look-alike", { Origin: "https://mh.neri.ph.evil.test" }],
    ["an unparseable Referer", { Referer: "not a url" }],
    ["an empty Origin", { Origin: "" }],
  ])("refuses %s", (_label, headers) => {
    expect(isSameOrigin(req(headers))).toBe(false);
  });

  /**
   * The finding this module exists for. Login and logout previously allowed a
   * request with no Origin at all, while /api/contact refused it — two answers
   * to one threat, with the laxer one guarding the route that issues sessions.
   *
   * Browsers send Origin on every cross-origin POST, so its absence means a
   * non-browser client. Treating "no evidence" as "must be fine" is the
   * failure-open shape AGENT §1.5 rules out.
   */
  it("refuses a request with neither Origin nor Referer", () => {
    expect(isSameOrigin(req({}))).toBe(false);
  });
});

/**
 * #37 — the downstream half of a boundary bug `env.test.ts` now blocks.
 *
 * `PUBLIC_SITE_URL=localhost:4321` used to pass `z.url()`, and
 * `new URL("localhost:4321").origin` is the *string* `"null"`. Browsers send
 * `Origin: null` from a sandboxed iframe and from some cross-origin redirects,
 * so a misconfigured deployment accepted exactly the callers this refuses.
 *
 * The fix is in `env.ts`, which is the right place — a value that cannot be
 * held cannot be compared against. This records the consequence so the two
 * halves stay connected: if anyone ever loosens the URL schema, they will find
 * this test explaining what it was protecting.
 */
describe("Origin: null is never our origin (#37)", () => {
  const post = (headers: Record<string, string>): Request =>
    new Request("https://mh.neri.ph/api/contact", { method: "POST", headers });

  it("refuses a sandboxed-iframe POST", () => {
    expect(isSameOrigin(post({ Origin: "null" }))).toBe(false);
  });

  it("refuses a null Referer too", () => {
    expect(isSameOrigin(post({ Referer: "null" }))).toBe(false);
  });

  it("the configured origin is always an absolute http(s) origin", () => {
    // The property that makes the two cases above hold, rather than the strings.
    const expected = new URL(env.PUBLIC_SITE_URL).origin;
    expect(expected).toMatch(/^https?:\/\//);
    expect(expected).not.toBe("null");
  });
});
