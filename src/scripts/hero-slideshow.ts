/**
 * The hero slideshow (BRAND §5, §9).
 *
 * Shuffles the frames on every load, crossfades between them, and exposes prev
 * and next controls. The order is randomised in the browser rather than on the
 * server because the page is prerendered — one HTML file is served to everyone,
 * so a build-time shuffle would produce one fixed order until the next deploy.
 *
 * ## Reduced motion
 *
 * BRAND §9 disables lifts, image scales and the rail fill under
 * `prefers-reduced-motion: reduce`. An auto-advancing slideshow is a stronger
 * case than any of those: it moves without being asked and cannot be stopped.
 * So under that preference it does not auto-advance — it picks one frame at
 * random and holds. The randomness stays because a still image is not motion.
 *
 * **The controls keep working.** Removing them would be the wrong reading of the
 * preference: reduced motion means "do not move without my consent", not "do not
 * let me navigate". A control press is consent, so it swaps instantly rather
 * than crossfading.
 */

const INTERVAL_MS = 5000;
const FADE_MS = 700;

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

export function initHeroSlideshow(): void {
  const root = document.querySelector<HTMLElement>("[data-hero-slideshow]");
  if (!root) return;

  const frames = [...root.querySelectorAll<HTMLElement>("[data-hero-frame]")];
  if (frames.length === 0) return;

  const order = shuffle(frames);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /**
   * A hidden frame is removed from the tab order AND the accessibility tree.
   *
   * `opacity: 0` alone leaves a link focusable and announced — fourteen of them,
   * thirteen invisible, at the top of the page. That is the failure this
   * function exists to prevent, so the three properties move together and never
   * separately.
   */
  const setActive = (el: HTMLElement, active: boolean): void => {
    el.style.opacity = active ? "1" : "0";
    el.classList.toggle("pointer-events-none", !active);
    if (active) el.removeAttribute("aria-hidden");
    else el.setAttribute("aria-hidden", "true");

    /**
     * The frame is a container now, not the link itself — it holds the stretched
     * project link and, when the project has one, a live-site link. `tabIndex`
     * has to be set on EVERY anchor inside it: setting it on the wrapper does
     * nothing, and missing the second one would leave a hidden live-site link
     * focusable on all thirteen inactive frames.
     */
    for (const link of el.querySelectorAll("a")) {
      link.tabIndex = active ? 0 : -1;
    }
  };

  let current = 0;

  // Instant for the initial placement; the transition is added afterwards so
  // the first frame does not fade in from nothing on load.
  for (const frame of frames) {
    frame.style.transitionProperty = "opacity";
    frame.style.transitionDuration = "0ms";
    setActive(frame, false);
  }
  const first = order[0];
  if (!first) return;
  setActive(first, true);

  if (!reduced) {
    for (const frame of frames) {
      frame.style.transitionDuration = `${String(FADE_MS)}ms`;
      frame.style.transitionTimingFunction = "ease";
    }
  }

  const go = (delta: number): void => {
    if (order.length < 2) return;
    const next = (current + delta + order.length) % order.length;
    const showing = order[current];
    const upcoming = order[next];
    if (!showing || !upcoming) return;

    setActive(upcoming, true);
    setActive(showing, false);
    current = next;
  };

  let timer: ReturnType<typeof setInterval> | null = null;

  const stop = (): void => {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  };

  const start = (): void => {
    if (reduced || order.length < 2) return;
    timer ??= setInterval(() => {
      go(1);
    }, INTERVAL_MS);
  };

  /**
   * A manual press restarts the clock rather than leaving it to fire whenever it
   * was next due — otherwise pressing next 200ms before a tick advances twice,
   * which reads as the control being broken.
   */
  const manual = (delta: number) => (): void => {
    stop();
    go(delta);
    start();
  };

  root
    .querySelector<HTMLButtonElement>("[data-hero-prev]")
    ?.addEventListener("click", manual(-1));
  root
    .querySelector<HTMLButtonElement>("[data-hero-next]")
    ?.addEventListener("click", manual(1));

  /**
   * Pause while a pointer is over the slideshow or focus is inside it.
   *
   * Both are the same signal: someone is reading this frame, and sliding it out
   * from under them — mid-sentence, or mid-tab — is the thing that makes
   * carousels hated. `focusin`/`focusout` covers the keyboard path that `hover`
   * alone would miss.
   */
  root.addEventListener("pointerenter", stop);
  root.addEventListener("pointerleave", start);
  root.addEventListener("focusin", stop);
  root.addEventListener("focusout", start);

  /**
   * Pause while the tab is hidden, and resume when it comes back. A timer that
   * keeps firing in a background tab burns battery to crossfade images nobody is
   * looking at, and browsers throttle it unevenly so it returns out of step.
   */
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else start();
  });

  start();
}
