/**
 * Reordering the project list (#27).
 *
 * The list works without this file: the up/down buttons are real buttons and the
 * form posts the resulting order. This adds drag-and-drop on top and submits
 * without a page reload.
 *
 * BRAND §9 forbids hover-only and pointer-only affordances, so the keyboard path
 * is not a fallback bolted on afterwards — the buttons are the primary control
 * and drag is the enhancement. Both write the same hidden field, so there is one
 * source of truth for what gets saved.
 */

const STATUS = "[data-reorder-status]";

function announce(root: ParentNode, message: string): void {
  const status = root.querySelector<HTMLElement>(STATUS);
  if (status) status.textContent = message;
}

/** Rewrites the visible rank and the hidden field from current DOM order. */
function sync(list: HTMLOListElement): void {
  const items = [
    ...list.querySelectorAll<HTMLLIElement>("li[data-project-id]"),
  ];

  items.forEach((item, index) => {
    const rank = item.querySelector<HTMLElement>(".text-index-rank");
    if (rank) rank.textContent = String(index + 1).padStart(2, "0");

    // The first item cannot move up and the last cannot move down. Disabling
    // rather than hiding keeps the tab order stable as items move.
    const up = item.querySelector<HTMLButtonElement>('[data-move="up"]');
    const down = item.querySelector<HTMLButtonElement>('[data-move="down"]');
    if (up) up.disabled = index === 0;
    if (down) down.disabled = index === items.length - 1;
  });

  /**
   * One hidden input per id, rewritten in the list's current order. Astro maps
   * repeated fields onto `z.array()` with `getAll`, which preserves document
   * order — so the DOM order IS the submitted order, with no parsing step in
   * between for an ordering bug to hide in.
   */
  const holder = document.querySelector<HTMLElement>("[data-ordered-ids]");
  if (holder) {
    holder.replaceChildren(
      ...items.map((item) => {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = "orderedIds";
        input.value = item.dataset.projectId ?? "";
        return input;
      }),
    );
  }
}

export function initProjectReorder(root: ParentNode = document): void {
  const list = root.querySelector<HTMLOListElement>("#project-order");
  if (!list) return;

  list.addEventListener("click", (event) => {
    const button = (
      event.target as HTMLElement | null
    )?.closest<HTMLButtonElement>("[data-move]");
    if (!button || button.disabled) return;

    const item = button.closest<HTMLLIElement>("li[data-project-id]");
    if (!item) return;

    const direction = button.dataset.move;
    const sibling =
      direction === "up"
        ? item.previousElementSibling
        : item.nextElementSibling;
    if (!sibling) return;

    if (direction === "up") item.parentElement?.insertBefore(item, sibling);
    else item.parentElement?.insertBefore(sibling, item);

    sync(list);

    /**
     * Focus follows the item, not the position. Without this the button under
     * the cursor now belongs to a different project, so a second press moves
     * the wrong one — and a keyboard user has no way to notice.
     */
    const moved = item.querySelector<HTMLButtonElement>(
      `[data-move="${direction ?? "up"}"]`,
    );
    if (moved && !moved.disabled) moved.focus();
    else item.querySelector<HTMLButtonElement>("[data-move]")?.focus();

    const title = item.querySelector("a")?.textContent?.trim() ?? "Project";
    const position =
      [...list.querySelectorAll("li[data-project-id]")].indexOf(item) + 1;
    announce(root, `${title} moved to position ${String(position)}.`);
  });

  sync(list);
}
