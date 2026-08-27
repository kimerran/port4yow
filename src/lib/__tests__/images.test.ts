import { describe, expect, it } from "vitest";
import {
  buildPicture,
  derivativeStem,
  mediaUrl,
  type AssetLike,
} from "../images";

const asset = (key: string, mimeType: string, width: number): AssetLike => ({
  key,
  mimeType,
  width,
  height: Math.round((width * 9) / 16),
  blurDataUrl: "data:image/webp;base64,AAAA",
  altText: "A demo screenshot",
});

describe("derivativeStem", () => {
  it.each([
    ["projects/p/01H8-960.webp", "projects/p/01H8"],
    ["projects/p/01H8-1920.avif", "projects/p/01H8"],
  ])("%s -> %s", (key, stem) => {
    expect(derivativeStem(key)).toBe(stem);
  });

  it.each(["projects/p/cover.webp", "projects/p/01H8.webp", "nowidth"])(
    "returns null for %s (no width in the key)",
    (key) => {
      expect(derivativeStem(key)).toBeNull();
    },
  );
});

describe("buildPicture", () => {
  const full = [
    asset("projects/p/a-480.avif", "image/avif", 480),
    asset("projects/p/a-960.avif", "image/avif", 960),
    asset("projects/p/a-480.webp", "image/webp", 480),
    asset("projects/p/a-960.webp", "image/webp", 960),
  ];

  it("puts AVIF before WebP (SPEC §15: AVIF first)", () => {
    expect(buildPicture(full).sources.map((s) => s.type)).toEqual([
      "image/avif",
      "image/webp",
    ]);
  });

  it("orders each srcset by ascending width with w descriptors", () => {
    expect(buildPicture(full).sources[0]?.srcset).toBe(
      "/api/media/projects/p/a-480.avif 480w, /api/media/projects/p/a-960.avif 960w",
    );
  });

  // AVIF is the likeliest format an <img>-only consumer cannot decode.
  it("falls back to the widest NON-AVIF raster", () => {
    expect(buildPicture(full).src).toBe("/api/media/projects/p/a-960.webp");
  });

  it("carries width and height so the box is reserved (CLS)", () => {
    const p = buildPicture(full);
    expect(p.width).toBe(960);
    expect(p.height).toBe(540);
  });

  // The srcset is built from rows that exist, so one derivative is valid.
  it("degrades to a single source when only one derivative is registered", () => {
    const p = buildPicture([asset("projects/p/a-960.webp", "image/webp", 960)]);
    expect(p.sources).toHaveLength(1);
    expect(p.src).toBe("/api/media/projects/p/a-960.webp");
  });

  it("uses only AVIF as the fallback when nothing else exists", () => {
    const p = buildPicture([asset("projects/p/a-960.avif", "image/avif", 960)]);
    expect(p.src).toBe("/api/media/projects/p/a-960.avif");
  });

  // SPEC §9: altText is "required — never allow empty".
  it.each(["", "   "])("throws rather than render an empty alt (%p)", (alt) => {
    const a = {
      ...asset("projects/p/a-960.webp", "image/webp", 960),
      altText: alt,
    };
    expect(() => buildPicture([a])).toThrow(/empty altText/);
  });

  it("throws on no assets rather than emitting a broken picture", () => {
    expect(() => buildPicture([])).toThrow(/no assets/);
  });
});

describe("mediaUrl", () => {
  it("routes through our own origin, never the storage host", () => {
    expect(mediaUrl("projects/p/a-960.webp")).toBe(
      "/api/media/projects/p/a-960.webp",
    );
  });
});
