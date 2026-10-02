/**
 * returnTo.ts — same-origin validator for post-login redirect targets.
 *
 * 2026-10-02, W7-B4 hardening: fixes an open redirect in the Keycloak auth
 * flow (server/_core/keycloakAuth.ts) where the `returnTo` query param was
 * stored verbatim in a cookie and later passed verbatim to res.redirect(),
 * letting an unauthenticated attacker bounce victims through the IdC login
 * to an arbitrary external URL. This helper is applied twice (defense in
 * depth): when the login endpoint stores the cookie, and again at the
 * callback immediately before res.redirect(), because the cookie is
 * client-tamperable between the two calls.
 *
 * Honest/fail-closed behavior: anything that is not an unambiguous
 * same-origin relative path collapses to '/'. No error page, and the
 * rejected value is never echoed back or logged with content.
 */

const DEFAULT_RETURN_PATH = "/";

/**
 * Returns `value` only if it is a safe same-origin relative path; otherwise '/'.
 *
 * Accepted: strings starting with exactly one '/', containing no backslash,
 * no ASCII control characters (0x00–0x1F, 0x7F), and no whitespace. Since a
 * leading '/' is mandatory, absolute URLs ("https://evil.com") and
 * scheme-relative URLs ("//evil.com") can never pass.
 *
 * Percent-encoding semantics: the value is treated as an opaque path string
 * and is NOT decoded. "/%2f%2fevil.com" is accepted as a relative path —
 * Express writes it verbatim into the Location header and clients do not
 * decode %2f for origin resolution, so it stays same-origin.
 */
export function sanitizeReturnTo(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    return DEFAULT_RETURN_PATH;
  }
  if (!value.startsWith("/") || value.startsWith("//")) {
    return DEFAULT_RETURN_PATH;
  }
  // Reject backslashes (browser treats "/\evil.com" as "//evil.com"),
  // ASCII control characters, and any whitespace.
  if (/[\x00-\x20\x7f\\]/.test(value)) {
    return DEFAULT_RETURN_PATH;
  }
  return value;
}
