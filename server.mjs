import { createServer } from "node:http";
import sirv from "sirv";
import { handler as astroHandler } from "./dist/server/entry.mjs";

/**
 * The production entry point.
 *
 * ## Why this file exists
 *
 * `@astrojs/node` serves prerendered HTML from its own static file handler, and
 * that handler does not run Astro middleware. Since every page on this site is
 * prerendered, `src/middleware.ts` reached only `/healthz` and the API routes —
 * so the whole public site was served with **no security headers at all**.
 * Measured with `curl -I /` against a built server: no HSTS, no `nosniff`, no
 * `Referrer-Policy`, no `Permissions-Policy`, no COOP, no `X-Frame-Options`.
 *
 * The unit tests did not catch it because they test the middleware function,
 * which is correct in isolation and simply never called. `e2e/headers.spec.ts`
 * asserts against the served response instead, which is the only place this is
 * observable.
 *
 * The adapter runs in `middleware` mode rather than `standalone` for the same
 * reason this file exists: standalone's entry point binds a port on import, so
 * wrapping it produced a second listener and EADDRINUSE.
 */

const PORT = Number(process.env.PORT) || 4321;
const HOST = process.env.HOST || "0.0.0.0";

/**
 * SPEC §14.1/§14.3. Identical to `src/middleware.ts`'s set — the middleware is
 * kept for the on-demand routes, so the two must not drift. `e2e/headers.spec`
 * checks both a prerendered page and an API route, which is what would catch it.
 *
 * CSP is deliberately absent here: Astro emits it per page with the hashes of
 * that page's inline scripts, and a blanket header would be a second, weaker
 * policy intersected with it. The exception is `frame-ancestors`, which browsers
 * ignore in the `<meta>` tag Astro uses for a static build — so it has to be a
 * header or it is not enforced at all.
 */
const SECURITY_HEADERS = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "frame-ancestors 'none'",
};

/**
 * Static assets from the build.
 *
 * Everything under `_astro/` is content-hashed, so it is immutable and can be
 * cached for a year. Everything else — HTML, the resume, the icons — keeps a
 * short life because those paths are stable and their contents are not.
 */
const serveStatic = sirv("./dist/client", {
  etag: true,
  gzip: true,
  brotli: true,
  setHeaders(res, pathname) {
    res.setHeader(
      "Cache-Control",
      pathname.startsWith("/_astro/")
        ? "public, max-age=31536000, immutable"
        : "public, max-age=0, must-revalidate",
    );
  },
});

const server = createServer((req, res) => {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(name, value);
  }
  // Static first, then Astro for anything it does not have.
  serveStatic(req, res, () => {
    astroHandler(req, res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`listening on http://${HOST}:${String(PORT)}`);
});
