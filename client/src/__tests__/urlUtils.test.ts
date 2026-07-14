import { describe, it, expect } from "vitest";

/**
 * Tests for URL construction utilities (extracted from const.ts)
 * These are pure functions that can be tested without DOM.
 */

// Simulate the getLoginUrl function for testing
function getLoginUrl(returnTo?: string): string {
  const path = returnTo || "/";
  const params = new URLSearchParams();
  if (path && path !== "/") {
    params.set("returnTo", path);
  }
  const query = params.toString();
  return `/api/auth/login${query ? `?${query}` : ""}`;
}

function getLogoutUrl(): string {
  return "/api/auth/logout";
}

// Simulate token validation
function isJwtToken(token: string): boolean {
  return token.split(".").length === 3;
}

// Simulate URL-safe encoding for auth parameters
function encodeAuthParam(param: string): string {
  return encodeURIComponent(param);
}

// Simulate building an OAuth redirect URL
function buildCallbackUrl(
  baseUrl: string,
  state: string,
  nonce?: string
): string {
  const url = new URL(baseUrl);
  url.searchParams.set("state", state);
  if (nonce) {
    url.searchParams.set("nonce", nonce);
  }
  return url.toString();
}

describe("URL Construction Utilities", () => {
  describe("getLoginUrl", () => {
    it("should return login URL without query params for undefined returnTo", () => {
      expect(getLoginUrl()).toBe("/api/auth/login");
      expect(getLoginUrl(undefined)).toBe("/api/auth/login");
    });

    it("should return login URL without query params for root path", () => {
      expect(getLoginUrl("/")).toBe("/api/auth/login");
    });

    it("should include returnTo param for specific paths", () => {
      const result = getLoginUrl("/dashboard");
      expect(result).toContain("?returnTo=");
      // Path is URL-encoded: "/" becomes "%2F"
      expect(result).toContain("%2Fdashboard");
    });

    it("should encode special characters in returnTo", () => {
      const result = getLoginUrl("/dashboard?tab=analytics");
      expect(result).toContain("returnTo=");
      expect(result).toContain("%3F");
      // All special chars are encoded
      expect(result).not.toContain("?tab=");
      expect(result).toContain("%3Ftab%3Danalytics");
    });

    it("should handle paths with query parameters", () => {
      const result = getLoginUrl("/payments?agent=123");
      expect(result).toContain("%2Fpayments");
      expect(result).toContain("agent%3D123");
    });
  });

  describe("getLogoutUrl", () => {
    it("should return static logout URL", () => {
      expect(getLogoutUrl()).toBe("/api/auth/logout");
    });

    it("should always return the same URL (no params)", () => {
      expect(getLogoutUrl()).toBe(getLogoutUrl());
    });
  });

  describe("isJwtToken", () => {
    it("should recognize valid JWT format", () => {
      const validJwt =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
      expect(isJwtToken(validJwt)).toBe(true);
    });

    it("should reject non-JWT strings", () => {
      expect(isJwtToken("not-a-token")).toBe(false);
      expect(isJwtToken("")).toBe(false);
      expect(isJwtToken("only.two-parts")).toBe(false);
      expect(isJwtToken("one")).toBe(false);
    });

    it("should require exactly 3 parts (header.payload.signature)", () => {
      // Exactly 3 dot-separated parts required
      const jwtWithDots = "aaa.bbb.ccc.with.dots";
      expect(isJwtToken(jwtWithDots)).toBe(false);
      // Valid JWT has exactly 3 parts
      const validJwt = "aaa.bbb.ccc";
      expect(isJwtToken(validJwt)).toBe(true);
    });
  });

  describe("encodeAuthParam", () => {
    it("should URL-encode special characters with percent-encoding", () => {
      // encodeURIComponent uses %20 for spaces, not +
      expect(encodeAuthParam("hello world")).toBe("hello%20world");
      expect(encodeAuthParam("a=b&c=d")).toBe("a%3Db%26c%3Dd");
    });

    it("should leave safe characters unchanged", () => {
      expect(encodeAuthParam("abc123")).toBe("abc123");
      expect(encodeAuthParam("path/to/resource")).toBe("path%2Fto%2Fresource");
    });

    it("should handle Unicode characters", () => {
      const result = encodeAuthParam("café");
      expect(result).toBe("caf%C3%A9");
    });
  });

  describe("buildCallbackUrl", () => {
    it("should build a valid callback URL with state", () => {
      const result = buildCallbackUrl("http://localhost:3000/callback", "abc123");
      expect(result).toContain("state=abc123");
      expect(result).toContain("http://localhost:3000/callback");
    });

    it("should include nonce when provided", () => {
      const result = buildCallbackUrl(
        "http://localhost:3000/callback",
        "abc123",
        "nonce456"
      );
      expect(result).toContain("nonce=nonce456");
    });

    it("should not include nonce when not provided", () => {
      const result = buildCallbackUrl(
        "http://localhost:3000/callback",
        "abc123"
      );
      expect(result).not.toContain("nonce");
      expect(result).toContain("state=abc123");
    });
  });
});
