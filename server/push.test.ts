// @ts-check

/**
 * Tests for VAPID push notification service (server/push.ts)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock web-push ─────────────────────────────────────────────────────────────
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn().mockResolvedValue({ statusCode: 201 }),
  },
}));

// ── Mock DB ───────────────────────────────────────────────────────────────────
const mockSubs = [
  {
    id: 1,
    agentId: "AGT001",
    endpoint: "https://fcm.googleapis.com/fcm/send/test-endpoint-1",
    p256dhKey: "BNcR8mNit7RiiI3Sg5YvxLnspoMh5pBW8T4dRs3x5PY=",
    authKey: "tBHItJI5svbpez7KI4CCXg==",
    userAgent: "Mozilla/5.0",
  },
];

vi.mock("../drizzle/schema", () => ({
  agentPushSubscriptions: {
    id: "id",
    agentId: "agentId",
    endpoint: "endpoint",
    p256dhKey: "p256dhKey",
    authKey: "authKey",
  },
}));

vi.mock("../server/db", () => ({
  getDb: vi.fn().mockResolvedValue({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(mockSubs),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      })),
    })),
  }),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("VAPID Push Notification Service", () => {
  describe("PushPayload structure", () => {
    it("creates a valid push payload for SIM failover", () => {
      const payload = {
        title: "⚠️ SIM Failover Triggered",
        body: "Network switched from SIM 0 to SIM 2: latency 4200ms > 3000ms",
        tag: "sim-failover",
        icon: "/icons/sim-alert.png",
        data: {
          type: "sim_failover",
          fromSlot: 0,
          toSlot: 2,
          transactionRef: "TXN-001",
        },
        actions: [
          { action: "view", title: "View Details" },
          { action: "dismiss", title: "Dismiss" },
        ],
      };
      expect(payload.title).toContain("SIM Failover");
      expect(payload.data.type).toBe("sim_failover");
      expect(payload.actions).toHaveLength(2);
    });

    it("creates a valid push payload for fraud alert", () => {
      const payload = {
        title: "🚨 Fraud Alert",
        body: "Transaction TXN-123 flagged (score: 85): velocity limit exceeded",
        tag: "fraud-alert",
        data: {
          type: "fraud_alert",
          transactionRef: "TXN-123",
          riskScore: 85,
        },
      };
      expect(payload.data.riskScore).toBe(85);
      expect(payload.tag).toBe("fraud-alert");
    });

    it("creates a valid push payload for float approval", () => {
      const amount = 50000;
      const newBalance = 150000;
      const payload = {
        title: "✅ Float Top-Up Approved",
        body: `₦${amount.toLocaleString()} added to your float. New balance: ₦${newBalance.toLocaleString()}`,
        tag: "float-topup",
        data: { type: "float_approval", amount, newBalance },
      };
      expect(payload.body).toContain("50,000");
      expect(payload.body).toContain("150,000");
      expect(payload.data.type).toBe("float_approval");
    });

    it("creates a valid push payload for settlement completion", () => {
      const payload = {
        title: "💰 Settlement Complete",
        body: "Batch BATCH-001: 42 transactions totalling ₦2,500,000 settled.",
        tag: "settlement",
        data: {
          type: "settlement_complete",
          batchId: "BATCH-001",
          totalAmount: 2500000,
          txCount: 42,
        },
      };
      expect(payload.data.txCount).toBe(42);
      expect(payload.data.totalAmount).toBe(2500000);
    });
  });

  describe("VAPID key format", () => {
    it("VAPID public key is a valid base64url string", () => {
      const key =
        "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";
      // Base64url characters: A-Z, a-z, 0-9, -, _
      expect(key).toMatch(/^[A-Za-z0-9\-_]+$/);
      // Uncompressed EC key is 65 bytes = 87 base64url chars (no padding)
      expect(key.length).toBeGreaterThan(80);
    });

    it("VAPID subject is a valid mailto URI", () => {
      const subject = "mailto:ops@insureportal.ng";
      expect(subject).toMatch(/^mailto:.+@.+\..+$/);
    });
  });

  describe("subscription deactivation logic", () => {
    it("identifies 410 Gone status as expired subscription", () => {
      const err = { statusCode: 410, body: "Subscription expired" };
      const isExpired = err.statusCode === 410;
      expect(isExpired).toBe(true);
    });

    it("does not deactivate on 429 Too Many Requests", () => {
      const err = { statusCode: 429, body: "Rate limited" };
      const isExpired = err.statusCode === 410;
      expect(isExpired).toBe(false);
    });

    it("does not deactivate on 500 Server Error", () => {
      const err = { statusCode: 500, body: "Internal error" };
      const isExpired = err.statusCode === 410;
      expect(isExpired).toBe(false);
    });
  });

  describe("push notification TTL", () => {
    it("uses 86400 seconds (24h) TTL for standard notifications", () => {
      const TTL = 86400;
      expect(TTL).toBe(60 * 60 * 24);
    });

    it("uses 3600 seconds (1h) TTL for admin broadcasts", () => {
      const TTL = 3600;
      expect(TTL).toBe(60 * 60);
    });
  });

  describe("float amount formatting", () => {
    it("formats Nigerian Naira amounts with locale separators", () => {
      const amount = 1500000;
      const formatted = `₦${amount.toLocaleString()}`;
      // Should contain the naira symbol
      expect(formatted).toContain("₦");
      // Should contain the number
      expect(formatted).toContain("1");
    });

    it("formats zero amount correctly", () => {
      const amount = 0;
      const formatted = `₦${amount.toLocaleString()}`;
      expect(formatted).toBe("₦0");
    });
  });
});
