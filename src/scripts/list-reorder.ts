/**
 * Keyboard-first list reordering, shared by the project list (#27) and the
 * stack lists (#29).
 *
 * ## Why this is one module rather than two
 *
 * #29 needed the same behaviour as #27 with a different selector. Copying the
 * file would have left two implementations of one rule, and the copy that drifts
 * is always the one nobody is looking at — the same failure this codebase has
 * already hit with the origin check (#25) and the `toActionError` mapper (#28).
 *
 * ## What it enhances, and what it does not provide
 *
 * The lists work WITHOUT this file: the up/down buttons are real buttons inside
 * a form that posts to an Action, so ordering is fully operable with JavaScript
 * disabled. BRAND §9 forbids pointer-only affordances, so the buttons are the
 * primary control and this is the polish on top.
 *
 * ## The contract
 *
 * - a list element carrying `data-reorder-list="<key>"`
 * - items carrying `data-item-id`
 * - move buttons carrying `data-move="up" | "down"`
 * - a hidden-input holder carrying `data-ordered-ids="<key>"`
 * - optionally a `[data-reorder-status]` live region, and a
 *   `.text-index-rank` element per item to renumber
 */

const labelFor = (item: Element): string => {
  const link = item.querySelector("a");
  if (link?.textContent) return link.textContent.trim();
  const named = item.querySelector<HTMLInputElement>('input[name="name"]');
  if (named?.value) return named.value;
  return "Item";
};

function announce(list: HTMLElement, message: string): void {
  /**
   * The live region nearest this list, not the first on the page. The stack
   * screen renders one list per suit, and announcing a move into another suit's
   * region would tell a screen-reader user nothing useful.
   */
  const status =
    list.parentElement?.querySelector<HTMLElement>("[data-reorder-status]") ??
    document.querySelector<HTMLElement>("[data-reorder-status]");
  if (status) status.textContent = message;
}

/** Rewrites ranks, button states and the hidden inputs from current DOM order. */
function sync(list: HTMLElement): void {
  const key = list.dataset.reorderList ?? "";
  const items = [...list.querySelectorAll<HTMLElement>("[data-item-id]")];

  items.forEach((item, index) => {
    const rank = item.querySelector<HTMLElement>(".text-index-rank");
    if (rank) rank.textContent = String(index + 1).padStart(2, "0");

    // The first cannot move up and the last cannot move down. Disabling rather
    // than hiding keeps the tab order stable as items move.
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
  const holder = document.querySelector<HTMLElement>(
    `[data-ordered-ids="${key}"]`,
  );
  if (!holder) return;

  holder.replaceChildren(
    ...items.map((item) => {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = "orderedIds";
      input.value = item.dataset.itemId ?? "";
      return input;
    }),
  );
}

export function initListReorder(root: ParentNode = document): void {
  const lists = [...root.querySelectorAll<HTMLElement>("[data-reorder-list]")];

  for (const list of lists) {
    list.addEventListener("click", (event) => {
      const button = (
        event.target as HTMLElement | null
      )?.closest<HTMLButtonElement>("[data-move]");
      if (!button || button.disabled || !list.contains(button)) return;

      const item = button.closest<HTMLElement>("[data-item-id]");
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
       * Focus follows the ITEM, not the position. Without this the button under
       * the cursor now belongs to a different row, so a second press moves the
       * wrong one — and a keyboard user has no way to notice.
       */
      const moved = item.querySelector<HTMLButtonElement>(
        `[data-move="${direction ?? "up"}"]`,
      );
      if (moved && !moved.disabled) moved.focus();
      else item.querySelector<HTMLButtonElement>("[data-move]")?.focus();

      const position =
        [...list.querySelectorAll("[data-item-id]")].indexOf(item) + 1;
      announce(
        list,
        `${labelFor(item)} moved to position ${String(position)}.`,
      );
    });

    sync(list);
  }
}
