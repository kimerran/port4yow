import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * #43's second acceptance criterion: "every state-changing route enumerated
 * with its origin check confirmed present."
 *
 * ## Why this reads source text instead of calling the handlers
 *
 * Calling them proves the routes that exist today are guarded. It cannot fail
 * for the route somebody adds next month, which is the only failure this
 * criterion is actually about — a sweep that has to be re-run by hand has a
 * shelf life measured in one merge.
 *
 * So the assertion is over the *enumeration*: every state-changing entry point
 * in the tree, discovered by walking it, must carry its guard. The live
 * behaviour is verified separately against a built server (see the handoff:
 * cross-origin 403, absent-Origin 403, same-origin through).
 *
 * `security.checkOrigin` in astro.config.mjs is a backstop, not a substitute.
 * SPEC §14.4 asks for both, and the framework check only covers form content
 * types — a JSON action is outside it entirely, which is exactly the shape
 * `getStats` has.
 */

const SRC = new URL("../", import.meta.url).pathname;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "generated") continue;
      walk(full, out);
    } else if (/\.(ts|astro)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const read = (path: string): string => readFileSync(path, "utf8");
const rel = (path: string): string => path.slice(SRC.length);

/** Comment and blank lines skipped — the guard is the first *statement*. */
function firstStatement(body: string): string {
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("//") || line.startsWith("/*") || line.startsWith("*"))
      continue;
    if (line === "try {") continue; // a guard inside try would still be first
    return line;
  }
  return "";
}

describe("every Astro Action guards before it works (SPEC §14.4, AGENT §3)", () => {
  const source = read(join(SRC, "actions/index.ts"));

  /** `name: defineAction({` at the top level of the exported object. */
  const names = [
    ...source.matchAll(/^ {2}([a-zA-Z][\w]*): defineAction\(\{/gm),
  ].map((m) => m[1] as string);

  it("finds the actions at all", () => {
    // Guards the parser, not the code: a regex that silently matches nothing
    // would make every assertion below vacuously true.
    expect(names.length).toBeGreaterThanOrEqual(15);
    expect(names).toContain("getStats");
    expect(names).toContain("saveHeroThesis");
  });

  it.each(names)("%s calls requireAdmin as its first statement", (name) => {
    const start = source.indexOf(`  ${name}: defineAction({`);
    const handler = source.indexOf("handler:", start);
    expect(handler).toBeGreaterThan(start);

    const bodyStart = source.indexOf("{", source.indexOf("=>", handler));
    const body = source.slice(bodyStart + 1, bodyStart + 600);

    expect(firstStatement(body)).toMatch(/requireAdmin\(context\)/);
  });

  it("requireAdmin checks the origin before it checks the session", () => {
    // Order matters for what an attacker learns: a cross-origin caller must be
    // told "forbidden" whether or not the cookie it replayed was valid.
    const guard = source.slice(source.indexOf("export function requireAdmin"));
    const origin = guard.indexOf("isSameOrigin");
    const sessionCheck = guard.indexOf("assertAdmin(context.locals)");
    expect(origin).toBeGreaterThan(-1);
    expect(sessionCheck).toBeGreaterThan(-1);
    expect(origin).toBeLessThan(sessionCheck);
  });
});

describe("every state-changing route file checks the origin (SPEC §14.4)", () => {
  const files = walk(join(SRC, "pages"));

  /** An API route exporting anything other than GET/HEAD changes state. */
  const apiRoutes = files.filter(
    (f) =>
      f.endsWith(".ts") &&
      /export const (POST|PUT|PATCH|DELETE|ALL):/.test(read(f)),
  );

  /** A page that branches on the request method is handling a form POST. */
  const formPages = files.filter(
    (f) =>
      f.endsWith(".astro") && /request\.method\s*===\s*"POST"/.test(read(f)),
  );

  const stateChanging = [...apiRoutes, ...formPages];

  it("enumerates the routes it is about to assert on", () => {
    // Same reason as above: an empty enumeration passes everything.
    expect(stateChanging.length).toBeGreaterThanOrEqual(3);
    expect(stateChanging.map(rel).sort()).toEqual([
      "pages/admin/login.astro",
      "pages/admin/logout.ts",
      "pages/api/contact.ts",
    ]);
  });

  it.each(stateChanging.map(rel))("%s calls isSameOrigin", (path) => {
    const source = read(join(SRC, path));
    expect(source).toMatch(/isSameOrigin\(/);
    // And acts on it — importing the helper is not the same as using it.
    expect(source).toMatch(/if \(!isSameOrigin\(/);
  });
});

describe("nothing widens CORS on an authenticated surface (AGENT §3)", () => {
  it("no source file sets Access-Control-Allow-Origin at all", () => {
    const offenders = walk(SRC)
      .filter((f) => /Access-Control-Allow-Origin/i.test(read(f)))
      .map(rel);
    // Nothing here is a cross-origin API, so the correct count is zero rather
    // than "zero wildcards" — a specific origin would still be a new decision.
    expect(offenders).toEqual([]);
  });
});
