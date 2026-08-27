import { describe, expect, it, vi } from "vitest";

// env.ts parses at import and crashes without a valid environment, so the
// fixture has to be in place before the logger (and therefore env) loads.
const SECRET = "x".repeat(48);
Object.assign(process.env, {
  PUBLIC_SITE_URL: "http://localhost:4321",
  DATABASE_URL: "postgresql://a:b@localhost:5432/c",
  SESSION_SECRET: SECRET,
  FORM_SECRET: SECRET,
  IP_HASH_SALT: SECRET,
  S3_ENDPOINT: "http://localhost:9000",
  S3_BUCKET: "b",
  S3_ACCESS_KEY_ID: "k",
  S3_SECRET_ACCESS_KEY: "s",
  CONTACT_TO_EMAIL: "a@b.com",
  LOG_LEVEL: "debug",
});

const { logger, audit, redact, newCorrelationId } = await import("../logger");

/** Capture what actually reaches the stream — not what we intended to write. */
function capture(fn: () => void): string {
  let out = "";
  const write = (chunk: string | Uint8Array) => {
    out += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    return true;
  };
  const so = vi.spyOn(process.stdout, "write").mockImplementation(write);
  const se = vi.spyOn(process.stderr, "write").mockImplementation(write);
  try {
    fn();
  } finally {
    so.mockRestore();
    se.mockRestore();
  }
  return out;
}

describe("redact", () => {
  // Redaction is keyed on the FIELD NAME, never on the value's shape, so these
  // fixtures are deliberately obvious sentinels rather than realistic-looking
  // credentials. AGENT §3 bans a hardcoded credential "even in a test", and
  // gitleaks flagged an earlier vendor-prefixed fixture here as a generic-api-key,
  // by its rules. A test that needs a plausible secret to pass would be testing
  // the wrong thing.
  it.each([
    ["password", "SENTINEL-VALUE-1"],
    ["passwordHash", "SENTINEL-VALUE-2"],
    ["sessionToken", "SENTINEL-VALUE-3"],
    ["SESSION_SECRET", "SENTINEL-VALUE-4"],
    ["apiKey", "SENTINEL-VALUE-5"],
    ["authorization", "SENTINEL-VALUE-6"],
    ["cookie", "SENTINEL-VALUE-7"],
    ["ipHashSalt", "SENTINEL-VALUE-8"],
    ["signature", "SENTINEL-VALUE-9"],
  ])("replaces %s", (key, value) => {
    const out = redact({ [key]: value }) as Record<string, unknown>;
    expect(out[key]).toBe("[redacted]");
    expect(JSON.stringify(out)).not.toContain(value);
  });

  it("keeps an email's domain but drops the local part", () => {
    const out = redact({ email: "mark@example.com" }) as Record<string, string>;
    expect(out.email).toBe("[redacted]@example.com");
    expect(out.email).not.toContain("mark");
  });

  it("drops raw IPs", () => {
    for (const key of ["ip", "ipAddress", "remote_ip"]) {
      const out = redact({ [key]: "203.0.113.7" }) as Record<string, unknown>;
      expect(out[key]).toBe("[redacted]");
    }
  });

  it("redacts nested values, not just top-level keys", () => {
    const out = redact({ user: { profile: { password: "SENTINEL-NESTED" } } });
    expect(JSON.stringify(out)).not.toContain("SENTINEL-NESTED");
  });

  it("truncates deep structures rather than walking an ORM object forever", () => {
    const deep = { a: { b: { c: { d: { e: { f: "bottom" } } } } } };
    expect(JSON.stringify(redact(deep))).not.toContain("bottom");
  });

  it("reduces an Error to name and message, dropping the stack", () => {
    const out = redact(new Error("boom")) as Record<string, unknown>;
    expect(out).toEqual({ name: "Error", message: "boom" });
    expect(out.stack).toBeUndefined();
  });

  it("leaves safe values alone", () => {
    expect(redact({ projectId: "abc", count: 3 })).toEqual({
      projectId: "abc",
      count: 3,
    });
  });
});

describe("logger output", () => {
  it("writes errors to stderr and info to stdout", () => {
    const so = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const se = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    logger.info("i");
    logger.error("e");
    expect(so).toHaveBeenCalledOnce();
    expect(se).toHaveBeenCalledOnce();
    so.mockRestore();
    se.mockRestore();
  });

  it("carries the correlation id through", () => {
    const id = newCorrelationId();
    expect(
      capture(() => logger.info("hello", { correlationId: id })),
    ).toContain(id);
  });

  it("redacts context at the emit boundary, not only via redact()", () => {
    const out = capture(() =>
      logger.error("failed", {
        password: "SENTINEL-EMIT",
        email: "mark@example.com",
      }),
    );
    expect(out).not.toContain("SENTINEL-EMIT");
    expect(out).not.toContain("mark@example.com");
    expect(out).toContain("[redacted]");
  });

  it("honours LOG_LEVEL", () => {
    // LOG_LEVEL=debug in this fixture, so debug must appear.
    expect(capture(() => logger.debug("d"))).toContain("d");
  });
});

describe("audit", () => {
  it("emits exactly one line carrying actor, action and target", () => {
    const out = capture(() =>
      audit({
        actorId: "user_1",
        action: "project.publish",
        entity: "Project",
        entityId: "proj_9",
        outcome: "success",
      }),
    );
    expect(out.trimEnd().split("\n")).toHaveLength(1);
    expect(out).toContain("user_1");
    expect(out).toContain("project.publish");
    expect(out).toContain("proj_9");
    expect(out).toContain("success");
  });

  it("redacts detail like any other context", () => {
    const out = capture(() =>
      audit({
        actorId: "user_1",
        action: "user.login",
        entity: "User",
        entityId: "user_1",
        outcome: "failure",
        detail: { password: "SENTINEL-AUDIT", ip: "203.0.113.7" },
      }),
    );
    expect(out).not.toContain("SENTINEL-AUDIT");
    expect(out).not.toContain("203.0.113.7");
  });
});
