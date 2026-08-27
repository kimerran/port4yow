/**
 * Validation for `?next=` redirect targets (SPEC §6, §14, AGENT §3, #24).
 *
 * An open redirect is a phishing primitive: `/admin/login?next=https://evil.test`
 * lets an attacker send a link that genuinely starts on our domain, shows our
 * login form, and then hands the visitor to theirs. The defence is an allowlist
 * of *shapes*, not a denylist of known-bad strings.
 */

/**
 * Returns the value if it is a safe same-origin path, or null.
 *
 * Every rule here exists because it is a real bypass, not a hypothetical:
 *
 * - `//evil.test/x` is PROTOCOL-RELATIVE. It carries no scheme, so a naive
 *   "starts with /" check accepts it, and the browser then treats it as an
 *   absolute URL to another host. This is the most common open-redirect bug and
 *   the acceptance criterion names it explicitly.
 * - `/\evil.test` — browsers normalise a backslash to a forward slash in the
 *   authority position, so `/\` behaves as `//`. Rejecting `//` alone is not
 *   enough.
 * - `https://evil.test` is absolute; so is `javascript:alert(1)`, which would be
 *   a redirect into script execution. The leading-slash rule refuses both, and
 *   the scheme check states the intent.
 * - A control character can split a `Location` header and inject a second one
 *   (response splitting).
 *
 * `/admin/login` is refused as a target: bouncing a signed-in user back to the
 * login page is a loop, not a redirect.
 */
export function safeNextPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value.length > 512) return null;

  // Control characters, including CR/LF header splitting and NUL.
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return null;
  }

  // Must be a rooted path, and not the start of an authority.
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//") || value.startsWith("/\\")) return null;

  // Belt and braces: nothing carrying a scheme, however it got past the above.
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null;

  // Backslashes are normalised inconsistently across browsers; a legitimate
  // path on this site never contains one.
  if (value.includes("\\")) return null;

  // A redirect back to the login page is a loop.
  const path = value.split(/[?#]/)[0] ?? "";
  if (path === "/admin/login") return null;

  return value;
}
