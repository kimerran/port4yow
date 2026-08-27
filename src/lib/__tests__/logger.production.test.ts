import { describe, expect, it, vi } from "vitest";

/**
 * Production output is a separate module instance: `env` is parsed once at import,
 * so NODE_ENV has to be set before the logger loads. Isolated in its own file
 * rather than fighting module caching inside the main suite.
 */
const SECRET = "x".repeat(48);
Object.assign(process.env, {
  NODE_ENV: "production",
  LOG_LEVEL: "info",
  PUBLIC_SITE_URL: "http://x.test",
  DATABASE_URL: "postgresql://a:b@h:5432/c",
  SESSION_SECRET: SECRET,
  FORM_SECRET: SECRET,
  IP_HASH_SALT: SECRET,
  S3_ENDPOINT: "http://x:9000",
  S3_BUCKET: "b",
  S3_ACCESS_KEY_ID: "k",
  S3_SECRET_ACCESS_KEY: "s",
  CONTACT_TO_EMAIL: "a@b.com",
});

const { logger, audit } = await import("../logger");

function capture(fn: () => void): string {
  let out = "";
  const write = (c: string | Uint8Array) => {
    out += typeof c === "string" ? c : Buffer.from(c).toString();
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

describe("production output (SPEC §14.11)", () => {
  it("is one parseable JSON object per line", () => {
    const out = capture(() =>
      logger.error("contact send failed", { correlationId: "cid-1" }),
    );
    const lines = out.trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    const [first = ""] = lines;
    const parsed = JSON.parse(first) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      level: "error",
      message: "contact send failed",
      correlationId: "cid-1",
    });
    expect(typeof parsed.timestamp).toBe("string");
  });

  it("leaks no email, raw IP or key in production format", () => {
    const out = capture(() =>
      logger.error("failed", {
        correlationId: "cid-2",
        email: "mark@example.com",
        ip: "203.0.113.7",
        apiKey: "SENTINEL-PROD-KEY",
        passwordHash: "SENTINEL-PROD-HASH",
      }),
    );
    expect(out).not.toContain("mark@example.com");
    expect(out).not.toContain("203.0.113.7");
    expect(out).not.toContain("SENTINEL-PROD-KEY");
    expect(out).not.toContain("SENTINEL-PROD-HASH");
    // the domain survives, which is what makes it debuggable
    expect(out).toContain("example.com");
  });

  // Caller context must never reshape the envelope: with the spread last,
  // logger.error(..., { level: "debug" }) emitted "level":"debug" — alerting
  // drops the line, the real message is lost, and it is a log-injection
  // primitive once any context value is user-derived.
  it("does not let context overwrite level, message or timestamp", () => {
    const out = capture(() =>
      logger.error("real message", {
        level: "debug",
        message: "spoofed",
        timestamp: "1970-01-01T00:00:00.000Z",
      }),
    );
    const parsed = JSON.parse(out.trim()) as Record<string, unknown>;
    expect(parsed.level).toBe("error");
    expect(parsed.message).toBe("real message");
    expect(parsed.timestamp).not.toBe("1970-01-01T00:00:00.000Z");
  });

  it("protects the audit envelope the same way", () => {
    const out = capture(() =>
      audit({
        actorId: "user_1",
        action: "project.publish",
        entity: "Project",
        entityId: "p9",
        outcome: "success",
        detail: { level: "debug", message: "spoofed" },
      }),
    );
    const parsed = JSON.parse(out.trim()) as Record<string, unknown>;
    expect(parsed.level).toBe("info");
    expect(parsed.message).toBe("audit");
  });

  it("redacts a camelCase IP in production format", () => {
    const out = capture(() => logger.error("req", { clientIp: "203.0.113.9" }));
    expect(out).not.toContain("203.0.113.9");
  });

  it("drops debug below LOG_LEVEL=info", () => {
    expect(capture(() => logger.debug("noisy"))).toBe("");
  });

  it("emits audit as a single parseable line", () => {
    const out = capture(() =>
      audit({
        actorId: "user_1",
        action: "project.publish",
        entity: "Project",
        entityId: "p9",
        outcome: "success",
        correlationId: "cid-3",
      }),
    );
    const parsed = JSON.parse(out.trimEnd()) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      level: "info",
      message: "audit",
      audit: true,
      actorId: "user_1",
      action: "project.publish",
      entity: "Project",
      entityId: "p9",
      outcome: "success",
    });
  });
});
