import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

/**
 * Slug generation at its boundaries (#37, SPEC §4).
 *
 * `projects.test.ts` covers the *policy* — a slug is immutable once published,
 * an invalid one is refused even on a draft. That is a different question from
 * whether `normalizeSlug` produces a valid slug for the input a human actually
 * pastes in, which is what #37 asks for by name: "unicode and punctuation
 * input", and collisions.
 *
 * The property that matters is the round trip: **anything `normalizeSlug` does
 * not reduce to an empty string must satisfy `isValidSlug`.** A normaliser that
 * can emit a value its own validator rejects is a 500 waiting for the right
 * title, and neither function alone shows that.
 *
 * Only the pure exports are used, but `projects.ts` reaches `env.ts` through
 * `logger.ts`, and `env.ts` parses at module load — so the fixture goes in
 * first. (I wrote "no stub needed" here at first; the import chain says
 * otherwise, which is the sort of thing to check rather than assume.)
 */

const SECRET = randomBytes(36).toString("base64url");
Object.assign(process.env, {
  PUBLIC_SITE_URL: "https://mh.neri.ph",
  DATABASE_URL: "postgresql://a:b@localhost:5432/c",
  SESSION_SECRET: SECRET,
  FORM_SECRET: SECRET,
  IP_HASH_SALT: SECRET,
  S3_ENDPOINT: "http://localhost:9000",
  S3_BUCKET: "portfolio-media",
  S3_ACCESS_KEY_ID: randomBytes(15).toString("base64url"),
  S3_SECRET_ACCESS_KEY: randomBytes(30).toString("base64url"),
  CONTACT_TO_EMAIL: "inbox@mh.neri.ph",
});

const { SLUG_PATTERN, isValidSlug, normalizeSlug } =
  await import("../projects.ts");

describe("the round trip (the property, not the examples)", () => {
  const inputs = [
    "A Project",
    "Café Münster",
    "  leading and trailing  ",
    "Hello, World! (2026)",
    "multiple---hyphens",
    "UPPERCASE",
    "trailing-",
    "-leading",
    "sn_ake_case",
    "dots.in.the.name",
    "slashes/in/the/name",
    "emoji 🎩 hat",
    "Ünïcödé Áccents",
    "100% done",
    "C++ and C#",
    "tabs\tand\nnewlines",
    "a".repeat(200),
    "ünïcödé ".repeat(30),
  ];

  it.each(inputs)("normalizeSlug(%j) is valid or empty", (input) => {
    const slug = normalizeSlug(input);
    if (slug === "") return;
    expect(isValidSlug(slug), `produced ${JSON.stringify(slug)}`).toBe(true);
  });

  it("never emits a leading or trailing hyphen", () => {
    for (const input of inputs) {
      const slug = normalizeSlug(input);
      expect(slug.startsWith("-")).toBe(false);
      expect(slug.endsWith("-")).toBe(false);
    }
  });

  it("never emits a doubled hyphen", () => {
    for (const input of inputs) {
      expect(normalizeSlug(input)).not.toContain("--");
    }
  });

  it("is idempotent — normalising a slug returns the same slug", () => {
    // The admin edits an existing slug, so this runs over its own output.
    for (const input of inputs) {
      const once = normalizeSlug(input);
      expect(normalizeSlug(once)).toBe(once);
    }
  });
});

describe("lowercase kebab (SPEC §4)", () => {
  it.each([
    ["A Project", "a-project"],
    ["UPPERCASE", "uppercase"],
    ["Hello, World! (2026)", "hello-world-2026"],
    ["multiple---hyphens", "multiple-hyphens"],
    ["  leading and trailing  ", "leading-and-trailing"],
    ["dots.in.the.name", "dots-in-the-name"],
    ["100% done", "100-done"],
  ])("%j becomes %j", (input, expected) => {
    expect(normalizeSlug(input)).toBe(expected);
  });
});

describe("unicode", () => {
  it("strips diacritics rather than transliterating or escaping", () => {
    // "Café" must become "cafe" — not "cafa", and not a percent-escaped byte run.
    expect(normalizeSlug("Café Münster")).toBe("cafe-munster");
    expect(normalizeSlug("Ünïcödé Áccents")).toBe("unicode-accents");
  });

  it("reduces a script with no ASCII form to empty rather than to mojibake", () => {
    // Empty is a refusal the caller can act on; a mangled slug is not.
    expect(normalizeSlug("日本語")).toBe("");
    expect(normalizeSlug("🎩")).toBe("");
  });

  it("keeps the ASCII around unrepresentable characters", () => {
    expect(normalizeSlug("emoji 🎩 hat")).toBe("emoji-hat");
  });
});

describe("length", () => {
  it("caps at 96 characters", () => {
    expect(normalizeSlug("a".repeat(200))).toHaveLength(96);
  });

  it("a capped slug is still valid — the cut cannot land on a hyphen", () => {
    // Slicing to 96 could otherwise leave a trailing hyphen, which the pattern
    // rejects; this is the case where the cap and the validator could disagree.
    for (let n = 90; n <= 110; n++) {
      const slug = normalizeSlug(`${"ab ".repeat(n)}`);
      if (slug === "") continue;
      expect(isValidSlug(slug), `n=${String(n)} produced ${slug}`).toBe(true);
    }
  });

  it("isValidSlug accepts 96 and refuses 97", () => {
    expect(isValidSlug("a".repeat(96))).toBe(true);
    expect(isValidSlug("a".repeat(97))).toBe(false);
  });

  it("isValidSlug refuses an empty slug", () => {
    expect(isValidSlug("")).toBe(false);
  });
});

describe("isValidSlug refuses what the pattern forbids", () => {
  it.each([
    "A-Project",
    "a project",
    "a_project",
    "a--project",
    "-a-project",
    "a-project-",
    "a.project",
    "a/project",
    "café",
    "a project!",
    "-",
    "--",
  ])("refuses %j", (slug) => {
    expect(isValidSlug(slug)).toBe(false);
  });

  it.each(["a", "0", "a-b", "a-1-b", "2026-retrospective", "abc123"])(
    "accepts %j",
    (slug) => {
      expect(isValidSlug(slug)).toBe(true);
    },
  );

  it("the pattern is anchored at both ends", () => {
    // Unanchored, "a project" would match on its "a" and every rejection above
    // would be an accident of the test data rather than the rule.
    expect(SLUG_PATTERN.source.startsWith("^")).toBe(true);
    expect(SLUG_PATTERN.source.endsWith("$")).toBe(true);
  });
});

describe("collisions are a caller's problem, and visible as one", () => {
  it("two different titles can normalise to the same slug", () => {
    // Not a defect — it is why the column is unique and why `resolveSlug`
    // exists. Stated here so nobody 'fixes' the normaliser into being
    // non-deterministic.
    expect(normalizeSlug("Hello World")).toBe(normalizeSlug("hello, world!"));
    expect(normalizeSlug("A/B")).toBe(normalizeSlug("A B"));
  });

  it("is deterministic — the same input always gives the same slug", () => {
    const once = normalizeSlug("Café Münster (2026)");
    for (let i = 0; i < 5; i++) {
      expect(normalizeSlug("Café Münster (2026)")).toBe(once);
    }
  });
});
