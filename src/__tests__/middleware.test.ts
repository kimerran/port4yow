import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Middleware runs on every request, and it now has exactly one job: the security
 * headers from #33, plus the #43 rule that an error response is never left
 * heuristically cacheable.
 *
 * The session-hydration and admin-guard suites are gone with the admin — there
 * is no cookie to read, no session to slide, and no `/admin` to protect. The
 * `../lib/auth` mock went with them.
 *
 * CSP is deliberately NOT asserted here: it is emitted by Astro's build, not by
 * this middleware, so a unit test would be asserting against nothing. It is
 * verified against a built server instead (see the handoff).
 */

vi.mock("../lib/logger", () => ({
  logger: {
    error: (message: string, context?: unknown): void => {
      logged.push({ message, context });
    },
    warn: (): void => undefined,
  },
  newCorrelationId: () => "corr-1",
}));

const logged: { message: string; context?: unknown }[] = [];

const { onRequest } = await import("../middleware");

interface RunResult {
  response: Response;
  headers: Headers;
  nextCalled: boolean;
}

async function run(
  pathname: string,
  opts: {
    /** Let a case drive what the downstream route does, including throwing. */
    next?: () => Promise<Response>;
  } = {},
): Promise<RunResult> {
  let nextCalled = false;
  const context = { url: new URL(`https://mh.neri.ph${pathname}`) };

  const response = (await onRequest(
    context as unknown as Parameters<typeof onRequest>[0],
    () => {
      nextCalled = true;
      return opts.next ? opts.next() : Promise.resolve(new Response("ok"));
    },
  )) as Response;

  return { response, headers: response.headers, nextCalled };
}

beforeEach(() => {
  logged.length = 0;
});

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
    expect((await run("/")).headers.get(header)).toBe(value);
  });
});

/**
 * The guard returns before `next()`, so an early return used to skip the header
 * block entirely — an admin redirect carried no `Cache-Control`, and a
 * heuristically cached 302 would keep bouncing a visitor to the login page after
 * they had signed in. Headers belong to the response, not to the happy path.
 */

/**
 * SPEC §6 / §14 — the open-redirect defence. `safeNextPath` covers the shapes;
 * this covers the middleware actually applying it before any consumer sees the
 * value.
 */

/**
 * Sliding expiry only reaches the browser if the cookie is re-sent. Without it
 * the row's expiry extends server-side while the cookie keeps its original
 * Max-Age, and the session dies in the browser while the database still
 * believes it is alive.
 */

/**
 * #43's sweep found this against a built server: a malformed JSON body to any
 * Astro Action made the framework's own `request.json()` reject, and the
 * adapter answered 500 with **not one security header on it** — anonymous and
 * cross-origin, because the parse happens before any action's `requireAdmin`.
 *
 * The tests below are about the class, not that one route: middleware must be
 * total, because the headers belong to the response.
 */
describe("an uncaught throw downstream (#43)", () => {
  const boom = (): Promise<Response> =>
    Promise.reject(
      new Error("Unexpected token 'x', \"x=1\" is not valid JSON"),
    );

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
  ])("still sets %s", async (header, value) => {
    const { headers } = await run("/_actions/getStats", { next: boom });
    expect(headers.get(header)).toBe(value);
  });

  it("answers 500 rather than propagating", async () => {
    const { response } = await run("/_actions/getStats", { next: boom });
    expect(response.status).toBe(500);
  });

  it("is never cached", async () => {
    const { headers } = await run("/_actions/getStats", { next: boom });
    expect(headers.get("cache-control")).toBe("no-store");
  });

  /** SPEC §14.11 — generic in the response, detail in the log, joined by an id. */
  it("returns a generic body with a correlation id and no detail", async () => {
    const { response } = await run("/_actions/getStats", { next: boom });
    const body = (await response.json()) as Record<string, unknown>;

    expect(body["error"]).toBe("Something went wrong on our end.");
    expect(body["correlationId"]).toBe("corr-1");

    const text = JSON.stringify(body);
    expect(text).not.toContain("JSON");
    expect(text).not.toContain("SyntaxError");
    expect(text).not.toContain("Unexpected token");
  });

  it("logs the reason and the path through the logger, with the same id", async () => {
    await run("/_actions/getStats", { next: boom });

    expect(logged).toHaveLength(1);
    const context = logged[0]?.context as Record<string, unknown>;
    expect(context["correlationId"]).toBe("corr-1");
    expect(context["path"]).toBe("/_actions/getStats");
    expect(String(context["reason"])).toContain("not valid JSON");
  });
});

/**
 * #43 — an error response with no `Cache-Control` is heuristically cacheable.
 * `/work/<slug>` rewrites to `/404` for a DRAFT (#18), so a shared cache could
 * keep serving "not found" after the project goes live.
 */
describe("error responses are not heuristically cacheable (#43)", () => {
  const status = (code: number, headers?: HeadersInit) => () =>
    Promise.resolve(
      new Response("x", { status: code, ...(headers ? { headers } : {}) }),
    );

  it.each([404, 410, 500, 503])("sets no-store on a bare %i", async (code) => {
    const { headers } = await run("/work/some-draft", { next: status(code) });
    expect(headers.get("cache-control")).toBe("no-store");
  });

  it("leaves a 200 alone — public caching is SPEC §5's call, not this one", async () => {
    const { headers } = await run("/", {
      next: status(200, { "Cache-Control": "public, max-age=0, s-maxage=300" }),
    });
    expect(headers.get("cache-control")).toBe(
      "public, max-age=0, s-maxage=300",
    );
  });

  it("does not add one to a 200 that set none", async () => {
    const { headers } = await run("/", { next: status(200) });
    expect(headers.get("cache-control")).toBeNull();
  });

  it("does not override an error route that chose its own policy", async () => {
    const { headers } = await run("/work/x", {
      next: status(404, { "Cache-Control": "public, max-age=60" }),
    });
    expect(headers.get("cache-control")).toBe("public, max-age=60");
  });
});
