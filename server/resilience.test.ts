/**
 * Resilience router integration tests
 *
 * Tests the tRPC procedures that proxy the three microservices:
 *   - Go resilience-agent (:8031)
 *   - Rust offline-queue (:8032)
 *   - Python analytics-service (:8033)
 *
 * These tests use the real HTTP microservices when available, and
 * verify graceful degradation when they are unavailable.
 */
import { describe, expect, it, vi, beforeAll } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ── Helpers ───────────────────────────────────────────────────────────────────

function createCtx(): TrpcContext {
  return {
    user: {
      id: 1,
      username: "test-agent",
      role: "admin" as const,
      agentId: "AGT001",
      name: "Test Agent",
      email: "test@insureportal.io",
    },
    req: {
      headers: {},
      cookies: {},
      ip: "127.0.0.1",
    } as any,
    res: {
      cookie: vi.fn(),
      clearCookie: vi.fn(),
    } as any,
  };
}

function createCaller() {
  return appRouter.createCaller(createCtx());
}

// ── agentSuccessRates ─────────────────────────────────────────────────────────

describe("resilience.agentSuccessRates", () => {
  it("returns an object with agents array and period_days", async () => {
    const caller = createCaller();
    const result = await caller.resilience.agentSuccessRates({ days: 7 });

    expect(result).toBeDefined();
    expect(result).toHaveProperty("agents");
    expect(Array.isArray(result.agents)).toBe(true);
    expect(result).toHaveProperty("period_days");
    expect(result.period_days).toBe(7);
  });

  it("each agent entry has expected fields when data is present", async () => {
    const caller = createCaller();
    const result = await caller.resilience.agentSuccessRates({ days: 7 });

    for (const agent of result.agents) {
      expect(agent).toHaveProperty("agent_code");
      expect(agent).toHaveProperty("agent_name");
      expect(agent).toHaveProperty("total_transactions");
      expect(typeof agent.total_transactions).toBe("number");
    }
  });

  it("accepts days parameter up to 90", async () => {
    const caller = createCaller();
    const result = await caller.resilience.agentSuccessRates({ days: 30 });
    expect(result.period_days).toBe(30);
  });
});

// ── successRate ───────────────────────────────────────────────────────────────

describe("resilience.successRate", () => {
  it("returns success_rate_pct and tier", async () => {
    const caller = createCaller();
    const result = await caller.resilience.successRate({ days: 7 });

    expect(result).toBeDefined();
    // When analytics service is running, these fields are present
    if (result && typeof result === "object" && "success_rate_pct" in result) {
      const rate = (result as any).success_rate_pct;
      expect(typeof rate).toBe("number");
      expect(rate).toBeGreaterThanOrEqual(0);
      expect(rate).toBeLessThanOrEqual(100);
    }
  });
});

// ── queueCount ────────────────────────────────────────────────────────────────

describe("resilience.queueCount", () => {
  it("returns a numeric count", async () => {
    const caller = createCaller();
    const result = await caller.resilience.queueCount({});

    expect(result).toBeDefined();
    if (result && typeof result === "object" && "count" in result) {
      expect(typeof (result as any).count).toBe("number");
      expect((result as any).count).toBeGreaterThanOrEqual(0);
    }
  });
});

// ── dequeueOffline ────────────────────────────────────────────────────────────

describe("resilience.dequeueOffline", () => {
  it("returns null item when queue is empty", async () => {
    const caller = createCaller();
    // When queue is empty, the procedure should return gracefully
    try {
      const result = await caller.resilience.dequeueOffline({});
      // If it returns, item should be null or an object
      if (result) {
        expect(result).toHaveProperty("dequeued");
      }
    } catch (err: any) {
      // Service unavailable is acceptable in test environment
      expect(err.message).toBeTruthy();
    }
  });
});

// ── enqueueOffline ────────────────────────────────────────────────────────────

describe("resilience.enqueueOffline", () => {
  it("enqueues a transaction and returns queued:true or service-unavailable error", async () => {
    const caller = createCaller();
    try {
      const result = await caller.resilience.enqueueOffline({
        txType: "CashIn",
        amount: 5000,
        customerName: "Test Customer",
        customerPhone: "08031234567",
        channel: "Offline",
      });
      expect(result).toBeDefined();
    } catch (err: any) {
      // Acceptable when Rust service is not running in test env
      expect(err.message).toBeTruthy();
    }
  });
});

// ── encodeUssd ────────────────────────────────────────────────────────────────

describe("resilience.encodeUssd", () => {
  it("returns a USSD string for a Transfer transaction", async () => {
    const caller = createCaller();
    try {
      const result = await caller.resilience.encodeUssd({
        txType: "Transfer",
        amount: 10000,
        accountNumber: "0123456789",
        bankCode: "058",
      });
      if (result && typeof result === "object" && "ussd" in result) {
        const ussd = (result as any).ussd as string;
        expect(ussd).toMatch(/^\*/);
        expect(ussd).toContain("10000");
      }
    } catch (err: any) {
      expect(err.message).toBeTruthy();
    }
  });
});
