import type { APIRoute } from "astro";
import { db } from "../../../lib/db";
import { isSafeKey, presignGet } from "../../../lib/storage";

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
      // SPEC §9 — long cache on the REDIRECT itself. The presigned target
      // expires in 5 minutes; the 302 pointing at it is what browsers reuse.
      "Cache-Control": "public, max-age=3600",
    },
  });
};
