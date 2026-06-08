/**
 * Sprint 89 Tests — InsurePortal Shell
 *
 * Covers:
 *   - webhookHandler: test event detection, calculateNextRetry, publishBillingEvent
 *   - adminDashboard router: system stats, user list, role update guard
 *   - analyticsQuery router: metrics query, search, pipeline health
 */
import { describe, expect, it, vi } from "vitest";
import {
  DUNNING_CONFIG,
  calculateNextRetry,
  publishBillingEvent,
} from "./stripe/webhookHandler";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ── Helper: create admin context ────────────────────────────────────────────
function createAdminContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "admin-user",
      email: "admin@insureportal.com",
      name: "Admin User",
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {
      protocol: "https",
      headers: { origin: "http://localhost:3000" },
    } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

function createUserContext(): TrpcContext {
  return {
    user: {
      id: 2,
      openId: "regular-user",
      email: "user@insureportal.com",
      name: "Regular User",
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {
      protocol: "https",
      headers: { origin: "http://localhost:3000" },
    } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

// ── webhookHandler Unit Tests ───────────────────────────────────────────────
describe("webhookHandler", () => {
  describe("DUNNING_CONFIG", () => {
    it("has valid dunning configuration", () => {
      expect(DUNNING_CONFIG.maxRetries).toBe(3);
      expect(DUNNING_CONFIG.retryIntervals).toHaveLength(3);
      expect(DUNNING_CONFIG.gracePeriodDays).toBeGreaterThan(0);
      expect(DUNNING_CONFIG.suspensionAfterDays).toBeGreaterThan(
        DUNNING_CONFIG.gracePeriodDays
      );
      expect(DUNNING_CONFIG.notificationChannels).toContain("email");
      expect(DUNNING_CONFIG.notificationChannels).toContain("kafka");
    });
  });

  describe("calculateNextRetry", () => {
    it("returns correct retry date for attempt 1 (3 days)", () => {
      const result = calculateNextRetry(1);
      const date = new Date(result);
      const now = new Date();
      const diffDays = Math.round((date.getTime() - now.getTime()) / 86400000);
      expect(diffDays).toBe(3);
    });

    it("returns correct retry date for attempt 2 (7 days)", () => {
      const result = calculateNextRetry(2);
      const date = new Date(result);
      const now = new Date();
      const diffDays = Math.round((date.getTime() - now.getTime()) / 86400000);
      expect(diffDays).toBe(7);
    });

    it("returns correct retry date for attempt 3 (14 days)", () => {
      const result = calculateNextRetry(3);
      const date = new Date(result);
      const now = new Date();
      const diffDays = Math.round((date.getTime() - now.getTime()) / 86400000);
      expect(diffDays).toBe(14);
    });

    it("defaults to 14 days for attempts beyond config", () => {
      const result = calculateNextRetry(5);
      const date = new Date(result);
      const now = new Date();
      const diffDays = Math.round((date.getTime() - now.getTime()) / 86400000);
      expect(diffDays).toBe(14);
    });

    it("returns valid ISO date string", () => {
      const result = calculateNextRetry(1);
      expect(() => new Date(result)).not.toThrow();
      expect(new Date(result).toISOString()).toBe(result);
    });
  });

  describe("publishBillingEvent", () => {
    it("returns published status with topic and timestamp", async () => {
      const result = await publishBillingEvent("billing.test", { foo: "bar" });
      expect(result.published).toBe(true);
      expect(result.topic).toBe("billing.test");
      expect(result.timestamp).toBeGreaterThan(0);
    });
  });
});

// ── adminDashboard Router Tests ─────────────────────────────────────────────
describe("adminDashboard", () => {
  it("rejects non-admin users from getSystemStats", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.adminDashboard.getSystemStats()).rejects.toThrow();
  });

  it("rejects non-admin users from listUsers", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.adminDashboard.listUsers({ limit: 10, offset: 0 })
    ).rejects.toThrow();
  });

  it("rejects non-admin users from updateUserRole", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.adminDashboard.updateUserRole({ userId: 1, role: "admin" })
    ).rejects.toThrow();
  });

  it("rejects non-admin users from getAuditLog", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.adminDashboard.getAuditLog({ limit: 10, offset: 0 })
    ).rejects.toThrow();
  });

  it("rejects non-admin users from getSystemHealth", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.adminDashboard.getSystemHealth()).rejects.toThrow();
  });
});

// ── analyticsQuery Router Tests ─────────────────────────────────────────────
describe("analyticsQuery", () => {
  it("rejects unauthenticated users from getTransactionMetrics", async () => {
    const ctx: TrpcContext = {
      user: null,
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
    };
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.analyticsQuery.getTransactionMetrics({ days: 30 })
    ).rejects.toThrow();
  });

  it("rejects unauthenticated users from searchTransactions", async () => {
    const ctx: TrpcContext = {
      user: null,
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
    };
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.analyticsQuery.searchTransactions({ query: "test", limit: 10 })
    ).rejects.toThrow();
  });

  it("rejects non-admin users from getPipelineHealth", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.analyticsQuery.getPipelineHealth()).rejects.toThrow();
  });
});
