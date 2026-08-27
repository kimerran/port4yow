import { describe, expect, it } from "vitest";

const SECRET = "x".repeat(48);
Object.assign(process.env, {
  PUBLIC_SITE_URL: "http://localhost:4321",
  DATABASE_URL: "postgresql://a:b@localhost:5432/c",
  SESSION_SECRET: SECRET,
  FORM_SECRET: SECRET,
  IP_HASH_SALT: SECRET,
  S3_ENDPOINT: "http://localhost:9000",
  S3_BUCKET: "portfolio-media",
  S3_ACCESS_KEY_ID: "k",
  S3_SECRET_ACCESS_KEY: "s",
  CONTACT_TO_EMAIL: "a@b.com",
});

const { isSafeKey, MEDIA_CACHE_SECONDS } = await import("../storage");

/**
 * The route requires a matching MediaAsset row, so this is defence in depth
 * rather than the authorisation itself — but AGENT §3 wants nothing
 * user-controlled reaching an outbound URL unvalidated, and a shape check that
 * silently accepted `../` would be worse than none.
 */
describe("isSafeKey — accepts the keys #28 generates", () => {
  it.each([
    "projects/abc123/01H8-960.avif",
    "projects/abc123/01H8-1920.webp",
    "projects/p/x.jpg",
    "a",
  ])("accepts %s", (key) => {
    expect(isSafeKey(key)).toBe(true);
  });
});

describe("isSafeKey — rejects traversal and absolute paths", () => {
  it.each([
    ["empty", ""],
    ["traversal", "../../etc/passwd"],
    ["traversal mid-path", "projects/../../etc/passwd"],
    ["absolute", "/etc/passwd"],
    ["protocol-relative", "//evil.example/x"],
    ["backslash", "projects\\..\\x"],
    ["double slash", "projects//x.jpg"],
    ["leading dot", ".hidden"],
    ["leading dash", "-flag"],
    ["null byte", "projects/x\0.jpg"],
    ["space", "projects/a b.jpg"],
    ["query string", "projects/x.jpg?raw=1"],
    ["hash", "projects/x.jpg#f"],
    ["url", "http://evil.example/x.jpg"],
    ["too long", "a".repeat(513)],
  ])("rejects %s", (_label, key) => {
    expect(isSafeKey(key)).toBe(false);
  });
});

describe("media cache lifetime", () => {
  /**
   * This replaced an invariant rather than relaxing one.
   *
   * Under the presigned-redirect design the cache lifetime HAD to stay strictly
   * below the signature TTL: a cached 302 replays a stale `Location`, and the
   * presigned URL behind it 403s once the signature expires, so returning
   * visitors got broken images invisibly — the first few minutes worked.
   *
   * The route now streams the bytes through our own origin, so there is no
   * signature left to outlive and the coupling is gone. What makes a long
   * lifetime safe instead is that a key names one immutable object: SPEC §9 keys
   * are `projects/{projectId}/{ulid}-{width}.{ext}`, and new bytes get a new
   * ULID and therefore a new URL.
   */
  it("caches for a year, which immutable keys make safe", () => {
    expect(MEDIA_CACHE_SECONDS).toBe(31_536_000);
  });

  it("does not export a presign TTL to couple against any more", async () => {
    const storage = await import("../storage");
    expect("PRESIGN_TTL_SECONDS" in storage).toBe(false);
    expect("REDIRECT_CACHE_SECONDS" in storage).toBe(false);
  });
});
