import { logger } from "./logger";

/**
 * Cache invalidation for the public pages (SPEC §5, #27).
 *
 * ## Read this before assuming the cache is purged
 *
 * SPEC §5 says the home page's cache "is purged on any project mutation". There
 * is nothing in the stack that can do that today: SPEC §13 deploys `web`,
 * `postgres` and `minio` on Railway and names no CDN, so there is no purge API
 * to call. The home page is served with
 * `s-maxage=300, stale-while-revalidate=86400`, which means a shared cache in
 * front of the app may serve a pre-publish copy for **up to 5 minutes** after
 * publishing, and a stale one for longer while it revalidates.
 *
 * This function is the seam where a real purge goes the moment a CDN exists. It
 * logs rather than pretending, so the gap is visible in the operational record
 * instead of being invisible in code that looks like it works.
 *
 * The alternative — quietly doing nothing at the call site — would leave #27's
 * "publishing purges the home cache" reading as satisfied when it is not.
 */
export function purgeHomeCache(reason: string): void {
  logger.info("home cache purge requested", {
    reason,
    // Explicit, so a log reader is not left inferring it.
    performed: false,
    note: "no CDN purge API in the stack (SPEC §13); s-maxage=300 applies",
  });
}
