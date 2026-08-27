import { db } from "./db";
import { derivativeStem, type AssetLike } from "./images";
import { type Suit, suitFromEnum } from "./suits";

/** Project detail data (SPEC §5). */
export interface ProjectDetail {
  slug: string;
  sequence: number;
  title: string;
  suit: Suit;
  summary: string;
  role: string;
  timeline: string;
  problem: string;
  body: string;
  outcome: string;
  liveUrl: string | null;
  repoUrl: string | null;
  stack: string[];
  publishedAt: Date | null;
  /** Drives `dateModified` in the Article JSON-LD (#34). */
  updatedAt: Date;
  /** The cover's media key, for the per-project OG image (#34). */
  coverKey: string | null;
  /** The cover's alt text — an OG image without one is an unlabelled picture. */
  coverAlt: string | null;
  /** Inline screenshots, each with every derivative that exists for it. */
  images: { caption: string | null; assets: AssetLike[] }[];
}

/**
 * Returns null for an unknown OR non-PUBLISHED slug, so the caller 404s.
 *
 * SPEC §5: "Unknown or non-PUBLISHED slug → 404 (never 500, never a redirect
 * that leaks existence)." The status filter is in the WHERE clause rather than a
 * post-fetch check, so a DRAFT row is indistinguishable from one that never
 * existed — same query, same response, same timing.
 */
export async function getPublishedProject(
  slug: string,
): Promise<ProjectDetail | null> {
  const project = await db.project.findFirst({
    where: { slug, status: "PUBLISHED" },
    select: {
      slug: true,
      sequence: true,
      title: true,
      suit: true,
      summary: true,
      role: true,
      timeline: true,
      problem: true,
      body: true,
      outcome: true,
      liveUrl: true,
      repoUrl: true,
      publishedAt: true,
      updatedAt: true,
      /**
       * #34 — a per-project OG image. The widest WebP row is what #17 picks as
       * its fallback `<img src>`, and an OG image has to be the one format every
       * scraper decodes, so an AVIF row would be exactly the wrong choice here.
       */
      coverImage: { select: { key: true, altText: true } },
      stack: {
        orderBy: { sortOrder: "asc" },
        select: { stackItem: { select: { name: true } } },
      },
      images: {
        orderBy: { sortOrder: "asc" },
        select: {
          caption: true,
          asset: {
            select: {
              key: true,
              mimeType: true,
              width: true,
              height: true,
              blurDataUrl: true,
              altText: true,
            },
          },
        },
      },
    },
  });

  if (!project) return null;

  /**
   * A srcset must be built from derivatives that EXIST — #42 treats the
   * MediaAsset row as the authorisation, so a guessed sibling key 404s
   * (measured). Sibling rows are fetched by their shared key stem in ONE query,
   * not one per image (AGENT §2: watch for N+1).
   */
  const stems = [
    ...new Set(
      project.images
        .map((i) => derivativeStem(i.asset.key))
        .filter((s): s is string => s !== null),
    ),
  ];

  const siblings = stems.length
    ? await db.mediaAsset.findMany({
        where: {
          OR: stems.map((stem) => ({ key: { startsWith: `${stem}-` } })),
        },
        select: {
          key: true,
          mimeType: true,
          width: true,
          height: true,
          blurDataUrl: true,
          altText: true,
        },
      })
    : [];

  return {
    ...project,
    suit: suitFromEnum(project.suit),
    coverKey: project.coverImage?.key ?? null,
    coverAlt: project.coverImage?.altText ?? null,
    stack: project.stack.map((s) => s.stackItem.name),
    images: project.images.map((image) => {
      const stem = derivativeStem(image.asset.key);
      const assets = stem
        ? siblings.filter((a) => derivativeStem(a.key) === stem)
        : [];
      return {
        caption: image.caption,
        assets: assets.length > 0 ? assets : [image.asset],
      };
    }),
  };
}

/** The card the "next card" footer flips to (SPEC §5, #18). */
export interface NextProject {
  slug: string;
  title: string;
  suit: Suit;
  sequence: number;
}

/**
 * The next published project by `sequence`, wrapping to the first.
 *
 * Two queries rather than one, and deliberately so: the wrap case is the only
 * one that needs the second, and expressing "next or else first" as a single
 * query means an OR across two orderings that reads worse than this.
 *
 * `sequence > current` rather than `>=` means a tie skips its sibling instead of
 * pointing the card at a project sharing the current sequence — which would
 * otherwise be reachable only by chance of insertion order.
 *
 * Returns null when this is the only published project, so the caller omits the
 * footer rather than rendering a card that links to the page you are on. Note
 * the filter is `status: "PUBLISHED"` on both queries: a DRAFT must never be
 * reachable by walking the deck, which would leak its existence (SPEC §5).
 */
export async function getNextProject(current: {
  slug: string;
  sequence: number;
}): Promise<NextProject | null> {
  const select = {
    slug: true,
    title: true,
    suit: true,
    sequence: true,
  } as const;

  const next =
    (await db.project.findFirst({
      where: { status: "PUBLISHED", sequence: { gt: current.sequence } },
      orderBy: { sequence: "asc" },
      select,
    })) ??
    (await db.project.findFirst({
      where: { status: "PUBLISHED" },
      orderBy: { sequence: "asc" },
      select,
    }));

  if (!next || next.slug === current.slug) return null;

  return { ...next, suit: suitFromEnum(next.suit) };
}

/** Every published slug, for getStaticPaths-style needs and the sitemap (#34). */
export async function getPublishedSlugs(): Promise<string[]> {
  const rows = await db.project.findMany({
    where: { status: "PUBLISHED" },
    orderBy: { sequence: "asc" },
    select: { slug: true },
  });
  return rows.map((r) => r.slug);
}
