// @ts-check
import { defineConfig } from "astro/config";
import node from "@astrojs/node";

// SPEC §2/§3: server-rendered Astro on the standalone Node adapter.
// Tailwind v4 (@tailwindcss/vite) is added in #2; CSP in #33.
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  // SPEC §14.4 — CSRF. Explicit per-route Origin checks are still required
  // on every state-changing handler; this is the framework-level backstop.
  security: {
    checkOrigin: true,
  },
});
