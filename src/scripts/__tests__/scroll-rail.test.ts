import { describe, expect, it } from "vitest";
import { dashOffset, scrollProgress } from "../scroll-rail";

/**
 * Covers the computation only. The DOM half — listener wiring and the
 * rAF-throttled write — is NOT verified here: `requestAnimationFrame` never
 * fires in headless Chrome under `--virtual-time-budget` (measured: raf 0 while
 * scroll events fired), so there is no harness for it until #39 adds Playwright.
 * Saying so rather than implying full coverage.
 */
describe("scrollProgress", () => {
  it("is 0 at the top of a scrollable page", () => {
    expect(scrollProgress(0, 4000, 800)).toBe(0);
  });

  it("is 1 at the bottom", () => {
    expect(scrollProgress(3200, 4000, 800)).toBe(1);
  });

  it("is 0.5 halfway", () => {
    expect(scrollProgress(1600, 4000, 800)).toBe(0.5);
  });

  // A page shorter than the viewport has nothing left to read.
  it.each([
    [0, 500, 800],
    [0, 800, 800],
  ])(
    "treats an unscrollable page as complete (%i,%i,%i)",
    (top, height, client) => {
      expect(scrollProgress(top, height, client)).toBe(1);
    },
  );

  // Overscroll/rubber-banding must not push the rail past its ends.
  it("clamps above 1", () => {
    expect(scrollProgress(99999, 4000, 800)).toBe(1);
  });

  it("clamps below 0", () => {
    expect(scrollProgress(-200, 4000, 800)).toBe(0);
  });
});

describe("dashOffset", () => {
  it("is the full length at 0 progress — nothing drawn", () => {
    expect(dashOffset(240, 0)).toBe(240);
  });

  it("is 0 at full progress — fully drawn", () => {
    expect(dashOffset(240, 1)).toBe(0);
  });

  it("is half the length at half progress", () => {
    expect(dashOffset(240, 0.5)).toBe(120);
  });
});
