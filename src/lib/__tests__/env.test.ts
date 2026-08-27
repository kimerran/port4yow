import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

/**
 * #37's consolidated sweep found `src/lib/env.ts` with **no test at all**, which
 * is the wrong file in this repo to leave unpinned.
 *
 * It is the single validated entry point for configuration (SPEC §10), the
 * `no-restricted-properties` ban on `process.env` is carved out for this file
 * alone (AGENT §3), and it **throws at module load** so the process dies at boot
 * rather than serving traffic with a missing secret (AGENT §1.5). Every one of
 * those properties is a claim, and none of them was measured.
 *
 * `loadEnv` is exported for exactly this, so these parse a fixture rather than
 * mutating the real `process.env` — the module has already consumed that by the
 * time any test runs.
 *
 * ## On credentials in fixtures
 *
 * AGENT §3 forbids a hardcoded credential "even in a test". Every secret below
 * is generated per-run with `randomBytes`, so nothing in this file is a string
 * that would still be a secret if it escaped. It also makes the length
 * boundaries honest: the value under test is a real 32-or-48-byte token rather
 * than a repeated character that happens to be the right length.
 */

/** A secret of exactly `chars` characters, random every run. */
const secretOf = (chars: number): string =>
  randomBytes(chars).toString("base64url").slice(0, chars);

const SECRET_MIN = 32;

/**
 * `env.ts` parses `process.env` at module load and throws on failure — that is
 * the behaviour under test, and it means the module cannot be imported at all
 * without a valid ambient environment. So one goes in first. Every case below
 * then parses an explicit fixture through `loadEnv`, never this.
 */
Object.assign(process.env, {
  PUBLIC_SITE_URL: "https://mh.neri.ph",
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  SESSION_SECRET: secretOf(48),
  FORM_SECRET: secretOf(48),
  IP_HASH_SALT: secretOf(48),
  S3_ENDPOINT: "https://s3.example.test",
  S3_BUCKET: "portfolio-media",
  S3_ACCESS_KEY_ID: secretOf(20),
  S3_SECRET_ACCESS_KEY: secretOf(40),
  CONTACT_TO_EMAIL: "inbox@mh.neri.ph",
});

const { loadEnv } = await import("../env.ts");

/** The smallest environment that parses — every required key, nothing else. */
function base(): Record<string, string> {
  return {
    PUBLIC_SITE_URL: "https://mh.neri.ph",
    DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
    SESSION_SECRET: secretOf(48),
    FORM_SECRET: secretOf(48),
    IP_HASH_SALT: secretOf(48),
    S3_ENDPOINT: "https://s3.example.test",
    S3_BUCKET: "portfolio-media",
    S3_ACCESS_KEY_ID: secretOf(20),
    S3_SECRET_ACCESS_KEY: secretOf(40),
    CONTACT_TO_EMAIL: "inbox@mh.neri.ph",
  };
}

const withEnv = (overrides: Record<string, string | undefined>) =>
  loadEnv({ ...base(), ...overrides });

const rejects = (overrides: Record<string, string | undefined>): void => {
  expect(() => withEnv(overrides)).toThrow(/Invalid environment configuration/);
};

describe("the fixture itself", () => {
  it("parses, so a rejection below is about the override and not the base", () => {
    // Without this every `rejects` case could be passing for the wrong reason.
    expect(() => loadEnv(base())).not.toThrow();
  });
});

describe("required keys fail closed (AGENT §1.5, SPEC §10)", () => {
  it.each([
    "PUBLIC_SITE_URL",
    "DATABASE_URL",
    "SESSION_SECRET",
    "FORM_SECRET",
    "IP_HASH_SALT",
    "S3_ENDPOINT",
    "S3_BUCKET",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "CONTACT_TO_EMAIL",
  ])("%s missing is a boot failure, not a default", (key) => {
    rejects({ [key]: undefined });
  });

  it("reports every problem at once, not just the first", () => {
    // A boot that fails one variable at a time costs a deploy cycle each.
    try {
      loadEnv({});
      expect.unreachable("empty environment must not parse");
    } catch (cause) {
      const message = (cause as Error).message;
      expect(message).toContain("PUBLIC_SITE_URL");
      expect(message).toContain("SESSION_SECRET");
      expect(message).toContain("CONTACT_TO_EMAIL");
    }
  });
});

describe("secret length boundaries", () => {
  it.each(["SESSION_SECRET", "FORM_SECRET", "IP_HASH_SALT"])(
    "%s accepts exactly the minimum",
    (key) => {
      expect(() => withEnv({ [key]: secretOf(SECRET_MIN) })).not.toThrow();
    },
  );

  it.each(["SESSION_SECRET", "FORM_SECRET", "IP_HASH_SALT"])(
    "%s refuses one character under the minimum",
    (key) => {
      rejects({ [key]: secretOf(SECRET_MIN - 1) });
    },
  );

  it("names the variable and how to generate one, without echoing it", () => {
    const value = secretOf(8);
    try {
      withEnv({ SESSION_SECRET: value });
      expect.unreachable("a short secret must not parse");
    } catch (cause) {
      const message = (cause as Error).message;
      expect(message).toContain("SESSION_SECRET");
      expect(message).toContain("openssl rand -base64 48");
      // A validation error must never be the thing that leaks the secret.
      expect(message).not.toContain(value);
    }
  });

  it("never echoes a rejected value for any key", () => {
    const value = secretOf(31);
    try {
      loadEnv({ ...base(), FORM_SECRET: value, IP_HASH_SALT: value });
      expect.unreachable("short secrets must not parse");
    } catch (cause) {
      expect((cause as Error).message).not.toContain(value);
    }
  });
});

describe("format boundaries", () => {
  it.each([
    ["PUBLIC_SITE_URL", "not-a-url"],
    ["PUBLIC_SITE_URL", "mh.neri.ph"],
    ["S3_ENDPOINT", "localhost:9000"],
    ["DATABASE_URL", "mysql://user:pass@localhost/db"],
    ["DATABASE_URL", "postgres://user:pass@localhost/db"],
    ["SHADOW_DATABASE_URL", "mysql://x"],
    ["REDIS_URL", "http://localhost:6379"],
    ["SMTP_URL", "http://localhost:1025"],
    ["CONTACT_TO_EMAIL", "inbox@"],
    ["CONTACT_TO_EMAIL", "inbox"],
    ["CONTACT_FROM_EMAIL", "@mh.neri.ph"],
    ["LOG_LEVEL", "verbose"],
    ["NODE_ENV", "staging"],
  ])("%s rejects %s", (key, value) => {
    rejects({ [key]: value });
  });

  /**
   * The case this sweep was written to find. `z.url()` alone accepted a bare
   * `host:port`, because the WHATWG parser reads `localhost:4321` as scheme
   * `localhost:` with path `4321`. `new URL(...).origin` on that is the *string*
   * `"null"`, and `isSameOrigin` compares the `Origin` header against it —
   * browsers send `Origin: null` from a sandboxed iframe, so the CSRF check
   * stopped refusing exactly the callers it exists to refuse.
   */
  it.each([
    "localhost:4321",
    "localhost:9000",
    "mh.neri.ph:443",
    "ftp://mh.neri.ph",
    "file:///etc/passwd",
    "javascript:alert(1)",
  ])("PUBLIC_SITE_URL refuses %s — it has no usable origin", (value) => {
    rejects({ PUBLIC_SITE_URL: value });
    // Why it matters, stated as the property rather than the shape:
    let origin: string;
    try {
      origin = new URL(value).origin;
    } catch {
      origin = "(unparseable)";
    }
    expect(origin).not.toMatch(/^https?:\/\//);
  });

  it.each(["localhost:9000", "s3.example.test", "ftp://s3.example.test"])(
    "S3_ENDPOINT refuses %s",
    (value) => {
      rejects({ S3_ENDPOINT: value });
    },
  );

  it.each([
    "http://localhost:4321",
    "https://mh.neri.ph",
    "https://mh.neri.ph:8443/base",
  ])("still accepts %s", (value) => {
    expect(() => withEnv({ PUBLIC_SITE_URL: value })).not.toThrow();
  });

  it("says what shape is wanted without echoing a secret", () => {
    try {
      withEnv({ PUBLIC_SITE_URL: "localhost:4321" });
      expect.unreachable("a scheme-less URL must not parse");
    } catch (cause) {
      expect((cause as Error).message).toContain("absolute http(s) URL");
    }
  });

  it("accepts postgresql:// but not its shorter alias", () => {
    // Prisma accepts both; the schema deliberately does not, so one spelling
    // reaches the adapter and a typo cannot silently pick a different driver.
    expect(() =>
      withEnv({ DATABASE_URL: "postgresql://u:p@h:5432/d" }),
    ).not.toThrow();
    rejects({ DATABASE_URL: "postgres://u:p@h:5432/d" });
  });
});

describe("PORT is coerced and bounded", () => {
  it("defaults to 4321 when absent", () => {
    expect(withEnv({}).PORT).toBe(4321);
  });

  it("coerces the string a .env file actually contains", () => {
    expect(withEnv({ PORT: "8080" }).PORT).toBe(8080);
  });

  it.each([
    ["1", 1],
    ["65535", 65535],
  ])("accepts the boundary %s", (given, expected) => {
    expect(withEnv({ PORT: given }).PORT).toBe(expected);
  });

  it.each(["0", "65536", "-1", "4321.5", "http"])("rejects %s", (value) => {
    rejects({ PORT: value });
  });
});

describe("boolean-ish keys (a .env file has only strings)", () => {
  it.each([
    ["true", true],
    ["1", true],
    ["false", false],
    ["0", false],
  ])("%s parses to %s", (given, expected) => {
    expect(withEnv({ S3_FORCE_PATH_STYLE: given }).S3_FORCE_PATH_STYLE).toBe(
      expected,
    );
  });

  it.each(["yes", "TRUE", "on", "2"])(
    "refuses %s rather than guessing",
    (value) => {
      // A silently-false "yes" on RESEND_ENABLED would drop mail without a word.
      rejects({ S3_FORCE_PATH_STYLE: value });
    },
  );

  it("defaults S3_FORCE_PATH_STYLE true and RESEND_ENABLED false", () => {
    const env = withEnv({});
    expect(env.S3_FORCE_PATH_STYLE).toBe(true);
    expect(env.RESEND_ENABLED).toBe(false);
  });
});

describe("optional keys treat empty as absent", () => {
  /**
   * `.env.example` ships optional keys as a bare `KEY=`, which is the empty
   * string rather than `undefined`. Without the preprocess, `cp .env.example
   * .env` was unbootable on `REDIS_URL`.
   */
  it.each([
    "REDIS_URL",
    "RESEND_API_KEY",
    "SHADOW_DATABASE_URL",
    "ADMIN_PASSWORD",
  ])("%s= (empty) is treated as unset", (key) => {
    expect(() => withEnv({ [key]: "" })).not.toThrow();
    expect(withEnv({ [key]: "" })[key as "REDIS_URL"]).toBeUndefined();
  });

  it("still applies the format check to a non-empty optional value", () => {
    rejects({ REDIS_URL: "http://localhost:6379" });
  });
});

describe("RESEND_ENABLED without a key fails closed (SPEC §7)", () => {
  it("refuses the combination that would silently drop mail", () => {
    rejects({ RESEND_ENABLED: "true" });
  });

  it("refuses it when the key is present but empty", () => {
    rejects({ RESEND_ENABLED: "true", RESEND_API_KEY: "" });
  });

  it("accepts it with a key", () => {
    expect(() =>
      withEnv({ RESEND_ENABLED: "true", RESEND_API_KEY: secretOf(32) }),
    ).not.toThrow();
  });

  it("does not require a key when Resend is off", () => {
    expect(() => withEnv({ RESEND_ENABLED: "false" })).not.toThrow();
  });
});

describe("the parsed object is not a mutable global", () => {
  it("is frozen, so nothing can rewrite configuration at runtime", () => {
    const env = withEnv({});
    expect(Object.isFrozen(env)).toBe(true);
    expect(() => {
      (env as unknown as Record<string, unknown>)["SESSION_SECRET"] = "x";
    }).toThrow();
  });
});

describe("no secret is exposed through a PUBLIC_ key (AGENT §3)", () => {
  it("the only PUBLIC_ variable is the site URL", () => {
    // A `PUBLIC_` variable is inlined into the client bundle by Vite, so this
    // is the boundary between "configuration" and "published".
    const publicKeys = Object.keys(withEnv({})).filter((k) =>
      k.startsWith("PUBLIC_"),
    );
    expect(publicKeys).toEqual(["PUBLIC_SITE_URL"]);
  });
});
