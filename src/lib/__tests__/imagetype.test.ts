import { describe, expect, it } from "vitest";
import { looksLikeSvg, sniffImageType } from "../imagetype";

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);
const ascii = (text: string, pad = 0): Uint8Array => {
  const out = new Uint8Array(pad + text.length);
  for (let i = 0; i < text.length; i++) out[pad + i] = text.charCodeAt(i);
  return out;
};

const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00);

const riff = (brand: string): Uint8Array => {
  const out = new Uint8Array(16);
  out.set(ascii("RIFF"), 0);
  out.set(ascii(brand), 8);
  return out;
};
const ftyp = (brand: string): Uint8Array => {
  const out = new Uint8Array(16);
  out.set(ascii("ftyp"), 4);
  out.set(ascii(brand), 8);
  return out;
};

describe("sniffImageType — the four allowed formats", () => {
  it("detects JPEG", () => {
    expect(sniffImageType(JPEG)).toBe("image/jpeg");
  });

  it("detects PNG", () => {
    expect(sniffImageType(PNG)).toBe("image/png");
  });

  it("detects WebP", () => {
    expect(sniffImageType(riff("WEBP"))).toBe("image/webp");
  });

  it("detects AVIF still images and sequences", () => {
    expect(sniffImageType(ftyp("avif"))).toBe("image/avif");
    expect(sniffImageType(ftyp("avis"))).toBe("image/avif");
  });
});

/**
 * The allowlist is the point: anything not matching a signature is rejected,
 * including every format nobody has thought about. These are the cases that
 * would slip past a check on the filename or the client's Content-Type.
 */
describe("sniffImageType — rejects everything else", () => {
  it("rejects SVG, whatever it is called", () => {
    const svg = ascii(
      '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>',
    );
    expect(sniffImageType(svg)).toBeNull();
    expect(looksLikeSvg(svg)).toBe(true);
  });

  it.each([
    ["an XML declaration first", '<?xml version="1.0"?><svg></svg>'],
    ["a DOCTYPE first", "<!DOCTYPE svg PUBLIC><svg></svg>"],
    ["a comment first", "<!-- a logo --><svg></svg>"],
    ["leading whitespace", "\n\n   <svg></svg>"],
    ["uppercase", "<SVG></SVG>"],
  ])("still recognises SVG with %s", (_label, text) => {
    const svg = ascii(text);
    expect(sniffImageType(svg)).toBeNull();
    expect(looksLikeSvg(svg)).toBe(true);
  });

  it.each([
    ["a GIF", ascii("GIF89a")],
    ["a PDF", ascii("%PDF-1.7")],
    ["a ZIP", bytes(0x50, 0x4b, 0x03, 0x04)],
    ["an ELF binary", bytes(0x7f, 0x45, 0x4c, 0x46)],
    ["a shell script", ascii("#!/bin/sh\necho hi")],
    ["HTML", ascii("<!doctype html><html>")],
    ["plain text", ascii("just some words")],
    ["empty", new Uint8Array(0)],
    ["one byte", bytes(0xff)],
  ])("rejects %s", (_label, input) => {
    expect(sniffImageType(input)).toBeNull();
  });

  /** A RIFF container that is not WebP — a .wav, for instance. */
  it("rejects a RIFF file that is not WebP", () => {
    expect(sniffImageType(riff("WAVE"))).toBeNull();
  });

  /** An ISO-BMFF container that is not AVIF — an .mp4, for instance. */
  it("rejects an ftyp file that is not AVIF", () => {
    expect(sniffImageType(ftyp("mp42"))).toBeNull();
    expect(sniffImageType(ftyp("heic"))).toBeNull();
  });

  /**
   * The acceptance criterion, at the unit level: the bytes decide, and there is
   * no filename in scope for them to disagree with.
   */
  it("is not fooled by an SVG carrying a PNG extension", () => {
    // What `payload.svg` renamed to `payload.png` actually contains.
    expect(sniffImageType(ascii('<svg onload="alert(1)"></svg>'))).toBeNull();
  });

  it("rejects a truncated PNG signature", () => {
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47))).toBeNull();
  });
});

describe("looksLikeSvg", () => {
  it("is false for the real image formats", () => {
    for (const input of [JPEG, PNG, riff("WEBP"), ftyp("avif")]) {
      expect(looksLikeSvg(input)).toBe(false);
    }
  });

  it("does not throw on binary that is not valid UTF-8", () => {
    expect(() =>
      looksLikeSvg(bytes(0xff, 0xfe, 0xfd, 0x00, 0x80)),
    ).not.toThrow();
  });
});
