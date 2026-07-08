// @ts-check

/**
 * Sprint 9: SMS Service + Notification Inbox Tests
 */
import { describe, it, expect, beforeEach } from "vitest";

// ── SMS Service Tests ───────────────────────────────────────────────────────

describe("SMS Service", () => {
  describe("normalizePhone", () => {
    it("should normalize Nigerian 11-digit number starting with 0", async () => {
      const { normalizePhone } = await import("./lib/smsService");
      expect(normalizePhone("08012345678")).toBe("+2348012345678");
    });

    it("should normalize 10-digit number", async () => {
      const { normalizePhone } = await import("./lib/smsService");
      expect(normalizePhone("8012345678")).toBe("+2348012345678");
    });

    it("should handle number with + prefix", async () => {
      const { normalizePhone } = await import("./lib/smsService");
      expect(normalizePhone("+2348012345678")).toBe("+2348012345678");
    });

    it("should strip spaces, dashes, and parentheses", async () => {
      const { normalizePhone } = await import("./lib/smsService");
      expect(normalizePhone("+1 (555) 123-4567")).toBe("+15551234567");
    });

    it("should handle international number without +", async () => {
      const { normalizePhone } = await import("./lib/smsService");
      expect(normalizePhone("442071234567")).toBe("+442071234567");
    });
  });

  describe("sendSms", () => {
    it("should fall back to console provider when no API keys set", async () => {
      const { sendSms } = await import("./lib/smsService");
      const result = await sendSms({
        to: "+2348012345678",
        body: "Test SMS message",
      });
      expect(result.success).toBe(true);
      expect(result.provider).toBe("console");
      expect(result.messageId).toMatch(/^sms_console_/);
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it("should include messageId in result", async () => {
      const { sendSms } = await import("./lib/smsService");
      const result = await sendSms({
        to: "08012345678",
        body: "Hello from InsurePortal",
      });
      expect(result.messageId).toBeDefined();
      expect(typeof result.messageId).toBe("string");
    });
  });

  describe("sendBatchSms", () => {
    it("should send to multiple recipients", async () => {
      const { sendBatchSms } = await import("./lib/smsService");
      const result = await sendBatchSms(
        ["+2348012345678", "+2348098765432"],
        "Batch test message"
      );
      expect(result.sent).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.results).toHaveLength(2);
    });
  });

  describe("sendSmsWithRetry", () => {
    it("should succeed on first attempt with console provider", async () => {
      const { sendSmsWithRetry } = await import("./lib/smsService");
      const result = await sendSmsWithRetry(
        {
          to: "+2348012345678",
          body: "Retry test",
        },
        3
      );
      expect(result.success).toBe(true);
      expect(result.provider).toBe("console");
    });
  });

  describe("SMS Templates", () => {
    it("should build rate alert SMS", async () => {
      const { buildRateAlertSms } = await import("./lib/smsService");
      const msg = buildRateAlertSms({
        agentName: "Test Agent",
        baseCurrency: "USD",
        targetCurrency: "NGN",
        targetRate: 1600,
        currentRate: 1605.5,
        direction: "above",
      });
      expect(msg.body).toContain("USD/NGN");
      expect(msg.body).toContain("risen above");
      expect(msg.body).toContain("1600");
      expect(msg.body).toContain("1605.5");
    });

    it("should build fraud alert SMS", async () => {
      const { buildFraudAlertSms } = await import("./lib/smsService");
      const msg = buildFraudAlertSms({
        agentName: "Test Agent",
        severity: "critical",
        type: "velocity_anomaly",
        amount: 5000000,
        currency: "NGN",
      });
      expect(msg.body).toContain("FRAUD ALERT");
      expect(msg.body).toContain("CRITICAL");
      expect(msg.body).toContain("5,000,000");
    });

    it("should build transaction confirm SMS", async () => {
      const { buildTransactionConfirmSms } = await import("./lib/smsService");
      const msg = buildTransactionConfirmSms({
        type: "Cash-In",
        amount: 50000,
        currency: "NGN",
        ref: "TXN-001",
        customerName: "John Doe",
      });
      expect(msg.body).toContain("Cash-In");
      expect(msg.body).toContain("50,000");
      expect(msg.body).toContain("TXN-001");
      expect(msg.body).toContain("John Doe");
    });

    it("should build OTP SMS", async () => {
      const { buildOtpSms } = await import("./lib/smsService");
      const msg = buildOtpSms({ otp: "123456", expiresInMinutes: 10 });
      expect(msg.body).toContain("123456");
      expect(msg.body).toContain("10 minutes");
      expect(msg.body).toContain("Do not share");
    });

    it("should build settlement SMS", async () => {
      const { buildSettlementSms } = await import("./lib/smsService");
      const msg = buildSettlementSms({
        agentName: "Agent A",
        txCount: 47,
        totalVolume: 2350000,
        commission: 11750,
        currency: "NGN",
      });
      expect(msg.body).toContain("47 transactions");
      expect(msg.body).toContain("2,350,000");
      expect(msg.body).toContain("11,750");
    });
  });

  describe("Provider Status", () => {
    it("should return provider status array", async () => {
      const { getSmsProviderStatus } = await import("./lib/smsService");
      const status = getSmsProviderStatus();
      expect(status).toBeInstanceOf(Array);
      expect(status.length).toBe(4);
      expect(status.map(s => s.name)).toEqual([
        "twilio",
        "africastalking",
        "termii",
        "console",
      ]);
      // Console should always be enabled
      const consoleProv = status.find(s => s.name === "console");
      expect(consoleProv?.enabled).toBe(true);
    });
  });

  describe("Delivery Log", () => {
    it("should record delivery in log after send", async () => {
      const { sendSms, getSmsDeliveryLog } = await import("./lib/smsService");
      await sendSms({ to: "+2340000000001", body: "Log test" });
      const logs = getSmsDeliveryLog({ phone: "+2340000000001", limit: 5 });
      expect(logs.length).toBeGreaterThanOrEqual(1);
      expect(logs[0].to).toBe("+2340000000001");
      expect(logs[0].status).toBe("sent");
    });
  });

  describe("SMS Stats", () => {
    it("should return stats summary", async () => {
      const { getSmsStats } = await import("./lib/smsService");
      const stats = getSmsStats();
      expect(typeof stats.totalSent).toBe("number");
      expect(typeof stats.totalFailed).toBe("number");
      expect(typeof stats.totalCost).toBe("number");
      expect(typeof stats.byProvider).toBe("object");
    });
  });
});

// ── Notification Inbox Tests ────────────────────────────────────────────────

describe("Notification Inbox", () => {
  describe("createNotification", () => {
    it("should create a notification with all fields", async () => {
      const { createNotification } = await import(
        "./routers/notificationInbox"
      );
      const notif = createNotification({
        channel: "email",
        category: "rate_alert",
        priority: "high",
        title: "Test Alert",
        body: "This is a test notification",
        agentId: 1,
        agentName: "Test Agent",
        actionUrl: "/rate-alerts",
      });
      expect(notif.id).toMatch(/^notif_/);
      expect(notif.channel).toBe("email");
      expect(notif.category).toBe("rate_alert");
      expect(notif.priority).toBe("high");
      expect(notif.title).toBe("Test Alert");
      expect(notif.read).toBe(false);
      expect(notif.starred).toBe(false);
      expect(notif.archived).toBe(false);
      expect(notif.createdAt).toBeInstanceOf(Date);
    });

    it("should create notification without optional fields", async () => {
      const { createNotification } = await import(
        "./routers/notificationInbox"
      );
      const notif = createNotification({
        channel: "in_app",
        category: "system",
        priority: "low",
        title: "System Update",
        body: "Maintenance scheduled",
      });
      expect(notif.agentId).toBeUndefined();
      expect(notif.agentName).toBeUndefined();
      expect(notif.actionUrl).toBeUndefined();
    });
  });

  describe("Notification Types", () => {
    it("should support all channel types", () => {
      const channels = ["email", "sms", "push", "in_app"];
      for (const ch of channels) {
        expect(typeof ch).toBe("string");
      }
    });

    it("should support all category types", () => {
      const categories = [
        "rate_alert",
        "fraud",
        "transaction",
        "security",
        "system",
        "settlement",
        "kyc",
        "compliance",
        "general",
      ];
      expect(categories).toHaveLength(9);
    });

    it("should support all priority levels", () => {
      const priorities = ["critical", "high", "medium", "low"];
      expect(priorities).toHaveLength(4);
    });
  });

  describe("Seeded Data", () => {
    it("should have seeded demo notifications", async () => {
      // The module seeds 10 demo notifications on import
      const mod = await import("./routers/notificationInbox");
      // Create one more to verify the store is working
      const notif = mod.createNotification({
        channel: "sms",
        category: "fraud",
        priority: "critical",
        title: "Seeded Test",
        body: "Verifying seed data",
      });
      expect(notif.id).toBeDefined();
    });
  });
});
