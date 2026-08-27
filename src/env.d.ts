/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    /**
     * The session-resolved admin user, hydrated by `src/middleware.ts` on every
     * request (SPEC §8). `null` when there is no valid session — middleware fails
     * closed, so a resolution error also lands here as `null`.
     *
     * Narrowed to what templates actually need. `passwordHash` is deliberately
     * absent: AGENT §2 forbids returning it from anything that feeds a template.
     * Replaced by a Prisma-derived type in #5/#23.
     */
    user: {
      id: string;
      username: string;
      displayName: string;
    } | null;
  }
}
