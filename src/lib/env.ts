import { z } from "zod";

/**
 * The single validated entry point for configuration (SPEC §10).
 *
 * Much shorter than it was. `DATABASE_URL`, the S3 block, the admin seed
 * credentials, `SESSION_SECRET` and `REDIS_URL` are all gone with the database,
 * the object store and the admin — thirteen variables that had to be correct
 * before the site would boot, for a site that is now prerendered HTML plus one
 * mail route.
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

    /**
     * Secrets — never logged, never PUBLIC_*.
     *
     * Two, down from three. `SESSION_SECRET` went with the admin: there are no
     * sessions to sign because there is nothing to log in to.
     */
    FORM_SECRET: secret("FORM_SECRET"),
    IP_HASH_SALT: secret("IP_HASH_SALT"),

    // Email
    RESEND_API_KEY: optional(z.string().min(1)),
    /**
     * The envelope sender. Must be an address on a domain verified with Resend,
     * or every send is rejected — which is why the default is the real one
     * rather than a placeholder that looks plausible and fails in production.
     */
    CONTACT_FROM_EMAIL: z.email().default("portfolio@msg.artisam.xyz"),
    CONTACT_TO_EMAIL: z.email(),
    RESEND_ENABLED: boolish.default(false),
    /**
     * Where mail goes when RESEND_ENABLED is false (SPEC §12 — Mailpit at 1025).
     *
     * Defaulted so `cp .env.example .env` still boots, and kept a variable
     * rather than a constant so a non-default compose file or a CI container can
     * point at its own SMTP sink.
     */
    SMTP_URL: z.string().startsWith("smtp://").default("smtp://localhost:1025"),

    /**
     * Cloudflare Turnstile (SPEC §7 — bot mitigation on the contact form).
     *
     * `PUBLIC_TURNSTILE_SITE_KEY` is `PUBLIC_*` and that is correct rather than
     * a violation of AGENT §3: a Turnstile *site* key is designed to be read
     * from the page. The secret is not, and is never `PUBLIC_*`.
     *
     * Both optional so the site builds and runs without a Cloudflare account —
     * unconfigured means the widget is not rendered and no token is expected.
     * The refine below makes half-configured impossible, which is the state
     * that fails silently: a widget rendered with no server-side verification
     * is decoration.
     *
     * The site key is read at RUNTIME, not compiled in. It reaches the page
     * through this module — which parses `process.env` — rather than through
     * `import.meta.env`, which Astro would substitute at build. Verified by
     * starting a built server with a different value and seeing it in the HTML.
     * Changing it is a restart, not a rebuild.
     */
    PUBLIC_TURNSTILE_SITE_KEY: optional(z.string().min(1)),
    TURNSTILE_SECRET_KEY: optional(z.string().min(1)),

    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  })
  .refine(
    (e) =>
      Boolean(e.PUBLIC_TURNSTILE_SITE_KEY) === Boolean(e.TURNSTILE_SECRET_KEY),
    {
      message:
        "PUBLIC_TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY must be set together — a widget with no server-side check verifies nothing.",
      path: ["TURNSTILE_SECRET_KEY"],
    },
  )
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
