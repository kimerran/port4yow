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

/** Every published slug, for getStaticPaths-style needs and the sitemap (#34). */
export async function getPublishedSlugs(): Promise<string[]> {
  const rows = await db.project.findMany({
    where: { status: "PUBLISHED" },
    orderBy: { sequence: "asc" },
    select: { slug: true },
  });
  return rows.map((r) => r.slug);
}
