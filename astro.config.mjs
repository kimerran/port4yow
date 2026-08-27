// @ts-check
import { defineConfig, fontProviders } from "astro/config";
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

  /**
   * BRAND §3 — three families, three jobs. Astro downloads these at BUILD time and
   * serves them from our own origin, so there is no runtime connection to Google
   * and no visitor IP leaks. That is the distinction BRAND §3 draws when it
   * forbids "the Google Fonts CDN links from the mock" — the provider is a build
   * -time source, not a third-party origin the browser talks to.
   *
   * Subset to latin and `font-display: swap` per SPEC §15. Only the display face
   * is preloaded: it carries the hero name, which is the LCP element.
   */
  fonts: [
    {
      provider: fontProviders.google(),
      name: "Bodoni Moda",
      cssVariable: "--font-bodoni-moda",
      weights: [600, 700],
      styles: ["normal"],
      subsets: ["latin"],
      display: "swap",
      fallbacks: ["Georgia", "serif"],
      optimizedFallbacks: false,
    },
    {
      provider: fontProviders.google(),
      name: "Karla",
      cssVariable: "--font-karla",
      weights: [400, 700],
      styles: ["normal"],
      subsets: ["latin"],
      display: "swap",
      fallbacks: ["ui-sans-serif", "system-ui", "sans-serif"],
      optimizedFallbacks: false,
    },
    {
      provider: fontProviders.google(),
      name: "IBM Plex Mono",
      cssVariable: "--font-plex-mono",
      weights: [500, 600],
      styles: ["normal"],
      subsets: ["latin"],
      display: "swap",
      fallbacks: ["ui-monospace", "monospace"],
      optimizedFallbacks: false,
    },
  ],
});
