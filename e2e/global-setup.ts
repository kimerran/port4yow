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

import { STORAGE_STATE_PATH } from "../playwright.config.ts";

export { STORAGE_STATE_PATH };

export const FIXTURE_PATH = join(process.cwd(), ".playwright", "fixture.json");

/**
 * Where the gate-bypass storage state is written.
 *
 * Imported from `playwright.config.ts` rather than declared here: the config
 * needs it too, and a config that imports from `e2e/` cannot type-check inside
 * the Docker image, which excludes that directory.
 */

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
