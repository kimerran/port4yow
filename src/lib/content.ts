import { getCollection, type CollectionEntry } from "astro:content";

/**
 * Reading projects, now that they are files rather than rows.
 *
 * This replaces `lib/project.ts` and the project half of `lib/home.ts`. Those
 * modules existed to turn Prisma rows into view models — selecting columns,
 * mapping the `Suit` enum, joining `ProjectStack` and assembling image
 * derivatives. A collection entry is already the view model, so what is left
 * here is only the ordering rules that used to live in `ORDER BY` clauses.
 */

export type Project = CollectionEntry<"projects">;

/**
 * Every non-draft project, in sequence order.
 *
 * `draft` replaces the old `ProjectStatus` enum. The three states (DRAFT /
 * PUBLISHED / ARCHIVED) were two more than anything used: archiving and
 * un-publishing were the same action, and a file that should not ship can
 * simply not be committed. One boolean covers the case that remains — a project
 * being written in a branch.
 */
export async function listProjects(): Promise<Project[]> {
  const all = await getCollection("projects", ({ data }) => !data.draft);
  return all.sort((a, b) => a.data.sequence - b.data.sequence);
}

export async function getProject(slug: string): Promise<Project | undefined> {
  const all = await listProjects();
  return all.find((p) => p.id === slug);
}

/** The two-digit ordering marker: 01, 02, … (BRAND §6). */
export function indexOf(project: Project): string {
  return String(project.data.sequence).padStart(2, "0");
}
