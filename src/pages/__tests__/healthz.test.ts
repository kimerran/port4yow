import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "x".repeat(48);
Object.assign(process.env, {
  PUBLIC_SITE_URL: "http://localhost:4321",
  DATABASE_URL: "postgresql://a:b@localhost:5432/c",
  SESSION_SECRET: SECRET,
  FORM_SECRET: SECRET,
  IP_HASH_SALT: SECRET,
  S3_ENDPOINT: "http://localhost:9000",
  S3_BUCKET: "portfolio-media",
  S3_ACCESS_KEY_ID: "k",
  S3_SECRET_ACCESS_KEY: "s",
  CONTACT_TO_EMAIL: "a@b.com",
});

/**
 * `/healthz` has no integration coverage by design — the interesting case is a
 * database that is *unreachable*, and a suite that needs a live database cannot
 * exercise it. The pool is mocked instead, which is exactly the seam that
 * matters here.
 *
 * This file is worth more than its size suggests. `railway.json` sets
 * `restartPolicyType: ON_FAILURE` with 3 retries, so an uncaught throw in this
 * handler does not degrade the site — it **crash-loops** it. The guard below is
 * cheaper than finding that out in production.
 */
let probe: () => Promise<unknown> = () => Promise.resolve([{ "?column?": 1 }]);

vi.mock("../../lib/db.ts", () => ({
  db: {
    $queryRaw: () => probe(),
  },
}));

const errors: { message: string; context?: unknown }[] = [];
vi.mock("../../lib/logger.ts", () => ({
  logger: {
    error: (message: string, context?: unknown): void => {
      errors.push({ message, context });
    },
    info: (): void => undefined,
    warn: (): void => undefined,
  },
}));

const { GET } = await import("../healthz.ts");

const call = async (): Promise<{
  status: number;
  body: Record<string, unknown>;
  headers: Headers;
}> => {
  const response = await GET({
    request: new Request("https://mh.neri.ph/healthz"),
  } as Parameters<typeof GET>[0]);
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
    headers: response.headers,
  };
};

beforeEach(() => {
  probe = () => Promise.resolve([{ "?column?": 1 }]);
  errors.length = 0;
});

describe("GET /healthz — healthy", () => {
  it("returns 200 with the documented shape", async () => {
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.db).toBe("ok");
    expect(typeof body.uptime).toBe("number");
  });

  it("is never cached", async () => {
    // A cached health check is not a health check.
    expect((await call()).headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("GET /healthz — database unreachable", () => {
  /**
   * The shape Prisma actually produces when the server is gone. The host and
   * port in it are the reason this endpoint must not echo `cause.message`:
   * that string IS the connection detail SPEC §5 forbids returning.
   */
  const REAL_PRISMA_ERROR =
    "\nInvalid `prisma.$queryRaw()` invocation:\n\nRaw query failed. " +
    "Code: `N/A`. Message: `Can't reach database server at 127.0.0.1:55466`";

  beforeEach(() => {
    probe = () => Promise.reject(new Error(REAL_PRISMA_ERROR));
  });

  it("returns 503 rather than throwing", async () => {
    // Throwing would be a 500 from the framework — and with
    // restartPolicyType: ON_FAILURE, a handler that throws crash-loops the site.
    await expect(call()).resolves.toBeDefined();
    expect((await call()).status).toBe(503);
  });

  it("reports the failure in the documented shape", async () => {
    const { body } = await call();
    expect(body.status).toBe("error");
    expect(body.db).toBe("error");
    expect(typeof body.uptime).toBe("number");
  });

  /** The guarantee this endpoint exists to keep. */
  it("leaks nothing about the driver, host or port", async () => {
    const { body } = await call();
    const serialised = JSON.stringify(body);

    expect(serialised).not.toContain("127.0.0.1");
    expect(serialised).not.toContain("55466");
    expect(serialised.toLowerCase()).not.toContain("prisma");
    expect(serialised.toLowerCase()).not.toContain("postgres");
    expect(serialised).not.toContain("queryRaw");
  });

  it("returns exactly three keys, so a future field cannot leak by accident", async () => {
    const { body } = await call();
    expect(Object.keys(body).sort()).toEqual(["db", "status", "uptime"]);
  });

  /** The reason goes to the log — that is where it is useful and safe. */
  it("logs the reason it refused to return", async () => {
    await call();
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe("healthz: database unreachable");
    expect(JSON.stringify(errors[0]?.context)).toContain("127.0.0.1");
  });

  it("is never cached on the failure path either", async () => {
    expect((await call()).headers.get("Cache-Control")).toBe("no-store");
  });
});

/**
 * A black-holed network hangs rather than refusing, and an unbounded probe would
 * sit past Railway's `healthcheckTimeout: 30`. Bounding it means the answer
 * always comes from us.
 */
describe("GET /healthz — probe hangs", () => {
  it("gives up and returns 503 instead of hanging", async () => {
    vi.useFakeTimers();
    probe = () => new Promise(() => undefined);

    const pending = call();
    await vi.advanceTimersByTimeAsync(6_000);
    const { status, body } = await pending;

    expect(status).toBe(503);
    expect(body.db).toBe("error");
    vi.useRealTimers();
  });
});
