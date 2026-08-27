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

const { isSafeKey } = await import("../storage");

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
