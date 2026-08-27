import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

/**
 * `ContactSchema` at its boundaries (#37, SPEC §16).
 *
 * `contact.integration.test.ts` covers the route end to end and has one case for
 * "validation failure returns a field-keyed 400" — which is the right shape for
 * a route test and the wrong place to enumerate boundaries. A handler test
 * cannot reach a value the schema rejects before the handler runs, so min-1 and
 * max+1 on each field are only observable from here.
 *
 * This is the only public, unauthenticated write surface on the site, which is
 * why its boundaries are worth stating rather than assuming.
 */

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

const { ContactSchema } = await import("../contact.ts");

const chars = (n: number): string => "a".repeat(n);

const valid = (overrides: Record<string, unknown> = {}) => ({
  name: "Visitor",
  email: "visitor@example.test",
  message: chars(20),
  ...overrides,
});

const accepts = (value: unknown): boolean =>
  ContactSchema.safeParse(value).success;

const errorFor = (value: unknown, field: string): string | undefined =>
  ContactSchema.safeParse(value).error?.issues.find((i) => i.path[0] === field)
    ?.message;

describe("the fixture parses", () => {
  it("so a rejection below is about the override", () => {
    expect(accepts(valid())).toBe(true);
  });
});

describe("name", () => {
  it("accepts exactly 2 characters and refuses 1", () => {
    expect(accepts(valid({ name: "Jo" }))).toBe(true);
    expect(accepts(valid({ name: "J" }))).toBe(false);
  });

  it("accepts exactly 120 and refuses 121", () => {
    expect(accepts(valid({ name: chars(120) }))).toBe(true);
    expect(accepts(valid({ name: chars(121) }))).toBe(false);
  });

  it("trims before measuring, so padding cannot buy length", () => {
    expect(accepts(valid({ name: " J " }))).toBe(false);
    expect(accepts(valid({ name: "                 " }))).toBe(false);
  });

  it("refuses a missing name and a non-string one", () => {
    expect(accepts({ email: "a@b.test", message: chars(20) })).toBe(false);
    expect(accepts(valid({ name: 42 }))).toBe(false);
  });

  it("says what to do, in the interface's voice (BRAND §8)", () => {
    expect(errorFor(valid({ name: "J" }), "name")).toBe(
      "Tell me what to call you.",
    );
  });
});

describe("email", () => {
  it.each([
    "visitor@example.test",
    "first.last+tag@sub.example.test",
    "a@b.co",
  ])("accepts %s", (email) => {
    expect(accepts(valid({ email }))).toBe(true);
  });

  it.each([
    "visitor",
    "visitor@",
    "@example.test",
    "visitor@localhost",
    "visitor example@test.com",
    "",
  ])("refuses %s", (email) => {
    expect(accepts(valid({ email }))).toBe(false);
  });

  it("refuses one over 255 characters even though the shape is valid", () => {
    const long = `${chars(250)}@example.test`;
    expect(long.length).toBeGreaterThan(255);
    expect(accepts(valid({ email: long }))).toBe(false);
  });

  it("names the problem without echoing the address", () => {
    const message = errorFor(valid({ email: "visitor@" }), "email");
    expect(message).toBe("That email address looks incomplete.");
    expect(message).not.toContain("visitor");
  });
});

describe("message", () => {
  it("accepts exactly 20 characters and refuses 19", () => {
    expect(accepts(valid({ message: chars(20) }))).toBe(true);
    expect(accepts(valid({ message: chars(19) }))).toBe(false);
  });

  it("accepts exactly 5000 and refuses 5001", () => {
    expect(accepts(valid({ message: chars(5000) }))).toBe(true);
    expect(accepts(valid({ message: chars(5001) }))).toBe(false);
  });

  it("trims before measuring", () => {
    expect(accepts(valid({ message: `${chars(19)}          ` }))).toBe(false);
  });

  it("asks for more rather than scolding (BRAND §8)", () => {
    expect(errorFor(valid({ message: "too short" }), "message")).toBe(
      "A couple more sentences would help.",
    );
  });
});

describe("the honeypot and the timestamp are optional to the schema", () => {
  /**
   * Both are spam signals handled by the route, not validation errors. If
   * `company` were required-empty here, a bot filling it would get a 400 naming
   * the hidden field — which tells it exactly what to stop filling in. The
   * route's indistinguishable-200 depends on these staying optional.
   */
  it("accepts a submission with neither", () => {
    expect(accepts(valid())).toBe(true);
  });

  it("accepts a filled honeypot rather than rejecting it", () => {
    expect(accepts(valid({ company: "Acme Inc" }))).toBe(true);
  });

  it("accepts a missing renderedAt rather than rejecting it", () => {
    expect(accepts(valid({ renderedAt: undefined }))).toBe(true);
  });
});

describe("unknown fields are dropped, not trusted", () => {
  it("does not carry an injected field into the parsed value", () => {
    const parsed = ContactSchema.safeParse(valid({ status: "REPLIED" }));
    expect(parsed.success).toBe(true);
    expect(parsed.data).not.toHaveProperty("status");
  });
});
