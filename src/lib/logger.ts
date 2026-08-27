import { env } from "./env";

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
const EMAIL_KEY = /email/i;
const IP_KEY = /(^|_)ip($|_|address)/i;

const REDACTED = "[redacted]";

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
    return { name: value.name, message: value.message };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((v) => redact(v, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY.test(key)) out[key] = REDACTED;
      else if (EMAIL_KEY.test(key))
        out[key] = typeof val === "string" ? maskEmail(val) : REDACTED;
      else if (IP_KEY.test(key)) out[key] = REDACTED;
      else out[key] = redact(val, depth + 1);
    }
    return out;
  }
  return value;
}

export interface LogContext {
  /** Ties every line for one request together, and appears in the user-facing error. */
  correlationId?: string;
  [key: string]: unknown;
}

function emit(level: Level, message: string, context?: LogContext): void {
  if (RANK[level] < RANK[env.LOG_LEVEL]) return;

  const line = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...(context ? (redact(context) as Record<string, unknown>) : {}),
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
