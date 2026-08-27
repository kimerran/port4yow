import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SECRET = "x".repeat(48);
Object.assign(process.env, {
  PUBLIC_SITE_URL: "http://localhost:4321",
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

const { MAX_UPLOAD_BYTES } = await import("../upload");

/**
 * The framework limit must sit ABOVE the application limit.
 *
 * Astro refuses an Action body larger than `security.actionBodySizeLimit`
 * before the handler runs, and its default is 1 MiB. With the default in place,
 * every upload between 1 MB and 8 MB — most of the range SPEC §9 allows, and
 * where real screenshots live — was refused with a raw `CONTENT_TOO_LARGE`,
 * while `processUpload`'s own 8 MB check and its error copy were unreachable.
 *
 * Measured before the fix: a valid 5.43 MB JPEG returned
 * `413 Request body exceeds 1048576 bytes` and stored nothing.
 *
 * Nothing else catches this. The other upload tests call `processUpload`
 * directly with a byte array and never cross the HTTP boundary, so the limit
 * that actually applies in production is invisible to them. This test reads the
 * config as text rather than importing it, because `astro.config.mjs` pulls in
 * integrations that cannot load under vitest.
 */
describe("upload size limits", () => {
  const config = readFileSync("astro.config.mjs", "utf8");

  const configuredLimit = (): number => {
    const match = /actionBodySizeLimit:\s*([0-9*\s]+),/.exec(config);
    if (!match?.[1]) throw new Error("actionBodySizeLimit is not set");
    return match[1]
      .split("*")
      .map((part) => Number(part.trim()))
      .reduce((product, value) => product * value, 1);
  };

  it("is configured at all — the 1 MiB default is far below SPEC §9", () => {
    expect(config).toContain("actionBodySizeLimit");
    expect(configuredLimit()).toBeGreaterThan(1024 * 1024);
  });

  it("leaves room for the app's own limit to be the one that decides", () => {
    expect(configuredLimit()).toBeGreaterThan(MAX_UPLOAD_BYTES);
  });

  /**
   * Multipart adds boundaries and field names, so a body carrying an 8 MiB file
   * is slightly larger than the file itself. Without headroom, a file exactly at
   * the app's limit would still be refused by the framework.
   */
  it("has headroom for multipart overhead", () => {
    expect(configuredLimit() - MAX_UPLOAD_BYTES).toBeGreaterThanOrEqual(
      512 * 1024,
    );
  });

  it("does not leave the framework limit wide open", () => {
    // Headroom, not an open door: a wildly oversized body should still be
    // refused cheaply at the framework layer rather than buffered.
    expect(configuredLimit()).toBeLessThanOrEqual(MAX_UPLOAD_BYTES * 2);
  });

  it("keeps SPEC §9's 8 MB as the application limit", () => {
    expect(MAX_UPLOAD_BYTES).toBe(8 * 1024 * 1024);
  });
});
