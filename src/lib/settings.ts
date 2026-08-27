import { purgeHomeCache } from "./cache";
import { db } from "./db";
import { logger } from "./logger";

/**
 * Site settings — the public copy the admin can edit (SPEC §4, §6, #31).
 *
 * Kept out of `src/actions/index.ts` so it is testable — `astro:actions` is a
 * virtual module only Astro's build resolves.
 */

export type SettingKind = "text" | "url";

export interface SettingDefinition {
  key: string;
  label: string;
  kind: SettingKind;
  /** Characters, not words: a word count cannot be enforced on a `<textarea>`. */
  maxLength: number;
  rows: number;
  /** Shown next to the field. BRAND §8 is a rule, so it belongs where you type. */
  help: string;
}

/**
 * SPEC §4's seeded keys.
 *
 * A closed list, deliberately: an admin screen that accepts arbitrary keys is a
 * screen that can write a setting nothing reads, and #31 names the keys the
 * public pages consume. A new key is a code change in both places anyway,
 * because the page that renders it has to exist.
 */
export const SETTING_DEFINITIONS: readonly SettingDefinition[] = [
  {
    key: "hero.thesis",
    label: "Hero thesis",
    kind: "text",
    /**
     * One sentence at the hero size. ~220 characters is roughly two lines of
     * `display-lg` on a phone; past that the hero stops being a thesis and
     * becomes a paragraph in the wrong typeface.
     */
    maxLength: 220,
    rows: 3,
    help: "One sentence, plain and specific. Not 'passionate about', not 'crafting digital experiences'.",
  },
  {
    key: "about.body",
    label: "Background",
    kind: "text",
    /**
     * ~150 words in a 66ch column (SPEC §5). At an average of six characters a
     * word that is ~900; 1200 leaves room without letting the section outgrow
     * the layout it was measured for.
     */
    maxLength: 1200,
    rows: 8,
    help: "About 150 words. States what you do and what you are responsible for.",
  },
  {
    key: "social.github",
    label: "GitHub URL",
    kind: "url",
    maxLength: 200,
    rows: 1,
    help: "Full https:// URL to your profile.",
  },
  {
    key: "social.linkedin",
    label: "LinkedIn URL",
    kind: "url",
    maxLength: 200,
    rows: 1,
    help: "Full https:// URL to your profile.",
  },
];

export class UnknownSetting extends Error {
  constructor(key: string) {
    super(`"${key}" is not a setting this site reads.`);
    this.name = "UnknownSetting";
  }
}

export class InvalidSetting extends Error {
  constructor(
    readonly key: string,
    message: string,
  ) {
    super(message);
    this.name = "InvalidSetting";
  }
}

/**
 * Hosts a social URL may point at.
 *
 * AGENT §3: nothing user-controlled reaches an outbound URL unvalidated. These
 * values are rendered as `href`s on the public home page, so an unchecked one is
 * a link this site vouches for — the `javascript:` case is the obvious harm, but
 * an `http://` link or an arbitrary host is a quieter one, because the site is
 * still the thing that put it in front of a visitor.
 */
const ALLOWED_URL_HOSTS: Record<string, readonly string[]> = {
  "social.github": ["github.com", "www.github.com"],
  "social.linkedin": ["linkedin.com", "www.linkedin.com"],
};

/**
 * Validates one value against its definition, returning what to store.
 *
 * Pure, so the form can explain and the action can refuse using exactly the same
 * rule — SPEC §6 wants the check server-side, and two copies of a rule is how
 * the two disagree.
 */
export function validateSetting(key: string, raw: string): string {
  const definition = SETTING_DEFINITIONS.find((d) => d.key === key);
  if (!definition) throw new UnknownSetting(key);

  const value = raw.trim();

  if (value.length > definition.maxLength) {
    throw new InvalidSetting(
      key,
      `That is ${String(value.length)} characters. ${definition.label} holds ${String(definition.maxLength)}.`,
    );
  }

  if (definition.kind !== "url") return value;

  // An empty URL means "no link", which the home page already handles by
  // omitting the item rather than rendering a dead one.
  if (value.length === 0) return "";

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new InvalidSetting(key, "That does not look like a full URL.");
  }

  /**
   * `https:` only. `javascript:` is the case #31 names, but `http:` is refused
   * too — a profile link that downgrades the connection is not something to
   * publish, and allowing it would mean the check passes on the one scheme an
   * attacker on the network can rewrite.
   */
  if (parsed.protocol !== "https:") {
    throw new InvalidSetting(key, "Use a full https:// URL.");
  }

  const allowed = ALLOWED_URL_HOSTS[key];
  if (allowed && !allowed.includes(parsed.hostname.toLowerCase())) {
    throw new InvalidSetting(
      key,
      `${definition.label} should point at ${allowed[0] ?? "the expected host"}.`,
    );
  }

  return parsed.toString();
}

export async function listSettings(): Promise<Record<string, string>> {
  const rows = await db.siteSetting.findMany({
    select: { key: true, value: true },
  });
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

/** Writes one setting. Upsert, so a key the seed never wrote can still be set. */
export async function saveSetting(key: string, raw: string): Promise<void> {
  const value = validateSetting(key, raw);

  await db.siteSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });

  purgeHomeCache("site setting changed");
  // The key, never the value: this is public copy today, but a log line that
  // prints whatever was typed into an admin field is a habit worth not forming.
  logger.info("site setting saved", { key });
}
