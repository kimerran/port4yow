import { expect, test } from "@playwright/test";

/**
 * Keyboard-only traversal with visible focus at every stop (#39, BRAND §9).
 *
 * The check that matters is **every** stop, not a sample: a single element with
 * `outline: none` and no replacement is exactly the regression AGENT §3 bans,
 * and it would be invisible to a spot check. So this tabs the whole page and
 * records the computed focus style at each stop.
 */

interface Stop {
  tag: string;
  text: string;
  outlineStyle: string;
  outlineWidth: number;
  boxShadow: string;
  visible: boolean;
}

const describeFocus = `(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const style = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return {
    tag: el.tagName.toLowerCase(),
    text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40),
    outlineStyle: style.outlineStyle,
    outlineWidth: parseFloat(style.outlineWidth) || 0,
    boxShadow: style.boxShadow,
    visible: rect.width > 0 && rect.height > 0,
  };
})()`;

async function walk(
  page: import("@playwright/test").Page,
  limit = 60,
): Promise<Stop[]> {
  const stops: Stop[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate<Stop | null>(describeFocus);
    if (!stop) break;
    const key = `${stop.tag}:${stop.text}:${String(i)}`;
    if (seen.has(key)) break;
    seen.add(key);
    stops.push(stop);
  }
  return stops;
}

/** BRAND §9's floor: a 2px outline, or a deliberate replacement. */
const hasVisibleFocus = (stop: Stop): boolean =>
  (stop.outlineStyle !== "none" && stop.outlineWidth >= 2) ||
  stop.boxShadow !== "none";

test("every tab stop on the home page shows visible focus", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("body").click({ position: { x: 1, y: 1 } });

  const stops = await walk(page);

  // The enumeration first — a page that yields no stops would pass vacuously,
  // and a broken `describeFocus` looks exactly like a page with no links.
  expect(stops.length, "no tab stops found").toBeGreaterThan(5);

  const bad = stops.filter((s) => !hasVisibleFocus(s));
  expect(
    bad,
    `stops with no visible focus:\n${bad
      .map(
        (s) =>
          `  <${s.tag}> "${s.text}" outline=${s.outlineStyle} ${String(s.outlineWidth)}px`,
      )
      .join("\n")}`,
  ).toEqual([]);
});

test("the whole contact form is reachable and operable by keyboard", async ({
  page,
}) => {
  await page.goto("/#contact");

  // Reached by tabbing, not by .focus() — the point is that the path exists.
  const reached: string[] = [];
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press("Tab");
    const id = await page.evaluate(
      () => document.activeElement?.getAttribute("id") ?? "",
    );
    if (id) reached.push(id);
    if (id === "contact-message") break;
  }

  for (const id of ["contact-name", "contact-email", "contact-message"]) {
    expect(reached, `${id} was never reached by Tab`).toContain(id);
  }

  // The honeypot must NOT be reachable — it is tabindex=-1 for exactly this.
  expect(reached).not.toContain("contact-company");
});

test("a project tile can be opened with Enter", async ({ page }) => {
  await page.goto("/");
  const tile = page.locator("#work a").first();
  await tile.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/work\//);
});
