import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.ts";
import { env } from "./env.ts";

/**
 * The single PrismaClient for the whole application (AGENT §2).
 *
 * Prisma 7's client is Rust-free and requires a driver adapter, so the
 * connection comes from `@prisma/adapter-pg` rather than from `schema.prisma`.
 * `DATABASE_URL` arrives via `src/lib/env.ts` — validated once at boot — because
 * AGENT §3 bans reading `process.env` anywhere else, and #47 enforces that.
 *
 *
Explicit `.ts` extensions on these relative imports are load-bearing, not style:
`src/jobs/run.ts` is executed directly by Node (`node --experimental-strip-types`)
for Railway cron, and Node's ESM resolver does not guess extensions. Vite and
Astro accept them either way — the repo already imports `.ts` from `<script>`
blocks — and `allowImportingTsExtensions` is on via `astro/tsconfigs/base`.
 *
 * Cached on `globalThis` in development so Astro's HMR does not open a new pool
 * on every reload and exhaust Postgres connections. Production gets exactly one.
 */
const createClient = (): PrismaClient =>
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
    log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db: PrismaClient = globalForPrisma.prisma ?? createClient();

if (env.NODE_ENV !== "production") globalForPrisma.prisma = db;
