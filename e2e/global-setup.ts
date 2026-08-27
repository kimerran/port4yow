import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Puts the database into a known state before any spec runs (#39).
 *
 * ## The admin password is generated, never written down
 *
 * AGENT §3 bans a hardcoded credential "even in a test". The account this suite
 * signs in as is created here with `randomBytes`, hashed with the app's own
 * argon2 settings, and handed to the specs through a gitignored file under
 * `.playwright/`. Nothing in the repository is a password, and the account does
 * not survive the run.
 *
 * ## Why it seeds rather than reusing whatever is there
 *
 * "Next card cycles through the full set and wraps" is a claim about a known
 * number of projects in a known order. Run against a developer's database it
 * would pass or fail for reasons that have nothing to do with the code.
 */

/**
 * The same `.env` bridge `astro.config.mjs` and `prisma.config.ts` already use,
 * and for the same reason: this file runs in the Playwright process, which
 * inherits nothing, and it reaches `src/lib/env.ts` through `db.ts`. Node loads
 * the file itself, so this needs no dependency. CI has no `.env` and supplies
 * the real variables, which is why the failure is swallowed rather than
 * reported — `env.ts` will name whatever is actually missing.
 *
 * `e2e/` sits outside `src/`, so AGENT §3's `process.env` ban and #47's lint
 * rule do not apply here; `src/lib/env.ts` remains the validated boundary for
 * application code.
 */
try {
  process.loadEnvFile();
} catch {
  // No .env — CI passes the variables directly.
}

export interface E2EFixture {
  username: string;
  password: string;
  slugs: string[];
  /** Per-run entropy for `forwardedFor` — see `fixture.ts`. */
  salt: string;
}

export const FIXTURE_PATH = join(process.cwd(), ".playwright", "fixture.json");

/** Distinctive enough that a stray row cannot be mistaken for one of ours. */
const PREFIX = "e2e-";

export default async function globalSetup(): Promise<void> {
  const { db } = await import("../src/lib/db.ts");
  const { hashPassword } = await import("../src/lib/auth.ts");

  const username = `${PREFIX}admin`;
  const password = randomBytes(24).toString("base64url");

  await db.session.deleteMany({});
  await db.contactMessage.deleteMany({
    where: { name: { startsWith: "E2E" } },
  });
  await db.projectImage.deleteMany({});
  await db.project.updateMany({ data: { coverImageId: null } });
  await db.mediaAsset.deleteMany({ where: { key: { contains: PREFIX } } });
  await db.projectStack.deleteMany({});
  await db.project.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await db.user.deleteMany({ where: { username: { startsWith: PREFIX } } });

  await db.user.create({
    data: {
      username,
      passwordHash: await hashPassword(password),
      displayName: "E2E Admin",
    },
  });

  /**
   * Three published projects, so "cycles through the full set and wraps" has a
   * cycle to make — with two, wrapping and alternating are indistinguishable.
   */
  const suits = ["DIAMONDS", "SPADES", "HEARTS"] as const;
  const slugs = suits.map((_, i) => `${PREFIX}project-${String(i + 1)}`);

  const highest = await db.project.aggregate({ _max: { sequence: true } });
  let sequence = (highest._max.sequence ?? 0) + 1;

  for (const [index, slug] of slugs.entries()) {
    await db.project.create({
      data: {
        slug,
        sequence: sequence++,
        title: `E2E Project ${String(index + 1)}`,
        suit: suits[index] as (typeof suits)[number],
        status: "PUBLISHED",
        summary: `Outcome line for project ${String(index + 1)}.`,
        role: "Lead engineer",
        timeline: "Jan 2026 – Feb 2026",
        problem: "The problem this project solved.",
        body: "## Approach\n\nSome **markdown** body copy.",
        outcome: "The measured outcome.",
        publishedAt: new Date(),
      },
    });
  }

  const fixture: E2EFixture = {
    username,
    password,
    slugs,
    salt: randomBytes(8).toString("hex"),
  };
  const { mkdirSync } = await import("node:fs");
  mkdirSync(join(process.cwd(), ".playwright"), { recursive: true });
  writeFileSync(FIXTURE_PATH, JSON.stringify(fixture), "utf8");

  await db.$disconnect();
}
