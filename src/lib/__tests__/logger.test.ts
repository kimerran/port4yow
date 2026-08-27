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

  // camelCase included: the same normalisation the IP branch needs applies here,
  // and `userEmail`/`contactEmail` are the likelier field names in practice.
  it.each(["email", "userEmail", "contactEmail", "email_address"])(
    "keeps the domain but drops the local part for %s",
    (key) => {
      const out = redact({ [key]: "mark@example.com" }) as Record<
        string,
        string
      >;
      expect(out[key]).toBe("[redacted]@example.com");
      expect(out[key]).not.toContain("mark");
    },
  );

  // camelCase and snake_case both, because `remote_ip` was redacted while
  // `clientIp` — the same value — passed through. `clientIp` is the likelier name
  // once middleware (#24) logs requests.
  it.each([
    "ip",
    "ipAddress",
    "ip_address",
    "remote_ip",
    "clientIp",
    "userIp",
    "sourceIP",
    "peerIp",
    "ipv4",
  ])("drops raw IP under %s", (key) => {
    const out = redact({ [key]: "203.0.113.7" }) as Record<string, unknown>;
    expect(out[key]).toBe("[redacted]");
  });

  // The anchoring is load-bearing: a bare /ip/ redacts all of these.
  it.each([
    "description",
    "recipient",
    "zip",
    "shipping",
    "clipboard",
    "equipment",
    "script",
    "ipsum",
  ])("does not touch %s", (key) => {
    const out = redact({ [key]: "keep-me" }) as Record<string, unknown>;
    expect(out[key]).toBe("keep-me");
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

/**
 * #36's audit finding. Key-based redaction cannot see what it cannot name, and
 * the SMTP path logs `reason: cause.message` — a mail-server rejection quotes
 * the address it rejected, and that address is the visitor's reply-to.
 */
describe("email addresses inside free-text values (#36)", () => {
  const REJECTION =
    "550 5.1.1 <visitor@example.com>: recipient address rejected";

  it("masks an address that arrives under a non-email key", () => {
    const out = redact({ reason: REJECTION }) as { reason: string };
    expect(out.reason).not.toContain("visitor@example.com");
    expect(out.reason).not.toContain("visitor");
    // The domain survives — it is what makes the rejection debuggable.
    expect(out.reason).toContain("[redacted]@example.com");
    // Everything that is not the address is left alone.
    expect(out.reason).toContain("550 5.1.1");
    expect(out.reason).toContain("recipient address rejected");
  });

  it("masks every address in a value, not just the first", () => {
    const out = redact({
      reason: "from a@one.test to b@two.test",
    }) as { reason: string };
    expect(out.reason).toBe("from [redacted]@one.test to [redacted]@two.test");
  });

  it("masks an address carried in an Error message", () => {
    const out = redact({ cause: new Error(REJECTION) }) as {
      cause: { message: string };
    };
    expect(out.cause.message).not.toContain("visitor@example.com");
    expect(out.cause.message).toContain("[redacted]@example.com");
  });

  it("reaches the stream masked, not just the return value", () => {
    const line = capture(() => {
      logger.error("contact email failed", { reason: REJECTION });
    });
    expect(line).not.toContain("visitor@example.com");
    expect(line).toContain("example.com");
  });

  it("leaves text with no address untouched", () => {
    const text = "Can't reach database server at 127.0.0.1:55466";
    expect((redact({ reason: text }) as { reason: string }).reason).toBe(text);
  });
});
