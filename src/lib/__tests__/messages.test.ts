import { describe, expect, it } from "vitest";

/**
 * `isUndelivered` is pure, but it lives beside the queries in `messages.ts`,
 * which imports `db` and therefore `env` — so the environment has to be present
 * before the module loads. Without this the file fails to load at all, which
 * vitest reports as a failed SUITE rather than a failed test, and a mutation
 * harness reading "1 failed" cannot tell the two apart.
 */
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

const { isUndelivered } = await import("../messages");

/**
 * `isUndelivered` is derived, not stored — SPEC §7.7. #22 answers 200 even when
 * the send fails, so a failed send leaves no status behind; the only evidence is
 * a null `deliveredAt` on a message that was supposed to be emailed. That makes
 * this the single place a lost notification becomes visible to a human, and
 * getting it wrong in either direction is costly:
 *
 * - too eager, and the inbox cries wolf on every spam row, so the banner gets
 *   ignored and a real failure hides among them;
 * - too shy, and a message nobody was told about sits in the database looking
 *   perfectly normal.
 */
describe("isUndelivered", () => {
  it.each(["NEW", "READ", "REPLIED"])(
    "is true for a %s message that was never sent",
    (status) => {
      expect(isUndelivered({ status, deliveredAt: null })).toBe(true);
    },
  );

  it.each(["NEW", "READ", "REPLIED", "SPAM"])(
    "is false for a %s message that was sent",
    (status) => {
      expect(
        isUndelivered({ status, deliveredAt: new Date("2026-01-01") }),
      ).toBe(false);
    },
  );

  /**
   * No mail is attempted for spam (#22 persists it and sends nothing), so a null
   * `deliveredAt` there is the expected state rather than a failure.
   */
  it("is false for SPAM that was never sent", () => {
    expect(isUndelivered({ status: "SPAM", deliveredAt: null })).toBe(false);
  });
});
