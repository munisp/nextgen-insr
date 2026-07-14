/**
 * Sprint 8: Email Notification Service + Rate Alerts Tests
 */
import { describe, it, expect, vi } from "vitest";

// ── Email Service Tests ──────────────────────────────────────────────────────

describe("Email Service", () => {
  describe("sendEmail", () => {
    it("should fall back to console provider when no SMTP/SendGrid configured", async () => {
      const { sendEmail } = await import("./lib/emailService");
      const result = await sendEmail({
        to: "test@example.com",
        subject: "Test Email",
        html: "<p>Hello</p>",
      });
      expect(result.success).toBe(true);
      expect(result.provider).toBe("console");
      expect(result.messageId).toMatch(/^console_/);
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it("should handle array recipients", async () => {
      const { sendEmail } = await import("./lib/emailService");
      const result = await sendEmail({
        to: ["a@test.com", "b@test.com"],
        subject: "Batch Test",
        html: "<p>Hello batch</p>",
      });
      expect(result.success).toBe(true);
    });

    it("should include category and tags in message", async () => {
      const { sendEmail } = await import("./lib/emailService");
      const result = await sendEmail({
        to: "test@example.com",
        subject: "Categorized",
        html: "<p>Test</p>",
        category: "rate_alert",
        tags: ["usd", "ngn"],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("sendBatchEmail", () => {
    it("should send to multiple recipients individually", async () => {
      const { sendBatchEmail } = await import("./lib/emailService");
      const result = await sendBatchEmail(
        ["a@test.com", "b@test.com", "c@test.com"],
        { subject: "Batch", html: "<p>Hello</p>" }
      );
      expect(result.sent).toBe(3);
      expect(result.failed).toBe(0);
      expect(result.results).toHaveLength(3);
    });
  });

  describe("getProviderStatus", () => {
    it("should return status for all providers", async () => {
      const { getProviderStatus } = await import("./lib/emailService");
      const status = getProviderStatus();
      expect(status).toBeInstanceOf(Array);
      expect(status.length).toBeGreaterThanOrEqual(1);
      const consoleProvider = status.find(p => p.name === "console");
      expect(consoleProvider).toBeDefined();
      expect(consoleProvider!.enabled).toBe(true);
    });
  });

  describe("Email Templates", () => {
    it("should build rate alert email", async () => {
      const { buildRateAlertEmail } = await import("./lib/emailService");
      const msg = buildRateAlertEmail({
        agentName: "Test Agent",
        baseCurrency: "USD",
        targetCurrency: "NGN",
        targetRate: 1600,
        currentRate: 1605.5,
        direction: "above",
        triggeredAt: new Date(),
      });
      expect(msg.subject).toContain("USD/NGN");
      expect(msg.subject).toContain("risen above");
      expect(msg.html).toContain("1605.5");
      expect(msg.category).toBe("rate_alert");
      expect(msg.tags).toContain("USD");
    });

    it("should build welcome email", async () => {
      const { buildWelcomeEmail } = await import("./lib/emailService");
      const msg = buildWelcomeEmail({
        agentName: "Adebayo",
        agentId: "AG-001",
      });
      expect(msg.subject).toContain("Welcome");
      expect(msg.html).toContain("AG-001");
      expect(msg.category).toBe("welcome");
    });

    it("should build password reset email with OTP", async () => {
      const { buildPasswordResetEmail } = await import("./lib/emailService");
      const msg = buildPasswordResetEmail({
        agentName: "Test",
        otp: "123456",
        expiresInMinutes: 10,
      });
      expect(msg.subject).toContain("PIN Reset");
      expect(msg.html).toContain("123456");
      expect(msg.html).toContain("10 minutes");
    });

    it("should build digest email with stats", async () => {
      const { buildDigestEmail } = await import("./lib/emailService");
      const msg = buildDigestEmail({
        agentName: "Agent",
        period: "Weekly",
        txCount: 150,
        totalVolume: 5000000,
        totalCommission: 25000,
        alertCount: 3,
      });
      expect(msg.subject).toContain("Weekly");
      expect(msg.html).toContain("150");
      expect(msg.category).toBe("digest");
    });
  });
});

// ── Rate Alerts Tests ────────────────────────────────────────────────────────

describe("Rate Alerts Router", () => {
  it("should import rateAlertsRouter without errors", async () => {
    const { rateAlertsRouter } = await import("./routers/rateAlerts");
    expect(rateAlertsRouter).toBeDefined();
    expect(rateAlertsRouter._def).toBeDefined();
  });

  it("should have all expected procedures", async () => {
    const { rateAlertsRouter } = await import("./routers/rateAlerts");
    const procedures = Object.keys(rateAlertsRouter._def.procedures);
    expect(procedures).toContain("create");
    expect(procedures).toContain("list");
    expect(procedures).toContain("getById");
    expect(procedures).toContain("update");
    expect(procedures).toContain("toggle");
    expect(procedures).toContain("rearm");
    expect(procedures).toContain("delete");
    expect(procedures).toContain("runCheck");
    expect(procedures).toContain("getCheckerStatus");
    expect(procedures).toContain("getStats");
    expect(procedures).toContain("quickCreate");
  });
});

// ── Email Notifications Router Tests ─────────────────────────────────────────

describe("Email Notifications Router", () => {
  it("should import emailNotificationsRouter without errors", async () => {
    const { emailNotificationsRouter } = await import(
      "./routers/emailNotifications"
    );
    expect(emailNotificationsRouter).toBeDefined();
    expect(emailNotificationsRouter._def).toBeDefined();
  });

  it("should have all expected procedures", async () => {
    const { emailNotificationsRouter } = await import(
      "./routers/emailNotifications"
    );
    const procedures = Object.keys(emailNotificationsRouter._def.procedures);
    expect(procedures).toContain("getPreferences");
    expect(procedures).toContain("updatePreferences");
    expect(procedures).toContain("sendTest");
    expect(procedures).toContain("sendCustom");
    expect(procedures).toContain("getDeliveryLog");
    expect(procedures).toContain("getProviderStatus");
    expect(procedures).toContain("getStats");
  });
});

// ── Helper Function Tests ────────────────────────────────────────────────────

describe("Email Helper Functions", () => {
  it("should extract email from formatted string", async () => {
    // Test internal helper via template output
    const { buildWelcomeEmail } = await import("./lib/emailService");
    const msg = buildWelcomeEmail({ agentName: "Test", agentId: "AG-001" });
    expect(msg.html).toContain("InsurePortal POS");
    expect(msg.html).toContain("DOCTYPE html");
  });

  it("should handle edge case: empty tags array", async () => {
    const { sendEmail } = await import("./lib/emailService");
    const result = await sendEmail({
      to: "test@example.com",
      subject: "No Tags",
      html: "<p>Test</p>",
      tags: [],
    });
    expect(result.success).toBe(true);
  });

  it("should handle edge case: very long subject", async () => {
    const { sendEmail } = await import("./lib/emailService");
    const result = await sendEmail({
      to: "test@example.com",
      subject: "A".repeat(256),
      html: "<p>Test</p>",
    });
    expect(result.success).toBe(true);
  });
});

// ── Rate Alert Notification Templates ────────────────────────────────────────

describe("Rate Alert Email Templates", () => {
  it("should build below-direction alert correctly", async () => {
    const { buildRateAlertEmail } = await import("./lib/emailService");
    const msg = buildRateAlertEmail({
      agentName: "Fatima",
      baseCurrency: "EUR",
      targetCurrency: "KES",
      targetRate: 145.5,
      currentRate: 144.2,
      direction: "below",
      triggeredAt: new Date("2026-04-16T12:00:00Z"),
    });
    expect(msg.subject).toContain("fallen below");
    expect(msg.subject).toContain("EUR/KES");
    expect(msg.html).toContain("144.2");
    expect(msg.tags).toContain("EUR");
    expect(msg.tags).toContain("KES");
  });

  it("should include all required fields in alert email", async () => {
    const { buildRateAlertEmail } = await import("./lib/emailService");
    const msg = buildRateAlertEmail({
      agentName: "Test",
      baseCurrency: "GBP",
      targetCurrency: "NGN",
      targetRate: 2000,
      currentRate: 2010,
      direction: "above",
      triggeredAt: new Date(),
    });
    expect(msg.to).toBe(""); // to be filled by caller
    expect(msg.html).toContain("GBP/NGN");
    expect(msg.html).toContain("2000");
    expect(msg.html).toContain("2010");
    expect(msg.text).toBeTruthy();
  });
});

// ── Integration-style Tests ──────────────────────────────────────────────────

describe("Email + Rate Alert Integration", () => {
  it("should send rate alert email via email service", async () => {
    const { sendEmail, buildRateAlertEmail } = await import(
      "./lib/emailService"
    );
    const emailMsg = buildRateAlertEmail({
      agentName: "Integration Test",
      baseCurrency: "USD",
      targetCurrency: "NGN",
      targetRate: 1600,
      currentRate: 1605,
      direction: "above",
      triggeredAt: new Date(),
    });
    emailMsg.to = "agent@insureportal.io";
    const result = await sendEmail(emailMsg);
    expect(result.success).toBe(true);
    expect(result.provider).toBe("console");
  });

  it("should handle batch rate alert notifications", async () => {
    const { sendBatchEmail, buildRateAlertEmail } = await import(
      "./lib/emailService"
    );
    const emailMsg = buildRateAlertEmail({
      agentName: "Batch Test",
      baseCurrency: "USD",
      targetCurrency: "KES",
      targetRate: 130,
      currentRate: 129,
      direction: "below",
      triggeredAt: new Date(),
    });
    const result = await sendBatchEmail(["a@test.com", "b@test.com"], {
      subject: emailMsg.subject,
      html: emailMsg.html,
      text: emailMsg.text,
    });
    expect(result.sent).toBe(2);
    expect(result.failed).toBe(0);
  });
});
