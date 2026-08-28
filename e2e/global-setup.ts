import { randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Prepares the run (#39).
 *
 * It used to seed the database: an admin account with a generated password,
 * three published projects in a known order, and a wipe of anything left over.
 * There is no database and no admin, so all of that is gone. What the specs
 * still need is the list of project slugs — and those are now files on disk, so
 * this reads them rather than creating them.
 *
 * That is a real improvement in what the suite proves. The seeded projects
 * existed so "next project cycles through the full set and wraps" had a known
 * cycle; the specs now walk the projects the site will actually ship.
 */

export interface E2EFixture {
  slugs: string[];
  /** Per-run entropy for `forwardedFor` — see `fixture.ts`. */
  salt: string;
}

export const FIXTURE_PATH = join(process.cwd(), ".playwright", "fixture.json");

/**
 * A Playwright storage state that has already passed the viewing gate.
 *
 * `playwright.config.ts` loads this for every project, so the specs exercise the
 * site rather than the overlay in front of it. The gate has its own spec, which
 * clears this and tests it directly — the bypass exists so that ONE spec covers
 * the gate instead of every spec having to dismiss it.
 *
 * The key and shape must match `access-gate.ts`. They are duplicated rather than
 * imported because that module is browser-only.
 */
export const STORAGE_STATE_PATH = join(
  process.cwd(),
  ".playwright",
  "state.json",
);

const CONTENT_DIR = join(process.cwd(), "src", "content", "projects");

export default function globalSetup(): void {
  /**
   * Slugs come from the filenames, which is exactly how the content loader
   * derives them. Sorted so the fixture is stable across machines — readdir
   * order is not guaranteed — and this is only used to pick *a* project, never
   * to assert an order.
   */
  const slugs = readdirSync(CONTENT_DIR)
    .filter((name) => name.endsWith(".md"))
    .map((name) => name.replace(/\.md$/, ""))
    .sort();

  if (slugs.length < 2) {
    throw new Error(
      `e2e needs at least two projects to test the next-project chain; found ${String(slugs.length)} in ${CONTENT_DIR}`,
    );
  }

  const fixture: E2EFixture = { slugs, salt: randomBytes(8).toString("hex") };
  mkdirSync(join(process.cwd(), ".playwright"), { recursive: true });
  writeFileSync(FIXTURE_PATH, JSON.stringify(fixture), "utf8");

  writeFileSync(
    STORAGE_STATE_PATH,
    JSON.stringify({
      cookies: [],
      origins: [
        {
          origin: "http://localhost:4321",
          localStorage: [
            {
              name: "mhn.access.v1",
              value: JSON.stringify({
                email: "e2e@example.test",
                name: "E2E",
              }),
            },
          ],
        },
      ],
    }),
    "utf8",
  );
}
