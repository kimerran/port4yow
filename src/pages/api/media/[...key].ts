import type { APIRoute } from "astro";
import { db } from "../../../lib/db";
import {
  isSafeKey,
  presignGet,
  REDIRECT_CACHE_SECONDS,
} from "../../../lib/storage";

export const prerender = false;

/**
 * `GET /api/media/[...key]` (SPEC §9).
 *
 * Validates the key against a `MediaAsset` row, then 302s to a presigned URL with
 * a 5-minute TTL. The storage host never reaches the browser and the bucket stays
 * private.
 *
 * A key with no matching row returns 404 — never a presigned URL, and never a
 * directory listing. The lookup is the authorisation: knowing a key is not enough.
 */
export const GET: APIRoute = async ({ params }) => {
  const key = params.key;

  // AGENT §3 — validate at the boundary, before anything downstream sees it.
  if (typeof key !== "string" || !isSafeKey(key)) {
    return new Response(null, { status: 404 });
  }

  const asset = await db.mediaAsset.findUnique({
    where: { key },
    select: { key: true, bucket: true },
  });

  if (!asset) {
    return new Response(null, { status: 404 });
  }

  const url = await presignGet(asset.key, asset.bucket);

  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      /**
       * Derived from the signature TTL, never a standalone number.
       *
       * SPEC §9 asks for "a 5-minute TTL AND a long Cache-Control on the
       * redirect" — the two cannot both hold. A browser caches the 302 and
       * replays the stale `Location`; the presigned URL behind it 403s once the
       * signature expires. With max-age=3600 that meant a returning visitor got
       * broken images from 5 minutes to 1 hour after first load — invisible in a
       * single session, because the first five minutes work.
       *
       * Capping below the signature keeps the cached redirect strictly younger
       * than the URL it points at. Deriving it means the two cannot drift.
       */
      "Cache-Control": `public, max-age=${REDIRECT_CACHE_SECONDS}`,
    },
  });
};
