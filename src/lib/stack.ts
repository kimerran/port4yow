import { Prisma } from "../generated/prisma/client";
import { purgeHomeCache } from "./cache";
import { db } from "./db";
import { logger } from "./logger";

/**
 * Stack item operations (SPEC §4, §6, BRAND §6, #29).
 *
 * Kept out of `src/actions/index.ts` so it is testable — `astro:actions` is a
 * virtual module only Astro's build resolves.
 */

export class DuplicateStackName extends Error {
  constructor(readonly name: string) {
    /**
     * Brand-voiced and field-keyed, never a raw Prisma error. `name` is
     * `@unique`, so a collision surfaces as P2002 — a message about a
     * constraint on a column, which tells the admin nothing they can act on.
     */
    super(`"${name}" is already in the stack.`);
    this.name = "DuplicateStackName";
  }
}

export class StackItemNotFound extends Error {
  constructor() {
    super("That stack item no longer exists.");
    this.name = "StackItemNotFound";
  }
}

/**
 * Deleting an item that projects use needs confirming first.
 *
 * `ProjectStack` cascades on `stackItemId`, so the delete succeeds silently and
 * quietly removes the item from every project that listed it. That is the right
 * behaviour — a stack item that no longer exists should not appear on a project
 * — but it is not something to do without saying so, which is why the first
 * attempt refuses and names the projects.
 */
export class StackItemInUse extends Error {
  constructor(readonly usedBy: string[]) {
    super(
      `That item is listed by ${usedBy.join(", ")}. Deleting it removes it from ${usedBy.length === 1 ? "that project" : "those projects"} too — submit again to confirm.`,
    );
    this.name = "StackItemInUse";
  }
}

const isUniqueViolation = (cause: unknown): boolean =>
  cause instanceof Prisma.PrismaClientKnownRequestError &&
  cause.code === "P2002";

/** The next free position within a suit — new items land at the end. */
async function nextSortOrder(suit: string): Promise<number> {
  const last = await db.stackItem.findFirst({
    where: { suit: suit as never },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  return (last?.sortOrder ?? -1) + 1;
}

export async function createStackItem(input: {
  name: string;
  suit: string;
  featured: boolean;
}): Promise<{ id: string }> {
  const name = input.name.trim();
  try {
    const item = await db.stackItem.create({
      data: {
        name,
        suit: input.suit as never,
        featured: input.featured,
        sortOrder: await nextSortOrder(input.suit),
      },
      select: { id: true },
    });
    purgeHomeCache("stack item created");
    return item;
  } catch (cause) {
    if (isUniqueViolation(cause)) throw new DuplicateStackName(name);
    throw cause;
  }
}

export async function updateStackItem(input: {
  id: string;
  name: string;
  suit: string;
  featured: boolean;
}): Promise<void> {
  const name = input.name.trim();
  const current = await db.stackItem.findUnique({
    where: { id: input.id },
    select: { suit: true },
  });
  if (!current) throw new StackItemNotFound();

  try {
    await db.stackItem.update({
      where: { id: input.id },
      data: {
        name,
        suit: input.suit as never,
        featured: input.featured,
        /**
         * Moving between suits puts the item at the end of its new one.
         * Carrying the old `sortOrder` across would drop it into an arbitrary
         * position mid-list, which reads as a bug rather than a move.
         */
        ...(String(current.suit) === input.suit
          ? {}
          : { sortOrder: await nextSortOrder(input.suit) }),
      },
    });
    purgeHomeCache("stack item updated");
  } catch (cause) {
    if (isUniqueViolation(cause)) throw new DuplicateStackName(name);
    throw cause;
  }
}

/**
 * Deletes an item, refusing the first time if projects list it.
 *
 * Two-step rather than a JavaScript `confirm()`: the admin pages ship no client
 * script, and a confirmation that only exists in JavaScript is not a
 * confirmation. The refusal names the projects, so the second submit is an
 * informed one.
 */
export async function deleteStackItem(
  id: string,
  confirmed: boolean,
): Promise<{ removedFrom: number }> {
  const item = await db.stackItem.findUnique({
    where: { id },
    select: {
      name: true,
      projects: { select: { project: { select: { title: true } } } },
    },
  });
  if (!item) throw new StackItemNotFound();

  const usedBy = [...new Set(item.projects.map((p) => p.project.title))];
  if (usedBy.length > 0 && !confirmed) throw new StackItemInUse(usedBy);

  // ProjectStack cascades on stackItemId, so the join rows go with it.
  await db.stackItem.delete({ where: { id } });

  purgeHomeCache("stack item deleted");
  logger.info("stack item deleted", { removed_from: usedBy.length });
  return { removedFrom: usedBy.length };
}

export class ReorderMismatch extends Error {
  constructor() {
    super("Reorder must list every item in that suit exactly once.");
    this.name = "ReorderMismatch";
  }
}

/**
 * Rewrites `sortOrder` within one suit.
 *
 * No parking pass, unlike #27's project reorder: `sortOrder` is NOT `@unique`,
 * so intermediate duplicates are legal and a single pass is safe. One
 * `$transaction` still, so a failure leaves the previous order intact rather
 * than half-applied.
 *
 * The list must name every item in the suit. A partial list would leave the
 * omitted items on their old positions, interleaving them with the new ones in
 * an order nobody chose.
 */
export async function reorderStackItems(
  suit: string,
  orderedIds: string[],
): Promise<void> {
  const unique = new Set(orderedIds);
  if (unique.size !== orderedIds.length) throw new ReorderMismatch();

  const existing = await db.stackItem.findMany({
    where: { suit: suit as never },
    select: { id: true },
  });
  if (existing.length !== orderedIds.length) throw new ReorderMismatch();
  for (const row of existing) {
    if (!unique.has(row.id)) throw new ReorderMismatch();
  }

  await db.$transaction(
    orderedIds.map((id, index) =>
      db.stackItem.update({ where: { id }, data: { sortOrder: index } }),
    ),
  );

  purgeHomeCache("stack reordered");
}
