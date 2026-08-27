import { describe, expect, it } from "vitest";
import { safeNextPath } from "../redirect";

/**
 * An open redirect is a phishing primitive: a link that genuinely starts on our
 * domain, shows our login form, then hands the visitor to someone else's. These
 * are the shapes that get past a naive "starts with a slash" check.
 */
describe("safeNextPath — accepts same-origin paths", () => {
  it.each([
    ["a plain path", "/admin/projects"],
    ["the admin root", "/admin"],
    ["a path with a query", "/admin/projects?page=2"],
    ["a path with a fragment", "/admin/projects#list"],
    ["a path with an encoded space", "/admin/my%20page"],
    ["the site root", "/"],
  ])("accepts %s", (_label, value) => {
    expect(safeNextPath(value)).toBe(value);
  });
});

describe("safeNextPath — rejects off-origin targets", () => {
  it.each([
    // The acceptance criterion names these two explicitly.
    ["an absolute https URL", "https://evil.test/x"],
    ["a protocol-relative URL", "//evil.test/x"],
    // Each of the rest is a real bypass of a narrower check.
    ["a protocol-relative URL with no path", "//evil.test"],
    ["a backslash authority", "/\\evil.test"],
    ["a backslash-slash authority", "/\\/evil.test"],
    ["an http URL", "http://evil.test"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a data: URL", "data:text/html,<script>"],
    ["a scheme in mixed case", "HTTPS://evil.test"],
    ["a bare host", "evil.test"],
    ["a relative path", "admin/projects"],
    ["an empty string", ""],
  ])("rejects %s", (_label, value) => {
    expect(safeNextPath(value)).toBeNull();
  });

  /**
   * A control character in a value that reaches a `Location` header can end the
   * header and start another one (response splitting). Built by code point so
   * this source file stays printable.
   */
  it.each([
    ["a line feed", 0x0a],
    ["a carriage return", 0x0d],
    ["a NUL", 0x00],
    ["a tab", 0x09],
    ["a DEL", 0x7f],
  ])("rejects %s — header splitting", (_label, code) => {
    const value = `/admin${String.fromCharCode(code)}Location: https://evil.test`;
    expect(safeNextPath(value)).toBeNull();
  });

  it.each([
    ["a non-string", 42],
    ["null", null],
    ["undefined", undefined],
    ["an object", { toString: () => "/admin" }],
  ])("rejects %s", (_label, value) => {
    expect(safeNextPath(value)).toBeNull();
  });

  it("rejects an absurdly long path", () => {
    expect(safeNextPath(`/${"a".repeat(600)}`)).toBeNull();
  });

  /** Bouncing a signed-in user back to the login form is a loop. */
  it.each([
    ["the login page", "/admin/login"],
    ["the login page with a query", "/admin/login?next=/admin"],
  ])("rejects %s", (_label, value) => {
    expect(safeNextPath(value)).toBeNull();
  });
});
