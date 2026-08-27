import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

/**
 * Server-side Markdown rendering for `Project.body` (SPEC §5, §14.6).
 *
 * SPEC §14.6: `set:html` is permitted ONLY on Markdown that has passed a
 * sanitizer allowlist. This is that sanitizer, and `MarkdownBody.astro` is the
 * only consumer — the ESLint exception is scoped to that one component, the same
 * shape as `JsonLd.astro` (#15).
 *
 * The schema is an ALLOWLIST, not a denylist: anything not named here is dropped,
 * so a tag or attribute nobody anticipated fails closed (AGENT §1.5).
 */
const schema = {
  ...defaultSchema,
  tagNames: [
    "p",
    "br",
    "strong",
    "em",
    "del",
    "code",
    "pre",
    "h2",
    "h3",
    "h4",
    "ul",
    "ol",
    "li",
    "blockquote",
    "hr",
    "a",
    "figure",
    "figcaption",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
  ],
  attributes: {
    ...defaultSchema.attributes,
    a: ["href", "title"],
    code: ["className"],
    th: ["scope"],
    "*": ["id"],
  },
  // Only these protocols may appear in an href. `javascript:` and `data:` are
  // absent on purpose.
  protocols: { ...defaultSchema.protocols, href: ["http", "https", "mailto"] },
  // h1 is reserved for the page title (BRAND §9: never skip heading levels, and
  // one h1 per page), so a body heading can never outrank it.
  clobber: [],
};

/**
 * Two independent defences, in this order:
 *
 * 1. `remarkRehype` WITHOUT `allowDangerousHtml` — raw HTML in the Markdown
 *    source never becomes an element at all. This is what actually stops
 *    `<script>`, `<iframe>` and `onerror`, not the allowlist below.
 *
 *    (Measured: with `allowDangerousHtml: true` and `script` explicitly ADDED to
 *    `tagNames`, `<script>alert(1)</script>` still renders to `""` — the raw node
 *    is dropped wholesale because `rehype-raw` is not in the pipeline. Relying on
 *    the allowlist for raw HTML would have been relying on the wrong thing.)
 *
 * 2. `rehypeSanitize` with the allowlist — governs the elements remark itself
 *    produces. `h1` is the live case: Markdown `# heading` would otherwise
 *    outrank the page title (BRAND §9).
 *
 * The two are independent: with the sanitizer in place, flipping
 * `allowDangerousHtml` back on changes nothing (measured — 0 tests fail). Adding
 * `rehype-raw` as well WOULD collapse it to a single defence, and no test catches
 * that. Don't, without replacing this comment.
 */
const processor = unified()
  .use(remarkParse)
  .use(remarkRehype)
  .use(rehypeSanitize, schema)
  .use(rehypeStringify);

/** Renders Markdown to HTML that has passed the allowlist above. */
export async function renderMarkdown(markdown: string): Promise<string> {
  const file = await processor.process(markdown);
  return String(file);
}
