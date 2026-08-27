import { purgeHomeCache } from "./cache";
import { db } from "./db";
import { logger } from "./logger";

/**
 * Admin project operations (SPEC §4, §6, #27).
 *
 * Kept out of `src/actions/index.ts` so it is testable — `astro:actions` is a
 * virtual module only Astro's build resolves.
 */

/** SPEC §4 — lowercase kebab. */
export function normalizeSlug(input: string): string {
  return (
    input
      .normalize("NFKD")
      // Strip diacritics rather than transliterating: "Café" becomes "cafe", not
      // "cafa" or an escaped byte sequence.
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96)
  );
}

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= 96 && SLUG_PATTERN.test(slug);
}

/** The fields SPEC §6 requires before a project may be published. */
export const PUBLISH_REQUIRED_TEXT = [
  "title",
  "summary",
  "problem",
  "body",
  "outcome",
] as const;

export type PublishRequiredField =
  (typeof PUBLISH_REQUIRED_TEXT)[number] | "cover" | "coverAltText";

export interface PublishCandidate {
  title: string;
  summary: string;
  problem: string;
  body: string;
  outcome: string;
  coverImage: { altText: string } | null;
}

/**
 * The fields standing between a project and publication.
 *
 * Pure, and separate from the action, because SPEC §6 says the block is
 * "enforced server-side in the action, not only in the UI" — which means the
 * same rule has to run in two places (the form, to explain; the action, to
 * refuse) and there must be exactly one copy of it.
 *
 * Whitespace does not count as present. A body of `"   "` satisfies a `!== ""`
 * check and publishes an empty page.
 */
export function publishBlockers(
  project: PublishCandidate,
): PublishRequiredField[] {
  const blockers: PublishRequiredField[] = [];

  for (const field of PUBLISH_REQUIRED_TEXT) {
    if (project[field].trim().length === 0) blockers.push(field);
  }

  if (!project.coverImage) {
    blockers.push("cover");
  } else if (project.coverImage.altText.trim().length === 0) {
    // A cover with empty alt text is the case #17 made a render-time failure.
    // Catching it here means it never reaches a public page at all.
    blockers.push("coverAltText");
  }

  return blockers;
}

export class PublishBlockedError extends Error {
  constructor(readonly blockers: PublishRequiredField[]) {
    super(`Not ready to publish: ${blockers.join(", ")}`);
    this.name = "PublishBlockedError";
  }
}

export class SlugImmutableError extends Error {
  constructor() {
    super("A published project keeps its slug.");
    this.name = "SlugImmutableError";
  }
}

export class ReorderMismatchError extends Error {
  constructor() {
    super("Reorder must list every project exactly once.");
    this.name = "ReorderMismatchError";
  }
}

/**
 * Rewrites `sequence` so the given order becomes 1..n.
 *
 * ## Why two passes inside one transaction
 *
 * `Project.sequence` is `@unique`, and Postgres checks a unique index per
 * statement — the index Prisma creates is not `DEFERRABLE`. So moving project A
 * to position 2 while project B still holds 2 raises a constraint violation
 * immediately, even inside a transaction. Swapping in place is not possible.
 *
 * The first pass parks every row at a negative sequence, a range no real row
 * ever occupies, so nothing collides. The second pass writes the final 1..n.
 * Both run in one `$transaction` (AGENT §2), so a failure anywhere leaves the
 * original order untouched rather than half-renumbered.
 *
 * ## Why the id list must be complete
 *
 * The final pass assigns 1..n. Any project left out keeps its old sequence,
 * which is very likely inside that range — so a partial reorder would either
 * collide or silently produce duplicates in the public ordering. Refusing an
 * incomplete list is the difference between a failed reorder and a corrupted
 * one.
 */
export async function reorderProjects(orderedIds: string[]): Promise<void> {
  const unique = new Set(orderedIds);
  if (unique.size !== orderedIds.length) throw new ReorderMismatchError();

  const existing = await db.project.findMany({ select: { id: true } });
  if (existing.length !== orderedIds.length) throw new ReorderMismatchError();
  for (const row of existing) {
    if (!unique.has(row.id)) throw new ReorderMismatchError();
  }

  await db.$transaction(async (tx) => {
    // Pass 1 — park out of the way of every final value.
    for (const [index, id] of orderedIds.entries()) {
      await tx.project.update({
        where: { id },
        data: { sequence: -(index + 1) },
      });
    }
    // Pass 2 — the order the caller asked for, contiguous from 1.
    for (const [index, id] of orderedIds.entries()) {
      await tx.project.update({
        where: { id },
        data: { sequence: index + 1 },
      });
    }
  });

  purgeHomeCache("projects reordered");
  logger.info("projects reordered", { count: orderedIds.length });
}

/** The next free sequence, for a newly created project. */
export async function nextSequence(): Promise<number> {
  const highest = await db.project.findFirst({
    orderBy: { sequence: "desc" },
    select: { sequence: true },
  });
  return (highest?.sequence ?? 0) + 1;
}

/**
 * Publishes a project, or refuses with the list of what is missing.
 *
 * The gate is re-evaluated here from the database rather than trusting anything
 * the caller sent — SPEC §6 wants it enforced in the action, and a client that
 * skipped the form could otherwise publish an empty page.
 */
export async function publishProject(id: string): Promise<void> {
  const project = await db.project.findUnique({
    where: { id },
    select: {
      title: true,
      summary: true,
      problem: true,
      body: true,
      outcome: true,
      coverImage: { select: { altText: true } },
    },
  });

  if (!project) throw new Error("Project not found.");

  const blockers = publishBlockers(project);
  if (blockers.length > 0) {
    logger.warn("publish refused", { project_id: id, blockers });
    throw new PublishBlockedError(blockers);
  }

  await db.project.update({
    where: { id },
    data: { status: "PUBLISHED", publishedAt: new Date() },
  });

  purgeHomeCache("project published");
  logger.info("project published", { project_id: id });
}

/** Moves a project back to DRAFT. `publishedAt` is kept as a historical fact. */
export async function unpublishProject(id: string): Promise<void> {
  await db.project.update({ where: { id }, data: { status: "DRAFT" } });
  purgeHomeCache("project unpublished");
  logger.info("project unpublished", { project_id: id });
}

/**
 * Guards SPEC §4's "immutable once published".
 *
 * A published slug is a public URL other people have linked to; changing it
 * breaks those links and the canonical tag with them. Returns the slug to
 * persist: the existing one for a published project, the requested one
 * otherwise.
 */
export function resolveSlug(
  current: { slug: string; status: string },
  requested: string | undefined,
): string {
  if (requested === undefined || requested === current.slug) {
    return current.slug;
  }
  if (current.status === "PUBLISHED") throw new SlugImmutableError();
  if (!isValidSlug(requested)) {
    throw new Error("Slug must be lowercase words separated by hyphens.");
  }
  return requested;
}
