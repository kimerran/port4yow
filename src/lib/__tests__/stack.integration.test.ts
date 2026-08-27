import { afterAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Stack item CRUD against real Postgres (#29).
 *
 * The duplicate-name rule is a database constraint and the delete cascade is a
 * schema relation — both only exist for real. Opt-in, same shape as the other
 * integration suites.
 */
const enabled =
  process.env.STACK_IT === "1" && Boolean(process.env.DATABASE_URL);

const SECRET = "x".repeat(48);
Object.assign(process.env, {
  PUBLIC_SITE_URL: "http://localhost:4321",
  SESSION_SECRET: SECRET,
  FORM_SECRET: SECRET,
  IP_HASH_SALT: SECRET,
  S3_ENDPOINT: "http://localhost:9000",
  S3_BUCKET: "portfolio-media",
  S3_ACCESS_KEY_ID: "minioadmin",
  S3_SECRET_ACCESS_KEY: "minioadmin",
  CONTACT_TO_EMAIL: "inbox@mh.neri.ph",
});

describe.skipIf(!enabled)("stack items", () => {
  let stack: typeof import("../stack");
  let db: typeof import("../db").db;

  beforeEach(async () => {
    stack = await import("../stack");
    ({ db } = await import("../db"));
    await db.projectStack.deleteMany({});
    await db.stackItem.deleteMany({});
    await db.projectImage.deleteMany({});
    await db.project.updateMany({ data: { coverImageId: null } });
    await db.mediaAsset.deleteMany({});
    await db.project.deleteMany({});
  });

  afterAll(async () => {
    await db.projectStack.deleteMany({});
    await db.stackItem.deleteMany({});
    await db.project.deleteMany({});
    await db.$disconnect();
  });

  const project = async (title: string): Promise<string> => {
    const row = await db.project.create({
      data: {
        slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        sequence: Math.floor(performance.now() * 1000) % 100000,
        title,
        suit: "DIAMONDS",
        summary: "s",
        role: "r",
        timeline: "t",
        problem: "p",
        body: "b",
        outcome: "o",
      },
      select: { id: true },
    });
    return row.id;
  };

  describe("create", () => {
    it("creates an item at the end of its suit", async () => {
      await stack.createStackItem({
        name: "Postgres",
        suit: "SPADES",
        featured: false,
      });
      const second = await stack.createStackItem({
        name: "Redis",
        suit: "SPADES",
        featured: true,
      });

      const rows = await db.stackItem.findMany({
        orderBy: { sortOrder: "asc" },
      });
      expect(rows.map((r) => r.name)).toEqual(["Postgres", "Redis"]);
      expect(rows.map((r) => r.sortOrder)).toEqual([0, 1]);
      expect(rows[1]?.id).toBe(second.id);
      expect(rows[1]?.featured).toBe(true);
    });

    it("numbers each suit independently", async () => {
      await stack.createStackItem({
        name: "Postgres",
        suit: "SPADES",
        featured: false,
      });
      await stack.createStackItem({
        name: "Figma",
        suit: "DIAMONDS",
        featured: false,
      });

      const rows = await db.stackItem.findMany();
      // Both are first in their own suit.
      expect(rows.every((r) => r.sortOrder === 0)).toBe(true);
    });

    /**
     * `name` is `@unique`, so a collision surfaces as Prisma P2002 — a message
     * about a constraint on a column, which tells the admin nothing they can act
     * on. #29 asks for a brand-voiced error and never a stack trace.
     */
    it("rejects a duplicate name in the interface's voice", async () => {
      await stack.createStackItem({
        name: "Postgres",
        suit: "SPADES",
        featured: false,
      });

      await expect(
        stack.createStackItem({
          name: "Postgres",
          suit: "CLUBS",
          featured: false,
        }),
      ).rejects.toThrow(stack.DuplicateStackName);

      await expect(
        stack.createStackItem({
          name: "Postgres",
          suit: "CLUBS",
          featured: false,
        }),
      ).rejects.toThrow('"Postgres" is already in the stack.');

      // The raw Prisma vocabulary never reaches the caller.
      await expect(
        stack.createStackItem({
          name: "Postgres",
          suit: "CLUBS",
          featured: false,
        }),
      ).rejects.not.toThrow(/P2002|Unique constraint|prisma/i);

      expect(await db.stackItem.count()).toBe(1);
    });

    it("trims the name", async () => {
      await stack.createStackItem({
        name: "  Astro  ",
        suit: "CLUBS",
        featured: false,
      });
      expect((await db.stackItem.findFirst())?.name).toBe("Astro");
    });
  });

  describe("update", () => {
    it("renames in place", async () => {
      const item = await stack.createStackItem({
        name: "Postgres",
        suit: "SPADES",
        featured: false,
      });
      await stack.updateStackItem({
        id: item.id,
        name: "PostgreSQL",
        suit: "SPADES",
        featured: true,
      });

      const row = await db.stackItem.findUnique({ where: { id: item.id } });
      expect(row?.name).toBe("PostgreSQL");
      expect(row?.featured).toBe(true);
      // Position within the suit is untouched by a rename.
      expect(row?.sortOrder).toBe(0);
    });

    /**
     * Carrying the old position across would drop the item into an arbitrary
     * place mid-list in its new suit, which reads as a bug rather than a move.
     */
    it("moves to the end when the suit changes", async () => {
      await stack.createStackItem({
        name: "Terraform",
        suit: "CLUBS",
        featured: false,
      });
      await stack.createStackItem({
        name: "Docker",
        suit: "CLUBS",
        featured: false,
      });
      const moved = await stack.createStackItem({
        name: "Postgres",
        suit: "SPADES",
        featured: false,
      });
      expect(
        (await db.stackItem.findUnique({ where: { id: moved.id } }))?.sortOrder,
      ).toBe(0);

      await stack.updateStackItem({
        id: moved.id,
        name: "Postgres",
        suit: "CLUBS",
        featured: false,
      });

      const row = await db.stackItem.findUnique({ where: { id: moved.id } });
      expect(row?.suit).toBe("CLUBS");
      expect(row?.sortOrder).toBe(2);
    });

    it("rejects a rename onto another item's name", async () => {
      await stack.createStackItem({
        name: "Postgres",
        suit: "SPADES",
        featured: false,
      });
      const other = await stack.createStackItem({
        name: "Redis",
        suit: "SPADES",
        featured: false,
      });

      await expect(
        stack.updateStackItem({
          id: other.id,
          name: "Postgres",
          suit: "SPADES",
          featured: false,
        }),
      ).rejects.toThrow(stack.DuplicateStackName);
    });

    it("refuses an unknown id", async () => {
      await expect(
        stack.updateStackItem({
          id: "no-such-id",
          name: "X",
          suit: "SPADES",
          featured: false,
        }),
      ).rejects.toThrow(stack.StackItemNotFound);
    });
  });

  describe("delete", () => {
    it("deletes an unused item without confirmation", async () => {
      const item = await stack.createStackItem({
        name: "Unused",
        suit: "CLUBS",
        featured: false,
      });
      const result = await stack.deleteStackItem(item.id, false);
      expect(result.removedFrom).toBe(0);
      expect(await db.stackItem.count()).toBe(0);
    });

    /**
     * `ProjectStack` cascades on `stackItemId`, so an unconfirmed delete would
     * silently strip the item from every project listing it. Refusing first, and
     * naming them, is the documented behaviour #29 asks for.
     */
    it("refuses an in-use item until confirmed, naming the projects", async () => {
      const item = await stack.createStackItem({
        name: "Postgres",
        suit: "SPADES",
        featured: false,
      });
      const a = await project("Ledger");
      const b = await project("Intake");
      await db.projectStack.createMany({
        data: [
          { projectId: a, stackItemId: item.id, sortOrder: 0 },
          { projectId: b, stackItemId: item.id, sortOrder: 0 },
        ],
      });

      await expect(stack.deleteStackItem(item.id, false)).rejects.toThrow(
        stack.StackItemInUse,
      );
      await expect(stack.deleteStackItem(item.id, false)).rejects.toThrow(
        /Ledger.*Intake|Intake.*Ledger/,
      );
      expect(await db.stackItem.count()).toBe(1);
    });

    it("cascades the join rows once confirmed", async () => {
      const item = await stack.createStackItem({
        name: "Postgres",
        suit: "SPADES",
        featured: false,
      });
      const a = await project("Ledger");
      await db.projectStack.create({
        data: { projectId: a, stackItemId: item.id, sortOrder: 0 },
      });

      const result = await stack.deleteStackItem(item.id, true);
      expect(result.removedFrom).toBe(1);
      expect(await db.stackItem.count()).toBe(0);
      // The join row went with it; the project itself did not.
      expect(await db.projectStack.count()).toBe(0);
      expect(await db.project.count()).toBe(1);
    });

    it("refuses an unknown id", async () => {
      await expect(stack.deleteStackItem("no-such-id", true)).rejects.toThrow(
        stack.StackItemNotFound,
      );
    });
  });

  describe("reorder", () => {
    const seed = async (): Promise<string[]> => {
      const ids: string[] = [];
      for (const name of ["One", "Two", "Three", "Four"]) {
        const item = await stack.createStackItem({
          name,
          suit: "CLUBS",
          featured: false,
        });
        ids.push(item.id);
      }
      return ids;
    };

    it("rewrites sortOrder within the suit", async () => {
      const ids = await seed();
      await stack.reorderStackItems("CLUBS", [...ids].reverse());

      const rows = await db.stackItem.findMany({
        orderBy: { sortOrder: "asc" },
      });
      expect(rows.map((r) => r.name)).toEqual(["Four", "Three", "Two", "One"]);
      expect(rows.map((r) => r.sortOrder)).toEqual([0, 1, 2, 3]);
    });

    it("leaves other suits alone", async () => {
      const ids = await seed();
      const other = await stack.createStackItem({
        name: "Elsewhere",
        suit: "HEARTS",
        featured: false,
      });
      await stack.reorderStackItems("CLUBS", [...ids].reverse());

      expect(
        (await db.stackItem.findUnique({ where: { id: other.id } }))?.sortOrder,
      ).toBe(0);
    });

    it("refuses a partial list", async () => {
      const ids = await seed();
      await expect(
        stack.reorderStackItems("CLUBS", ids.slice(0, 3)),
      ).rejects.toThrow(stack.ReorderMismatch);
    });

    it("refuses a duplicate id", async () => {
      const ids = await seed();
      await expect(
        stack.reorderStackItems("CLUBS", [
          ids[0] ?? "",
          ids[0] ?? "",
          ids[1] ?? "",
          ids[2] ?? "",
        ]),
      ).rejects.toThrow(stack.ReorderMismatch);
    });

    it("refuses an id from another suit", async () => {
      const ids = await seed();
      const other = await stack.createStackItem({
        name: "Elsewhere",
        suit: "HEARTS",
        featured: false,
      });
      await expect(
        stack.reorderStackItems("CLUBS", [...ids.slice(0, 3), other.id]),
      ).rejects.toThrow(stack.ReorderMismatch);
    });
  });
});
