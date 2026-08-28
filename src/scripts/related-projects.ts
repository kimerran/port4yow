/**
 * Picks the three "More projects" shown at the foot of a project page.
 *
 * The server renders every candidate with all but the first three `hidden`.
 * This shuffles and re-hides, so the selection changes on every load rather
 * than being baked in at build time.
 *
 * Deliberately not animated: this runs before paint, and the three that end up
 * visible were always going to be visible. Fading them in would advertise that
 * a script ran, which is not information anyone needs.
 */

const SHOWN = 3;

/** Fisher-Yates. Unbiased, unlike `sort(() => Math.random() - 0.5)`. */
function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = out[i];
    const b = out[j];
    if (a === undefined || b === undefined) continue;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

export function initRelatedProjects(): void {
  const list = document.querySelector<HTMLElement>("[data-related-list]");
  if (!list) return;

  const items = [...list.querySelectorAll<HTMLElement>("[data-related-item]")];
  if (items.length <= SHOWN) return;

  const chosen = new Set(shuffle(items).slice(0, SHOWN));

  for (const item of items) {
    const show = chosen.has(item);
    item.hidden = !show;
    /**
     * `hidden` is the whole mechanism, and that is the point: it removes the
     * element from the layout, the tab order and the accessibility tree in one
     * attribute. Hiding with `opacity` or `visibility` would leave the other
     * eleven projects as invisible tab stops at the bottom of every page.
     */
  }

  /**
   * Re-append in the shuffled order so the three do not always appear in
   * sequence order. Without this the picks are random but their arrangement is
   * not, and across a few pages the same project keeps showing up leftmost.
   */
  for (const item of shuffle([...chosen])) list.append(item);
}
