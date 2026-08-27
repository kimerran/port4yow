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
 *
 * Every tag here is one `remarkParse` + `remarkRehype` can actually produce from
 * CommonMark. Allowlisting more than the pipeline can emit advertises a
 * capability the renderer does not have: `table`/`thead`/`tbody`/`tr`/`th`/`td`
 * and `del` were listed once, but they need `remark-gfm`, which is not in the
 * pipeline — an author writing a table got a wall of literal pipes and no error.
 * Tables are not in #16's scope, so the tags went rather than the dependency.
 * If `remark-gfm` is ever added, add them back in the same commit.
 */
const schema = {
  ...defaultSchema,
  // h1 is absent on purpose: it is reserved for the page title (BRAND §9 — never
  // skip heading levels, one h1 per page), so a body heading can never outrank it.
  tagNames: [
    "p",
    "br",
    "strong",
    "em",
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
    "img",
  ],
  attributes: {
    ...defaultSchema.attributes,
    a: ["href", "title"],
    code: ["className"],
    img: ["src", "alt", "title", "width", "height", "loading", "decoding"],
    "*": ["id"],
  },
  // Only these protocols may appear in these URL attributes. `javascript:` and
  // `data:` are absent on purpose.
  //
  // `href` is load-bearing: widening it fails tests. `src: []` is NOT — measured,
  // relaxing it to `["http", "https"]` fails 0 tests, because
  // `assertLocalImageSources` below already rejects every absolute URL. It is
  // kept as redundant depth, not as the protection, and it is recorded as
  // redundant so nobody later reads it as the thing doing the work. If that pass
  // is ever removed, this line does NOT cover for it — a protocol-relative
  // `//host/x.png` carries no scheme and walks straight through.
  protocols: {
    ...defaultSchema.protocols,
    href: ["http", "https", "mailto"],
    src: [],
  },
  // `clobber` is intentionally left at the default. It was once set to `[]`,
  // which silently disabled the `user-content-` prefixing that stops a
  // user-supplied `id`/`name` from shadowing a DOM property — while `*: ["id"]`
  // above still permits `id`. Nothing user-controlled can produce an `id` today
  // (raw HTML is dropped and there is no `rehype-slug`), so it was not
  // reachable, but it was a disabled defence one plugin away from mattering.
};

/**
 * Images must be same-origin paths.
 *
 * SPEC §9 routes every image through `GET /api/media/[...key]` so the storage
 * host never reaches the browser, and astro.config.mjs sets `img-src 'self'
 * data:`. An external `https://…` image would therefore be BLOCKED BY CSP at
 * render time — allowing it through the sanitizer would emit markup that fails
 * silently in the browser. The sanitizer and the CSP agree instead.
 *
 * `protocols.src: []` above rejects anything carrying a scheme, but it does NOT
 * catch a protocol-relative `//evil.example/x.png`, which has no scheme and
 * still loads cross-origin. That is the case this pass exists for.
 *
 * An image that fails the check is dropped entirely rather than left with a
 * missing `src`: a broken image icon is worse than nothing, and #17 requires
 * that no image element ships without `src`, `alt`, `width` and `height`.
 */
const isLocalPath = (value: string): boolean =>
  value.startsWith("/") && !value.startsWith("//");

interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

function assertLocalImageSources() {
  return (tree: HastNode): void => {
    const walk = (node: HastNode): void => {
      if (!node.children) return;
      node.children = node.children.filter((child) => {
        if (child.type === "element" && child.tagName === "img") {
          const src = child.properties?.["src"];
          if (typeof src !== "string" || !isLocalPath(src)) return false;
        }
        walk(child);
        return true;
      });
    };
    walk(tree);
  };
}

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
 *
 * `assertLocalImageSources` runs AFTER the sanitizer, never before: the
 * sanitizer is what normalises `properties`, and a pass that ran first would be
 * inspecting a tree the sanitizer could still change.
 */
const processor = unified()
  .use(remarkParse)
  .use(remarkRehype)
  .use(rehypeSanitize, schema)
  .use(assertLocalImageSources)
  .use(rehypeStringify);

/** Renders Markdown to HTML that has passed the allowlist above. */
export async function renderMarkdown(markdown: string): Promise<string> {
  const file = await processor.process(markdown);
  return String(file);
}
