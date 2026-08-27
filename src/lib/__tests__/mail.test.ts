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
  CONTACT_TO_EMAIL: "inbox@mh.neri.ph",
  RESEND_ENABLED: "false",
  SMTP_URL: "smtp://localhost:1025",
});

/**
 * A one-row stand-in for `ContactMessage`. The mock implements BOTH methods the
 * wrapper uses: `findUnique` is the idempotency read, `update` is the write. An
 * earlier version had only `findUnique`, and because `recordSent` swallows its
 * own failures the missing method was invisible — every test passed while the
 * write silently did nothing. `updateFails` exists to drive that path
 * deliberately instead of by accident.
 */
let existingRow: { resendId: string | null } | null = null;
let updateFails = false;
const updates: { id: string; resendId: string }[] = [];

vi.mock("../db", () => ({
  db: {
    contactMessage: {
      findUnique: () => Promise.resolve(existingRow),
      update: ({
        where,
        data,
      }: {
        where: { id: string };
        data: { resendId: string; deliveredAt: Date };
      }) => {
        if (updateFails) return Promise.reject(new Error("row not found"));
        updates.push({ id: where.id, resendId: data.resendId });
        // Persisted for real: a later findUnique in the same test sees it.
        existingRow = { resendId: data.resendId };
        return Promise.resolve({});
      },
    },
  },
}));

const sendMail = vi.fn();
vi.mock("nodemailer", () => ({
  createTransport: vi.fn(() => ({
    sendMail: (opts: unknown) => sendMail(opts) as unknown,
  })),
}));

const resendSend = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: (payload: unknown, options: unknown) =>
        resendSend(payload, options) as unknown,
    };
  },
}));

const errorLog = vi.fn();
vi.mock("../logger", () => ({
  logger: {
    error: (message: string, context?: unknown): void => {
      errorLog(message, context);
    },
  },
}));

const { escapeHtml, renderContactEmail, sendContactEmail } =
  await import("../mail");

const base = {
  messageId: "cm_123",
  name: "Ada",
  email: "ada@example.com",
  message: "Hello there.",
};

beforeEach(() => {
  existingRow = null;
  updateFails = false;
  updates.length = 0;
  sendMail.mockReset();
  sendMail.mockResolvedValue({ messageId: "<cm_123@mh.neri.ph>" });
  resendSend.mockReset();
  resendSend.mockResolvedValue({ data: { id: "re_abc" }, error: null });
  errorLog.mockReset();
});

/**
 * SPEC §14.6 — every user-supplied value is escaped before interpolation into
 * the HTML body. This is the acceptance criterion #20 names explicitly.
 */
describe("HTML escaping", () => {
  it("escapes a script tag in the name", () => {
    const { html } = renderContactEmail({
      ...base,
      name: "<script>alert(1)</script>",
    });
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("alert(1)</script>");
  });

  /**
   * The property that matters is that no user text becomes MARKUP. An escaped
   * payload still contains the literal characters `onerror=` — that is inert,
   * because the `<` that would open a tag is `&lt;` and the `"` that would close
   * an attribute is `&quot;`. Asserting the absence of the substring `onerror=`
   * would be asserting the wrong thing and would fail on correct output.
   */
  it.each([
    ["img onerror", '<img src=x onerror="alert(1)">'],
    ["closing p then markup", "</p><iframe src=x></iframe>"],
    ["attribute break-out", '" onmouseover="alert(1)'],
    ["single-quote break-out", "' onmouseover='alert(1)"],
  ])("escapes %s in the message", (_label, payload) => {
    const { html } = renderContactEmail({ ...base, message: payload });
    const body = html.slice(html.indexOf("<p>", html.indexOf("</p>")));
    // No raw angle bracket, quote or apostrophe survives from the payload.
    expect(body).not.toMatch(/<(script|img|iframe|p\s)/i);
    for (const ch of ["<", ">", '"', "'"]) {
      if (payload.includes(ch)) expect(body).toContain(escapeHtml(ch));
    }
    expect(body).toContain(escapeHtml(payload).replace(/\r?\n/g, "<br>"));
  });

  it("escapes the ampersand first so escapes are not double-escaped", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("turns newlines into <br> only after escaping", () => {
    const { html } = renderContactEmail({
      ...base,
      message: "<b>one\ntwo",
    });
    expect(html).toContain("&lt;b&gt;one<br>two");
    expect(html).not.toMatch(/<b>/);
  });

  it("leaves the plain-text part unescaped — there is no markup to escape into", () => {
    const { text } = renderContactEmail({ ...base, message: "5 < 6 & 7" });
    expect(text).toContain("5 < 6 & 7");
  });
});

/**
 * A `\r\n` in a header value injects additional headers — the classic SMTP
 * header-injection hole, which would turn a subject into a Bcc.
 */
describe("header injection", () => {
  it("strips CRLF from the subject", () => {
    const { subject } = renderContactEmail({
      ...base,
      name: "Ada\r\nBcc: attacker@example.com",
    });
    expect(subject).not.toMatch(/[\r\n]/);
    expect(subject).toBe("New message from Ada Bcc: attacker@example.com");
  });

  it("strips CRLF from reply-to", async () => {
    await sendContactEmail({
      ...base,
      email: "ada@example.com\r\nBcc: attacker@example.com",
    });
    const opts = sendMail.mock.calls[0]?.[0] as { replyTo: string };
    expect(opts.replyTo).not.toMatch(/[\r\n]/);
  });
});

describe("Mailpit backend (RESEND_ENABLED=false)", () => {
  it("sends over SMTP and makes zero Resend calls", async () => {
    const result = await sendContactEmail(base);
    expect(result).toEqual({
      ok: true,
      providerId: "<cm_123@mh.neri.ph>",
      backend: "smtp",
    });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(resendSend).not.toHaveBeenCalled();
  });

  it("addresses the mail per SPEC §7", async () => {
    await sendContactEmail(base);
    const opts = sendMail.mock.calls[0]?.[0] as Record<string, string>;
    expect(opts.from).toBe("Portfolio <hello@mh.neri.ph>");
    expect(opts.to).toBe("inbox@mh.neri.ph");
    expect(opts.replyTo).toBe("ada@example.com");
    expect(opts.subject).toBe("New message from Ada");
  });

  it("carries the message id as the Message-ID", async () => {
    await sendContactEmail(base);
    const opts = sendMail.mock.calls[0]?.[0] as { messageId: string };
    expect(opts.messageId).toBe("<cm_123@mh.neri.ph>");
  });
});

/**
 * #20 — "sending twice with the same message id results in one email". Resend's
 * idempotencyKey covers only the Resend path; SMTP has no such concept, so the
 * durable `resendId` check is what makes this true for Mailpit too.
 */
describe("idempotency", () => {
  it("does not dispatch when the message already has a provider id", async () => {
    existingRow = { resendId: "<cm_123@mh.neri.ph>" };
    const result = await sendContactEmail(base);
    expect(result).toEqual({
      ok: true,
      providerId: "<cm_123@mh.neri.ph>",
      backend: "smtp",
      deduped: true,
    });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("dispatches when the row exists but has not been delivered", async () => {
    existingRow = { resendId: null };
    const result = await sendContactEmail(base);
    expect(result.ok).toBe(true);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  /**
   * The regression this exists for: with only the READ in this module, a caller
   * that never persisted `resendId` got two emails from two sends. The test that
   * "proved" idempotency wrote `resendId` itself between the calls — so it was
   * measuring the caller doing its part, not the module guaranteeing anything.
   * There is deliberately NO caller-side write here.
   */
  it("sends once across two calls with no caller-side write at all", async () => {
    const first = await sendContactEmail(base);
    expect(first.ok && first.deduped).toBeFalsy();

    const second = await sendContactEmail(base);
    expect(second.ok && second.deduped).toBe(true);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it("records the provider id where the guard reads it", async () => {
    await sendContactEmail(base);
    expect(updates).toEqual([
      { id: "cm_123", resendId: "<cm_123@mh.neri.ph>" },
    ]);
  });

  /**
   * The mail has already gone out by the time the write runs, so a write
   * failure must not turn a delivered message into a request-path error. It is
   * logged at `error` because the consequence — a retry will double-send —
   * deserves to be visible.
   */
  it("still reports success when recording fails, and logs it", async () => {
    updateFails = true;
    const result = await sendContactEmail(base, "corr-9");
    expect(result.ok).toBe(true);
    expect(errorLog).toHaveBeenCalledTimes(1);
    const [message, context] = errorLog.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(message).toBe("contact email sent but not recorded");
    expect(context.correlation_id).toBe("corr-9");
  });
});

describe("Resend backend", () => {
  it("passes the message id as the idempotency key", async () => {
    vi.resetModules();
    process.env.RESEND_ENABLED = "true";
    process.env.RESEND_API_KEY = "re_test_key";
    const mail = await import("../mail");

    const result = await mail.sendContactEmail(base);
    expect(result).toEqual({
      ok: true,
      providerId: "re_abc",
      backend: "resend",
    });
    expect(resendSend.mock.calls[0]?.[1]).toEqual({
      idempotencyKey: "cm_123",
    });

    process.env.RESEND_ENABLED = "false";
    delete process.env.RESEND_API_KEY;
    vi.resetModules();
  });
});

/**
 * SPEC §7 — a provider failure never throws into the request path. A contact
 * form that 500s because the mail provider is down has lost the message twice:
 * once to the provider and once to the visitor who gets an error page.
 */
describe("never throws into the request path", () => {
  it("returns ok:false when the transport rejects", async () => {
    sendMail.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const result = await sendContactEmail(base, "corr-1");
    expect(result).toEqual({ ok: false, error: "ECONNREFUSED" });
  });

  it("logs the failure at error with the correlation id", async () => {
    sendMail.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await sendContactEmail(base, "corr-1");
    expect(errorLog).toHaveBeenCalledTimes(1);
    const [message, context] = errorLog.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(message).toBe("contact email failed");
    expect(context.correlation_id).toBe("corr-1");
    expect(context.message_id).toBe("cm_123");
  });

  /**
   * SPEC §14.8 — the API key never reaches a log line. The Resend error object
   * can carry the request that produced it, and that request carries the key,
   * so the handler logs `error.message` and nothing else. Logging the object
   * whole would leak it, and no test caught that until this one.
   */
  it("logs only the message from a Resend error, never the object", async () => {
    vi.resetModules();
    process.env.RESEND_ENABLED = "true";
    process.env.RESEND_API_KEY = "re_super_secret_key";
    const mail = await import("../mail");

    resendSend.mockResolvedValueOnce({
      data: null,
      error: {
        name: "validation_error",
        message: "Invalid `to` field.",
        // What a provider SDK can realistically attach to an error.
        request: {
          headers: { Authorization: "Bearer re_super_secret_key" },
          url: "https://api.resend.com/emails",
        },
      },
    });

    const result = await mail.sendContactEmail(base, "corr-3");
    expect(result).toEqual({ ok: false, error: "Invalid `to` field." });

    const logged = JSON.stringify(errorLog.mock.calls);
    expect(logged).not.toContain("re_super_secret_key");
    expect(logged).not.toContain("Authorization");
    expect(logged).toContain("Invalid `to` field.");

    process.env.RESEND_ENABLED = "false";
    delete process.env.RESEND_API_KEY;
    vi.resetModules();
  });

  it("never puts the API key or message body in a log line", async () => {
    sendMail.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await sendContactEmail({ ...base, message: "secret body text" }, "corr-2");
    const logged = JSON.stringify(errorLog.mock.calls);
    expect(logged).not.toContain("re_test_key");
    expect(logged).not.toContain("RESEND_API_KEY");
    expect(logged).not.toContain("secret body text");
  });
});
