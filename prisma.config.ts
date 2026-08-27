import { defineConfig, env } from "prisma/config";

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
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
    shadowDatabaseUrl: env("SHADOW_DATABASE_URL"),
  },
  migrations: {
    path: "prisma/migrations",
    // Wired for #6. `prisma db seed` is what `pnpm db:seed` runs.
    seed: "node --experimental-strip-types prisma/seed.ts",
  },
});
