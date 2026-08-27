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

const {
  normalizeSlug,
  isValidSlug,
  publishBlockers,
  resolveSlug,
  SlugImmutableError,
} = await import("../projects");

const complete = {
  title: "Ledger",
  summary: "A summary",
  problem: "A problem",
  body: "A body",
  outcome: "An outcome",
  coverImage: { altText: "Alt text" },
};

describe("normalizeSlug — SPEC §4, lowercase kebab", () => {
  it.each([
    ["Sample Ledger", "sample-ledger"],
    ["  Trailing  spaces  ", "trailing-spaces"],
    ["Already-Kebab", "already-kebab"],
    ["Punctuation! & symbols?", "punctuation-symbols"],
    ["multiple   spaces", "multiple-spaces"],
    ["--leading-and-trailing--", "leading-and-trailing"],
    ["Numbers 123", "numbers-123"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeSlug(input)).toBe(expected);
  });

  /** Strip diacritics rather than transliterating or escaping them. */
  it("folds accented characters to their base letter", () => {
    expect(normalizeSlug("Café Münster")).toBe("cafe-munster");
  });

  it("returns an empty string when nothing survives", () => {
    expect(normalizeSlug("!!!")).toBe("");
    expect(normalizeSlug("")).toBe("");
  });

  it("caps the length", () => {
    expect(normalizeSlug("a".repeat(200))).toHaveLength(96);
  });

  it("produces a valid slug for anything it does not empty", () => {
    for (const input of ["Café Münster", "A  B", "x!y", "--z--"]) {
      const slug = normalizeSlug(input);
      if (slug.length > 0) expect(isValidSlug(slug)).toBe(true);
    }
  });
});

describe("isValidSlug", () => {
  it.each(["sample-ledger", "abc", "a1-b2-c3"])("accepts %s", (slug) => {
    expect(isValidSlug(slug)).toBe(true);
  });

  it.each([
    ["an empty string", ""],
    ["uppercase", "Sample"],
    ["a leading hyphen", "-sample"],
    ["a trailing hyphen", "sample-"],
    ["a double hyphen", "sample--ledger"],
    ["a space", "sample ledger"],
    ["an underscore", "sample_ledger"],
    ["a slash", "sample/ledger"],
  ])("rejects %s", (_label, slug) => {
    expect(isValidSlug(slug)).toBe(false);
  });
});

/**
 * SPEC §6 — publication is blocked unless title, summary, problem, body,
 * outcome, cover and cover alt text are all present.
 */
describe("publishBlockers", () => {
  it("returns nothing for a complete project", () => {
    expect(publishBlockers(complete)).toEqual([]);
  });

  it.each(["title", "summary", "problem", "body", "outcome"] as const)(
    "blocks on a missing %s",
    (fieldName) => {
      expect(publishBlockers({ ...complete, [fieldName]: "" })).toEqual([
        fieldName,
      ]);
    },
  );

  /**
   * Whitespace is not content. A body of "   " passes a `!== ""` check and
   * publishes an empty page.
   */
  it.each(["title", "summary", "problem", "body", "outcome"] as const)(
    "treats a whitespace-only %s as missing",
    (fieldName) => {
      expect(publishBlockers({ ...complete, [fieldName]: "   \n\t " })).toEqual(
        [fieldName],
      );
    },
  );

  it("blocks on a missing cover", () => {
    expect(publishBlockers({ ...complete, coverImage: null })).toEqual([
      "cover",
    ]);
  });

  /** #17 makes an empty alt a render-time failure; this stops it going public. */
  it("blocks on cover alt text that is empty or blank", () => {
    expect(
      publishBlockers({ ...complete, coverImage: { altText: "" } }),
    ).toEqual(["coverAltText"]);
    expect(
      publishBlockers({ ...complete, coverImage: { altText: "  " } }),
    ).toEqual(["coverAltText"]);
  });

  it("reports every blocker at once, not just the first", () => {
    expect(
      publishBlockers({
        title: "",
        summary: "",
        problem: "ok",
        body: "",
        outcome: "ok",
        coverImage: null,
      }),
    ).toEqual(["title", "summary", "body", "cover"]);
  });

  it("does not report both cover and coverAltText for a missing cover", () => {
    // "Add a cover, and also fill in its alt text" is confusing when there is
    // no cover to fill anything in on.
    expect(publishBlockers({ ...complete, coverImage: null })).not.toContain(
      "coverAltText",
    );
  });
});

/** SPEC §4 — immutable once published. */
describe("resolveSlug", () => {
  const draft = { slug: "old-slug", status: "DRAFT" };
  const published = { slug: "old-slug", status: "PUBLISHED" };

  it("keeps the current slug when none is requested", () => {
    expect(resolveSlug(published, undefined)).toBe("old-slug");
  });

  it("allows an unchanged slug on a published project", () => {
    // Saving the edit form resubmits the same value; that is not a change.
    expect(resolveSlug(published, "old-slug")).toBe("old-slug");
  });

  it("allows a change while the project is a draft", () => {
    expect(resolveSlug(draft, "new-slug")).toBe("new-slug");
  });

  it("refuses a change once published", () => {
    expect(() => resolveSlug(published, "new-slug")).toThrow(
      SlugImmutableError,
    );
  });

  it("refuses an invalid slug even on a draft", () => {
    expect(() => resolveSlug(draft, "Not A Slug")).toThrow();
  });

  it("refuses an empty slug", () => {
    expect(() => resolveSlug(draft, "")).toThrow();
  });
});
