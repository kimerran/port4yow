import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Astro drops the newline *after* an expression in a text node.
 *
 * ```astro
 * <p>deleted after {months} months ({years}
 * years)</p>          <!-- serves as "(2years)" -->
 * ```
 *
 * ## Why this is a test and not a note in a review
 *
 * It bit `/privacy` on the one sentence of that page that is a promise, and
 * every check in that PR passed anyway: the page answered 200 and axe found
 * nothing, because a missing space is neither a status code nor an
 * accessibility violation. Prettier will happily *introduce* it too — the wrap
 * is what creates the bug, so formatting is on the hazard's side.
 *
 * The rule is mechanical: an expression must not be the last thing on a line
 * that is followed by more prose. Keep the expression and the word after it
 * together, and the newline has nothing to swallow.
 */

const SRC = new URL("../", import.meta.url).pathname;

function astroFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) astroFiles(full, out);
    else if (entry.endsWith(".astro")) out.push(full);
  }
  return out;
}

/** `class={x}` and `<Foo bar={x} />` are attributes — the rule is about prose. */
const isAttributeOrTag = (line: string): boolean =>
  /=\{[^}]*\}\s*$/.test(line) || /\/>\s*$/.test(line) || /^\s*\}/.test(line);

interface Hazard {
  file: string;
  line: number;
  text: string;
}

function hazards(): Hazard[] {
  const found: Hazard[] = [];
  for (const file of astroFiles(join(SRC))) {
    const lines = readFileSync(file, "utf8").split("\n");
    for (let i = 0; i < lines.length - 1; i++) {
      const current = lines[i] ?? "";
      const next = lines[i + 1] ?? "";
      if (!/\{[^{}]+\}\s*$/.test(current)) continue;
      if (isAttributeOrTag(current)) continue;
      // A word on the next line means the dropped newline was a real space.
      if (!/^\s*[A-Za-z0-9]/.test(next)) continue;
      found.push({
        file: file.slice(SRC.length),
        line: i + 1,
        text: `${current.trim()} ⏎ ${next.trim().slice(0, 40)}`,
      });
    }
  }
  return found;
}

describe("no expression ends a line of prose (Astro eats the newline)", () => {
  it("scans the .astro files it claims to scan", () => {
    // An empty file list would make the assertion below vacuously true — the
    // failure mode of every "grep finds nothing" check.
    expect(astroFiles(join(SRC)).length).toBeGreaterThan(10);
  });

  it("finds none", () => {
    expect(hazards()).toEqual([]);
  });

  it("would find one if it existed", () => {
    // The detector itself, run against the exact shape that shipped, so a
    // future edit cannot quietly turn this suite into a no-op.
    const shipped = [
      "      Contact messages are deleted after {RETENTION_MONTHS} months ({years}",
      "      years). That is not a policy someone remembers to apply:",
    ];
    const current = shipped[0] ?? "";
    const next = shipped[1] ?? "";
    expect(/\{[^{}]+\}\s*$/.test(current)).toBe(true);
    expect(isAttributeOrTag(current)).toBe(false);
    expect(/^\s*[A-Za-z0-9]/.test(next)).toBe(true);
  });
});
