import { db } from "./db";
import { logger } from "./logger";

/**
 * Admin authorization and dashboard data (SPEC §6, #26).
 *
 * Separate from `src/actions/index.ts` on purpose: that module imports
 * `astro:actions`, a virtual module only Astro's build can resolve, so anything
 * living there is untestable under vitest. The rule this file encodes is the
 * single most important one in the admin, and it needed to be testable.
 */

/** Thrown when there is no session. The action layer maps it to `UNAUTHORIZED`. */
export class AdminAuthError extends Error {
  constructor() {
    super("Sign in to continue.");
    this.name = "AdminAuthError";
  }
}

/**
 * Re-checks the session and returns the signed-in admin.
 *
 * ## Why this exists when middleware already guards /admin
 *
 * **Middleware is not authorization for Actions.** #24's guard covers
 * `/admin/*` and `/api/admin/*`. Actions are served from `/_actions/*` — a path
 * space that guard never sees. An action relying on the guard would be
 * reachable, unauthenticated, by anyone who knows the endpoint name. For an
 * action this is not defence in depth; it is the only defence.
 *
 * Identity comes from `locals.user`, hydrated from the session cookie — never
 * from the caller's input. SPEC §6: "Never trust a hidden form field for
 * identity or authorization." An action taking a `userId` argument would let
 * any caller act as anyone.
 *
 * Throws rather than returning null so a caller cannot forget to check
 * (AGENT §1.5).
 */
export function assertAdmin(
  locals: App.Locals,
): NonNullable<App.Locals["user"]> {
  const user = locals.user;
  if (!user) {
    logger.warn("admin action rejected: no session");
    throw new AdminAuthError();
  }
  return user;
}

export interface DashboardStats {
  unreadMessages: number;
  undeliveredMessages: number;
  projectsByStatus: { draft: number; published: number; archived: number };
  lastLoginAt: Date | null;
}

/** The dashboard's counts, in one round trip. */
export async function getDashboardStats(
  userId: string,
): Promise<DashboardStats> {
  const [unread, undelivered, grouped, user] = await Promise.all([
    db.contactMessage.count({ where: { status: "NEW" } }),
    /**
     * Undelivered is not a status — it is a real message whose mail never went
     * out. #20's wrapper writes `deliveredAt` on a successful send and leaves it
     * null on failure, and #22 still answers 200 in that case, so this count is
     * the only place a failed send becomes visible to a human. SPAM is excluded:
     * no mail was ever attempted for it, so counting it would report a delivery
     * failure that never happened.
     */
    db.contactMessage.count({
      where: { deliveredAt: null, status: { not: "SPAM" } },
    }),
    db.project.groupBy({ by: ["status"], _count: { _all: true } }),
    db.user.findUnique({
      where: { id: userId },
      select: { lastLoginAt: true },
    }),
  ]);

  const countFor = (status: string): number =>
    grouped.find((row) => row.status === status)?._count._all ?? 0;

  return {
    unreadMessages: unread,
    undeliveredMessages: undelivered,
    projectsByStatus: {
      draft: countFor("DRAFT"),
      published: countFor("PUBLISHED"),
      archived: countFor("ARCHIVED"),
    },
    lastLoginAt: user?.lastLoginAt ?? null,
  };
}
