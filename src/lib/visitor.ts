import { z } from "zod";

/**
 * The shape both `/api/access` and `/api/resume` accept.
 *
 * ## Why the facts are an allowlist, not a passthrough
 *
 * The browser sends a bag of "data points" and the server puts them in an email.
 * Accepting arbitrary keys would make the owner's inbox a rendering surface for
 * whatever a caller invents — unbounded in size, unbounded in count, and with
 * key names chosen by the sender. This names the fields it will report and drops
 * everything else, so the email has a known shape whoever posts to it.
 *
 * Each value is length-capped for the same reason: a 2MB referrer is a valid
 * string.
 */
const fact = z.string().trim().max(400).optional();

export const VisitorSchema = z.object({
  email: z.email("That email address looks incomplete.").max(255),
  name: z.string().trim().max(120).optional(),

  /** Where they came from, and what they were looking at. */
  referrer: fact,
  path: fact,

  /** Device and locale, as the browser reports them. */
  userAgent: fact,
  language: fact,
  timezone: fact,
  screen: fact,
  viewport: fact,

  /**
   * The honeypot. Named for something a bot will fill and a person will never
   * see, and — as with the contact form — a filled value never produces a
   * validation error, because the error message would tell the bot what caught
   * it. It is evaluated by the route.
   */
  company: z.string().optional(),
});

export type VisitorInput = z.infer<typeof VisitorSchema>;

/**
 * The reported facts, in a fixed order, with blanks dropped.
 *
 * Fixed order because these become an email the owner reads dozens of times:
 * scanning is faster when the fields are always in the same place. Blanks
 * dropped because "referrer: (empty)" is noise, and a direct visit genuinely has
 * no referrer.
 */
export function factsFrom(
  input: VisitorInput,
  serverSide: { ipHash: string; at: string },
): Record<string, string> {
  const ordered: [string, string | undefined][] = [
    ["Page", input.path],
    ["Referrer", input.referrer],
    ["Time", serverSide.at],
    ["Timezone", input.timezone],
    ["Language", input.language],
    ["Screen", input.screen],
    ["Viewport", input.viewport],
    ["User agent", input.userAgent],
    /**
     * SPEC §14.10 — the hash, never the address, and truncated because the full
     * 64 characters are unreadable and the first 12 are already enough to tell
     * two visitors apart in an inbox.
     */
    ["Visitor (hashed IP)", `${serverSide.ipHash.slice(0, 12)}…`],
  ];

  return Object.fromEntries(
    ordered.filter((entry): entry is [string, string] => {
      const value = entry[1];
      return typeof value === "string" && value.length > 0;
    }),
  );
}
