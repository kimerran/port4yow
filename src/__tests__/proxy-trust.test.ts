import { describe, expect, it } from "vitest";

/**
 * The reverse-proxy trust setting, pinned because its absence took the contact
 * form down in production and nothing else noticed.
 *
 * ## What happened
 *
 * Railway terminates TLS at its edge and forwards plain HTTP. The adapter
 * therefore derives `http://mh.neri.ph` as the request origin unless it trusts
 * `x-forwarded-proto` — and Astro only trusts that header when
 * `security.allowedDomains` is non-empty (`validateForwardedHeaders` in
 * `astro/dist/core/app/validate-headers.js`). It defaults to empty.
 *
 * `checkOrigin` then compared the browser's `Origin: https://mh.neri.ph`
 * against `http://mh.neri.ph` and returned **403 to every form submission**,
 * both the JavaScript path and the no-JS one.
 *
 * ## Why this is a config assertion and not an end-to-end one
 *
 * The bug only exists behind a TLS-terminating proxy. Locally the server is
 * plain HTTP and the browser's Origin is `http://localhost:4321`, so the origins
 * match and every test passes — which is exactly what happened. Reproducing it
 * in the suite would mean running the app under a second, TLS-terminating proxy
 * for one assertion.
 *
 * So this pins the setting itself. It is a weaker test than a request, and it
 * is honest about that: it cannot prove the proxy path works, only that the
 * line whose absence broke it is still there and still scoped.
 */

const { default: config } = await import("../../astro.config.mjs");

describe("proxy trust (security.allowedDomains)", () => {
  it("is configured at all", () => {
    // Empty is Astro's default and is the state that caused the outage.
    expect(
      config.security?.allowedDomains ?? [],
      "x-forwarded-proto is ignored when this is empty",
    ).not.toHaveLength(0);
  });

  it("names the production host over https, and nothing wider", () => {
    const domains = config.security?.allowedDomains ?? [];

    for (const pattern of domains) {
      expect(pattern.protocol, "http would defeat the point").toBe("https");
      expect(
        pattern.hostname,
        "a wildcard lets a caller spoof the host Astro thinks it serves",
      ).not.toContain("*");
    }

    expect(domains.map((d) => d.hostname)).toContain("mh.neri.ph");
  });

  it("still checks the origin", () => {
    /**
     * Trusting the proxy is only safe alongside the check it feeds. Turning
     * `checkOrigin` off would be the other way to make the 403 disappear, and
     * the wrong one.
     */
    expect(config.security?.checkOrigin).toBe(true);
  });
});
