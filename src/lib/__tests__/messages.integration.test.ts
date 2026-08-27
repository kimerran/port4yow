import { afterAll, beforeEach, describe, expect, it } from "vitest";

/**
 * The inbox against real Postgres (#30).
 *
 * The acceptance criteria are about what the public pipeline actually produces —
 * a real submission, a real honeypot rejection, a real send failure — so these
 * drive `POST /api/contact` rather than inserting rows by hand. A hand-made row
 * would test the inbox against my idea of what #22 writes rather than what it
 * writes.
 */
const enabled =
  process.env.MESSAGES_IT === "1" && Boolean(process.env.DATABASE_URL);

const SECRET = "x".repeat(48);
const SITE = "http://localhost:4321";
Object.assign(process.env, {
  PUBLIC_SITE_URL: SITE,
  SESSION_SECRET: SECRET,
  FORM_SECRET: SECRET,
  IP_HASH_SALT: SECRET,
  S3_ENDPOINT: "http://localhost:9000",
  S3_BUCKET: "portfolio-media",
  S3_ACCESS_KEY_ID: "minioadmin",
  S3_SECRET_ACCESS_KEY: "minioadmin",
  CONTACT_TO_EMAIL: "inbox@mh.neri.ph",
  RESEND_ENABLED: "false",
  SMTP_URL: "smtp://localhost:1025",
});

describe.skipIf(!enabled)("contact inbox", () => {
  let messages: typeof import("../messages");
  let db: typeof import("../db").db;
  let POST: typeof import("../../pages/api/contact").POST;
  let createFormToken: typeof import("../formToken").createFormToken;

  const submit = async (
    over: Record<string, string> = {},
    ip = "203.0.113.5",
  ): Promise<Response> => {
    const fields = {
      name: "Ada Lovelace",
      email: "ada@example.com",
      message: "This message is comfortably longer than twenty characters.",
      renderedAt: createFormToken(Date.now() - 10_000),
      ...over,
    };
    const request = new Request(`${SITE}/api/contact`, {
      method: "POST",
      headers: {
        Origin: SITE,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "vitest",
      },
      body: new URLSearchParams(fields).toString(),
    });
    return POST({ request, clientAddress: ip } as Parameters<typeof POST>[0]);
  };

  beforeEach(async () => {
    messages = await import("../messages");
    ({ db } = await import("../db"));
    ({ POST } = await import("../../pages/api/contact"));
    ({ createFormToken } = await import("../formToken"));

    await db.contactMessage.deleteMany({});
    await db.rateLimit.deleteMany({
      where: { key: { startsWith: "contact:" } },
    });
    await fetch("http://localhost:8025/api/v1/messages", { method: "DELETE" });
  });

  afterAll(async () => {
    await db.contactMessage.deleteMany({});
    await db.$disconnect();
  });

  /** #30's first criterion, driven through the real public pipeline. */
  it("a real submission appears with status NEW and delivered", async () => {
    expect((await submit()).status).toBe(200);

    const [received] = await messages.listMessages();
    expect(received).toBeDefined();
    if (!received) return;

    expect(received.status).toBe("NEW");
    expect(received.name).toBe("Ada Lovelace");
    expect(received.deliveredAt).not.toBeNull();
    expect(messages.isUndelivered(received)).toBe(false);
  });

  it("a honeypot submission appears as SPAM with no email sent", async () => {
    expect((await submit({ company: "Acme" })).status).toBe(200);

    const [spam] = await messages.listMessages();
    expect(spam).toBeDefined();
    if (!spam) return;
    expect(spam.status).toBe("SPAM");
    expect(spam.deliveredAt).toBeNull();

    const mailpit = (await (
      await fetch("http://localhost:8025/api/v1/messages")
    ).json()) as { total: number };
    expect(mailpit.total).toBe(0);

    // Not flagged undelivered: no mail was ever attempted for it.
    expect(messages.isUndelivered(spam)).toBe(false);
  });

  /** #30's third criterion — the case #22 deliberately answers 200 for. */
  it("a message whose send failed is visibly undelivered", async () => {
    await db.contactMessage.deleteMany({});
    process.env.SMTP_URL = "smtp://localhost:1";
    const { vi } = await import("vitest");
    vi.resetModules();

    const { POST: freshPost } = await import("../../pages/api/contact");
    const { createFormToken: freshToken } = await import("../formToken");
    const request = new Request(`${SITE}/api/contact`, {
      method: "POST",
      headers: {
        Origin: SITE,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        name: "Grace",
        email: "grace@example.com",
        message: "This message is comfortably longer than twenty characters.",
        renderedAt: freshToken(Date.now() - 10_000),
      }).toString(),
    });
    const response = await freshPost({
      request,
      clientAddress: "203.0.113.9",
    } as Parameters<typeof POST>[0]);

    // The visitor is still told it worked, because it was stored.
    expect(response.status).toBe(200);

    const { db: db2 } = await import("../db");
    const { isUndelivered } = await import("../messages");
    const [stored] = await db2.contactMessage.findMany();
    expect(stored).toBeDefined();
    if (!stored) return;
    expect(stored.deliveredAt).toBeNull();
    expect(stored.status).toBe("NEW");
    expect(isUndelivered(stored)).toBe(true);

    process.env.SMTP_URL = "smtp://localhost:1025";
    vi.resetModules();
  });

  it("stores an HTML body verbatim, so escaping is the renderer's job", async () => {
    const hostile = "<script>alert(1)</script> and <b>bold</b> text here.";
    expect((await submit({ message: hostile })).status).toBe(200);

    const [stored] = await messages.listMessages();
    expect(stored).toBeDefined();
    // Stored exactly as sent — nothing is stripped on the way in, which is why
    // the templates must escape on the way out (they do; Astro escapes an
    // expression by default and neither page uses set:html).
    expect(stored?.message).toBe(hostile);
  });

  describe("filtering and counts", () => {
    it("filters by status and counts each bucket", async () => {
      await submit({}, "203.0.113.11");
      await submit({ company: "Acme" }, "203.0.113.12");
      await submit({}, "203.0.113.13");

      const counts = await messages.statusCounts();
      expect(counts.all).toBe(3);
      expect(counts.NEW).toBe(2);
      expect(counts.SPAM).toBe(1);
      // Spam is excluded, and the two real ones were delivered.
      expect(counts.undelivered).toBe(0);

      expect(await messages.listMessages({ status: "SPAM" })).toHaveLength(1);
      expect(await messages.listMessages({ status: "NEW" })).toHaveLength(2);
    });

    it("orders newest first", async () => {
      await submit({ name: "First" }, "203.0.113.21");
      await new Promise((resolve) => setTimeout(resolve, 20));
      await submit({ name: "Second" }, "203.0.113.22");

      const inbox = await messages.listMessages();
      expect(inbox.map((m) => m.name)).toEqual(["Second", "First"]);
    });
  });

  describe("triage", () => {
    it("moves a message between statuses", async () => {
      await submit();
      const [message] = await messages.listMessages();
      expect(message).toBeDefined();
      if (!message) return;

      await messages.setMessageStatus(message.id, "READ");
      expect((await messages.getMessage(message.id))?.status).toBe("READ");

      await messages.setMessageStatus(message.id, "REPLIED");
      expect((await messages.getMessage(message.id))?.status).toBe("REPLIED");
    });

    it("refuses an unknown id", async () => {
      await expect(
        messages.setMessageStatus("no-such-id", "READ"),
      ).rejects.toThrow(messages.MessageNotFound);
    });

    /**
     * SPEC §14.10 keeps a salted hash so it can be compared, not displayed. A
     * value on a screen is a value in a screenshot, so nothing the inbox reads
     * selects it.
     */
    it("never selects ipHash into anything the inbox renders", async () => {
      await submit();
      const [row] = await messages.listMessages();
      expect(row).toBeDefined();
      if (!row) return;

      expect("ipHash" in row).toBe(false);

      const detail = await messages.getMessage(row.id);
      expect(detail).not.toBeNull();
      if (!detail) return;
      expect("ipHash" in detail).toBe(false);
    });
  });
});
