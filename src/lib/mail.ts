import { createTransport } from "nodemailer";
import { Resend } from "resend";
import { env } from "./env";
import { logger } from "./logger";

/**
 * Outbound mail (SPEC §7, §12, §14.6, §14.8). One wrapper, two backends:
 * Resend in production, Mailpit over SMTP in development.
 *
 * SERVER ONLY. This module reads `RESEND_API_KEY` and must never be imported
 * from a client script (AGENT §4). The proof is not intention — it is a grep of
 * the built client bundle, recorded in the handoff.
 */

export interface ContactEmail {
  /**
   * The request's correlation id. Doubles as the idempotency key.
   *
   * This was `ContactMessage.id` — a database primary key that survived a
   * restart, which is what made the idempotency guarantee durable. There is no
   * database now, so see `sendContactEmail` for exactly how much of that
   * guarantee remains.
   */
  messageId: string;
  name: string;
  email: string;
  message: string;
}

export type SendResult =
  | {
      ok: true;
      providerId: string;
      backend: "resend" | "smtp";
    }
  | { ok: false; error: string };

/**
 * SPEC §14.6 — every user-supplied value is escaped before it reaches the HTML
 * body. The plain-text part needs no escaping; the HTML part is the whole
 * reason this exists.
 *
 * `&` first, or the escapes produced by the later replacements get re-escaped.
 * `"` and `'` are included even though nothing here interpolates into an
 * attribute today: an allowlist of contexts is a promise about the template,
 * and templates change.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * `\r` and `\n` in a header value let a caller inject additional headers — the
 * classic SMTP header-injection hole, which would turn `subject` into a Bcc.
 * Neither Resend nor nodemailer should let this through, but the boundary is
 * ours to hold (AGENT §3).
 */
const headerSafe = (value: string): string =>
  value.replace(/[\r\n]+/g, " ").trim();

interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export function renderContactEmail(input: ContactEmail): RenderedEmail {
  const name = escapeHtml(input.name);
  const email = escapeHtml(input.email);
  const message = escapeHtml(input.message);

  return {
    subject: headerSafe(`New message from ${input.name}`),
    // Plain text is the raw values by design: there is no markup to escape into.
    text: [`From: ${input.name} <${input.email}>`, "", input.message].join(
      "\n",
    ),
    html: [
      "<!doctype html>",
      '<html lang="en"><body>',
      `<p><strong>From:</strong> ${name} &lt;${email}&gt;</p>`,
      // Newlines are the only formatting a submitter gets, and they are applied
      // to the ALREADY-escaped string so <br> is the only tag that can appear.
      `<p>${message.replace(/\r?\n/g, "<br>")}</p>`,
      "</body></html>",
    ].join("\n"),
  };
}

let resendClient: Resend | null = null;
const getResend = (): Resend => {
  // The env schema already refuses to boot with RESEND_ENABLED and no key, so
  // this cannot be reached without one — but assert rather than assume.
  if (!env.RESEND_API_KEY) {
    throw new Error("mail: RESEND_ENABLED is true but RESEND_API_KEY is unset");
  }
  resendClient ??= new Resend(env.RESEND_API_KEY);
  return resendClient;
};

/**
 * Sends the contact notification.
 *
 * NEVER THROWS. A provider failure is logged at `error` with the correlation id
 * and returned as `{ ok: false }`, so the request path can persist the message
 * as undelivered and still answer the submitter (SPEC §7). A contact form that
 * 500s because the mail provider is down has lost the message twice.
 *
 * ## Idempotency, and what it is now worth
 *
 * It used to be durable: `ContactMessage.resendId` recorded that a send had
 * happened, was read before dispatch, and survived a process restart. That
 * record is gone with the database, and nothing here replaces it — an
 * in-memory set would not survive the restart that is the whole reason the
 * check existed, so pretending otherwise would be worse than the gap.
 *
 * What remains is Resend's own `idempotencyKey`, which collapses a retry
 * provider-side on the production path. The SMTP path has no such concept, so a
 * retried send in development puts a second copy in Mailpit. Since nothing
 * retries this route — the browser fires once and the handler does not loop —
 * the exposure is a visitor pressing submit twice, which produces two distinct
 * correlation ids and is genuinely two messages.
 */
export async function sendContactEmail(
  input: ContactEmail,
  correlationId?: string,
): Promise<SendResult> {
  const rendered = renderContactEmail(input);
  const from = `Portfolio <${env.CONTACT_FROM_EMAIL}>`;
  const replyTo = headerSafe(input.email);

  try {
    if (env.RESEND_ENABLED) {
      const { data, error } = await getResend().emails.send(
        {
          from,
          to: env.CONTACT_TO_EMAIL,
          replyTo,
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
        },
        { idempotencyKey: input.messageId },
      );

      if (error || !data) {
        /**
         * `error.message` only. The Resend error object can carry the request
         * that produced it, and that request contains the API key — SPEC §14.8
         * says the key never reaches a log line.
         */
        logger.error("contact email failed", {
          correlation_id: correlationId,
          message_id: input.messageId,
          backend: "resend",
          reason: error?.message ?? "resend returned no data",
        });
        return { ok: false, error: error?.message ?? "no data" };
      }

      return { ok: true, providerId: data.id, backend: "resend" };
    }

    /**
     * SPEC §12 — with Resend disabled, mail goes to Mailpit and NOTHING leaves
     * the machine. `SMTP_URL` defaults to the compose file's Mailpit.
     */
    const info = await createTransport(env.SMTP_URL).sendMail({
      from,
      to: env.CONTACT_TO_EMAIL,
      replyTo,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      messageId: `<${input.messageId}@mh.neri.ph>`,
    });

    return { ok: true, providerId: info.messageId, backend: "smtp" };
  } catch (cause) {
    logger.error("contact email failed", {
      correlation_id: correlationId,
      message_id: input.messageId,
      backend: env.RESEND_ENABLED ? "resend" : "smtp",
      reason: cause instanceof Error ? cause.message : "unknown",
    });
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : "unknown",
    };
  }
}

/**
 * A visit, or a resume download, reported to the owner.
 *
 * These exist because the site has no database: the email IS the record. That is
 * the same decision the contact route already makes, and it has the same
 * consequence — a provider outage loses the entry, and there is no second copy
 * to reconcile against.
 */
export interface VisitAlert {
  /** Correlation id, doubling as the idempotency key. */
  messageId: string;
  kind: "visit" | "resume";
  email: string;
  name?: string | undefined;
  /** Everything the browser volunteered. Rendered verbatim, escaped. */
  facts: Record<string, string>;
}

/**
 * Renders the alert.
 *
 * `escapeHtml` on every value without exception: `facts` is populated from the
 * browser, so the referrer and the user-agent are attacker-controlled strings
 * arriving in the owner's mail client.
 */
export function renderVisitAlert(input: VisitAlert): RenderedEmail {
  const heading =
    input.kind === "resume" ? "Resume downloaded" : "Portfolio viewed";
  const who = input.name ? `${input.name} <${input.email}>` : input.email;

  const rows = Object.entries(input.facts);

  const text = [
    `${heading}`,
    "",
    `From: ${who}`,
    "",
    ...rows.map(([key, value]) => `${key}: ${value}`),
  ].join("\n");

  const html = [
    `<h2>${escapeHtml(heading)}</h2>`,
    `<p><strong>From:</strong> ${escapeHtml(who)}</p>`,
    '<table cellpadding="4" style="border-collapse:collapse">',
    ...rows.map(
      ([key, value]) =>
        `<tr><td style="color:#3C4F50">${escapeHtml(key)}</td><td>${escapeHtml(value)}</td></tr>`,
    ),
    "</table>",
  ].join("\n");

  return { subject: `[mh.neri.ph] ${heading} — ${who}`, text, html };
}

/**
 * Sends a visit or download alert. NEVER THROWS, for the same reason
 * `sendContactEmail` does not: the visitor's page must not fail because the mail
 * provider is having a bad minute.
 */
export async function sendVisitAlert(
  input: VisitAlert,
  correlationId?: string,
): Promise<SendResult> {
  const rendered = renderVisitAlert(input);
  const from = `Portfolio <${env.CONTACT_FROM_EMAIL}>`;

  try {
    if (env.RESEND_ENABLED) {
      const { data, error } = await getResend().emails.send(
        {
          from,
          to: env.CONTACT_TO_EMAIL,
          replyTo: headerSafe(input.email),
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
        },
        { idempotencyKey: input.messageId },
      );

      if (error || !data) {
        logger.error("visit alert failed", {
          correlation_id: correlationId,
          kind: input.kind,
          backend: "resend",
          reason: error?.message ?? "resend returned no data",
        });
        return { ok: false, error: error?.message ?? "no data" };
      }

      return { ok: true, providerId: data.id, backend: "resend" };
    }

    const info = await createTransport(env.SMTP_URL).sendMail({
      from,
      to: env.CONTACT_TO_EMAIL,
      replyTo: headerSafe(input.email),
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      messageId: `<${input.messageId}@mh.neri.ph>`,
    });

    return { ok: true, providerId: info.messageId, backend: "smtp" };
  } catch (cause) {
    logger.error("visit alert failed", {
      correlation_id: correlationId,
      kind: input.kind,
      backend: env.RESEND_ENABLED ? "resend" : "smtp",
      reason: cause instanceof Error ? cause.message : "unknown",
    });
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : "unknown",
    };
  }
}
