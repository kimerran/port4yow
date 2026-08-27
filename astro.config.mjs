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

    /**
     * SPEC §9 allows an 8 MB upload. Astro refuses an Action body over
     * `actionBodySizeLimit` BEFORE the handler runs, and its default is 1 MiB —
     * so without this, every upload between 1 MB and 8 MB was rejected with a
     * raw `CONTENT_TOO_LARGE`, which is most of the range the spec allows and
     * squarely where real screenshots live. Measured: a valid 5.43 MB JPEG got
     * `413 Request body exceeds 1048576 bytes` and `processUpload` never ran,
     * so the app's own 8 MB check and its error copy were dead code.
     *
     * 9 MiB, not a round 8: multipart adds boundaries and field names, so a
     * body carrying an 8 MiB file is slightly larger than the file. The
     * headroom is deliberately small — a wildly oversized body is still refused
     * cheaply here, while every legitimate file reaches the app's check, which
     * is the one that should decide and the one that explains itself.
     *
     * `src/lib/__tests__/uploadlimits.test.ts` asserts this stays above
     * `MAX_UPLOAD_BYTES`, so the two cannot drift apart silently again.
     */
    actionBodySizeLimit: 9 * 1024 * 1024,

    /**
     * SPEC §14.2 — CSP through Astro's own API rather than hand-rolled header
     * strings (AGENT §2). Its real value is that it hashes every inline script
     * and style Astro emits, so `unsafe-inline` is never needed.
     *
     * Astro emits this as a real `content-security-policy` RESPONSE HEADER in a
     * production build (its docstring example shows a <meta> tag, which would
     * have silently dropped `frame-ancestors` — verified against a built server
     * rather than trusting the docs). The remaining SPEC §14.3 headers have no
     * Astro equivalent and are set in src/middleware.ts.
     */
    csp: {
      algorithm: "SHA-256",
      directives: [
        "default-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
        // Fonts are self-hosted by #9, so no third-party origin is needed.
        "font-src 'self'",
        "img-src 'self' data:",
        "connect-src 'self'",
        "frame-src 'none'",
        "manifest-src 'self'",
        "media-src 'self'",
        "worker-src 'self'",
      ],
    },
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
