import { createHash } from "node:crypto";
import sharp from "sharp";
import { ulid } from "ulid";
import { db } from "./db";
import { ALLOWED_MIME_TYPES, looksLikeSvg, sniffImageType } from "./imagetype";
import { logger } from "./logger";
import { deleteObject, putObject } from "./storage";
import { env } from "./env";

/**
 * The write half of the media pipeline (SPEC §9, §14.13, #28).
 *
 * SERVER ONLY (AGENT §4). Serving is #42's `GET /api/media/[...key]`.
 */

/** SPEC §9 — 8 MB. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** SPEC §9 — the widths every upload is re-encoded to. */
export const DERIVATIVE_WIDTHS = [480, 960, 1440, 1920] as const;

/** SPEC §9 — AVIF and WebP, in that order of preference. */
export const DERIVATIVE_FORMATS = [
  { format: "avif", mimeType: "image/avif", ext: "avif" },
  { format: "webp", mimeType: "image/webp", ext: "webp" },
] as const;

export class UploadRejected extends Error {
  constructor(
    message: string,
    readonly reason: string,
  ) {
    super(message);
    this.name = "UploadRejected";
  }
}

export interface UploadInput {
  bytes: Uint8Array;
  projectId: string;
  altText: string;
}

export interface UploadResult {
  /** The widest WebP row — the one a cover picker should reference. */
  primaryAssetId: string;
  keyStem: string;
  derivatives: number;
}

/**
 * Validates, re-encodes and stores an upload.
 *
 * Every check runs before a single byte reaches storage, and the order is
 * deliberate: cheap and certain first, so a hostile file is refused before it
 * costs anything.
 */
export async function processUpload(input: UploadInput): Promise<UploadResult> {
  // 1 · Size. First because it is a length check on data we already hold, and
  // because everything below is proportional to it.
  if (input.bytes.byteLength === 0) {
    throw new UploadRejected("That file is empty.", "empty");
  }
  if (input.bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new UploadRejected(
      "That file is larger than 8 MB. Try exporting it smaller.",
      "too-large",
    );
  }

  // 2 · Alt text. SPEC §9: required, never empty. Checked before any work so a
  // missing description cannot be "fixed later" once bytes are in the bucket.
  const altText = input.altText.trim();
  if (altText.length === 0) {
    throw new UploadRejected(
      "Every image needs alt text describing what it shows.",
      "missing-alt",
    );
  }

  // 3 · Type, from the CONTENT. Never the filename, never the client's
  // Content-Type — `payload.svg` renamed to `payload.png` arrives claiming
  // image/png and only the bytes disagree.
  const mimeType = sniffImageType(input.bytes);
  if (!mimeType) {
    if (looksLikeSvg(input.bytes)) {
      // Named explicitly: SVG carries script, and a person uploading a logo
      // deserves the real reason rather than "unsupported image".
      throw new UploadRejected(
        "SVG files are not accepted. Export a PNG or WebP instead.",
        "svg",
      );
    }
    throw new UploadRejected(
      `That file is not one of ${ALLOWED_MIME_TYPES.join(", ")}.`,
      "unsupported-type",
    );
  }

  // 4 · Duplicate. sha256 of the ORIGINAL bytes, so the same source file is
  // recognised however it was re-encoded afterwards.
  const checksum = createHash("sha256").update(input.bytes).digest("hex");
  const existing = await db.mediaAsset.findFirst({
    where: { checksum },
    select: { id: true, key: true },
  });
  if (existing) {
    throw new UploadRejected(
      "That image is already in the library.",
      "duplicate",
    );
  }

  /**
   * 5 · Re-encode.
   *
   * A fresh sharp pipeline per derivative, from the original bytes. Reusing one
   * instance across outputs is a documented footgun — the pipeline is stateful
   * and the second `toBuffer` would operate on the first one's result.
   *
   * EXIF is stripped by default: sharp only copies metadata when asked with
   * `.withMetadata()`, which is never called here. That is what removes GPS
   * coordinates from a phone photo, and it is why the acceptance criterion can
   * be checked on any derivative.
   */
  const source = sharp(input.bytes, { failOn: "error" });
  const metadata = await source.metadata();
  const sourceWidth = metadata.width ?? 0;
  const sourceHeight = metadata.height ?? 0;
  if (sourceWidth === 0 || sourceHeight === 0) {
    throw new UploadRejected("That image could not be read.", "undecodable");
  }

  /**
   * SPEC §9's LQIP: a 16px preview inlined as a data URI. WebP rather than AVIF
   * because it decodes faster at this size and the difference in bytes is
   * negligible when the whole thing is a few hundred of them.
   */
  const lqipBuffer = await sharp(input.bytes)
    .resize({ width: 16 })
    .webp({ quality: 40 })
    .toBuffer();
  const blurDataUrl = `data:image/webp;base64,${lqipBuffer.toString("base64")}`;

  // SPEC §9 — never the client-supplied filename.
  const id = ulid();
  const keyStem = `projects/${input.projectId}/${id}`;

  /**
   * Only widths the source can actually fill. Upscaling a 600px screenshot to
   * 1920 produces a larger file that looks worse, and #17 builds its srcset from
   * the rows that exist — so omitting a width is already handled downstream.
   * The smallest width is always produced, so a tiny source still yields one
   * derivative rather than none.
   */
  const widths = DERIVATIVE_WIDTHS.filter(
    (width, index) => index === 0 || width <= sourceWidth,
  );

  const created: { id: string; width: number; mimeType: string }[] = [];

  for (const width of widths) {
    for (const spec of DERIVATIVE_FORMATS) {
      const pipeline = sharp(input.bytes).resize({
        width,
        withoutEnlargement: true,
      });

      const buffer =
        spec.format === "avif"
          ? await pipeline.avif({ quality: 50 }).toBuffer()
          : await pipeline.webp({ quality: 78 }).toBuffer();

      const encoded = await sharp(buffer).metadata();
      const key = `${keyStem}-${String(width)}.${spec.ext}`;

      await putObject(key, buffer, spec.mimeType);

      /**
       * One row per derivative, deliberately. #42's media route authorises a
       * request by looking the key up, so a derivative with no row is
       * unreachable — #17 measured that (a guessed sibling key returned 404).
       * The srcset is built from the rows that exist.
       */
      const row = await db.mediaAsset.create({
        data: {
          key,
          bucket: env.S3_BUCKET,
          mimeType: spec.mimeType,
          byteSize: buffer.byteLength,
          width: encoded.width ?? width,
          height: encoded.height ?? null,
          blurDataUrl,
          altText,
          checksum,
        },
        select: { id: true },
      });
      created.push({ id: row.id, width, mimeType: spec.mimeType });
    }
  }

  /**
   * The widest WebP is the row a cover picker should reference: #17 chooses the
   * fallback `<img src>` from the non-AVIF rows, so pointing a cover at an AVIF
   * row would make the fallback the thing that cannot be displayed everywhere.
   */
  const primary = created
    .filter((row) => row.mimeType === "image/webp")
    .reduce((best, row) => (row.width > best.width ? row : best));

  logger.info("media uploaded", {
    project_id: input.projectId,
    derivatives: created.length,
    source_type: mimeType,
  });

  return {
    primaryAssetId: primary.id,
    keyStem,
    derivatives: created.length,
  };
}

export class AssetInUse extends Error {
  /**
   * Names the projects rather than counting them.
   *
   * "Used by 1 project" leaves the admin hunting for which one; #28 asks for a
   * clear message, and the only useful next step is knowing where to go and
   * remove the reference.
   */
  constructor(readonly usedBy: string[]) {
    super(`That image is still used by ${usedBy.join(", ")}.`);
    this.name = "AssetInUse";
  }
}

/**
 * Deletes every derivative sharing a key stem, rows and objects together.
 *
 * SPEC §9 soft-blocks a referenced asset. The check covers BOTH references: a
 * project's cover and an inline gallery image. Checking only one would delete an
 * image that is still on a published page, and `ProjectImage.assetId` is
 * `onDelete: Restrict`, so the row delete would fail halfway and leave objects
 * without rows — unreachable bytes nobody can find again.
 */
export async function deleteAssetGroup(keyStem: string): Promise<number> {
  const assets = await db.mediaAsset.findMany({
    where: { key: { startsWith: `${keyStem}-` } },
    select: {
      id: true,
      key: true,
      bucket: true,
      coverOf: { select: { title: true } },
      projectUses: { select: { project: { select: { title: true } } } },
    },
  });

  if (assets.length === 0) return 0;

  const usedBy = new Set<string>();
  for (const asset of assets) {
    if (asset.coverOf) usedBy.add(asset.coverOf.title);
    for (const use of asset.projectUses) usedBy.add(use.project.title);
  }
  if (usedBy.size > 0) throw new AssetInUse([...usedBy]);

  for (const asset of assets) {
    // Object first: a failure here leaves a row pointing at nothing, which is
    // visible and fixable. The reverse leaves bytes nobody can reach.
    await deleteObject(asset.key, asset.bucket);
  }

  await db.mediaAsset.deleteMany({
    where: { id: { in: assets.map((a) => a.id) } },
  });

  logger.info("media deleted", { key_stem: keyStem, rows: assets.length });
  return assets.length;
}

/** Alt text belongs to the image, so it is written to every derivative row. */
export async function updateAltText(
  keyStem: string,
  altText: string,
): Promise<number> {
  const trimmed = altText.trim();
  if (trimmed.length === 0) {
    throw new UploadRejected(
      "Every image needs alt text describing what it shows.",
      "missing-alt",
    );
  }
  const result = await db.mediaAsset.updateMany({
    where: { key: { startsWith: `${keyStem}-` } },
    data: { altText: trimmed },
  });
  return result.count;
}
