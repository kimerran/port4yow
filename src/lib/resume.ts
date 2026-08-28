import { readFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "./logger";

/**
 * The resume PDF, read from disk once and cached.
 *
 * ## Why two paths
 *
 * `public/` is the source location and `dist/client/` is where the build copies
 * it. The server runs from the repo root in development and from `/app` in the
 * container, and in both cases `process.cwd()` is that root — so the built copy
 * is tried first and the source second. Getting this wrong is silent: the email
 * still sends, just without the attachment anyone asked for.
 *
 * Cached because it is ~100KB and every gate submission would otherwise re-read
 * it. Cached as `null` on failure too, so a missing file does not turn into a
 * disk read per request.
 */

const CANDIDATES = ["dist/client/resume.pdf", "public/resume.pdf"];

export const RESUME_FILENAME = "Mark-Hugh-Neri-resume.pdf";

let cached: Buffer | null | undefined;

export function readResume(): Buffer | null {
  if (cached !== undefined) return cached;

  for (const relative of CANDIDATES) {
    try {
      cached = readFileSync(join(process.cwd(), relative));
      return cached;
    } catch {
      // Try the next location.
    }
  }

  logger.error("resume pdf not found; welcome mail will have no attachment", {
    looked_in: CANDIDATES.join(", "),
  });
  cached = null;
  return cached;
}
