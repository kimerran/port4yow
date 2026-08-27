import { defineConfig } from "prisma/config";

// Prisma 7 no longer loads .env automatically, and `env()` throws if the
// variable is absent — so `pnpm db:migrate` fails before it starts. Node 24
// loads the file itself; same bridge as astro.config.mjs, and for the same
// reason. Production passes real variables and never reaches this branch.
if (process.env.NODE_ENV !== "production") {
  try {
    process.loadEnvFile();
  } catch {
    // No .env yet — env() will name what is missing.
  }
}

/**
 * Prisma 7 configuration (SPEC §4).
 *
 * The connection URL lives here rather than in `schema.prisma`: Prisma 7 removed
 * `url` from the datasource block. This file is CLI-only — it configures migrate,
 * generate and seed. The runtime client gets its connection from
 * `@prisma/adapter-pg` in `src/lib/db.ts`.
 *
 * `env()` is Prisma's own reader, not `process.env`, and this file sits outside
 * `src/` — so AGENT §3's ban and #47's lint rule are both satisfied without an
 * exemption. `src/lib/env.ts` remains the boundary for application code.
 */
/**
 * `prisma generate` needs no database, but it loads this file — and Prisma's
 * `env()` throws on a missing variable, so an eager datasource made the
 * `postinstall` generate step fail anywhere DATABASE_URL is absent. That is
 * exactly CI, where install runs before any database exists.
 *
 * Reading `process.env` directly is fine here: this file is outside `src/`, so
 * AGENT §3's ban and #47's rule do not apply, and `src/lib/env.ts` remains the
 * validated boundary for application code. Commands that genuinely need a
 * connection (`migrate`, `db push`, `studio`) still fail loudly without it.
 */
const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  ...(databaseUrl
    ? {
        datasource: {
          url: databaseUrl,
          ...(process.env.SHADOW_DATABASE_URL
            ? { shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL }
            : {}),
        },
      }
    : {}),
  migrations: {
    path: "prisma/migrations",
    // Wired for #6. `prisma db seed` is what `pnpm db:seed` runs.
    seed: "node --experimental-strip-types prisma/seed.ts",
  },
});
