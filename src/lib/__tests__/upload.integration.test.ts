import { afterAll, beforeEach, describe, expect, it } from "vitest";

/**
 * The upload pipeline against real sharp, real MinIO and real Postgres (#28).
 *
 * Every acceptance criterion here is about what actually happens to bytes:
 * EXIF stripping is sharp's behaviour, checksum dedupe is a database
 * constraint, and the referenced-asset block depends on real relations. A mock
 * would be testing the mock. Opt-in, same shape as #19/#22/#25/#27.
 */
const enabled =
  process.env.UPLOAD_IT === "1" && Boolean(process.env.DATABASE_URL);

const SECRET = "x".repeat(48);
Object.assign(process.env, {
  PUBLIC_SITE_URL: "http://localhost:4321",
  SESSION_SECRET: SECRET,
  FORM_SECRET: SECRET,
  IP_HASH_SALT: SECRET,
  S3_ENDPOINT: "http://localhost:9000",
  S3_BUCKET: "portfolio-media",
  S3_ACCESS_KEY_ID: "minioadmin",
  S3_SECRET_ACCESS_KEY: "minioadmin",
  S3_FORCE_PATH_STYLE: "true",
  CONTACT_TO_EMAIL: "inbox@mh.neri.ph",
});

describe.skipIf(!enabled)("upload pipeline", () => {
  let upload: typeof import("../upload");
  let db: typeof import("../db").db;
  let sharp: typeof import("sharp").default;
  let projectId: string;

  const jpegWithGps = async (): Promise<Buffer> => {
    /**
     * A real JPEG carrying real GPS EXIF. Built rather than committed: a binary
     * fixture in the repo is opaque, and this makes the "before" state explicit
     * — the assertion below is only meaningful because these tags are provably
     * present to begin with.
     */
    return sharp({
      create: {
        width: 1200,
        height: 800,
        channels: 3,
        background: { r: 20, g: 90, b: 90 },
      },
    })
      .withExif({
        IFD0: { Copyright: "Test", Make: "TestCam" },
        // sharp/libvips maps the GPS IFD to IFD3 — there is no `GPS` key.
        IFD3: {
          GPSLatitudeRef: "N",
          GPSLatitude: "51/1 30/1 0/1",
          GPSLongitudeRef: "W",
          GPSLongitude: "0/1 7/1 0/1",
        },
      })
      .jpeg()
      .toBuffer();
  };

  beforeEach(async () => {
    upload = await import("../upload");
    ({ db } = await import("../db"));
    sharp = (await import("sharp")).default;

    await db.projectImage.deleteMany({});
    await db.project.updateMany({ data: { coverImageId: null } });
    await db.mediaAsset.deleteMany({});
    await db.projectStack.deleteMany({});
    await db.project.deleteMany({});
    await db.rateLimit.deleteMany({
      where: { key: { startsWith: "upload:" } },
    });

    const project = await db.project.create({
      data: {
        slug: "it-upload",
        sequence: 900,
        title: "Upload Target",
        suit: "DIAMONDS",
        summary: "s",
        role: "r",
        timeline: "t",
        problem: "p",
        body: "b",
        outcome: "o",
      },
      select: { id: true },
    });
    projectId = project.id;
  });

  afterAll(async () => {
    await db.projectImage.deleteMany({});
    await db.project.updateMany({ data: { coverImageId: null } });
    await db.mediaAsset.deleteMany({});
    await db.project.deleteMany({});
    await db.$disconnect();
  });

  const png = (width = 1200, height = 800): Promise<Buffer> =>
    sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 10, g: 20, b: 30 },
      },
    })
      .png()
      .toBuffer();

  it("stores one row per derivative and returns the widest WebP", async () => {
    const result = await upload.processUpload({
      bytes: new Uint8Array(await png(1920, 1080)),
      projectId,
      altText: "A teal rectangle",
    });

    const rows = await db.mediaAsset.findMany({ orderBy: { key: "asc" } });
    expect(rows).toHaveLength(result.derivatives);
    // 4 widths x 2 formats for a 1920-wide source.
    expect(result.derivatives).toBe(8);

    const primary = rows.find((r) => r.id === result.primaryAssetId);
    expect(primary?.mimeType).toBe("image/webp");
    expect(primary?.width).toBe(1920);

    // Keys never contain a client-supplied name (SPEC §9).
    for (const row of rows) {
      expect(row.key).toMatch(
        /^projects\/[^/]+\/[0-9A-HJKMNP-TV-Z]{26}-\d+\.(avif|webp)$/,
      );
      expect(row.altText).toBe("A teal rectangle");
      expect(row.blurDataUrl?.startsWith("data:image/webp;base64,")).toBe(true);
    }
  });

  it("only produces widths the source can fill", async () => {
    const result = await upload.processUpload({
      bytes: new Uint8Array(await png(600, 400)),
      projectId,
      altText: "Small",
    });
    // 480 always, 960/1440/1920 skipped for a 600px source.
    expect(result.derivatives).toBe(2);
  });

  /** SPEC §9 — sharp strips EXIF, including GPS. */
  it("leaves no EXIF or GPS in any derivative", async () => {
    const original = await jpegWithGps();

    /**
     * The "before" state, asserted so the checks below can actually fail. The
     * literal string "GPSLatitude" is NOT in the bytes — EXIF stores numeric tag
     * ids — so asserting its absence would pass trivially and prove nothing.
     * `TestCam` and the `Exif` header ARE literal bytes in the source, which is
     * why those are the ones checked afterwards.
     */
    const before = await sharp(original).metadata();
    expect(before.exif).toBeDefined();
    expect(original.includes(Buffer.from("TestCam"))).toBe(true);
    expect(original.includes(Buffer.from("Exif"))).toBe(true);

    await upload.processUpload({
      bytes: new Uint8Array(original),
      projectId,
      altText: "A photo",
    });

    const rows = await db.mediaAsset.findMany({ select: { key: true } });
    expect(rows.length).toBeGreaterThan(0);

    const { getObject } = await import("../storage");
    for (const row of rows) {
      const object = await getObject(row.key);
      expect(object).not.toBeNull();
      const chunks: Uint8Array[] = [];
      for await (const chunk of object?.body ?? []) chunks.push(chunk);
      const derivative = Buffer.concat(chunks);

      const meta = await sharp(derivative).metadata();
      expect(meta.exif).toBeUndefined();
      // Both of these are literal bytes in the source, so their absence here is
      // a real measurement rather than a vacuous one.
      expect(derivative.includes(Buffer.from("TestCam"))).toBe(false);
      expect(derivative.includes(Buffer.from("Exif"))).toBe(false);
    }
  });

  it("blocks a duplicate by checksum", async () => {
    const bytes = new Uint8Array(await png());
    const first = await upload.processUpload({
      bytes,
      projectId,
      altText: "First",
    });

    await expect(
      upload.processUpload({ bytes, projectId, altText: "Second" }),
    ).rejects.toThrow(/already in the library/);

    // The second attempt stored nothing extra. Counted against the first
    // upload's own total rather than a literal: a 1200px source fills only the
    // 480 and 960 widths, so hard-coding 8 would assert the fixture, not the
    // behaviour.
    expect(await db.mediaAsset.count()).toBe(first.derivatives);
  });

  it("rejects a file over 8 MB", async () => {
    const tooBig = new Uint8Array(upload.MAX_UPLOAD_BYTES + 1);
    // Valid PNG signature, so it is the SIZE that refuses it, not the type.
    tooBig.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);

    await expect(
      upload.processUpload({ bytes: tooBig, projectId, altText: "Big" }),
    ).rejects.toThrow(/larger than 8 MB/);
    expect(await db.mediaAsset.count()).toBe(0);
  });

  /** The acceptance criterion, end to end: content decides, not the name. */
  it("rejects an SVG that claims to be a PNG", async () => {
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    await expect(
      upload.processUpload({ bytes: svg, projectId, altText: "Logo" }),
    ).rejects.toThrow(/SVG files are not accepted/);
    expect(await db.mediaAsset.count()).toBe(0);
  });

  it("requires alt text", async () => {
    const bytes = new Uint8Array(await png());
    await expect(
      upload.processUpload({ bytes, projectId, altText: "   " }),
    ).rejects.toThrow(/needs alt text/);
    expect(await db.mediaAsset.count()).toBe(0);
  });

  describe("deletion", () => {
    it("removes every derivative, rows and objects", async () => {
      const result = await upload.processUpload({
        bytes: new Uint8Array(await png()),
        projectId,
        altText: "Deletable",
      });

      const deleted = await upload.deleteAssetGroup(result.keyStem);
      expect(deleted).toBe(result.derivatives);
      expect(await db.mediaAsset.count()).toBe(0);

      const { getObject } = await import("../storage");
      await expect(getObject(`${result.keyStem}-480.webp`)).rejects.toThrow();
    });

    it("is blocked when the asset is a project cover", async () => {
      const result = await upload.processUpload({
        bytes: new Uint8Array(await png()),
        projectId,
        altText: "Cover",
      });
      await db.project.update({
        where: { id: projectId },
        data: { coverImageId: result.primaryAssetId },
      });

      await expect(upload.deleteAssetGroup(result.keyStem)).rejects.toThrow(
        /Upload Target/,
      );
      expect(await db.mediaAsset.count()).toBe(result.derivatives);
    });

    /**
     * The second reference. Checking only the cover would delete an image still
     * on a published page — and `ProjectImage.assetId` is `onDelete: Restrict`,
     * so the row delete would fail halfway and leave objects with no rows.
     */
    it("is blocked when the asset is an inline gallery image", async () => {
      const result = await upload.processUpload({
        bytes: new Uint8Array(await png()),
        projectId,
        altText: "Inline",
      });
      await db.projectImage.create({
        data: { projectId, assetId: result.primaryAssetId, sortOrder: 0 },
      });

      await expect(upload.deleteAssetGroup(result.keyStem)).rejects.toThrow(
        upload.AssetInUse,
      );
      expect(await db.mediaAsset.count()).toBe(result.derivatives);
    });
  });

  describe("alt text", () => {
    it("updates every derivative row", async () => {
      const result = await upload.processUpload({
        bytes: new Uint8Array(await png()),
        projectId,
        altText: "Before",
      });

      const updated = await upload.updateAltText(result.keyStem, "After");
      expect(updated).toBe(result.derivatives);

      const rows = await db.mediaAsset.findMany({ select: { altText: true } });
      expect(new Set(rows.map((r) => r.altText))).toEqual(new Set(["After"]));
    });

    it("refuses to blank it", async () => {
      const result = await upload.processUpload({
        bytes: new Uint8Array(await png()),
        projectId,
        altText: "Before",
      });
      await expect(upload.updateAltText(result.keyStem, "  ")).rejects.toThrow(
        /needs alt text/,
      );
    });
  });
});
