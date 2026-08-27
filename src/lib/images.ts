/**
 * Responsive image sources (SPEC §5, §9, §15).
 *
 * SPEC §9 generates widths [480, 960, 1440, 1920] in AVIF + WebP, with the width
 * encoded in the key: `projects/{projectId}/{ulid}-{width}.{ext}`.
 *
 * But `MediaAsset.key` is `@unique` — one row per OBJECT — and #42's route treats
 * the row lookup as the authorisation. So a `srcset` built by GUESSING sibling
 * keys 404s: measured, `projects/demo/img-480.webp` returns 404 when only
 * `img-960.webp` is registered.
 *
 * Therefore the srcset is built from the rows that actually exist. That degrades
 * correctly in both directions: one registered derivative renders a single
 * source, and once #28 registers all eight the full set appears, with no change
 * here.
 */
export interface AssetLike {
  key: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  blurDataUrl: string | null;
  altText: string;
}

export interface PictureSource {
  type: string;
  srcset: string;
}

export interface Picture {
  sources: PictureSource[];
  /** Fallback <img> src — the widest raster the browser is sure to handle. */
  src: string;
  width: number | null;
  height: number | null;
  blurDataUrl: string | null;
  alt: string;
}

/** Everything is served through our own origin (SPEC §9). */
export const mediaUrl = (key: string): string => `/api/media/${key}`;

/**
 * The stem shared by every derivative of one upload: `…/{ulid}` from
 * `…/{ulid}-{width}.{ext}`. Returns null when the key does not carry a width,
 * so a non-conforming key is simply treated as having no siblings.
 */
export function derivativeStem(key: string): string | null {
  const match = /^(.*)-(\d+)\.[A-Za-z0-9]+$/.exec(key);
  return match ? (match[1] ?? null) : null;
}

/** AVIF first, WebP second, anything else last (SPEC §15: "AVIF first"). */
const TYPE_ORDER = ["image/avif", "image/webp"];

function rank(mimeType: string): number {
  const i = TYPE_ORDER.indexOf(mimeType);
  return i === -1 ? TYPE_ORDER.length : i;
}

/**
 * Builds a <picture> from the derivatives that exist.
 *
 * `alt` is required by the schema and never defaulted here: SPEC §9 says
 * "required — never allow empty", so an empty alt must fail loudly at the
 * boundary rather than render a silently inaccessible image.
 */
export function buildPicture(assets: AssetLike[]): Picture {
  if (assets.length === 0) throw new Error("buildPicture: no assets");

  const byType = new Map<string, AssetLike[]>();
  for (const asset of assets) {
    const list = byType.get(asset.mimeType) ?? [];
    list.push(asset);
    byType.set(asset.mimeType, list);
  }

  const sources: PictureSource[] = [...byType.entries()]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([type, list]) => ({
      type,
      srcset: list
        .slice()
        .sort((a, b) => (a.width ?? 0) - (b.width ?? 0))
        .map((a) => `${mediaUrl(a.key)} ${a.width ?? 0}w`)
        .join(", "),
    }));

  // Fallback: the widest NON-AVIF raster, since AVIF is the format most likely
  // to be unsupported by whatever is reading the bare <img>.
  const fallbackPool = assets.filter((a) => a.mimeType !== "image/avif");
  const pool = fallbackPool.length > 0 ? fallbackPool : assets;
  const fallback = pool.reduce((best, a) =>
    (a.width ?? 0) > (best.width ?? 0) ? a : best,
  );

  const alt = fallback.altText;
  if (alt.trim().length === 0) {
    throw new Error(`buildPicture: asset ${fallback.key} has empty altText`);
  }

  return {
    sources,
    src: mediaUrl(fallback.key),
    width: fallback.width,
    height: fallback.height,
    blurDataUrl: fallback.blurDataUrl,
    alt,
  };
}
