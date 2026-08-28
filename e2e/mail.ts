/**
 * Reading what the app actually sent, via Mailpit's HTTP API.
 *
 * This replaces `e2e/db.ts`. The no-JS contact test needed to tell an ACCEPTED
 * submission from one classified as spam, and it could not use the status code:
 * SPEC §7 requires both to answer 200 so a bot is never told it was caught. The
 * old discriminator was the stored row's `status`.
 *
 * There is no database, and the replacement is a better probe than the one it
 * replaces: a delivered email proves the whole pipeline ran, where a stored row
 * only proved the handler reached its INSERT. Spam returns before the send, so
 * "did an email arrive" is exactly the question.
 *
 * With `RESEND_ENABLED=false`, `src/lib/mail.ts` posts to the Mailpit SMTP
 * container instead of Resend, and its web API is on 8025.
 */

const MAILPIT_API = process.env.MAILPIT_API ?? "http://localhost:8025";

interface MailpitMessage {
  ID: string;
  Subject: string;
}

interface MailpitSearch {
  messages?: MailpitMessage[];
}

/**
 * Polls for a message whose body mentions `needle`, up to `timeoutMs`.
 *
 * SMTP delivery is asynchronous with respect to the HTTP response the browser
 * saw — the handler awaits `sendMail`, but Mailpit indexes on its own schedule —
 * so a single immediate read is racy. Polling is the honest shape; a fixed sleep
 * would either be flaky or slower than it needs to be.
 */
export async function waitForEmailContaining(
  needle: string,
  timeoutMs = 10_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const response = await fetch(
      `${MAILPIT_API}/api/v1/search?query=${encodeURIComponent(needle)}`,
    );
    if (response.ok) {
      const body = (await response.json()) as MailpitSearch;
      if ((body.messages?.length ?? 0) > 0) return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return false;
}

/** Empties the mailbox so one test cannot see another's mail. */
export async function clearMailbox(): Promise<void> {
  await fetch(`${MAILPIT_API}/api/v1/messages`, { method: "DELETE" });
}
