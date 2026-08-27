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

const { createFormToken, verifyFormToken, MIN_AGE_MS, MAX_AGE_MS } =
  await import("../formToken");

const T0 = 1_800_000_000_000;
const afterHuman = T0 + MIN_AGE_MS + 1;

describe("createFormToken", () => {
  it("is <issuedAt>.<hmac>", () => {
    expect(createFormToken(T0)).toMatch(/^1800000000000\.[0-9a-f]{64}$/);
  });

  it("does not expose the secret", () => {
    expect(createFormToken(T0)).not.toContain(SECRET);
  });
});

describe("verifyFormToken — signature", () => {
  it("accepts a token this server signed", () => {
    const verdict = verifyFormToken(createFormToken(T0), afterHuman);
    expect(verdict.valid).toBe(true);
  });

  /**
   * The whole point of signing: a bot that skips the rendered page cannot mint
   * a `renderedAt` old enough to look human.
   */
  it("rejects a forged timestamp with no signature", () => {
    expect(verifyFormToken(String(T0), afterHuman)).toEqual({
      valid: false,
      reason: "malformed",
    });
  });

  it("rejects a tampered timestamp with a valid-looking signature", () => {
    const token = createFormToken(T0);
    const [, mac] = token.split(".");
    // Claim the form rendered an hour earlier, keeping the original signature.
    expect(
      verifyFormToken(`${String(T0 - 3_600_000)}.${mac ?? ""}`, afterHuman),
    ).toEqual({
      valid: false,
      reason: "bad-signature",
    });
  });

  it("rejects a signature of the right shape but the wrong value", () => {
    expect(
      verifyFormToken(`${String(T0)}.${"a".repeat(64)}`, afterHuman),
    ).toEqual({
      valid: false,
      reason: "bad-signature",
    });
  });

  it.each([
    ["a non-string", 12345],
    ["an empty string", ""],
    ["no separator", "1800000000000abc"],
    ["a leading separator", ".abc"],
    ["a non-numeric timestamp", "not-a-number.abc"],
  ])("rejects %s as malformed", (_label, token) => {
    expect(verifyFormToken(token, afterHuman)).toEqual({
      valid: false,
      reason: "malformed",
    });
  });

  it("does not throw on a signature of the wrong length", () => {
    // timingSafeEqual throws on a length mismatch; the length check comes first.
    expect(() =>
      verifyFormToken(`${String(T0)}.abc`, afterHuman),
    ).not.toThrow();
    expect(verifyFormToken(`${String(T0)}.abc`, afterHuman).valid).toBe(false);
  });
});

/**
 * SPEC §7 step 4 — the timing half of the honeypot. A form submitted instantly
 * was not filled in by a person.
 */
describe("verifyFormToken — age", () => {
  it("rejects a submission faster than a human could type", () => {
    expect(verifyFormToken(createFormToken(T0), T0 + 500)).toEqual({
      valid: false,
      reason: "too-fast",
    });
  });

  it("accepts one just past the threshold", () => {
    expect(verifyFormToken(createFormToken(T0), T0 + MIN_AGE_MS).valid).toBe(
      true,
    );
  });

  it("rejects a stale form", () => {
    expect(verifyFormToken(createFormToken(T0), T0 + MAX_AGE_MS + 1)).toEqual({
      valid: false,
      reason: "expired",
    });
  });

  it("accepts one right on the expiry boundary", () => {
    expect(verifyFormToken(createFormToken(T0), T0 + MAX_AGE_MS).valid).toBe(
      true,
    );
  });

  /**
   * A token from the future would otherwise have a negative age, which sails
   * straight past a naive `age > MIN` check.
   */
  it("rejects a token issued in the future", () => {
    expect(verifyFormToken(createFormToken(T0 + 60_000), T0)).toEqual({
      valid: false,
      reason: "too-fast",
    });
  });

  it("checks the signature before the age", () => {
    // Forged AND too fast — the signature failure is the one that must win, or
    // the reason leaks whether a guessed signature was correct.
    expect(verifyFormToken(`${String(T0)}.${"a".repeat(64)}`, T0)).toEqual({
      valid: false,
      reason: "bad-signature",
    });
  });
});
