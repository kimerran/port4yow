import { env } from "./env.ts";

/**
 * Structured logging (AGENT §4, SPEC §14.11). The only sanctioned output path —
 * `no-console` is an error repo-wide (#47).
 *
 * JSON in production so a log shipper can parse it; human-readable in development.
 * Every line carries a level, a message, an optional correlation id, and context
 * that has been through `redact()`.
 *
 * The redaction here is a **backstop, not a licence**. AGENT §3 says a secret,
 * token, hash, raw IP, full email address or request body must never reach a log
 * line in the first place. This exists because "never" survives exactly as long as
 * the next person who forgets.
 */

export const LEVELS = ["debug", "info", "warn", "error"] as const;
export type Level = (typeof LEVELS)[number];

const RANK: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** Values under these keys are replaced wholesale, whatever they contain. */
const SECRET_KEY =
  /(pass(word)?|secret|token|hash|salt|apikey|api_key|authorization|cookie|session|credential|signature)/i;

/** Keys whose values are identifying and must be reduced, not dropped. */
/**
 * Key names arrive in both camelCase and snake_case, so match against a single
 * normalised form. Without this, `remote_ip` was redacted while `clientIp` — the
 * same value, and the likelier name once middleware (#24) logs requests — passed
 * straight through.
 */
const normalizeKey = (key: string): string =>
  key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

const EMAIL_KEY = /email/;
/**
 * Anchored on purpose. A bare /ip/ would redact `description`, `recipient`,
 * `shipping` and `equipment`; anchoring to word boundaries in the normalised key
 * catches every real shape without those false positives.
 */
const IP_KEY = /(^|_)ip(_?(address|v4|v6))?($|_)/;

const REDACTED = "[redacted]";

/**
 * An email address appearing *inside* a string value, not under a key that
 * names one.
 *
 * #36's audit found the gap: key-based redaction cannot see what it cannot
 * name, and the SMTP path logs `reason: cause.message`. A rejection from a mail
 * server routinely quotes the address it rejected — `550 5.1.1
 * <someone@example.com>: recipient rejected` — and that address is the visitor's
 * reply-to. It reaches the log under the key `reason`, which is not an email
 * key, so every filter above passes it through.
 *
 * Deliberately not matched: bare IP addresses in the same position. The only
 * IP-shaped strings that reach a log line here come from driver errors naming
 * our own database host, which is the useful half of the message; a client
 * address is hashed at the one place it is read and never travels as a string.
 * Masking both would cost real debugging information to fix a leak that does
 * not exist.
 */
const EMAIL_IN_TEXT = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

const maskEmailsInText = (value: string): string =>
  value.replace(EMAIL_IN_TEXT, (match) => maskEmail(match));

/**
 * An email in a log is a PII leak (SPEC §14.10); the domain alone is usually
 * enough to debug with, so keep that and drop the local part.
 */
function maskEmail(value: string): string {
  const at = value.lastIndexOf("@");
  return at > 0 ? `[redacted]@${value.slice(at + 1)}` : REDACTED;
}

/**
 * Recursively strip anything that must not be logged. Depth-limited: context is
 * meant to be small and flat, and an unbounded walk over an ORM object is exactly
 * how a whole row full of PII ends up in a log line.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (value === null || value === undefined) return value;

  if (value instanceof Error) {
    // Same masking as any other string: an Error reaching a log line whole is
    // the other way a mail-server rejection carries an address in.
    return { name: value.name, message: maskEmailsInText(value.message) };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((v) => redact(v, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const normalized = normalizeKey(key);
      if (SECRET_KEY.test(key)) out[key] = REDACTED;
      else if (EMAIL_KEY.test(normalized))
        out[key] = typeof val === "string" ? maskEmail(val) : REDACTED;
      else if (IP_KEY.test(normalized)) out[key] = REDACTED;
      else out[key] = redact(val, depth + 1);
    }
    return out;
  }
  if (typeof value === "string") return maskEmailsInText(value);
  return value;
}

export interface LogContext {
  /** Ties every line for one request together, and appears in the user-facing error. */
  correlationId?: string;
  [key: string]: unknown;
}

function emit(level: Level, message: string, context?: LogContext): void {
  if (RANK[level] < RANK[env.LOG_LEVEL]) return;

  // Context spreads FIRST so it can never overwrite the envelope. With the spread
  // last, `logger.error("real", { level: "debug" })` emitted `"level":"debug"`:
  // level-based alerting silently drops the line, the real message is lost, and it
  // becomes a log-injection primitive the moment a context value is user-derived.
  // audit() routes through here too, so it inherits the same protection.
  const line = {
    ...(context ? (redact(context) as Record<string, unknown>) : {}),
    level,
    message,
    timestamp: new Date().toISOString(),
  };

  const stream =
    level === "error" || level === "warn" ? process.stderr : process.stdout;

  if (env.NODE_ENV === "production") {
    stream.write(`${JSON.stringify(line)}\n`);
    return;
  }
  const { level: _l, message: _m, timestamp, ...rest } = line;
  const extra = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : "";
  stream.write(
    `${timestamp} ${level.toUpperCase().padEnd(5)} ${message}${extra}\n`,
  );
}

export const logger = {
  debug: (message: string, context?: LogContext) =>
    emit("debug", message, context),
  info: (message: string, context?: LogContext) =>
    emit("info", message, context),
  warn: (message: string, context?: LogContext) =>
    emit("warn", message, context),
  error: (message: string, context?: LogContext) =>
    emit("error", message, context),
};

/** One id per request, threaded through every line and surfaced on errors. */
export function newCorrelationId(): string {
  return crypto.randomUUID();
}

export interface AuditEntry {
  /** The signed-in user who performed it. Never a session token. */
  actorId: string;
  /** Dotted operation name, e.g. "project.publish". */
  action: string;
  /** What it acted on. */
  entity: string;
  entityId: string;
  outcome: "success" | "failure";
  correlationId?: string;
  /** Extra context — goes through `redact()` like everything else. */
  detail?: Record<string, unknown>;
}

/**
 * SPEC §14.14 — audit-log every admin mutation with user id and timestamp.
 * Exactly one line per mutation, at `info` so it survives a production
 * `LOG_LEVEL` of `info`.
 */
export function audit(entry: AuditEntry): void {
  const { detail, ...rest } = entry;
  emit("info", "audit", {
    audit: true,
    ...rest,
    ...(detail ? { detail } : {}),
  });
}
