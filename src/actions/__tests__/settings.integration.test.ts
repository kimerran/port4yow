import { randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The four setting actions against real Postgres (#82).
 *
 * ## Why these exist, and what the schema tests could not see
 *
 * `schemas.test.ts` covers the inputs. It cannot cover the two things #82 is
 * actually about, and mutation testing proved it: rewiring `saveGithubUrl` to
 * write `social.linkedin`, and reverting `persistSetting` to return
 * `{ ok: false }` instead of throwing, both left the whole unit suite green.
 *
 * The first is a wiring bug that silently saves to the wrong setting. The
 * second **is the defect this issue exists to fix** — a domain refusal
 * answering HTTP 200. Neither is visible from an input schema, so both are
 * asserted here against the handler and the row it writes.
 */
const enabled =
  process.env.SETTINGS_IT === "1" && Boolean(process.env.DATABASE_URL);

/** The config object is the value under test; returning it is the whole mock. */
vi.mock("astro:actions", () => ({
  defineAction: <T>(config: T): T => config,
  ActionError: class ActionError extends Error {
    code: string;
    constructor({ code, message }: { code: string; message: string }) {
      super(message);
      this.name = "ActionError";
      this.code = code;
    }
  },
}));

const SECRET = randomBytes(36).toString("base64url");
Object.assign(process.env, {
  PUBLIC_SITE_URL: "https://mh.neri.ph",
  SESSION_SECRET: SECRET,
  FORM_SECRET: SECRET,
  IP_HASH_SALT: SECRET,
  S3_ENDPOINT: "http://localhost:9000",
  S3_BUCKET: "portfolio-media",
  S3_ACCESS_KEY_ID: "minioadmin",
  S3_SECRET_ACCESS_KEY: "minioadmin",
  CONTACT_TO_EMAIL: "inbox@mh.neri.ph",
});

interface SettingAction {
  handler: (
    input: { value: string },
    context: { request: Request; locals: unknown },
  ) => Promise<{ ok: true }>;
}

describe.skipIf(!enabled)("the four setting actions", () => {
  let actions: Record<string, SettingAction>;
  let db: typeof import("../../lib/db.ts").db;

  /** Same-origin and signed in, so `requireAdmin` lets the handler run. */
  const context = {
    request: new Request("https://mh.neri.ph/_actions/x", {
      method: "POST",
      headers: { Origin: "https://mh.neri.ph" },
    }),
    locals: {
      user: {
        id: "u1",
        username: "admin",
        displayName: "Admin",
        role: "ADMIN",
      },
    },
  };

  const SETTING_ACTIONS = [
    "saveHeroThesis",
    "saveAboutBody",
    "saveGithubUrl",
    "saveLinkedinUrl",
  ] as const;

  beforeEach(async () => {
    const mod = (await import("../index.ts")) as unknown as {
      server: Record<string, SettingAction>;
    };
    actions = mod.server;
    ({ db } = await import("../../lib/db.ts"));
    await db.siteSetting.deleteMany({});
  });

  afterAll(async () => {
    await db.siteSetting.deleteMany({});
    await db.$disconnect();
  });

  it.each([
    ["saveHeroThesis", "hero.thesis", "A plain, specific sentence."],
    ["saveAboutBody", "about.body", "Lead engineer. Ships and maintains."],
    ["saveGithubUrl", "social.github", "https://github.com/kimerran"],
    ["saveLinkedinUrl", "social.linkedin", "https://www.linkedin.com/in/x"],
  ])("%s writes %s and nothing else", async (name, key, value) => {
    await actions[name]?.handler({ value }, context);

    const rows = await db.siteSetting.findMany({
      select: { key: true, value: true },
    });
    // Exactly one row, under exactly the right key. Rewiring an action to a
    // different key fails here — the mutation that the schema tests missed.
    expect(rows.map((r) => r.key)).toEqual([key]);
    expect(rows[0]?.value).toBe(value);
  });

  /**
   * The defect #82 is named for. A refusal must **throw** a `BAD_REQUEST`
   * `ActionError` — which Astro renders as HTTP 400 — rather than returning a
   * value with `ok: false`, which answers 200.
   */
  it.each([
    ["saveGithubUrl", "javascript:alert(1)", "Use a full https:// URL."],
    ["saveGithubUrl", "http://github.com/x", "Use a full https:// URL."],
    ["saveGithubUrl", "//github.com/x", "That does not look like a full URL."],
    ["saveLinkedinUrl", "https://evil.example/x", "should point at"],
    ["saveHeroThesis", "x".repeat(250), "Hero thesis holds 220"],
  ])(
    "%s refuses %j by throwing, not by returning",
    async (name, value, expected) => {
      const refusal = actions[name]?.handler({ value }, context);
      await expect(refusal).rejects.toMatchObject({
        name: "ActionError",
        code: "BAD_REQUEST",
      });
      await expect(refusal).rejects.toThrow(expected);

      // And nothing was written.
      expect(await db.siteSetting.count()).toBe(0);
    },
  );

  it("a refused write leaves the previous value intact", async () => {
    await actions["saveGithubUrl"]?.handler(
      { value: "https://github.com/kimerran" },
      context,
    );
    await expect(
      actions["saveGithubUrl"]?.handler(
        { value: "https://evil.example/x" },
        context,
      ),
    ).rejects.toThrow();

    const row = await db.siteSetting.findUnique({
      where: { key: "social.github" },
    });
    expect(row?.value).toBe("https://github.com/kimerran");
  });

  it("every action refuses a cross-origin caller", async () => {
    const crossSite = {
      ...context,
      request: new Request("https://mh.neri.ph/_actions/x", {
        method: "POST",
        headers: { Origin: "https://evil.example" },
      }),
    };
    for (const name of SETTING_ACTIONS) {
      // No `continue` guard: a name that does not resolve must fail loudly
      // rather than skip. An earlier draft had a typo'd name here and the loop
      // quietly covered three actions instead of four.
      expect(actions[name], `${name} is missing`).toBeDefined();
      await expect(
        actions[name]?.handler({ value: "x" }, crossSite),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
});
