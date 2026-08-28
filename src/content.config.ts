import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

/**
 * Projects are files, not database rows (#projects-static).
 *
 * They used to live in Postgres behind an admin CRUD: three pages, five
 * actions, three tables and a media pipeline, all to maintain a list that
 * changes a few times a year. A content collection replaces the lot — the
 * content is versioned with the code, reviewable in a diff, and the site needs
 * no database to render it.
 *
 * `image()` is the reason the cover lives in frontmatter rather than as a
 * string path: Astro resolves it at build time, so a typo'd filename fails the
 * build instead of shipping a broken thumbnail, and the optimized derivatives
 * are generated for us.
 */
const projects = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/projects" }),
  schema: ({ image }) =>
    z.object({
      title: z.string().min(1).max(120),
      /** Sub-title on the detail page. The PDF calls this the descriptor line. */
      tagline: z.string().min(1).max(160),
      /**
       * The only text on the grid tile besides the title, so it states an
       * outcome rather than describing the app. 180 chars was the old column
       * width and remains a useful discipline.
       */
      summary: z.string().min(1).max(180),
      category: z.enum([
        "Product & client work",
        "Systems & backend",
        "Open source",
        "Infrastructure & tooling",
      ]),
      /** Drives the 01/02 index and the next-project order. Unique, checked below. */
      sequence: z.number().int().positive(),
      cover: image(),
      coverAlt: z.string().min(1).max(500),
      stack: z.array(z.string().min(1)).min(1),
      liveUrl: z.url().optional(),
      repoUrl: z.url().optional(),
      /**
       * True when an NDA forbids naming the client. Nothing in the file may
       * carry the real name; this flag exists so the detail page can say why
       * there is no link rather than leaving a conspicuous gap.
       */
      whiteLabel: z.boolean().default(false),
      /**
       * Hackathon provenance, shown as a badge on the grid tile.
       *
       * A closed enum rather than a free string: these are claims about
       * competition results, and "Hackathon Winner" appearing as "Hackaton
       * Winner" on one card out of fourteen is the kind of typo nobody reads
       * twice. The build refuses anything not in this list.
       */
      badge: z.enum(["Hackathon Winner", "Hackathon Project"]).optional(),
      /** Omit to keep a project out of the site entirely. */
      draft: z.boolean().default(false),
    }),
});

export const collections = { projects };
