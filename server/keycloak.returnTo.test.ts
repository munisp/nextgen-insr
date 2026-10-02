/**
 * keycloak.returnTo.test.ts — pure-unit coverage for the returnTo validator
 * (2026-10-02, W7-B4 open-redirect hardening in server/_core/keycloakAuth.ts).
 *
 * The login endpoint stores `returnTo` in a cookie and the callback passes it
 * to res.redirect(); sanitizeReturnTo must fail closed to '/' for anything
 * that is not an unambiguous same-origin relative path.
 */
import { describe, it, expect } from "vitest";
import { sanitizeReturnTo } from "./_core/returnTo";

describe("sanitizeReturnTo (W7-B4 open-redirect hardening)", () => {
  it("accepts a same-origin relative path verbatim", () => {
    expect(sanitizeReturnTo("/member/quotes")).toBe("/member/quotes");
    expect(sanitizeReturnTo("/")).toBe("/");
    expect(sanitizeReturnTo("/a/b?c=d#frag")).toBe("/a/b?c=d#frag");
  });

  it("rejects absolute http(s) URLs → '/'", () => {
    expect(sanitizeReturnTo("https://evil.com")).toBe("/");
    expect(sanitizeReturnTo("http://evil.com/path")).toBe("/");
  });

  it("rejects scheme-relative URLs ('//evil.com') → '/'", () => {
    expect(sanitizeReturnTo("//evil.com")).toBe("/");
    expect(sanitizeReturnTo("//evil.com/path")).toBe("/");
  });

  it("rejects javascript: and other schemes → '/'", () => {
    expect(sanitizeReturnTo("javascript:alert(1)")).toBe("/");
    expect(sanitizeReturnTo("data:text/html,<script>1</script>")).toBe("/");
  });

  it("rejects backslash variants (browsers treat '/\\evil.com' as scheme-relative)", () => {
    expect(sanitizeReturnTo("/\\evil.com")).toBe("/");
    expect(sanitizeReturnTo("/\\/evil.com")).toBe("/");
    expect(sanitizeReturnTo("\\evil.com")).toBe("/");
  });

  it("rejects control characters and whitespace", () => {
    expect(sanitizeReturnTo("/path\nLocation: https://evil.com")).toBe("/");
    expect(sanitizeReturnTo("/path\revil")).toBe("/");
    expect(sanitizeReturnTo("/path with space")).toBe("/");
    expect(sanitizeReturnTo("/\tevil")).toBe("/");
    expect(sanitizeReturnTo("/path\u0000evil")).toBe("/");
    expect(sanitizeReturnTo("/path\u007fevil")).toBe("/");
  });

  it("rejects non-strings and missing/empty values → '/'", () => {
    expect(sanitizeReturnTo(undefined)).toBe("/");
    expect(sanitizeReturnTo(null)).toBe("/");
    expect(sanitizeReturnTo("")).toBe("/");
    expect(sanitizeReturnTo(42)).toBe("/");
    expect(sanitizeReturnTo(["/a"])).toBe("/");
    expect(sanitizeReturnTo({ toString: () => "/x" })).toBe("/");
  });

  it("does not decode percent-encoding: '/%2f%2fevil.com' stays a relative path", () => {
    // Documented semantics: the value is an opaque path string, never decoded.
    // Express writes it verbatim into the Location header and clients do not
    // decode %2f for origin resolution, so it remains same-origin.
    expect(sanitizeReturnTo("/%2f%2fevil.com")).toBe("/%2f%2fevil.com");
    // But a literal decoded '//' is rejected.
    expect(sanitizeReturnTo("//evil.com")).toBe("/");
  });

  it("rejects paths that do not start with '/'", () => {
    expect(sanitizeReturnTo("member/quotes")).toBe("/");
    expect(sanitizeReturnTo("///evil.com")).toBe("/");
  });
});
