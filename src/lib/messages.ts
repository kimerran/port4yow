import { db } from "./db";
import { logger } from "./logger";

/**
 * Contact message triage (SPEC §6, §7, #30).
 *
 * Kept out of `src/actions/index.ts` so it is testable — `astro:actions` is a
 * virtual module only Astro's build resolves.
 */

export const MESSAGE_STATUSES = ["NEW", "READ", "REPLIED", "SPAM"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export class MessageNotFound extends Error {
  constructor() {
    super("That message no longer exists.");
    this.name = "MessageNotFound";
  }
}

/**
 * The fields the inbox and detail views may read.
 *
 * A narrow select, and `ipHash` is absent on purpose. SPEC §14.10 stores a
 * salted hash rather than an address so it can be compared for anomaly review —
 * it is not something to put on a screen, and a value on a screen is a value in
 * a screenshot. Nothing here needs it, so nothing here selects it.
 */
const MESSAGE_FIELDS = {
  id: true,
  name: true,
  email: true,
  message: true,
  status: true,
  createdAt: true,
  resendId: true,
  deliveredAt: true,
  userAgent: true,
} as const;

export interface InboxMessage {
  id: string;
  name: string;
  email: string;
  message: string;
  status: string;
  createdAt: Date;
  resendId: string | null;
  deliveredAt: Date | null;
  userAgent: string | null;
}

/**
 * True when the message should have been emailed and was not.
 *
 * SPEC §7.7 — #22 answers 200 even when the send fails, because the message is
 * safely stored and the visitor should not be told it was lost. That makes this
 * the ONLY place a failed send becomes visible to a human, so it has to be
 * derived rather than assumed from a status.
 *
 * SPAM is excluded: no mail is attempted for it, so a null `deliveredAt` there
 * is the expected state rather than a failure. Counting it would report a
 * delivery problem that never happened, and an inbox that cries wolf gets
 * ignored.
 */
export function isUndelivered(message: {
  status: string;
  deliveredAt: Date | null;
}): boolean {
  return message.status !== "SPAM" && message.deliveredAt === null;
}

export interface InboxQuery {
  status?: MessageStatus;
}

/** The inbox, newest first. `@@index([status, createdAt])` exists for this. */
export async function listMessages(
  query: InboxQuery = {},
): Promise<InboxMessage[]> {
  return db.contactMessage.findMany({
    where: query.status ? { status: query.status } : {},
    orderBy: { createdAt: "desc" },
    take: 200,
    select: MESSAGE_FIELDS,
  });
}

export async function getMessage(id: string): Promise<InboxMessage | null> {
  return db.contactMessage.findUnique({
    where: { id },
    select: MESSAGE_FIELDS,
  });
}

export interface StatusCounts {
  all: number;
  NEW: number;
  READ: number;
  REPLIED: number;
  SPAM: number;
  undelivered: number;
}

export async function statusCounts(): Promise<StatusCounts> {
  const [grouped, undelivered, all] = await Promise.all([
    db.contactMessage.groupBy({ by: ["status"], _count: { _all: true } }),
    db.contactMessage.count({
      where: { deliveredAt: null, status: { not: "SPAM" } },
    }),
    db.contactMessage.count(),
  ]);

  const countFor = (status: MessageStatus): number =>
    grouped.find((row) => row.status === status)?._count._all ?? 0;

  return {
    all,
    NEW: countFor("NEW"),
    READ: countFor("READ"),
    REPLIED: countFor("REPLIED"),
    SPAM: countFor("SPAM"),
    undelivered,
  };
}

/** Triage. The only mutation this screen performs. */
export async function setMessageStatus(
  id: string,
  status: MessageStatus,
): Promise<void> {
  const existing = await db.contactMessage.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) throw new MessageNotFound();

  await db.contactMessage.update({ where: { id }, data: { status } });

  /**
   * No message content in the log line — not the body, not the sender's name,
   * not their address. AGENT §3 bans a full email address outright, and the
   * body is someone's private correspondence.
   */
  logger.info("message status changed", { message_id: id, status });
}
