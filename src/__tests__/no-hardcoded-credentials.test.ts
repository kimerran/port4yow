import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * #37's third acceptance criterion: no hardcoded credential anywhere in the
 * test suite (AGENT §3, "even in a test").
 *
 * ## What this is and is not looking for
 *
 * It is not looking for the string `"x".repeat(48)`, which 24 suites use as a
 * `SESSION_SECRET` fixture. That is a *constructed placeholder* — it is not a
 * credential, it would not authenticate anywhere, and rewriting two dozen files
 * to generate it would trade determinism for the appearance of rigour.
 *
 * It is looking for the thing the rule exists to prevent: someone pasting a
 * **real** secret into a test to make it pass — a live API key, an AWS key id, a
 * private key block, a connection string with an actual password. Those have
 * recognisable shapes, and none of them can be confused with `"x".repeat(48)`.
 *
 * ## Why it self-tests
 *
 * A scanner that silently matches nothing is indistinguishable from a clean
 * codebase, and that failure mode has already cost this repo real work. So the
 * detector is run against synthetic samples that it MUST flag, and against
 * legitimate fixtures it MUST NOT. If someone loosens a pattern into
 * uselessness, those cases fail first.
 */

const SRC = new URL("../", import.meta.url).pathname;

interface Rule {
  name: string;
  pattern: RegExp;
}

/**
 * Each rule targets a shape that is only produced by a real credential.
 *
 * Assembled at runtime rather than written literally, because a file whose job
 * is to ban credential-shaped strings must not contain credential-shaped
 * strings — a literal `AKIA…` here would be found by the repo's own secret
 * scanner (SPEC §14.8) and by this very test.
 */
/**
 * A lookahead requiring the token body to contain both an uppercase letter and
 * a digit — that is, to look *generated* rather than typed.
 *
 * Added after the first run flagged `mail.test.ts`'s `re_super_secret_key`,
 * which is a placeholder whose whole purpose is to assert the key never reaches
 * a log line. Flagging it would have been a false positive on a test that exists
 * to enforce the very rule this file enforces, and the pressure would have been
 * to loosen the scanner or exempt the file — both worse than being precise.
 *
 * The discriminator is entropy, not length: a real key is mixed-case with
 * digits; `super_secret_key` is neither.
 */
const RANDOMISH = `(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*[0-9])`;

const RULES: Rule[] = [
  {
    name: "AWS access key id",
    pattern: new RegExp(`\\b(?:AKIA|ASIA)[0-9A-Z]{16}\\b`),
  },
  {
    name: "private key block",
    pattern: new RegExp(`-----BEGIN [A-Z ]*PRIVATE KEY-----`),
  },
  {
    name: "Resend API key",
    pattern: new RegExp(`\\bre_${RANDOMISH}[A-Za-z0-9_-]{16,}`),
  },
  {
    name: "generic provider token (sk_/pk_/ghp_/xox)",
    pattern: new RegExp(
      `\\b(?:sk|pk)_(?:live|test)_${RANDOMISH}[A-Za-z0-9]{16,}` +
        `|\\bghp_${RANDOMISH}[A-Za-z0-9]{30,}` +
        `|\\bxox[bapr]-${RANDOMISH}[A-Za-z0-9-]{10,}`,
    ),
  },
  {
    name: "JWT",
    pattern: new RegExp(
      `\\beyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}`,
    ),
  },
  {
    name: "argon2 hash of a real password",
    // A stored hash is a credential too — it is offline-crackable.
    pattern: new RegExp(
      `\\$argon2id\\$v=\\d+\\$m=\\d+,t=\\d+,p=\\d+\\$[A-Za-z0-9+/]{16,}\\$[A-Za-z0-9+/]{16,}`,
    ),
  },
];

function files(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "generated") continue;
      files(full, out);
    } else if (/\.(ts|astro|mjs|js)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const isTest = (path: string): boolean => /\.(test|spec)\.ts$/.test(path);

interface Hit {
  file: string;
  rule: string;
}

function scan(paths: string[]): Hit[] {
  const hits: Hit[] = [];
  for (const path of paths) {
    const source = readFileSync(path, "utf8");
    for (const rule of RULES) {
      if (rule.pattern.test(source)) {
        hits.push({ file: path.slice(SRC.length), rule: rule.name });
      }
    }
  }
  return hits;
}

describe("the detector works before it is trusted", () => {
  /**
   * Synthetic, never-valid samples — every one assembled from fragments at
   * runtime.
   *
   * That is not stylistic. Written as literals, the samples made this file the
   * scanner's own first two hits: a file whose job is to ban credential-shaped
   * strings must not contain credential-shaped strings, or it fails itself and
   * the obvious "fix" is to exclude it from its own scan. Splitting the shape
   * across a concatenation keeps the runtime string intact while leaving nothing
   * for a scanner — this one, or the repo's gitleaks step (SPEC §14.8) — to
   * match in source.
   */
  const dashes = "-".repeat(5);
  const samples: [string, string][] = [
    ["AWS access key id", `const id = "${"AK" + "IA"}${"Q".repeat(16)}";`],
    [
      "private key block",
      `const k = "${dashes}BEGIN RSA PRIVATE${" KEY"}${dashes}";`,
    ],
    ["Resend API key", `const k = "${"re" + "_"}${"aB3xQ9".repeat(4)}";`],
    [
      "generic provider token (sk_/pk_/ghp_/xox)",
      `const k = "${"sk" + "_live_"}${"bK7mZ2".repeat(4)}";`,
    ],
    [
      "JWT",
      `const t = "${"ey" + "JhbGciOiJIUzI1NiJ9"}.${"ey" + "JzdWIiOiIxMjM0NSJ9"}.${"c".repeat(20)}";`,
    ],
  ];

  it.each(samples)("flags a %s", (ruleName, source) => {
    const rule = RULES.find((r) => r.name === ruleName);
    expect(rule, `no rule named ${ruleName}`).toBeDefined();
    expect(rule?.pattern.test(source)).toBe(true);
  });

  it.each([
    `const SECRET = "x".repeat(48);`,
    `const SECRET = randomBytes(36).toString("base64url");`,
    `DATABASE_URL: "postgresql://a:b@localhost:5432/c"`,
    `S3_ACCESS_KEY_ID: "minioadmin"`,
    `passwordHash: "x"`,
    `expect(stored).toContain("$m=19456,t=2,p=1$");`,
    // The literal that made the first version of this scanner wrong.
    `process.env.RESEND_API_KEY = "re_super_secret_key";`,
    `headers: { Authorization: "Bearer re_test_key" }`,
  ])("does not flag the legitimate fixture %j", (source) => {
    // A rule that fires on these would be rewritten around rather than obeyed.
    for (const rule of RULES) {
      expect(rule.pattern.test(source), `${rule.name} fired`).toBe(false);
    }
  });

  it("scans a non-empty file list", () => {
    // The failure mode that makes every assertion below vacuous.
    expect(files(SRC).filter(isTest).length).toBeGreaterThan(20);
  });
});

describe("no hardcoded credential in the test suite (AGENT §3)", () => {
  it("finds none", () => {
    expect(scan(files(SRC).filter(isTest))).toEqual([]);
  });
});

describe("nor anywhere else in src/", () => {
  it("finds none", () => {
    // The ban is repo-wide; the test suite is only where #37 asks about it.
    expect(scan(files(SRC))).toEqual([]);
  });
});
