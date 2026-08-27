import { hash } from "@node-rs/argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { Suit } from "../src/generated/prisma/enums.ts";

/**
 * Idempotent seed (SPEC §4). Safe to re-run: every write is an upsert keyed on a
 * unique column, so a second run produces identical state.
 *
 * Deliberately does NOT import `src/lib/env.ts`. That module validates the whole
 * server environment and refuses to boot without `SESSION_SECRET`, S3 credentials
 * and the rest — none of which seeding needs. Requiring them here would mean you
 * could not seed a database without a full production configuration. It reads the
 * handful of variables it actually uses and applies SPEC §4's stricter password
 * rules itself, which is where that check belongs. Being outside `src/`, AGENT §3's
 * ban does not apply.
 */

/** OWASP minimum (SPEC §8). Not bcrypt, not SHA-anything, not a homemade scheme. */
const ARGON2 = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

const MIN_PASSWORD_LENGTH = 16;
const PLACEHOLDERS = new Set(["admin", "password", "changeme"]);

/** Refuse to create an admin nobody meant to ship. Fail closed (AGENT §1.5). */
function requireStrongPassword(value: string | undefined): string {
  if (!value || value.length === 0) {
    throw new Error(
      "ADMIN_PASSWORD is not set. Generate one with: openssl rand -base64 24",
    );
  }
  // Placeholder BEFORE length, deliberately. Every placeholder SPEC §4 names is
  // shorter than 16 characters, so a length-first order leaves this branch
  // unreachable and tells someone who typed `changeme` that their password is
  // too short — true, but not the useful reason.
  if (PLACEHOLDERS.has(value.toLowerCase())) {
    throw new Error(
      "ADMIN_PASSWORD is a known placeholder. Choose a generated value.",
    );
  }
  if (value.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters (got ${value.length}).`,
    );
  }
  return value;
}

/** BRAND.md §6 taxonomy. Plain and specific — no marketing copy (BRAND §8). */
const STACK: ReadonlyArray<{
  name: string;
  suit: Suit;
  sortOrder: number;
  featured: boolean;
}> = [
  { name: "TypeScript", suit: Suit.SPADES, sortOrder: 1, featured: true },
  { name: "Node.js", suit: Suit.SPADES, sortOrder: 2, featured: true },
  { name: "PostgreSQL", suit: Suit.SPADES, sortOrder: 3, featured: true },
  { name: "Prisma", suit: Suit.SPADES, sortOrder: 4, featured: false },
  { name: "Astro", suit: Suit.DIAMONDS, sortOrder: 1, featured: true },
  { name: "Tailwind CSS", suit: Suit.DIAMONDS, sortOrder: 2, featured: false },
  { name: "React", suit: Suit.DIAMONDS, sortOrder: 3, featured: false },
  { name: "Docker", suit: Suit.CLUBS, sortOrder: 1, featured: true },
  { name: "Railway", suit: Suit.CLUBS, sortOrder: 2, featured: false },
  { name: "GitHub Actions", suit: Suit.CLUBS, sortOrder: 3, featured: false },
  { name: "MinIO", suit: Suit.CLUBS, sortOrder: 4, featured: false },
  { name: "Vitest", suit: Suit.CLUBS, sortOrder: 5, featured: false },
  { name: "Playwright", suit: Suit.CLUBS, sortOrder: 6, featured: false },
  // ♥ Hearts is deliberately empty. BRAND §6 defines it as "Open source" —
  // provenance, i.e. Mark's own contributions — not "happens to be OSS". Read the
  // other way every item here qualifies and the category carries no information.
  // Vitest and Playwright are test runners: ♣ Infrastructure & tooling. Leaving ♥
  // honestly empty until there is real work to put in it; see the handoff's
  // content TODOs.
];

/**
 * Placeholder copy pending Mark's real text — TODO(content), listed in the handoff
 * (AGENT §6). Written in BRAND §8's voice so it is not embarrassing if it ships:
 * plain, specific, slightly dry. No "passionate about", no "crafting digital
 * experiences", and explicitly not the mock's rejected hero line.
 */
const SETTINGS: ReadonlyArray<{ key: string; value: string }> = [
  {
    key: "hero.thesis",
    value:
      "I build and run web systems end to end — schema, server, interface, and the pipeline that ships them.", // TODO(content)
  },
  {
    key: "about.body",
    value:
      "I am a full-stack engineer working mostly in TypeScript, Postgres, and whatever the problem actually needs. " +
      "Most of my work is the unglamorous middle: data models that hold up, endpoints that fail closed, and " +
      "deploys that are boring on purpose. I care about the parts users never see, because those are the parts " +
      "that decide whether the parts they do see keep working.", // TODO(content)
  },
  { key: "social.github", value: "https://github.com/kimerran" }, // TODO(content)
  { key: "social.linkedin", value: "https://www.linkedin.com/in/" }, // TODO(content)
];

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set.");

  const username = process.env.ADMIN_USERNAME ?? "admin";
  const displayName = process.env.ADMIN_DISPLAY_NAME ?? "Mark Hugh Neri";
  const password = requireStrongPassword(process.env.ADMIN_PASSWORD);

  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  try {
    const passwordHash = await hash(password, ARGON2);

    // `update: {}` on purpose: re-running must not rotate a password the operator
    // has already changed, nor reset lockout counters.
    await db.user.upsert({
      where: { username },
      create: { username, passwordHash, displayName },
      update: {},
      select: { id: true },
    });

    for (const item of STACK) {
      await db.stackItem.upsert({
        where: { name: item.name },
        create: item,
        update: {
          suit: item.suit,
          sortOrder: item.sortOrder,
          featured: item.featured,
        },
        select: { id: true },
      });
    }

    for (const setting of SETTINGS) {
      await db.siteSetting.upsert({
        where: { key: setting.key },
        create: setting,
        update: {},
        select: { key: true },
      });
    }

    if (process.env.NODE_ENV !== "production") {
      await seedSampleProjects(db);
    }

    // Never the password (SPEC §4.5).
    process.stdout.write(
      `Seed complete.\n` +
        `  Admin username: ${username}\n` +
        `  Rotate the admin password after first login.\n`,
    );
  } finally {
    await db.$disconnect();
  }
}

/** Non-production only. DRAFT, so nothing sample-shaped can reach the public site. */
async function seedSampleProjects(db: PrismaClient): Promise<void> {
  const samples = [
    {
      slug: "sample-ledger",
      sequence: 1,
      title: "Sample: reconciliation ledger",
      suit: Suit.SPADES,
    },
    {
      slug: "sample-intake",
      sequence: 2,
      title: "Sample: client intake flow",
      suit: Suit.DIAMONDS,
    },
    {
      slug: "sample-pipeline",
      sequence: 3,
      title: "Sample: deploy pipeline",
      suit: Suit.CLUBS,
    },
  ];

  for (const s of samples) {
    await db.project.upsert({
      where: { slug: s.slug },
      create: {
        ...s,
        summary: "Sample record seeded for local development.", // TODO(content)
        role: "Lead engineer",
        timeline: "2025 – 2026",
        problem: "Placeholder problem statement for local development.", // TODO(content)
        body: "Placeholder body. Replaced by real project copy.", // TODO(content)
        outcome: "Placeholder outcome.", // TODO(content)
      },
      update: {},
      select: { id: true },
    });
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    `Seed failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
