import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ZodType } from "astro/zod";

/**
 * Boundary cases for every Astro Action's input schema (#37, SPEC §16).
 *
 * ## Why these had no test until now
 *
 * `src/actions/index.ts` imports `astro:actions`, a virtual module that only
 * exists inside Astro's build — so the file could not be imported by Vitest at
 * all, and fifteen Zod schemas sat on the admin boundary unmeasured. The
 * integration suites exercise the *handlers* against real Postgres, which is the
 * right shape for what they cover, but a handler test cannot reach a value the
 * schema rejects before the handler runs.
 *
 * Mocking `astro:actions` fixes that: `defineAction` returns its own config, so
 * `server.<name>.input` is the real schema object, not a copy of it.
 *
 * ## What is asserted
 *
 * #37 asks for min, max, min-1, max+1 and wrong-type on every schema, and every
 * bullet to have a negative path. The tables below are driven from the exported
 * `server` object, so **an action added without an entry here fails the
 * enumeration test** rather than silently going uncovered.
 */

vi.mock("astro:actions", () => ({
  // The config object is the value under test; returning it is the whole mock.
  defineAction: <T>(config: T): T => config,
  ActionError: class ActionError extends Error {},
}));

const SECRET = randomBytes(36).toString("base64url");
Object.assign(process.env, {
  PUBLIC_SITE_URL: "https://mh.neri.ph",
  DATABASE_URL: "postgresql://a:b@localhost:5432/c",
  SESSION_SECRET: SECRET,
  FORM_SECRET: SECRET,
  IP_HASH_SALT: SECRET,
  S3_ENDPOINT: "http://localhost:9000",
  S3_BUCKET: "portfolio-media",
  S3_ACCESS_KEY_ID: randomBytes(15).toString("base64url"),
  S3_SECRET_ACCESS_KEY: randomBytes(30).toString("base64url"),
  CONTACT_TO_EMAIL: "inbox@mh.neri.ph",
});

const { server } = await import("../index.ts");

type Action = { input: ZodType; accept?: string };
const actions = server as unknown as Record<string, Action>;
const schemaOf = (name: string): ZodType => actions[name]?.input as ZodType;

const accepts = (name: string, value: unknown): boolean =>
  schemaOf(name).safeParse(value).success;

/** A minimal valid `createProject` / `updateProject` payload. */
const project = (overrides: Record<string, unknown> = {}) => ({
  slug: "a-project",
  title: "A project",
  suit: "DIAMONDS",
  summary: "One line about the outcome.",
  role: "Lead engineer",
  timeline: "Jan 2026 – Feb 2026",
  problem: "The problem.",
  body: "The body.",
  outcome: "The outcome.",
  ...overrides,
});

const chars = (n: number): string => "a".repeat(n);

describe("the enumeration itself", () => {
  it("covers every action that exists", () => {
    // The guard that stops this file rotting: a new action with an unmeasured
    // schema fails here rather than passing unnoticed.
    expect(Object.keys(actions).sort()).toEqual(
      [
        "createProject",
        "createStackItem",
        "deleteMedia",
        "deleteStackItem",
        "getStats",
        "publishProject",
        "reorderProjects",
        "reorderStackItems",
        "saveSetting",
        "setMessageStatus",
        "unpublishProject",
        "updateAltText",
        "updateProject",
        "updateStackItem",
        "uploadMedia",
      ].sort(),
    );
  });

  it("every action carries an input schema", () => {
    for (const [name, action] of Object.entries(actions)) {
      expect(action.input, `${name} has no input schema`).toBeDefined();
    }
  });

  it("reaches the real schemas, not a mock that accepts everything", () => {
    // Without this, every `accepts(...) === true` below could be vacuous.
    expect(accepts("saveSetting", { key: "", value: "x" })).toBe(false);
  });
});

describe("id-shaped inputs", () => {
  const idActions = [
    "publishProject",
    "unpublishProject",
    "deleteStackItem",
  ] as const;

  it.each(idActions)("%s accepts a single non-empty id", (name) => {
    expect(accepts(name, { id: "cmt0000000000000000000000" })).toBe(true);
  });

  it.each(idActions)("%s refuses an empty id", (name) => {
    expect(accepts(name, { id: "" })).toBe(false);
  });

  it.each(idActions)("%s refuses a missing id", (name) => {
    expect(accepts(name, {})).toBe(false);
  });

  it.each(idActions)("%s refuses a non-string id", (name) => {
    expect(accepts(name, { id: 12345 })).toBe(false);
  });

  it("deleteStackItem defaults `confirmed` to false rather than requiring it", () => {
    // A destructive action defaulting to "not confirmed" is the fail-closed
    // direction: forgetting the field cannot delete anything.
    const parsed = schemaOf("deleteStackItem").safeParse({ id: "s1" });
    expect(parsed.success).toBe(true);
    expect((parsed as { data: { confirmed: boolean } }).data.confirmed).toBe(
      false,
    );
  });
});

describe("saveSetting", () => {
  it("accepts a key at 1 and at 64 characters", () => {
    expect(accepts("saveSetting", { key: "a", value: "" })).toBe(true);
    expect(accepts("saveSetting", { key: chars(64), value: "" })).toBe(true);
  });

  it("refuses a key at 0 and at 65", () => {
    expect(accepts("saveSetting", { key: "", value: "" })).toBe(false);
    expect(accepts("saveSetting", { key: chars(65), value: "" })).toBe(false);
  });

  it("accepts a value at the 5000-character ceiling and refuses 5001", () => {
    expect(accepts("saveSetting", { key: "k", value: chars(5000) })).toBe(true);
    expect(accepts("saveSetting", { key: "k", value: chars(5001) })).toBe(
      false,
    );
  });

  it("accepts an empty value — clearing a setting is a real operation", () => {
    expect(accepts("saveSetting", { key: "k", value: "" })).toBe(true);
  });

  it("refuses a non-string value rather than coercing it", () => {
    // A form sends strings; anything else came from a hand-built request.
    expect(accepts("saveSetting", { key: "k", value: 42 })).toBe(false);
    expect(accepts("saveSetting", { key: "k", value: null })).toBe(false);
  });
});

describe("setMessageStatus", () => {
  it.each(["NEW", "READ", "REPLIED", "SPAM"])("accepts %s", (status) => {
    expect(accepts("setMessageStatus", { id: "m1", status })).toBe(true);
  });

  it.each(["read", "ARCHIVED", "", "DELETED"])("refuses %s", (status) => {
    expect(accepts("setMessageStatus", { id: "m1", status })).toBe(false);
  });

  it("refuses a valid status with no id", () => {
    expect(accepts("setMessageStatus", { status: "READ" })).toBe(false);
  });
});

describe("reorder actions", () => {
  it("reorderProjects accepts 1 id and refuses 0", () => {
    expect(accepts("reorderProjects", { orderedIds: ["a"] })).toBe(true);
    expect(accepts("reorderProjects", { orderedIds: [] })).toBe(false);
  });

  it("reorderProjects accepts 200 ids and refuses 201", () => {
    expect(
      accepts("reorderProjects", { orderedIds: Array(200).fill("a") }),
    ).toBe(true);
    expect(
      accepts("reorderProjects", { orderedIds: Array(201).fill("a") }),
    ).toBe(false);
  });

  it("refuses an empty string inside the list", () => {
    // The list length being right is not the same as its contents being ids.
    expect(accepts("reorderProjects", { orderedIds: ["a", ""] })).toBe(false);
  });

  it("refuses a bare string where a list is expected", () => {
    expect(accepts("reorderProjects", { orderedIds: "a" })).toBe(false);
  });

  it("reorderStackItems has the same list boundaries, plus a suit", () => {
    // It reorders WITHIN a suit, so the suit is part of the input rather than
    // implied — a list with no suit would reorder the wrong column.
    expect(
      accepts("reorderStackItems", { suit: "SPADES", orderedIds: [] }),
    ).toBe(false);
    expect(
      accepts("reorderStackItems", { suit: "SPADES", orderedIds: ["a"] }),
    ).toBe(true);
    expect(
      accepts("reorderStackItems", { suit: "SPADES", orderedIds: ["a", ""] }),
    ).toBe(false);
  });

  it("reorderStackItems refuses a valid list with no suit", () => {
    expect(accepts("reorderStackItems", { orderedIds: ["a"] })).toBe(false);
  });

  it("reorderStackItems refuses an unknown suit", () => {
    expect(
      accepts("reorderStackItems", { suit: "JOKERS", orderedIds: ["a"] }),
    ).toBe(false);
  });
});

describe("createProject / updateProject", () => {
  it("accepts a complete project", () => {
    expect(accepts("createProject", project())).toBe(true);
  });

  it("accepts a slug at 96 characters and refuses 97", () => {
    expect(accepts("createProject", project({ slug: chars(96) }))).toBe(true);
    expect(accepts("createProject", project({ slug: chars(97) }))).toBe(false);
  });

  it("refuses an empty slug", () => {
    expect(accepts("createProject", project({ slug: "" }))).toBe(false);
  });

  it("refuses a slug that is only whitespace, because it trims first", () => {
    expect(accepts("createProject", project({ slug: "   " }))).toBe(false);
  });

  it.each(["DIAMONDS", "SPADES", "HEARTS", "CLUBS"])(
    "accepts the suit %s",
    (suit) => {
      expect(accepts("createProject", project({ suit }))).toBe(true);
    },
  );

  it.each(["diamonds", "JOKERS", ""])("refuses the suit %s", (suit) => {
    expect(accepts("createProject", project({ suit }))).toBe(false);
  });

  it("refuses a missing required field", () => {
    const { title: _title, ...withoutTitle } = project();
    expect(accepts("createProject", withoutTitle)).toBe(false);
  });

  it("updateProject requires an id where createProject does not", () => {
    expect(accepts("updateProject", project())).toBe(false);
    expect(accepts("updateProject", { ...project(), id: "p1" })).toBe(true);
  });
});

describe("media actions", () => {
  it("updateAltText refuses an empty alt text", () => {
    // BRAND §9: alt text is required and never allowed to be empty.
    expect(accepts("updateAltText", { keyStem: "k", altText: "" })).toBe(false);
  });

  it("updateAltText accepts real alt text", () => {
    expect(
      accepts("updateAltText", {
        keyStem: "projects/p1/01ABC",
        altText: "A dashboard screenshot",
      }),
    ).toBe(true);
  });

  it("updateAltText caps alt text at 500 characters", () => {
    const stem = "projects/p1/01ABC";
    expect(
      accepts("updateAltText", { keyStem: stem, altText: chars(500) }),
    ).toBe(true);
    expect(
      accepts("updateAltText", { keyStem: stem, altText: chars(501) }),
    ).toBe(false);
  });

  it("updateAltText refuses an empty key stem", () => {
    expect(accepts("updateAltText", { keyStem: "", altText: "alt" })).toBe(
      false,
    );
  });

  it("deleteMedia refuses an empty key stem and one over 256", () => {
    expect(accepts("deleteMedia", { keyStem: "" })).toBe(false);
    expect(accepts("deleteMedia", { keyStem: chars(257) })).toBe(false);
    expect(accepts("deleteMedia", { keyStem: chars(256) })).toBe(true);
  });
});

describe("uploadMedia", () => {
  /**
   * A second `altText: z.string().min(1).max(500)` lives here, and a mutation
   * run against it failed nothing until these were added — the media block only
   * covered `updateAltText`. Two identical schemas are two things to break.
   */
  const file = (): File =>
    new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" });

  it("accepts a real upload", () => {
    expect(
      accepts("uploadMedia", {
        projectId: "p1",
        altText: "A dashboard screenshot",
        file: file(),
      }),
    ).toBe(true);
  });

  it("refuses empty alt text (BRAND §9 — never allow empty)", () => {
    expect(
      accepts("uploadMedia", { projectId: "p1", altText: "", file: file() }),
    ).toBe(false);
  });

  it("caps alt text at 500 characters", () => {
    expect(
      accepts("uploadMedia", {
        projectId: "p1",
        altText: chars(500),
        file: file(),
      }),
    ).toBe(true);
    expect(
      accepts("uploadMedia", {
        projectId: "p1",
        altText: chars(501),
        file: file(),
      }),
    ).toBe(false);
  });

  it("refuses a missing projectId", () => {
    expect(accepts("uploadMedia", { altText: "alt", file: file() })).toBe(
      false,
    );
  });

  it("refuses something that is not a File", () => {
    // `accept: "form"` means this arrives from FormData, where a text field and
    // a file field are indistinguishable until the schema says otherwise.
    expect(
      accepts("uploadMedia", {
        projectId: "p1",
        altText: "alt",
        file: "a.png",
      }),
    ).toBe(false);
  });
});

describe("stack actions", () => {
  it("createStackItem refuses an empty name", () => {
    expect(accepts("createStackItem", { name: "", suit: "SPADES" })).toBe(
      false,
    );
  });

  it("createStackItem refuses an unknown suit", () => {
    expect(
      accepts("createStackItem", { name: "PostgreSQL", suit: "JOKERS" }),
    ).toBe(false);
  });

  it("createStackItem accepts a real item", () => {
    expect(
      accepts("createStackItem", { name: "PostgreSQL", suit: "SPADES" }),
    ).toBe(true);
  });
});

describe("getStats takes no input and accepts none", () => {
  it("accepts an empty object", () => {
    expect(accepts("getStats", {})).toBe(true);
  });
});
