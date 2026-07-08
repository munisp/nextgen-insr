// @ts-check

/**
 * Sprint 18 Tests: Security Hardening + System Health Monitor
 */
import { describe, it, expect } from "vitest";
import {
  generateSecureCsrfToken,
  isAccountLocked,
  recordFailedLogin,
  clearFailedLogins,
  maskSensitiveData,
  logSecurityEvent,
  getSecurityEvents,
  getSecuritySummary,
  getIpReputation,
  recordIpViolation,
} from "./lib/securityHardening";

describe("Sprint 18: Security Hardening", () => {
  describe("CSRF Token Generation", () => {
    it("should generate a 64-character hex token", () => {
      const token = generateSecureCsrfToken();
      expect(token).toHaveLength(64);
      expect(/^[0-9a-f]+$/.test(token)).toBe(true);
    });

    it("should generate unique tokens", () => {
      const tokens = new Set(
        Array.from({ length: 100 }, () => generateSecureCsrfToken())
      );
      expect(tokens.size).toBe(100);
    });
  });

  describe("Account Lockout", () => {
    it("should not lock account on first failed attempt", () => {
      const result = recordFailedLogin("test-lockout-1");
      expect(result.locked).toBe(false);
      expect(result.attemptsRemaining).toBe(4);
      clearFailedLogins("test-lockout-1");
    });

    it("should lock account after 5 failed attempts", () => {
      const id = "test-lockout-2";
      for (let i = 0; i < 4; i++) {
        const r = recordFailedLogin(id);
        expect(r.locked).toBe(false);
      }
      const final = recordFailedLogin(id);
      expect(final.locked).toBe(true);
      expect(final.attemptsRemaining).toBe(0);

      const check = isAccountLocked(id);
      expect(check.locked).toBe(true);
      expect(check.remainingMs).toBeGreaterThan(0);
      clearFailedLogins(id);
    });

    it("should clear lockout", () => {
      const id = "test-lockout-3";
      for (let i = 0; i < 5; i++) recordFailedLogin(id);
      expect(isAccountLocked(id).locked).toBe(true);
      clearFailedLogins(id);
      expect(isAccountLocked(id).locked).toBe(false);
    });
  });

  describe("Sensitive Data Masking", () => {
    it("should mask password fields", () => {
      const result = maskSensitiveData({ password: "t3st", username: "john" });
      expect(result.password).not.toBe("mysecretpass");
      expect(result.password).toContain("*");
      expect(result.username).toBe("john");
    });

    it("should mask email addresses", () => {
      const result = maskSensitiveData({ email: "john@example.com" });
      expect(result.email).toContain("***@");
      expect(result.email).toContain("example.com");
    });

    it("should mask nested sensitive data", () => {
      const result = maskSensitiveData({
        user: { token: "abc123", name: "John" },
      });
      expect((result.user as any).token).toContain("*");
      expect((result.user as any).name).toBe("John");
    });

    it("should mask phone numbers", () => {
      const result = maskSensitiveData({ phone: "+2348012345678" });
      expect(result.phone).toContain("****");
    });
  });

  describe("Security Event Logging", () => {
    it("should log and retrieve security events", () => {
      logSecurityEvent("LOGIN_SUCCESS", { userId: "user-1" });
      const events = getSecurityEvents({ limit: 1 });
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[0].event).toBe("LOGIN_SUCCESS");
    });

    it("should filter events by severity", () => {
      logSecurityEvent("ACCOUNT_LOCKED", { identifier: "test" });
      const critical = getSecurityEvents({ severity: "critical", limit: 5 });
      expect(critical.every(e => e.severity === "critical")).toBe(true);
    });

    it("should provide security summary", () => {
      const summary = getSecuritySummary();
      expect(summary).toHaveProperty("totalEvents");
      expect(summary).toHaveProperty("criticalEvents");
      expect(summary).toHaveProperty("warningEvents");
      expect(summary).toHaveProperty("lockedAccounts");
      expect(summary).toHaveProperty("blockedIps");
      expect(summary).toHaveProperty("recentEvents");
    });
  });

  describe("IP Reputation", () => {
    it("should start with score 100", () => {
      const rep = getIpReputation("192.168.1.1");
      expect(rep.score).toBe(100);
      expect(rep.violations).toBe(0);
    });

    it("should decrease score on violations", () => {
      recordIpViolation("10.0.0.1", "low");
      const rep = getIpReputation("10.0.0.1");
      expect(rep.score).toBe(95);
      expect(rep.violations).toBe(1);
    });

    it("should decrease more for high severity", () => {
      recordIpViolation("10.0.0.2", "high");
      const rep = getIpReputation("10.0.0.2");
      expect(rep.score).toBe(70);
    });
  });
});

describe("Sprint 18: System Health Monitor Router", () => {
  it("should export systemHealthMonitorRouter", async () => {
    const mod = await import("./routers/systemHealthMonitor");
    expect(mod.systemHealthMonitorRouter).toBeDefined();
  });
});
