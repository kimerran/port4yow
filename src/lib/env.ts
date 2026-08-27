import { z } from "zod";

/**
 * The single validated entry point for configuration (SPEC §10).
 *
 * Nothing else in this codebase reads `process.env` — AGENT §3 bans it, and
 * `eslint.config.js` enforces that ban everywhere in `src/` except this file.
 *
 * Parsing happens once, at module load, and **throws on failure** so the process
 * dies at boot rather than serving traffic with a missing secret. There is no
 * default for any secret: falling back to one would be worse than crashing.
 */

/** Generated with `openssl rand -base64 48`; 32 chars is the floor we accept. */
const SECRET_MIN = 32;
const secret = (name: string) =>
  z
    .string()
    .min(
      SECRET_MIN,
      `${name} must be at least ${SECRET_MIN} characters — generate with: openssl rand -base64 48`,
    );

/**
 * `.env` ships optional keys as bare `KEY=`, which is the empty string, not
 * `undefined` — so `.optional()` alone still runs the format checks against `""`
 * and rejects it. That made `cp .env.example .env` unbootable on `REDIS_URL`.
 * Treat empty as absent for every optional key, closing the class rather than
 * the one instance.
 */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

/**
 * A URL that is actually addressable over HTTP — scheme required.
 *
 * `z.url()` alone is not enough, and the gap is not academic. The WHATWG parser
 * reads `localhost:4321` as **scheme `localhost:`, path `4321`**, so a bare
 * `PUBLIC_SITE_URL=localhost:4321` — the obvious typo, since that is how you say
 * the address out loud — passed validation. `new URL(...).origin` on it is the
 * *string* `"null"`, and `isSameOrigin` compares the `Origin` header against
 * that. Browsers send `Origin: null` from a sandboxed iframe and from some
 * cross-origin redirects, so the check stopped refusing exactly the callers it
 * exists to refuse. Measured: with that value a cross-origin POST carrying
 * `Origin: null` was **accepted**; with a correct value it is refused.
 *
 * That is a config typo turning a CSRF control into a no-op, which is why it is
 * caught here rather than defended against downstream — `env.ts` is the one
 * place that is supposed to make a bad value impossible to hold (SPEC §10).
 */
const httpUrl = (name: string) =>
  z.url({
    protocol: /^https?$/,
    error: `${name} must be an absolute http(s) URL, e.g. https://mh.neri.ph — a bare host:port parses as a URL but has no origin.`,
  });

/** `.env` files carry strings; accept the usual spellings and normalise to boolean. */
const boolish = z
  .union([
    z.literal("true"),
    z.literal("false"),
    z.literal("1"),
    z.literal("0"),
  ])
  .transform((v) => v === "true" || v === "1");

const EnvSchema = z
  .object({
    // Core
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(4321),
    PUBLIC_SITE_URL: httpUrl("PUBLIC_SITE_URL"),

    // Database
    DATABASE_URL: z.string().startsWith("postgresql://"),
    SHADOW_DATABASE_URL: optional(z.string().startsWith("postgresql://")),

    // Admin seed. Consumed by prisma/seed.ts, not by the running server, so the
    // app must boot without it — see the seed's own stricter checks (SPEC §4).
    ADMIN_USERNAME: z.string().min(1).default("admin"),
    ADMIN_PASSWORD: optional(z.string().min(1)),
    ADMIN_DISPLAY_NAME: z.string().min(1).default("Mark Hugh Neri"),

    // Secrets — never logged, never PUBLIC_*
    SESSION_SECRET: secret("SESSION_SECRET"),
    FORM_SECRET: secret("FORM_SECRET"),
    IP_HASH_SALT: secret("IP_HASH_SALT"),

    // Object storage
    S3_ENDPOINT: httpUrl("S3_ENDPOINT"),
    S3_REGION: z.string().min(1).default("us-east-1"),
    S3_BUCKET: z.string().min(1),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: boolish.default(true),

    // Email
    RESEND_API_KEY: optional(z.string().min(1)),
    CONTACT_FROM_EMAIL: z.email().default("hello@mh.neri.ph"),
    CONTACT_TO_EMAIL: z.email(),
    RESEND_ENABLED: boolish.default(false),
    /**
     * Where mail goes when RESEND_ENABLED is false (SPEC §12 — Mailpit at 1025).
     *
     * NOT in SPEC §10's variable list: §10 says "false in dev → log to console /
     * Mailpit instead" without naming a host, and #20 requires the Mailpit path
     * to work. Defaulted so `cp .env.example .env` still boots, and kept a
     * variable rather than a constant so a non-default compose file or a CI
     * container can point at its own SMTP sink. Worth adding to §10.
     */
    SMTP_URL: z.string().startsWith("smtp://").default("smtp://localhost:1025"),

    // Optional
    REDIS_URL: optional(z.string().startsWith("redis://")),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  })
  // Fail closed: enabling Resend without a key would silently drop mail (SPEC §7).
  .refine((e) => !e.RESEND_ENABLED || (e.RESEND_API_KEY?.length ?? 0) > 0, {
    message: "RESEND_API_KEY is required when RESEND_ENABLED is true.",
    path: ["RESEND_API_KEY"],
  });

export type Env = z.infer<typeof EnvSchema>;

/**
 * Formats a failure without echoing any value — a validation error must never
 * become the thing that leaks a secret into the logs (AGENT §3, §4).
 */
function describe(error: z.ZodError): string {
  const lines = error.issues.map(
    (i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`,
  );
  return `Invalid environment configuration:\n${lines.join("\n")}\n\nSee .env.example and SPEC §10.`;
}

function load(source: Record<string, string | undefined>): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) throw new Error(describe(parsed.error));
  return Object.freeze(parsed.data);
}

/** Exported for unit tests, which must be able to parse a fixture (SPEC §16). */
export { EnvSchema, load as loadEnv };

export const env: Env = load(process.env);
