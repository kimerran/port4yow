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
