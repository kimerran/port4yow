import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `getNextProject` is the deck-walking rule from #18: next by `sequence`,
 * wrapping to the first. The wrap and the self-link cases are the ones worth
 * pinning — both are invisible in a two-project fixture and both are how the
 * footer breaks (a dead end, or a card that links to the page you are on).
 *
 * The db is mocked rather than seeded because what is under test is the
 * ordering rule, not Prisma. The mock implements only the two query shapes
 * `getNextProject` issues, and asserts the `status` filter is present on both —
 * a DRAFT must never be reachable by walking the deck (SPEC §5).
 */
interface Row {
  slug: string;
  title: string;
  suit: string;
  sequence: number;
  status: "PUBLISHED" | "DRAFT";
}

interface FindFirstArgs {
  where: { status: Row["status"]; sequence?: { gt: number } };
  orderBy: { sequence: "asc" | "desc" };
}

let rows: Row[] = [];
const seenWhere: FindFirstArgs["where"][] = [];

vi.mock("../db", () => ({
  db: {
    project: {
      findFirst: vi.fn(({ where, orderBy }: FindFirstArgs) => {
        seenWhere.push(where);
        let pool = rows.filter((r) => r.status === where.status);
        const gt = where.sequence?.gt;
        if (gt !== undefined) pool = pool.filter((r) => r.sequence > gt);
        pool = [...pool].sort((a, b) =>
          orderBy.sequence === "asc"
            ? a.sequence - b.sequence
            : b.sequence - a.sequence,
        );
        return Promise.resolve(pool[0] ?? null);
      }),
    },
  },
}));

const { getNextProject } = await import("../project");

const project = (
  slug: string,
  sequence: number,
  status: Row["status"],
): Row => ({
  slug,
  title: `${slug} title`,
  suit: "DIAMONDS",
  sequence,
  status,
});

beforeEach(() => {
  rows = [];
  seenWhere.length = 0;
});

describe("getNextProject", () => {
  it("returns the next project by sequence", async () => {
    rows = [
      project("a", 1, "PUBLISHED"),
      project("b", 2, "PUBLISHED"),
      project("c", 3, "PUBLISHED"),
    ];
    const next = await getNextProject({ slug: "a", sequence: 1 });
    expect(next?.slug).toBe("b");
  });

  it("wraps from the last project to the first", async () => {
    rows = [
      project("a", 1, "PUBLISHED"),
      project("b", 2, "PUBLISHED"),
      project("c", 3, "PUBLISHED"),
    ];
    const next = await getNextProject({ slug: "c", sequence: 3 });
    expect(next?.slug).toBe("a");
  });

  it("cycles through every published project and returns to the start", async () => {
    rows = [
      project("a", 1, "PUBLISHED"),
      project("b", 2, "PUBLISHED"),
      project("c", 3, "PUBLISHED"),
    ];
    const visited: string[] = [];
    let current = { slug: "a", sequence: 1 };
    for (let i = 0; i < 3; i++) {
      const next = await getNextProject(current);
      if (!next) break;
      visited.push(next.slug);
      current = { slug: next.slug, sequence: next.sequence };
    }
    expect(visited).toEqual(["b", "c", "a"]);
  });

  it("returns null when this is the only published project", async () => {
    rows = [project("a", 1, "PUBLISHED"), project("d", 2, "DRAFT")];
    expect(await getNextProject({ slug: "a", sequence: 1 })).toBeNull();
  });

  it("never walks into a DRAFT", async () => {
    rows = [
      project("a", 1, "PUBLISHED"),
      project("secret", 2, "DRAFT"),
      project("c", 3, "PUBLISHED"),
    ];
    const next = await getNextProject({ slug: "a", sequence: 1 });
    expect(next?.slug).toBe("c");
    for (const where of seenWhere) {
      expect(where.status).toBe("PUBLISHED");
    }
  });

  it("skips a sibling sharing the current sequence rather than linking to it", async () => {
    rows = [
      project("a", 1, "PUBLISHED"),
      project("tie", 1, "PUBLISHED"),
      project("c", 2, "PUBLISHED"),
    ];
    const next = await getNextProject({ slug: "a", sequence: 1 });
    expect(next?.slug).toBe("c");
  });

  it("maps the suit enum rather than leaking the database value", async () => {
    rows = [project("a", 1, "PUBLISHED"), project("b", 2, "PUBLISHED")];
    const next = await getNextProject({ slug: "a", sequence: 1 });
    expect(next?.suit).toBe("diamonds");
  });
});
