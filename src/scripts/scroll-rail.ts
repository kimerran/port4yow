/**
 * BRAND §7 — the scroll rail. A 2px `deep-teal` line that fills with scroll
 * progress: at the base of the desktop left rail, and a top bar on mobile.
 *
 * "It reads as a progress indicator first and a dragon second." The single sine
 * curve lives in the SVG path; this file only drives the fill.
 *
 * EXTERNAL MODULE, not an inline <script>. Astro's CSP header carries only its
 * own runtime hashes and is identical on every route, so a page-level inline
 * script is blocked outright (see docs/features/10-baselayout.md). `script-src
 * 'self'` permits a bundled module, which is what an imported .ts becomes.
 *
 * No scroll-jacking, no parallax (BRAND §10) — this only reads scroll position.
 */

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/**
 * Pure so it can be tested without a browser: the DOM-driven half of this module
 * cannot be exercised in headless Chrome, because `requestAnimationFrame` never
 * fires under `--virtual-time-budget` (measured: raf 0, scroll events 1).
 */
export function scrollProgress(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): number {
  const scrollable = scrollHeight - clientHeight;
  // A page shorter than the viewport is fully "read".
  if (scrollable <= 0) return 1;
  return Math.min(1, Math.max(0, scrollTop / scrollable));
}

/** Dash offset for a given progress: full length at 0, zero at 1. */
export function dashOffset(length: number, progressValue: number): number {
  return length * (1 - progressValue);
}

function progress(): number {
  const el = document.documentElement;
  return scrollProgress(el.scrollTop, el.scrollHeight, el.clientHeight);
}

export function initScrollRail(): void {
  const fills = document.querySelectorAll<SVGGeometryElement>(
    "[data-scroll-rail-fill]",
  );
  if (fills.length === 0) return;

  // BRAND §9 — reduced motion renders the final state and runs nothing.
  if (window.matchMedia(REDUCED_MOTION).matches) {
    for (const fill of fills) fill.style.strokeDashoffset = "0";
    return;
  }

  const lengths = new Map<SVGGeometryElement, number>();
  for (const fill of fills) {
    const length = fill.getTotalLength();
    lengths.set(fill, length);
    fill.style.strokeDasharray = String(length);
    fill.style.strokeDashoffset = String(length);
  }

  let queued = false;
  const update = (): void => {
    queued = false;
    const value = progress();
    for (const [fill, length] of lengths) {
      fill.style.strokeDashoffset = String(dashOffset(length, value));
    }
  };

  const onScroll = (): void => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  };

  update();
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
}
