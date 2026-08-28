// @ts-check
import { readFileSync } from "node:fs";
import { defineConfig, fontProviders } from "astro/config";
import node from "@astrojs/node";
import tailwindcss from "@tailwindcss/vite";

// Vite exposes .env on import.meta.env only — it never populates process.env.
// src/lib/env.ts validates process.env (correct for production, where Railway
// injects real variables and SPEC §13 boots `node ./dist/server/entry.mjs`), so
// without this bridge every page importing `env` 500s under `astro dev`.
//
// It must live here rather than in src/: astro.config.mjs is outside the scope
// of #47's no-restricted-properties ban, so no exemption has to be carved out.
//
// ## Why this no longer skips production
//
// It used to be wrapped in `if (NODE_ENV !== "production")`, which was fine
// while every value it supplied was only needed at RUNTIME. `site` is needed at
// BUILD time — and `astro build` sets NODE_ENV=production, so the guard skipped
// the file in exactly the case that now needs it, and a local build failed on a
// PUBLIC_SITE_URL that was sitting in .env all along.
//
// Reading it by hand rather than with `process.loadEnvFile()`: that function
// overwrites values already in the environment, which would let a stale .env on
// a deploy host beat the real injected variables. Only unset keys are filled, so
// a real environment variable always wins.
/**
 * Parses one `KEY=value` line the way a .env file means it.
 *
 * A quoted value is taken verbatim up to its closing quote, so a `#` inside it
 * survives. An unquoted value ends at the first `#` that follows whitespace —
 * `.env` here writes `RESEND_ENABLED=false   # false in dev → Mailpit`, and a
 * naive split produced the string `"false   # false in dev → Mailpit"`, which
 * `env.ts` then rejected with `RESEND_ENABLED: Invalid input`. That failed the
 * BUILD, at the first prerendered page, which is the loudest place it could
 * have surfaced and still took a minute to read.
 *
 * @param {string} line
 * @returns {{ key: string, value: string } | null}
 */
function parseEnvLine(line) {
  const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
  if (!match) return null;
  const key = match[1];
  let value = match[2];
  if (key === undefined || value === undefined) return null;

  const quote = value[0];
  if (quote === '"' || quote === "'") {
    const end = value.indexOf(quote, 1);
    value = end === -1 ? value.slice(1) : value.slice(1, end);
  } else {
    value = value.replace(/\s+#.*$/, "").trim();
  }

  return { key, value };
}

try {
  const text = readFileSync(new URL(".env", import.meta.url), "utf8");
  for (const line of text.split("\n")) {
    const entry = parseEnvLine(line);
    if (!entry) continue;
    if (process.env[entry.key] !== undefined) continue;
    process.env[entry.key] = entry.value;
  }
} catch {
  // No .env — CI and production supply the real variables directly.
}

/**
 * The origin every absolute URL is built from.
 *
 * Prerendered routes have no request to derive one from, so this is the only
 * source. A production build MUST fail rather than bake `localhost` into the
 * sitemap, canonicals and OG tags — that is a silent, fully-successful build
 * that ships URLs no crawler can follow.
 */
const siteUrl = process.env.PUBLIC_SITE_URL ?? "http://localhost:4321";
if (process.env.NODE_ENV === "production" && !process.env.PUBLIC_SITE_URL) {
  throw new Error(
    "PUBLIC_SITE_URL is required for a production build — absolute URLs would otherwise point at localhost.",
  );
}

// SPEC §2/§3, amended: STATIC Astro on the standalone Node adapter.
//
// `output: "server"` rendered every page per request because every page read
// the database. Projects are files now, so the only route that cannot be built
// ahead of time is POST /api/contact, which opts out with `prerender = false`.
// The adapter stays for exactly that one route (and for /healthz).
//
// `middleware` mode, not `standalone`. Standalone's `entry.mjs` starts its own
// listener the moment it is imported, so `server.mjs` — which wraps the handler
// to put security headers on every response — became a SECOND listener and
// crashed with EADDRINUSE. Middleware mode exports the handler without binding,
// which is what a wrapper needs.
// Tailwind v4 is CSS-first: tokens live in @theme in src/styles/global.css.
// There is no tailwind.config.js and never a CDN script (BRAND §11). CSP in #33.
export default defineConfig({
  output: "static",
  adapter: node({ mode: "middleware" }),
  /**
   * Absolute URLs for the sitemap, robots.txt, canonicals and OG tags.
   *
   * Prerendered routes have no request to derive an origin from, so this is the
   * only source — `sitemap.xml.ts` and `robots.txt.ts` throw at BUILD time if it
   * is unset rather than emitting relative URLs a crawler cannot follow.
   */
  site: siteUrl,
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

      /**
       * The ONE third-party origin on this site.
       *
       * BRAND §3 self-hosts the fonts specifically so the browser talks to
       * nobody but us; Turnstile is the deliberate exception, added by name
       * rather than by relaxing the policy. Three directives are needed and all
       * three are load-bearing: the widget is a script, it renders in an iframe,
       * and it posts the challenge result back to Cloudflare.
       *
       * `resources` REPLACES the default `script-src` sources, so `'self'` has
       * to be restated. Astro still appends its own per-page hashes.
       */
      scriptDirective: {
        resources: ["'self'", "https://challenges.cloudflare.com"],
      },

      directives: [
        "frame-src https://challenges.cloudflare.com",
        "connect-src 'self' https://challenges.cloudflare.com",
        "default-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
        // Fonts are self-hosted by #9, so no third-party origin is needed.
        "font-src 'self'",
        "img-src 'self' data:",
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
