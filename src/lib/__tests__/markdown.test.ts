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
