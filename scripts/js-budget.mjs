#!/usr/bin/env node
import { spawn } from "node:child_process";

/**
 * SPEC §15 — under 30KB of JavaScript on public pages (#40).
 *
 * ## Why this boots a server instead of measuring `dist/`
 *
 * Astro **inlines** small module scripts straight into the HTML and only emits a
 * separate `.js` file once they grow. Summing `dist/client/**\/*.js` therefore
 * reports 1.6KB while the home page actually ships 2.2KB, and — worse — the
 * number would *fall* as scripts grew past the inlining threshold. A budget that
 * moves the wrong way under load is not a budget.
 *
 * So each page is fetched as a browser would get it, every `<script>` is
 * counted, and referenced files are fetched once and counted per page that
 * references them.
 *
 * JSON-LD is excluded: `type="application/ld+json"` is a data block, never
 * parsed or executed as script.
 */

const BUDGET_BYTES = 30 * 1024;
const PORT = Number(process.env.PORT ?? 4321);
const BASE = `http://localhost:${String(PORT)}`;

/** Public pages only — the admin is behind a login and has no budget. */
const PAGES = ["/", "/privacy", "/404"];

const server = spawn(
  "node",
  ["--env-file-if-exists=.env", "./dist/server/entry.mjs"],
  { stdio: ["ignore", "pipe", "pipe"], env: process.env },
);
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += String(d)));
server.stderr.on("data", (d) => (serverLog += String(d)));

const stop = () => {
  server.kill("SIGTERM");
};

async function ready() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/healthz`);
      if (r.ok || r.status === 503) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  process.stderr.write(`Server never came up.\n${serverLog}\n`);
  stop();
  process.exit(1);
}

await ready();

const fetched = new Map();

/**
 * Bytes of a module and everything it imports, transitively.
 *
 * This is the part a first version got wrong, and the control caught it: Astro
 * does not emit `<script src>` for a page script. It emits an inline module
 * that *imports* the real file —
 *
 *     <script type="module">import "/_astro/scroll-rail.abc123.js";</script>
 *
 * so adding **40KB** of genuine script moved the measured total by **51 bytes**,
 * the length of the import statement. Counting only what is literally inside the
 * tag measures the pointer, not the payload.
 */
async function moduleBytes(url, seen) {
  const key = new URL(url, BASE).pathname;
  if (seen.has(key)) return 0;
  seen.add(key);

  if (!fetched.has(key)) {
    const res = await fetch(new URL(key, BASE));
    fetched.set(key, res.ok ? await res.text() : "");
  }
  const source = fetched.get(key);
  let total = Buffer.byteLength(source);

  for (const spec of importSpecifiers(source)) {
    total += await moduleBytes(spec, seen);
  }
  return total;
}

/** Same-origin specifiers only — a bare specifier never reaches the browser. */
function* importSpecifiers(source) {
  const patterns = [
    /\bimport\s+["']([^"']+)["']/g,
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) {
    for (const m of source.matchAll(re)) {
      const spec = m[1];
      if (spec.startsWith("/")) yield spec;
    }
  }
}

let worst = 0;
const rows = [];

for (const path of PAGES) {
  const res = await fetch(`${BASE}${path}`);
  const html = await res.text();
  const seen = new Set();
  let inline = 0;
  let imported = 0;

  for (const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    const attrs = match[1];
    const body = match[2];
    if (/type\s*=\s*["']application\/ld\+json["']/i.test(attrs)) continue;

    const src = /\ssrc=["']([^"']+)["']/.exec(attrs)?.[1];
    if (src) {
      imported += await moduleBytes(src, seen);
    } else {
      inline += Buffer.byteLength(body);
      for (const spec of importSpecifiers(body)) {
        imported += await moduleBytes(spec, seen);
      }
    }
  }

  const total = inline + imported;
  worst = Math.max(worst, total);
  rows.push({ path, inline, imported, total });
}

stop();

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
process.stdout.write(
  `\nJavaScript per public page (budget ${kb(BUDGET_BYTES)}):\n`,
);
for (const r of rows) {
  process.stdout.write(
    `  ${r.path.padEnd(12)} inline ${String(r.inline).padStart(6)} B  imported ${String(r.imported).padStart(6)} B  total ${kb(r.total).padStart(8)}\n`,
  );
}

if (worst > BUDGET_BYTES) {
  process.stderr.write(
    `\nOver budget: the heaviest page ships ${kb(worst)}, ceiling is ${kb(BUDGET_BYTES)}.\n` +
      `SPEC §15 allows the scroll rail and the contact enhancement and nothing else.\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `\nHeaviest page ${kb(worst)} — ${((worst / BUDGET_BYTES) * 100).toFixed(0)}% of the ${kb(BUDGET_BYTES)} ceiling.\n`,
);
