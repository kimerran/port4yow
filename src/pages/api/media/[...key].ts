import type { APIRoute } from "astro";
import { db } from "../../../lib/db";
import {
  getObject,
  isSafeKey,
  MEDIA_CACHE_SECONDS,
} from "../../../lib/storage";

export const prerender = false;

/**
 * `GET /api/media/[...key]` (SPEC §9).
 *
 * Validates the key against a `MediaAsset` row, then STREAMS the object through
 * this origin. The bucket stays private and the storage host never reaches the
 * browser — literally, not just in intent.
 *
 * A key with no matching row returns 404 — never a directory listing, and never
 * anything that reveals whether the object exists in the bucket. The row lookup
 * IS the authorisation: knowing a key is not enough.
 *
 * ## Why this proxies rather than redirecting
 *
 * SPEC §9 says both "302s to a presigned URL" and "Storage host never reaches
 * the browser". Those contradict each other, and the contradiction is not
 * academic: #33 sets `img-src 'self' data:` per SPEC §14.2, so when #17 became
 * the first consumer, Chrome blocked every redirect target with
 * `blockedReason: "csp"` and no image painted at all. Measured, not reasoned:
 * `naturalWidth` was 0 on every image on the page.
 *
 * There were two ways out. Adding the storage origin to `img-src` would have
 * worked, but it weakens `default-src 'self'` to unblock a feature and the
 * origin is environment-dependent (`S3_ENDPOINT` differs on Railway) — AGENT
 * §1.2 rules that out. Proxying keeps `img-src 'self'` intact, makes SPEC §9's
 * storage-host sentence true as written, and as a bonus makes its OTHER
 * requirement satisfiable: a long `Cache-Control` was impossible behind a
 * 5-minute signature and is trivial without one.
 *
 * This does change the mechanism SPEC §9 names, so it wants ratifying in the
 * §9 amendment rather than being treated as settled.
 */
export const GET: APIRoute = async ({ params, request }) => {
  const key = params.key;

  // AGENT §3 — validate at the boundary, before anything downstream sees it.
  if (typeof key !== "string" || !isSafeKey(key)) {
    return new Response(null, { status: 404 });
  }

  const asset = await db.mediaAsset.findUnique({
    where: { key },
    select: { key: true, bucket: true, mimeType: true, checksum: true },
  });

  if (!asset) {
    return new Response(null, { status: 404 });
  }

  /**
   * The row's checksum, not the storage ETag: it is stable across a re-upload of
   * identical bytes and never leaks a storage implementation detail. Quoted
   * because an ETag is a quoted-string by RFC 9110.
   */
  const etag = `"${asset.checksum}"`;
  const cacheControl = `public, max-age=${MEDIA_CACHE_SECONDS}, immutable`;

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, {
      status: 304,
      headers: { ETag: etag, "Cache-Control": cacheControl },
    });
  }

  const object = await getObject(asset.key, asset.bucket);

  if (!object) {
    return new Response(null, { status: 404 });
  }

  const headers = new Headers({
    // From the row, never from the storage response — the row's mimeType was
    // sniffed from magic bytes at upload (SPEC §9). See getObject.
    "Content-Type": asset.mimeType,
    "Cache-Control": cacheControl,
    ETag: etag,
    // The bytes are an image, and nothing should ever re-sniff them as markup.
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": "inline",
  });

  if (object.contentLength !== null) {
    headers.set("Content-Length", String(object.contentLength));
  }

  return new Response(object.body, { status: 200, headers });
};
