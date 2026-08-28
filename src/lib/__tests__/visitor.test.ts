import { describe, expect, it } from "vitest";
import { factsFrom, VisitorSchema } from "../visitor";

/**
 * The gate's payload and the email it becomes.
 *
 * Worth testing as units because both are pure and both handle input a stranger
 * chose: the referrer and the user-agent arrive from the browser and end up
 * rendered in the owner's mail client.
 */

/**
 * `../mail` reaches `env`, which parses `process.env` at module load and throws
 * on anything missing — correct for a server that must die at boot rather than
 * serve without a secret, and the reason the import below is dynamic. These are
 * fixture values with no meaning beyond satisfying the shape.
 */
const SECRET = "x".repeat(48);
Object.assign(process.env, {
  PUBLIC_SITE_URL: "http://localhost:4321",
  FORM_SECRET: SECRET,
  IP_HASH_SALT: SECRET,
  CONTACT_TO_EMAIL: "inbox@example.test",
});

const { renderVisitAlert } = await import("../mail");

const base = { email: "someone@example.test" };

describe("VisitorSchema", () => {
  it("accepts the minimum: an email and nothing else", () => {
    const parsed = VisitorSchema.safeParse(base);
    expect(parsed.success).toBe(true);
  });

  it("rejects a malformed address", () => {
    const parsed = VisitorSchema.safeParse({ email: "not-an-email" });
    expect(parsed.success).toBe(false);
  });

  it("caps each fact, so one field cannot become the whole email", () => {
    const parsed = VisitorSchema.safeParse({
      ...base,
      referrer: "x".repeat(401),
    });
    expect(parsed.success).toBe(false);
  });

  it("drops unknown keys rather than reporting them", () => {
    /**
     * The allowlist is the point: without it the owner's inbox renders whatever
     * key names a caller invents. Zod strips unknown keys by default, and this
     * pins that default rather than trusting it.
     */
    const parsed = VisitorSchema.safeParse({
      ...base,
      creditCard: "4111111111111111",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && "creditCard" in parsed.data).toBe(false);
  });
});

describe("factsFrom", () => {
  const server = { ipHash: "a".repeat(64), at: "2026-08-28T00:00:00.000Z" };

  it("omits fields the browser could not supply", () => {
    const facts = factsFrom({ ...base, referrer: "" }, server);
    // A direct visit genuinely has no referrer; "Referrer: (empty)" is noise.
    expect(facts).not.toHaveProperty("Referrer");
  });

  it("truncates the IP hash and never exposes an address", () => {
    const facts = factsFrom(base, server);
    const value = facts["Visitor (hashed IP)"];
    expect(value).toBe(`${"a".repeat(12)}…`);
    expect(value).not.toContain(server.ipHash);
  });

  it("keeps a stable field order", () => {
    // These become an email read dozens of times; scanning is faster when the
    // fields do not move.
    const facts = factsFrom(
      { ...base, path: "/", referrer: "https://x.test/", timezone: "UTC" },
      server,
    );
    expect(Object.keys(facts)).toEqual([
      "Page",
      "Referrer",
      "Time",
      "Timezone",
      "Visitor (hashed IP)",
    ]);
  });
});

describe("renderVisitAlert", () => {
  const server = { ipHash: "b".repeat(64), at: "2026-08-28T00:00:00.000Z" };

  it("escapes browser-supplied values in the HTML part", () => {
    /**
     * The referrer is chosen by whoever links to the site. Unescaped, it is a
     * script tag rendered in the owner's mail client — the one place on this
     * project where the attacker's target is the operator rather than a visitor.
     */
    const rendered = renderVisitAlert({
      messageId: "corr-1",
      kind: "visit",
      email: "someone@example.test",
      facts: factsFrom(
        { ...base, referrer: "<script>alert(1)</script>" },
        server,
      ),
    });

    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).toContain("&lt;script&gt;");
  });

  it("escapes the address in the subject line and body", () => {
    const rendered = renderVisitAlert({
      messageId: "corr-2",
      kind: "resume",
      email: "a@b.test",
      name: "<img src=x onerror=1>",
      facts: {},
    });

    expect(rendered.html).not.toContain("<img");
    expect(rendered.subject).toContain("Resume downloaded");
  });

  it("distinguishes a visit from a download in the subject", () => {
    const visit = renderVisitAlert({
      messageId: "1",
      kind: "visit",
      email: "a@b.test",
      facts: {},
    });
    const resume = renderVisitAlert({
      messageId: "2",
      kind: "resume",
      email: "a@b.test",
      facts: {},
    });

    // They land in the same inbox; an identical subject makes them one thread.
    expect(visit.subject).not.toBe(resume.subject);
  });
});
