import { describe, expect, it } from "vitest";
import { onRequest } from "../middleware";

/**
 * Header regression tests. These would have caught a header being dropped in a
 * refactor, which is the realistic failure mode — the set is written once and
 * then nobody looks at it again.
 *
 * CSP is deliberately NOT asserted here: it is emitted by Astro's build, not by
 * this middleware, so a unit test would be asserting against nothing. It is
 * verified against a built server instead (see the handoff).
 */
async function run(pathname: string): Promise<Headers> {
  const context = { url: new URL(`https://mh.neri.ph${pathname}`) };
  const response = await onRequest(
    context as Parameters<typeof onRequest>[0],
    () => Promise.resolve(new Response("ok")),
  );
  return (response as Response).headers;
}

describe("security headers (SPEC §14.1, §14.3)", () => {
  it.each([
    [
      "strict-transport-security",
      "max-age=63072000; includeSubDomains; preload",
    ],
    ["x-content-type-options", "nosniff"],
    ["referrer-policy", "strict-origin-when-cross-origin"],
    [
      "permissions-policy",
      "camera=(), microphone=(), geolocation=(), interest-cohort=()",
    ],
    ["cross-origin-opener-policy", "same-origin"],
    ["x-frame-options", "DENY"],
  ])("sets %s", async (header, value) => {
    expect((await run("/")).get(header)).toBe(value);
  });
});

describe("admin caching and indexing (SPEC §6)", () => {
  it.each(["/admin", "/admin/projects", "/admin/messages/1"])(
    "%s is no-store and noindex",
    async (path) => {
      const headers = await run(path);
      expect(headers.get("cache-control")).toBe("no-store");
      expect(headers.get("x-robots-tag")).toBe("noindex, nofollow");
    },
  );

  it.each([
    "/",
    "/work/a-project",
    "/adminsomething",
    "/administrators",
    "/admin-guide",
  ])("%s is not treated as admin", async (path) => {
    const headers = await run(path);
    expect(headers.get("cache-control")).toBeNull();
    expect(headers.get("x-robots-tag")).toBeNull();
  });
});
