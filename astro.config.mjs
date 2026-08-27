// @ts-check
import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import tailwindcss from "@tailwindcss/vite";

// Vite exposes .env on import.meta.env only — it never populates process.env.
// src/lib/env.ts validates process.env (correct for production, where Railway
// injects real variables and SPEC §13 boots `node ./dist/server/entry.mjs`), so
// without this bridge every page importing `env` 500s under `astro dev`.
//
// Node 24 loads the file itself, so this needs no dependency. It must live here
// rather than in src/: astro.config.mjs is outside the scope of #47's
// no-restricted-properties ban, so no exemption has to be carved out.
// Real environment variables keep precedence over the file.
if (process.env.NODE_ENV !== "production") {
  try {
    process.loadEnvFile();
  } catch {
    // No .env yet — env.ts will report whatever is actually missing.
  }
}

// SPEC §2/§3: server-rendered Astro on the standalone Node adapter.
// Tailwind v4 is CSS-first: tokens live in @theme in src/styles/global.css.
// There is no tailwind.config.js and never a CDN script (BRAND §11). CSP in #33.
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  // `astro dev` takes its port only from --port or server.port; it does not read
  // PORT on its own. SPEC §10 declares PORT as a project variable, so wire it
  // explicitly or `.env`'s PORT silently does nothing in development once #7
  // lands. 4321 matches the default .env.example ships. Production is separate:
  // the standalone adapter reads process.env.PORT at runtime (SPEC §13).
  // `||` not `??`: ?? only catches undefined/null, so a bare `PORT=` line in
  // .env gives Number("") === 0 and Node binds a random free port. `||`
  // collapses "", 0 and NaN to the intended default.
  server: { port: Number(process.env.PORT) || 4321 },
  // SPEC §14.4 — CSRF. Explicit per-route Origin checks are still required
  // on every state-changing handler; this is the framework-level backstop.
  security: {
    checkOrigin: true,
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
