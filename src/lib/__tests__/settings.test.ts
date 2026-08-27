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

const { validateSetting, InvalidSetting, UnknownSetting, SETTING_DEFINITIONS } =
  await import("../settings");

describe("validateSetting — the closed key list", () => {
  it.each(SETTING_DEFINITIONS.map((d) => d.key))("accepts %s", (key) => {
    expect(() => validateSetting(key, "")).not.toThrow();
  });

  /**
   * An admin screen that accepts arbitrary keys can write a setting nothing
   * reads — a value that looks saved and changes nothing.
   */
  it.each([
    ["an unknown key", "hero.subtitle"],
    ["a near-miss", "hero.thesys"],
    ["an empty key", ""],
  ])("refuses %s", (_label, key) => {
    expect(() => validateSetting(key, "x")).toThrow(UnknownSetting);
  });
});

describe("validateSetting — length", () => {
  it("accepts a value at the limit", () => {
    const limit =
      SETTING_DEFINITIONS.find((d) => d.key === "hero.thesis")?.maxLength ?? 0;
    expect(validateSetting("hero.thesis", "a".repeat(limit))).toHaveLength(
      limit,
    );
  });

  it("refuses one character over, and says by how much", () => {
    const limit =
      SETTING_DEFINITIONS.find((d) => d.key === "hero.thesis")?.maxLength ?? 0;
    expect(() => validateSetting("hero.thesis", "a".repeat(limit + 1))).toThrow(
      InvalidSetting,
    );
    expect(() => validateSetting("hero.thesis", "a".repeat(limit + 1))).toThrow(
      new RegExp(`${String(limit + 1)} characters`),
    );
  });

  it("measures the trimmed value, so trailing spaces are not an error", () => {
    const limit =
      SETTING_DEFINITIONS.find((d) => d.key === "hero.thesis")?.maxLength ?? 0;
    expect(() =>
      validateSetting("hero.thesis", `${"a".repeat(limit)}     `),
    ).not.toThrow();
  });

  it("holds about.body to a longer limit than the hero", () => {
    const hero = SETTING_DEFINITIONS.find((d) => d.key === "hero.thesis");
    const about = SETTING_DEFINITIONS.find((d) => d.key === "about.body");
    expect(about?.maxLength).toBeGreaterThan(hero?.maxLength ?? 0);
  });
});

/**
 * AGENT §3: nothing user-controlled reaches an outbound URL unvalidated. These
 * values become `href`s on the public home page, so an unchecked one is a link
 * this site vouches for.
 */
describe("validateSetting — URLs", () => {
  it.each([
    ["a github profile", "social.github", "https://github.com/kimerran"],
    ["a www github host", "social.github", "https://www.github.com/kimerran"],
    ["a linkedin profile", "social.linkedin", "https://www.linkedin.com/in/x"],
  ])("accepts %s", (_label, key, value) => {
    expect(validateSetting(key, value)).toBe(new URL(value).toString());
  });

  it("accepts an empty URL as 'no link'", () => {
    expect(validateSetting("social.github", "")).toBe("");
    expect(validateSetting("social.github", "   ")).toBe("");
  });

  /** The case #31 names by name. */
  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/html,<script>alert(1)</script>"],
    ["vbscript:", "vbscript:msgbox(1)"],
    ["file:", "file:///etc/passwd"],
  ])("refuses a %s URL", (_label, value) => {
    expect(() => validateSetting("social.github", value)).toThrow(
      InvalidSetting,
    );
  });

  /**
   * http is refused too. A profile link that downgrades the connection is not
   * something to publish, and allowing it would mean the check passes on the one
   * scheme an attacker on the network can rewrite.
   */
  it("refuses plain http", () => {
    expect(() =>
      validateSetting("social.github", "http://github.com/x"),
    ).toThrow(/https/);
  });

  it.each([
    ["another host entirely", "https://evil.test/kimerran"],
    ["a look-alike suffix", "https://github.com.evil.test/kimerran"],
    ["a subdomain", "https://pages.github.com/x"],
    ["the wrong network", "https://linkedin.com/in/x"],
  ])("refuses %s for social.github", (_label, value) => {
    expect(() => validateSetting("social.github", value)).toThrow(
      InvalidSetting,
    );
  });

  it.each([
    ["not a URL at all", "github.com/kimerran"],
    ["a bare word", "kimerran"],
    ["a protocol-relative URL", "//github.com/kimerran"],
  ])("refuses %s", (_label, value) => {
    expect(() => validateSetting("social.github", value)).toThrow(
      InvalidSetting,
    );
  });

  it("does not host-check a text setting", () => {
    // A thesis mentioning a URL is prose, not a link.
    expect(() =>
      validateSetting("hero.thesis", "I work on https://example.com things."),
    ).not.toThrow();
  });
});
