/**
 * Reveal-on-scroll (BRAND §9).
 *
 * Adds `is-revealed` to `.reveal` / `.reveal-stagger` blocks as they enter the
 * viewport. The CSS in `global.css` does the rest.
 *
 * ## Two rules this obeys, both of which are easy to get wrong
 *
 * 1. **It opts IN to hiding.** The stylesheet only hides anything under
 *    `[data-reveal-ready]`, and this file sets that attribute. If the script
 *    fails to load, throws, or is disabled, nothing is ever hidden — the page is
 *    just a page. The alternative (hide in CSS, reveal in JS) turns any script
 *    failure into a blank page, and it is a failure you cannot see locally
 *    because the script always loads.
 *
 * 2. **Reduced motion takes the no-JS path.** It returns before setting the
 *    attribute, so there is no separate "reduced" styling to keep in sync — one
 *    code path, not two.
 */

/** Reveal slightly before the block is fully on screen, so it is not obviously late. */
const ROOT_MARGIN = "0px 0px -10% 0px";

export function initReveal(): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const targets = [
    ...document.querySelectorAll<HTMLElement>(".reveal, .reveal-stagger"),
  ];
  if (targets.length === 0) return;

  /**
   * No IntersectionObserver means no reveal, rather than a scroll listener
   * fallback. The effect is decoration; a `scroll` handler doing layout reads on
   * every frame is a real cost, and trading one for the other is a bad deal.
   */
  if (!("IntersectionObserver" in window)) return;

  document.documentElement.setAttribute("data-reveal-ready", "");

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-revealed");
        // One-shot: re-hiding on scroll-up is the behaviour that makes these
        // feel like a gimmick rather than an entrance.
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: ROOT_MARGIN, threshold: 0.05 },
  );

  /**
   * Reveal immediately if focus lands inside a block that has not revealed yet.
   *
   * Tabbing to an off-screen link scrolls it into view, which trips the observer
   * — but the observer fires a frame later, so for that frame the focused
   * element is invisible. Anyone navigating by keyboard hits this on every page.
   * `focusin` bubbles, so one listener covers every block.
   */
  document.addEventListener("focusin", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const block = target.closest(".reveal, .reveal-stagger");
    if (block) block.classList.add("is-revealed");
  });

  for (const target of targets) {
    /**
     * Anything already on screen at load is revealed immediately rather than
     * observed. The observer would do this itself on its first callback, but a
     * frame later — long enough to see the hero flash in on every navigation.
     */
    const box = target.getBoundingClientRect();
    if (box.top < window.innerHeight && box.bottom > 0) {
      target.classList.add("is-revealed");
      continue;
    }
    observer.observe(target);
  }
}
