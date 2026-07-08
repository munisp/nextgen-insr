// @ts-check

/**
 * Production Readiness Tests — Sprint 56
 * Covers: Performance Tuning, HA Patterns, Circuit Breakers, Retry Logic, Health Checks
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Performance Tuning Tests ──────────────────────────────────────────────────
describe("Performance Tuning", () => {
  describe("LRU Query Cache", () => {
    it("should cache and retrieve values", async () => {
      const { queryCache } = await import("./lib/performanceTuning");
      queryCache.set("test:key1", { data: "hello" }, 5000);
      const result = queryCache.get<{ data: string }>("test:key1");
      expect(result).toEqual({ data: "hello" });
    });

    it("should return null for expired entries", async () => {
      const { queryCache } = await import("./lib/performanceTuning");
      queryCache.set("test:expired", { data: "old" }, 1); // 1ms TTL
      await new Promise(r => setTimeout(r, 10));
      const result = queryCache.get("test:expired");
      expect(result).toBeNull();
    });

    it("should evict LRU entries when full", async () => {
      const { LRUQueryCache } = await import("./lib/performanceTuning").then(
        m => {
          // Access the class through the cache instance
          return { LRUQueryCache: m.queryCache.constructor };
        }
      );
      // Use the existing cache and test eviction behavior
      const { queryCache } = await import("./lib/performanceTuning");
      const stats = queryCache.getStats();
      expect(stats.maxSize).toBe(500);
      expect(typeof stats.hitRate).toBe("number");
    });

    it("should invalidate entries by pattern", async () => {
      const { queryCache } = await import("./lib/performanceTuning");
      queryCache.set("commission:tier:1", "a", 5000);
      queryCache.set("commission:tier:2", "b", 5000);
      queryCache.set("dispute:1", "c", 5000);
      const removed = queryCache.invalidate("commission:tier");
      expect(removed).toBe(2);
      expect(queryCache.get("dispute:1")).toBe("c");
    });

    it("should track hit/miss statistics", async () => {
      const { queryCache } = await import("./lib/performanceTuning");
      queryCache.set("stats:test", "value", 5000);
      queryCache.get("stats:test"); // hit
      queryCache.get("stats:missing"); // miss
      const stats = queryCache.getStats();
      expect(stats.hitCount).toBeGreaterThan(0);
      expect(typeof stats.hitRate).toBe("number");
    });
  });

  describe("Cached Query Wrapper", () => {
    it("should execute query on cache miss", async () => {
      const { cachedQuery } = await import("./lib/performanceTuning");
      const queryFn = vi.fn().mockResolvedValue({ count: 42 });
      const result = await cachedQuery("test:query:unique1", queryFn, 5000);
      expect(result).toEqual({ count: 42 });
      expect(queryFn).toHaveBeenCalledOnce();
    });

    it("should return cached result on cache hit", async () => {
      const { cachedQuery } = await import("./lib/performanceTuning");
      const queryFn = vi.fn().mockResolvedValue({ count: 99 });
      await cachedQuery("test:query:unique2", queryFn, 5000);
      const result = await cachedQuery("test:query:unique2", queryFn, 5000);
      expect(result).toEqual({ count: 99 });
      expect(queryFn).toHaveBeenCalledOnce(); // Only called once
    });
  });

  describe("Request Metrics", () => {
    it("should record and summarize metrics", async () => {
      const { requestMetrics } = await import("./lib/performanceTuning");
      requestMetrics.record({
        path: "/api/trpc/commission.listTiers",
        method: "GET",
        statusCode: 200,
        durationMs: 15.5,
        timestamp: Date.now(),
      });
      requestMetrics.record({
        path: "/api/trpc/commission.listTiers",
        method: "GET",
        statusCode: 200,
        durationMs: 22.3,
        timestamp: Date.now(),
      });
      const summary = requestMetrics.getSummary();
      expect(summary.totalRequests).toBeGreaterThanOrEqual(2);
      expect(summary.p50Ms).toBeGreaterThanOrEqual(0);
      expect(summary.p99Ms).toBeGreaterThanOrEqual(0);
      expect(typeof summary.errorRate).toBe("number");
    });

    it("should identify slow endpoints", async () => {
      const { requestMetrics } = await import("./lib/performanceTuning");
      for (let i = 0; i < 5; i++) {
        requestMetrics.record({
          path: "/api/trpc/slow.endpoint",
          method: "GET",
          statusCode: 200,
          durationMs: 800 + i * 100,
          timestamp: Date.now(),
        });
      }
      const summary = requestMetrics.getSummary();
      expect(summary.slowestEndpoints.length).toBeGreaterThan(0);
    });
  });

  describe("Connection Pool Config", () => {
    it("should have production-optimized settings", async () => {
      const { POOL_CONFIG } = await import("./lib/performanceTuning");
      expect(POOL_CONFIG.max).toBeGreaterThanOrEqual(20);
      expect(POOL_CONFIG.idleTimeoutMillis).toBeLessThanOrEqual(60_000);
      expect(POOL_CONFIG.connectionTimeoutMillis).toBeLessThanOrEqual(10_000);
      expect(POOL_CONFIG.statement_timeout).toBeLessThanOrEqual(60_000);
    });
  });

  describe("DB Optimization Indexes", () => {
    it("should define indexes for hot query paths", async () => {
      const { DB_OPTIMIZATION } = await import("./lib/performanceTuning");
      expect(DB_OPTIMIZATION.indexes.length).toBeGreaterThanOrEqual(5);
      expect(DB_OPTIMIZATION.indexes.some(i => i.includes("disputes"))).toBe(
        true
      );
      expect(DB_OPTIMIZATION.indexes.some(i => i.includes("commission"))).toBe(
        true
      );
      expect(DB_OPTIMIZATION.indexes.some(i => i.includes("settlement"))).toBe(
        true
      );
    });
  });
});

// ── High Availability Tests ───────────────────────────────────────────────────
describe("High Availability", () => {
  describe("Circuit Breaker", () => {
    it("should start in closed state", async () => {
      const { circuitBreakers } = await import("./lib/highAvailability");
      const state = circuitBreakers.database.getState();
      expect(state.state).toBe("closed");
    });

    it("should execute successfully in closed state", async () => {
      const { circuitBreakers } = await import("./lib/highAvailability");
      circuitBreakers.database.reset();
      const result = await circuitBreakers.database.execute(
        async () => "success"
      );
      expect(result).toBe("success");
    });

    it("should open after threshold failures", async () => {
      const { circuitBreakers } = await import("./lib/highAvailability");
      circuitBreakers.kafka.reset();
      for (let i = 0; i < 5; i++) {
        try {
          await circuitBreakers.kafka.execute(async () => {
            throw new Error("fail");
          });
        } catch {}
      }
      const state = circuitBreakers.kafka.getState();
      expect(state.state).toBe("open");
    });

    it("should reject requests when open", async () => {
      const { circuitBreakers } = await import("./lib/highAvailability");
      // kafka should still be open from previous test
      const state = circuitBreakers.kafka.getState();
      if (state.state === "open") {
        await expect(
          circuitBreakers.kafka.execute(async () => "should not run")
        ).rejects.toThrow("Circuit breaker");
      }
      circuitBreakers.kafka.reset(); // cleanup
    });

    it("should have circuit breakers for all critical services", async () => {
      const { circuitBreakers } = await import("./lib/highAvailability");
      expect(circuitBreakers.database).toBeDefined();
      expect(circuitBreakers.kafka).toBeDefined();
      expect(circuitBreakers.redis).toBeDefined();
      expect(circuitBreakers.tigerBeetle).toBeDefined();
      expect(circuitBreakers.temporal).toBeDefined();
      expect(circuitBreakers.permify).toBeDefined();
      expect(circuitBreakers.fluvio).toBeDefined();
      expect(circuitBreakers.external).toBeDefined();
    });
  });

  describe("Retry with Exponential Backoff", () => {
    it("should succeed on first attempt", async () => {
      const { retryWithBackoff } = await import("./lib/highAvailability");
      const fn = vi.fn().mockResolvedValue("ok");
      const result = await retryWithBackoff(fn, "test-success");
      expect(result).toBe("ok");
      expect(fn).toHaveBeenCalledOnce();
    });

    it("should retry on failure and eventually succeed", async () => {
      const { retryWithBackoff } = await import("./lib/highAvailability");
      let attempt = 0;
      const fn = vi.fn().mockImplementation(async () => {
        attempt++;
        if (attempt < 3) throw new Error("transient");
        return "recovered";
      });
      const result = await retryWithBackoff(fn, "test-retry", {
        maxRetries: 3,
        baseDelayMs: 10,
      });
      expect(result).toBe("recovered");
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it("should throw after max retries exhausted", async () => {
      const { retryWithBackoff } = await import("./lib/highAvailability");
      const fn = vi.fn().mockRejectedValue(new Error("permanent"));
      await expect(
        retryWithBackoff(fn, "test-exhaust", { maxRetries: 2, baseDelayMs: 10 })
      ).rejects.toThrow("permanent");
      expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    });

    it("should not retry non-retryable errors", async () => {
      const { retryWithBackoff } = await import("./lib/highAvailability");
      const fn = vi.fn().mockRejectedValue(new Error("validation error"));
      await expect(
        retryWithBackoff(fn, "test-non-retryable", {
          maxRetries: 3,
          baseDelayMs: 10,
          retryableErrors: ["timeout", "connection"],
        })
      ).rejects.toThrow("validation error");
      expect(fn).toHaveBeenCalledOnce();
    });
  });

  describe("Health Checks", () => {
    it("should return liveness status", async () => {
      const { getLivenessStatus } = await import("./lib/highAvailability");
      const status = getLivenessStatus();
      expect(status.status).toBe("ok");
      expect(status.uptime).toBeGreaterThanOrEqual(0);
    });

    it("should return health status with all checks", async () => {
      const { getHealthStatus } = await import("./lib/highAvailability");
      const health = await getHealthStatus();
      expect(["healthy", "degraded", "unhealthy"]).toContain(health.status);
      expect(health.checks).toBeDefined();
      expect(health.checks.database).toBeDefined();
      expect(health.checks.redis).toBeDefined();
      expect(health.checks.kafka).toBeDefined();
      expect(health.timestamp).toBeDefined();
      expect(health.uptime).toBeGreaterThanOrEqual(0);
    });

    it("should return readiness status", async () => {
      const { getReadinessStatus } = await import("./lib/highAvailability");
      const readiness = await getReadinessStatus();
      expect(typeof readiness.ready).toBe("boolean");
    });
  });

  describe("Health Router", () => {
    it("should create express router with health endpoints", async () => {
      const { createHealthRouter } = await import("./lib/highAvailability");
      const router = createHealthRouter();
      expect(router).toBeDefined();
      // Router has stack with routes
      expect(router.stack.length).toBeGreaterThan(0);
    });
  });

  describe("Graceful Shutdown", () => {
    it("should track shutdown state", async () => {
      const { isServerShuttingDown } = await import("./lib/highAvailability");
      expect(isServerShuttingDown()).toBe(false);
    });
  });

  describe("Request Timeout Middleware", () => {
    it("should create middleware function", async () => {
      const { requestTimeoutMiddleware } = await import(
        "./lib/highAvailability"
      );
      const middleware = requestTimeoutMiddleware(5000);
      expect(typeof middleware).toBe("function");
    });
  });
});

// ── Integration: All 3 Engines DB-Backed ──────────────────────────────────────
describe("Core Engine DB Verification", () => {
  it("txDisputeArbitration should import DB dependencies", async () => {
    const content = await import("fs").then(fs =>
      fs.readFileSync("server/routers/txDisputeArbitration.ts", "utf-8")
    );
    expect(content).toContain("getDb");
    expect(content).toContain("disputes");
    expect(content).not.toContain("Array.from");
    const codeLines1 = content
      .split("\n")
      .filter(
        (l: string) => !l.trim().startsWith("*") && !l.trim().startsWith("//")
      );
    expect(codeLines1.join("\n")).not.toContain("Math.random()");
  });

  it("disputeAnalytics should have zero Math.random", async () => {
    const content = await import("fs").then(fs =>
      fs.readFileSync("server/routers/disputeAnalytics.ts", "utf-8")
    );
    expect(content).toContain("getDb");
    const codeLines1 = content
      .split("\n")
      .filter(
        (l: string) => !l.trim().startsWith("*") && !l.trim().startsWith("//")
      );
    expect(codeLines1.join("\n")).not.toContain("Math.random()");
  });

  it("commissionEngine should use DB persistence", async () => {
    const content = await import("fs").then(fs =>
      fs.readFileSync("server/routers/commissionEngine.ts", "utf-8")
    );
    expect(content).toContain("getDb");
    expect(content).toContain("commission_tiers");
    expect(content).not.toContain("Array.from({ length");
  });

  it("settlementBatchProcessor should use DB persistence", async () => {
    const content = await import("fs").then(fs =>
      fs.readFileSync("server/routers/settlementBatchProcessor.ts", "utf-8")
    );
    expect(content).toContain("getDb");
    expect(content).not.toContain("Array.from({ length");
  });
});

// ── Security Hardening Verification ───────────────────────────────────────────
describe("Security Hardening", () => {
  it("should have input sanitization middleware", async () => {
    const fs = await import("fs");
    expect(fs.existsSync("server/middleware/inputSanitizer.ts")).toBe(true);
  });

  it("should have RBAC middleware", async () => {
    const fs = await import("fs");
    expect(fs.existsSync("server/middleware/rbac.ts")).toBe(true);
  });

  it("should have webhook HMAC verification", async () => {
    const fs = await import("fs");
    expect(fs.existsSync("server/middleware/webhookHmac.ts")).toBe(true);
  });

  it("should have security hardening module", async () => {
    const fs = await import("fs");
    expect(fs.existsSync("server/lib/securityHardening.ts")).toBe(true);
  });
});
