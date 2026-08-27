import { db } from "./db";
import { SUITS, type Suit, suitFromEnum } from "./suits";

/**
 * Home-page data (SPEC §5).
 *
 * SPEC asks for "one Prisma query with `include` for cover image and stack".
 * Projects, stack items and settings are three different tables with no relation
 * between them, so they cannot be one SQL round trip — but they are issued
 * concurrently and the PROJECT query is a single query with its includes, which
 * is where the N+1 risk AGENT §2 warns about actually lives.
 */

export interface HomeProject {
  slug: string;
  sequence: number;
  title: string;
  suit: Suit;
  summary: string;
  stack: string[];
}

export interface HomeData {
  projects: HomeProject[];
  stackBySuit: { suit: Suit; items: string[] }[];
  settings: Record<string, string>;
}

/** SPEC §5: 3–6 PUBLISHED projects by sequence. */
const MAX_PROJECTS = 6;

export async function getHomeData(): Promise<HomeData> {
  const [projects, stackItems, settings] = await Promise.all([
    // One query, with the includes — no per-tile follow-up (AGENT §2).
    db.project.findMany({
      where: { status: "PUBLISHED" },
      orderBy: { sequence: "asc" },
      take: MAX_PROJECTS,
      select: {
        slug: true,
        sequence: true,
        title: true,
        suit: true,
        summary: true,
        stack: {
          orderBy: { sortOrder: "asc" },
          select: { stackItem: { select: { name: true } } },
        },
      },
    }),
    db.stackItem.findMany({
      orderBy: [{ suit: "asc" }, { sortOrder: "asc" }],
      select: { name: true, suit: true },
    }),
    db.siteSetting.findMany({ select: { key: true, value: true } }),
  ]);

  return {
    projects: projects.map((p) => ({
      slug: p.slug,
      sequence: p.sequence,
      title: p.title,
      suit: suitFromEnum(p.suit),
      summary: p.summary,
      stack: p.stack.map((s) => s.stackItem.name),
    })),
    // Grouped in the BRAND §6 order, and suits with no items are dropped rather
    // than rendered empty — ♥ Open source is deliberately empty until Mark has
    // contributions to list (#6).
    stackBySuit: SUITS.map((suit) => ({
      suit,
      items: stackItems
        .filter((i) => suitFromEnum(i.suit) === suit)
        .map((i) => i.name),
    })).filter((group) => group.items.length > 0),
    settings: Object.fromEntries(settings.map((s) => [s.key, s.value])),
  };
}
