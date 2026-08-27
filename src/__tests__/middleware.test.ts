import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Middleware runs on every request, so these cover three separate jobs: the
 * security headers from #33, and the session hydration and admin guard from #24.
 *
 * CSP is deliberately NOT asserted here: it is emitted by Astro's build, not by
 * this middleware, so a unit test would be asserting against nothing. It is
 * verified against a built server instead (see the handoff).
 */

interface FakeSession {
  user: { id: string; username: string; displayName: string; role: string };
  expiresAt: Date;
  refreshed: boolean;
}

let session: FakeSession | null = null;
let validateThrows = false;
let cookieReadThrows = false;
const cookiesSet: { name: string; value: string }[] = [];

vi.mock("../lib/auth", () => ({
  SESSION_COOKIE: "__Host-session",
  SESSION_COOKIE_OPTIONS: {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 2592000,
  },
  validateSession: () => {
    if (validateThrows) return Promise.reject(new Error("db down"));
    return Promise.resolve(session);
  },
}));

vi.mock("../lib/logger", () => ({
  logger: { error: (): void => undefined, warn: (): void => undefined },
}));

const { onRequest } = await import("../middleware");

const USER = {
  id: "user_1",
  username: "mark",
  displayName: "Mark",
  role: "ADMIN",
};

interface RunResult {
  response: Response;
  headers: Headers;
  locals: { user: unknown };
  nextCalled: boolean;
}

async function run(
  pathname: string,
  opts: { token?: string | null } = {},
): Promise<RunResult> {
  const locals: { user: unknown } = { user: undefined };
  let nextCalled = false;

  const context = {
    url: new URL(`https://mh.neri.ph${pathname}`),
    locals,
    cookies: {
      get: (name: string) => {
        if (cookieReadThrows) throw new Error("malformed cookie header");
        return opts.token ? { name, value: opts.token } : undefined;
      },
      set: (name: string, value: string) => {
        cookiesSet.push({ name, value });
      },
    },
    redirect: (location: string, status = 302) =>
      new Response(null, { status, headers: { Location: location } }),
  };

  const response = (await onRequest(
    context as unknown as Parameters<typeof onRequest>[0],
    () => {
      nextCalled = true;
      return Promise.resolve(new Response("ok"));
    },
  )) as Response;

  return { response, headers: response.headers, locals, nextCalled };
}

beforeEach(() => {
  session = null;
  validateThrows = false;
  cookieReadThrows = false;
  cookiesSet.length = 0;
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

describe("admin caching and indexing (SPEC §6, §14.14)", () => {
  it.each(["/admin", "/admin/projects", "/admin/messages/1"])(
    "%s is no-store and noindex",
    async (path) => {
      session = { user: USER, expiresAt: new Date(), refreshed: false };
      const { headers } = await run(path, { token: "t" });
      expect(headers.get("cache-control")).toBe("no-store");
      expect(headers.get("x-robots-tag")).toBe("noindex, nofollow");
    },
  );

  it("applies to /api/admin too", async () => {
    session = { user: USER, expiresAt: new Date(), refreshed: false };
    const { headers } = await run("/api/admin/projects", { token: "t" });
    expect(headers.get("cache-control")).toBe("no-store");
    expect(headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it.each([
    "/",
    "/work/a-project",
    "/adminsomething",
    "/administrators",
    "/admin-guide",
  ])("%s is not treated as admin", async (path) => {
    const { headers } = await run(path);
    expect(headers.get("cache-control")).toBeNull();
    expect(headers.get("x-robots-tag")).toBeNull();
  });
});

describe("session hydration", () => {
  it("sets locals.user from a valid session", async () => {
    session = { user: USER, expiresAt: new Date(), refreshed: false };
    const { locals } = await run("/", { token: "t" });
    expect(locals.user).toEqual({
      id: "user_1",
      username: "mark",
      displayName: "Mark",
    });
  });

  /** AGENT §2 — nothing that feeds a template carries a password hash. */
  it("exposes only id, username and displayName", async () => {
    session = { user: USER, expiresAt: new Date(), refreshed: false };
    const { locals } = await run("/", { token: "t" });
    expect(Object.keys(locals.user as object).sort()).toEqual([
      "displayName",
      "id",
      "username",
    ]);
  });

  it("sets locals.user to null with no cookie", async () => {
    const { locals } = await run("/");
    expect(locals.user).toBeNull();
  });

  it("sets locals.user to null when the session is unknown", async () => {
    session = null;
    const { locals } = await run("/", { token: "bogus" });
    expect(locals.user).toBeNull();
  });

  /**
   * The acceptance criterion: an exception during resolution denies, never
   * defaults to allowing. Both the validate call and the cookie read are covered
   * — the cookie read is the one `validateSession`'s own try/catch cannot help
   * with.
   */
  it("fails closed when session validation throws", async () => {
    validateThrows = true;
    const { locals } = await run("/", { token: "t" });
    expect(locals.user).toBeNull();
  });

  it("fails closed when the cookie read throws", async () => {
    cookieReadThrows = true;
    const { locals } = await run("/", { token: "t" });
    expect(locals.user).toBeNull();
  });

  it("denies an admin page when resolution throws", async () => {
    validateThrows = true;
    const { response, nextCalled } = await run("/admin/projects", {
      token: "t",
    });
    expect(response.status).toBe(302);
    expect(nextCalled).toBe(false);
  });
});

describe("admin guard", () => {
  it("redirects an unauthenticated admin page with a next parameter", async () => {
    const { response, nextCalled } = await run("/admin/projects");
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "/admin/login?next=%2Fadmin%2Fprojects",
    );
    // The page is never rendered.
    expect(nextCalled).toBe(false);
  });

  it("preserves the query string in next", async () => {
    const { response } = await run("/admin/projects?page=2");
    expect(response.headers.get("Location")).toBe(
      "/admin/login?next=%2Fadmin%2Fprojects%3Fpage%3D2",
    );
  });

  it("does not guard the login page itself — that would loop", async () => {
    const { response, nextCalled } = await run("/admin/login");
    expect(response.status).toBe(200);
    expect(nextCalled).toBe(true);
  });

  it("lets a signed-in user through", async () => {
    session = { user: USER, expiresAt: new Date(), refreshed: false };
    const { response, nextCalled } = await run("/admin/projects", {
      token: "t",
    });
    expect(response.status).toBe(200);
    expect(nextCalled).toBe(true);
  });

  it.each(["/", "/work/a-project", "/administrators", "/admin-guide"])(
    "does not guard %s",
    async (path) => {
      const { response, nextCalled } = await run(path);
      expect(response.status).toBe(200);
      expect(nextCalled).toBe(true);
    },
  );

  /**
   * A fetch follows a 302 transparently and would then parse an HTML login page
   * as JSON — the caller sees a parse error rather than "you are signed out".
   */
  it("answers 401 JSON for an unauthenticated admin API, not a redirect", async () => {
    const { response, nextCalled } = await run("/api/admin/projects");
    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(await response.json()).toEqual({
      ok: false,
      error: "Not signed in.",
    });
    expect(nextCalled).toBe(false);
  });

  it("does not guard a non-admin api route", async () => {
    const { response, nextCalled } = await run("/api/contact");
    expect(response.status).toBe(200);
    expect(nextCalled).toBe(true);
  });
});

/**
 * The guard returns before `next()`, so an early return used to skip the header
 * block entirely — an admin redirect carried no `Cache-Control`, and a
 * heuristically cached 302 would keep bouncing a visitor to the login page after
 * they had signed in. Headers belong to the response, not to the happy path.
 */
describe("the guard's own responses carry the headers too", () => {
  it("the redirect is no-store and noindex", async () => {
    const { response } = await run("/admin/projects");
    expect(response.status).toBe(302);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("the redirect carries the standard security headers", async () => {
    const { response } = await run("/admin/projects");
    expect(response.headers.get("strict-transport-security")).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("the 401 is no-store and noindex", async () => {
    const { response } = await run("/api/admin/projects");
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });

  it("the unsafe-next redirect is no-store", async () => {
    const { response } = await run("/admin/login?next=https%3A%2F%2Fevil.test");
    expect(response.status).toBe(302);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

/**
 * SPEC §6 / §14 — the open-redirect defence. `safeNextPath` covers the shapes;
 * this covers the middleware actually applying it before any consumer sees the
 * value.
 */
describe("unsafe next is stripped before the login page sees it", () => {
  it.each([
    ["an absolute URL", "https://evil.test"],
    ["a protocol-relative URL", "//evil.test"],
    ["a backslash authority", "/\\evil.test"],
    ["a javascript URL", "javascript:alert(1)"],
  ])("redirects away from %s rather than following it", async (_l, next) => {
    const { response, nextCalled } = await run(
      `/admin/login?next=${encodeURIComponent(next)}`,
    );
    expect(response.status).toBe(302);
    const location = response.headers.get("Location") ?? "";
    expect(location).toBe("/admin/login");
    expect(location).not.toContain("evil.test");
    expect(nextCalled).toBe(false);
  });

  it("leaves a safe next alone", async () => {
    const { response, nextCalled } = await run(
      "/admin/login?next=%2Fadmin%2Fprojects",
    );
    expect(response.status).toBe(200);
    expect(nextCalled).toBe(true);
  });
});

/**
 * Sliding expiry only reaches the browser if the cookie is re-sent. Without it
 * the row's expiry extends server-side while the cookie keeps its original
 * Max-Age, and the session dies in the browser while the database still
 * believes it is alive.
 */
describe("sliding expiry re-sets the cookie", () => {
  it("re-sends the cookie when the session was refreshed", async () => {
    session = { user: USER, expiresAt: new Date(), refreshed: true };
    await run("/admin", { token: "tok" });
    expect(cookiesSet).toEqual([{ name: "__Host-session", value: "tok" }]);
  });

  it("does not touch the cookie when it was not refreshed", async () => {
    session = { user: USER, expiresAt: new Date(), refreshed: false };
    await run("/admin", { token: "tok" });
    expect(cookiesSet).toEqual([]);
  });
});
