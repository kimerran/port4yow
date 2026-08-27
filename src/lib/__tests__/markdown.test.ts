import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../markdown";

/**
 * SPEC §14.6 — `set:html` is permitted only on Markdown that has passed this
 * allowlist. These are the cases the allowlist exists for; a rendering test that
 * only checks headings and lists would pass against a sanitizer that does
 * nothing.
 */
describe("sanitizer — script and event handlers", () => {
  it.each([
    ["raw script tag", "<script>alert(1)</script>"],
    ["img onerror", '<img src=x onerror="alert(1)">'],
    ["svg onload", '<svg onload="alert(1)"></svg>'],
    ["iframe", '<iframe src="https://evil.example"></iframe>'],
    ["object", '<object data="evil.swf"></object>'],
    ["embed", '<embed src="evil.swf">'],
    ["form", '<form action="https://evil.example"><input name="x"></form>'],
    ["style block", "<style>body{display:none}</style>"],
    ["body onload attr", '<body onload="alert(1)">x</body>'],
    ["details ontoggle", '<details ontoggle="alert(1)">x</details>'],
  ])("neutralises %s", async (_label, input) => {
    const html = await renderMarkdown(input);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<iframe/i);
    expect(html).not.toMatch(/<object/i);
    expect(html).not.toMatch(/<embed/i);
    expect(html).not.toMatch(/<form/i);
    expect(html).not.toMatch(/<style/i);
    expect(html).not.toMatch(/on\w+\s*=/i);
    expect(html).not.toContain("alert(1)");
  });
});

describe("sanitizer — dangerous URL protocols", () => {
  it.each([
    ["javascript:", "[link](javascript:alert(1))"],
    ["JaVaScRiPt: mixed case", "[link](JaVaScRiPt:alert(1))"],
    ["data: html", "[link](data:text/html;base64,PHNjcmlwdD4=)"],
    ["vbscript:", "[link](vbscript:msgbox(1))"],
    ["file:", "[link](file:///etc/passwd)"],
  ])("strips %s", async (_label, input) => {
    const html = await renderMarkdown(input);
    expect(html).not.toMatch(/javascript:/i);
    expect(html).not.toMatch(/vbscript:/i);
    expect(html).not.toMatch(/data:text\/html/i);
    expect(html).not.toMatch(/file:/i);
  });

  it.each([
    ["https", "[a](https://example.com)"],
    ["http", "[a](http://example.com)"],
    ["mailto", "[a](mailto:x@example.com)"],
    ["relative", "[a](/work/thing)"],
  ])("keeps %s", async (_label, input) => {
    expect(await renderMarkdown(input)).toMatch(/<a href=/);
  });
});

describe("legitimate Markdown still renders", () => {
  it.each([
    ["heading", "## What I built", /<h2[^>]*>What I built<\/h2>/],
    ["bold", "**bold**", /<strong>bold<\/strong>/],
    ["emphasis", "_em_", /<em>em<\/em>/],
    ["inline code", "`const x = 1`", /<code>const x = 1<\/code>/],
    ["fenced code", "```\nconst x = 1;\n```", /<pre><code>/],
    ["unordered list", "- one\n- two", /<ul>[\s\S]*<li>one<\/li>/],
    ["ordered list", "1. one\n2. two", /<ol>[\s\S]*<li>one<\/li>/],
    ["blockquote", "> quoted", /<blockquote>/],
    ["paragraph", "Just text.", /<p>Just text\.<\/p>/],
  ])("renders %s", async (_label, input, pattern) => {
    expect(await renderMarkdown(input)).toMatch(pattern);
  });

  // BRAND §9 — one h1 per page, and the page title owns it.
  it("does not emit an h1 that would outrank the page title", async () => {
    expect(await renderMarkdown("# Body heading")).not.toMatch(/<h1/);
  });
});

describe("raw HTML is dropped before the allowlist can matter", () => {
  /**
   * Two defences cover this, and either alone is sufficient — which is why
   * flipping `allowDangerousHtml` back on fails NOTHING here (measured). What
   * these tests actually pin is the OUTCOME: raw HTML never reaches the page.
   *
   * Removing `rehypeSanitize` fails 11 tests, so the sanitizer is load-bearing
   * and covered. The un-covered edge is adding BOTH `allowDangerousHtml` and
   * `rehype-raw`, which would make the allowlist the only defence; that is a
   * deliberate pipeline change and the comment in markdown.ts flags it.
   */
  it.each([
    "<script>alert(1)</script>",
    "<iframe src=x></iframe>",
    "<div>plain div</div>",
    "<span>inline</span>",
  ])("drops %s entirely", async (input) => {
    const html = await renderMarkdown(input);
    expect(html).not.toMatch(/<(script|iframe|div|span)/i);
  });
});

/**
 * Issue #16's scope names "inline ProjectImage screenshots resolved into the
 * rendered body", so Markdown images must survive. They were previously dropped
 * silently: `figure`/`figcaption` were allowlisted for images while `img` itself
 * was not, so the wrapper survived and its content vanished.
 */
describe("images", () => {
  it("renders a same-origin image", async () => {
    const html = await renderMarkdown("![Ledger detail](/api/media/a.webp)");
    expect(html).toMatch(/<img[^>]*src="\/api\/media\/a\.webp"/);
    expect(html).toMatch(/alt="Ledger detail"/);
  });

  it("keeps the title attribute", async () => {
    const html = await renderMarkdown('![alt](/api/media/a.webp "A caption")');
    expect(html).toMatch(/title="A caption"/);
  });

  /**
   * SPEC §9 routes every image through /api/media, and astro.config.mjs sets
   * `img-src 'self' data:` — so an external image would be blocked by CSP in the
   * browser regardless. The sanitizer agrees with the CSP rather than emitting
   * markup that fails silently.
   *
   * The protocol-relative case is the one `protocols.src: []` does NOT catch on
   * its own: it carries no scheme, so the sanitizer passes it, and it still
   * loads cross-origin. It is why `assertLocalImageSources` exists.
   */
  it.each([
    ["absolute https", "![x](https://evil.example/a.png)"],
    ["absolute http", "![x](http://evil.example/a.png)"],
    ["protocol-relative", "![x](//evil.example/a.png)"],
    ["javascript:", "![x](javascript:alert(1))"],
    ["data: svg", "![x](data:image/svg+xml,<svg onload=alert(1)>)"],
    ["relative, no leading slash", "![x](a.webp)"],
  ])("drops an image with a %s source", async (_label, input) => {
    const html = await renderMarkdown(input);
    expect(html).not.toMatch(/<img/);
    expect(html).not.toContain("evil.example");
    expect(html).not.toContain("alert(1)");
  });

  it("never emits an img without a src", async () => {
    for (const input of [
      "![x](https://evil.example/a.png)",
      "![x](//evil.example/a.png)",
      "![x](javascript:alert(1))",
    ]) {
      const html = await renderMarkdown(input);
      expect(html).not.toMatch(/<img(?![^>]*\ssrc=)/);
    }
  });

  it("drops a bad image nested inside other elements", async () => {
    const html = await renderMarkdown("> quoted ![x](//evil.example/a.png)");
    expect(html).toMatch(/<blockquote>/);
    expect(html).not.toMatch(/<img/);
  });

  it("keeps a good image nested inside other elements", async () => {
    const html = await renderMarkdown("- item ![ok](/api/media/a.webp)");
    expect(html).toMatch(/<li>[\s\S]*<img[^>]*src="\/api\/media\/a\.webp"/);
  });
});

/**
 * These pin the OUTCOME: half-supported syntax never reaches the page as
 * markup. They do not pin the allowlist itself — removing `table`/`del` from
 * `tagNames` fails 0 tests, and re-adding them fails 0 tests, because
 * `remark-gfm` is absent so the pipeline cannot emit them either way. That is
 * precisely why they were removed: an unreachable allowlist entry is
 * undetectable by construction, so it has to be kept honest by reading.
 *
 * These tests DO fail if someone adds `remark-gfm` and restores the tags
 * without deciding that tables are in scope.
 */
describe("allowlist matches what the pipeline can produce", () => {
  it("does not silently half-support GFM tables", async () => {
    const html = await renderMarkdown("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(html).not.toMatch(/<table/);
    expect(html).toMatch(/\| a \| b \|/);
  });

  it("does not silently half-support strikethrough", async () => {
    const html = await renderMarkdown("~~struck~~");
    expect(html).not.toMatch(/<del/);
  });
});
