/**
 * Content-based image type detection (SPEC §9, §14.13, #28).
 *
 * ## Why this is hand-rolled rather than a library
 *
 * The requirement is an ALLOWLIST of four formats. A general sniffer recognises
 * a hundred types and answers "what is this?"; we need "is this one of exactly
 * four?", which is a different question with a safer default. Anything that does
 * not match a signature below is rejected — including every format nobody has
 * thought about yet, and including SVG, which is a script vector and must never
 * be accepted (SPEC §9).
 *
 * Nothing here consults the client-supplied `Content-Type` or the filename.
 * Both are attacker-controlled: `payload.svg` renamed to `payload.png` arrives
 * claiming `image/png`, and only the bytes disagree.
 */

export const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

const startsWith = (bytes: Uint8Array, signature: number[]): boolean => {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
};

const asciiAt = (bytes: Uint8Array, offset: number, text: string): boolean => {
  if (bytes.length < offset + text.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
};

/**
 * Returns the detected type, or null if the bytes are not one of the four.
 *
 * Signatures, each from the format's own specification:
 *
 * - **JPEG** — `FF D8 FF`. The SOI marker followed by the first segment marker.
 * - **PNG** — `89 50 4E 47 0D 0A 1A 0A`. The full 8-byte signature, not just
 *   `\x89PNG`: the trailing bytes are there to catch line-ending mangling, and
 *   checking all eight costs nothing.
 * - **WebP** — RIFF container: `RIFF` at 0, `WEBP` at 8. The four bytes between
 *   are the file size, which is why the second check is at an offset rather than
 *   part of one prefix.
 * - **AVIF** — ISO-BMFF: `ftyp` at 4, then a brand. `avif` is a still image;
 *   `avis` is an image *sequence*. Both are accepted as `image/avif` because
 *   sharp decodes both, and rejecting `avis` would surprise anyone exporting
 *   from a tool that emits it.
 *
 * A file may only be one of these — the checks are mutually exclusive by
 * construction, so order carries no meaning.
 */
export function sniffImageType(bytes: Uint8Array): AllowedMimeType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";

  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }

  if (asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WEBP")) {
    return "image/webp";
  }

  if (asciiAt(bytes, 4, "ftyp")) {
    if (asciiAt(bytes, 8, "avif") || asciiAt(bytes, 8, "avis")) {
      return "image/avif";
    }
  }

  return null;
}

/**
 * True when the bytes look like SVG.
 *
 * Not needed for the decision — `sniffImageType` already returns null for it —
 * but the caller can then say "SVG is not accepted" instead of "unsupported
 * image", and a person who uploaded a logo deserves the real reason. It is also
 * a marker that the SVG rejection is deliberate rather than incidental.
 *
 * Deliberately loose: XML declarations, comments and a BOM can all precede the
 * root element, so this scans the head of the file rather than anchoring.
 */
export function looksLikeSvg(bytes: Uint8Array): boolean {
  const head = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.subarray(0, 1024))
    .toLowerCase();
  return head.includes("<svg") || head.includes("<!doctype svg");
}
