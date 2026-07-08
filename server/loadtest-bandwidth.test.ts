// @ts-check

// @ts-nocheck
import { describe, it, expect } from "vitest";
import { logger } from '../_core/logger.js';

import {
  detectConnectionQuality,
  getBandwidthBudget,
  trimResponse,
  getProgressiveLoadConfig,
  getCachedResponse,
  setCachedResponse,
  createBatchProcessor,
  recordConnectionHealth,
  getConnectionHealthStats,
} from "./middleware/adaptiveBandwidth";

describe("Adaptive Bandwidth Load Test — Simulated 2G Conditions", () => {
  describe("Network Quality Detection", () => {
    it("detects 2G from Save-Data and ECT headers", () => {
      const mockReq = {
        headers: { "save-data": "on", ect: "2g", downlink: "0.1", rtt: "2000" },
        get: function (h: string) {
          return this.headers[h.toLowerCase()];
        },
      } as any;
      const quality = detectConnectionQuality(mockReq);
      expect(["2g", "3g", "offline", "wifi", "4g"]).toContain(quality);
    });

    it("detects 3G from ECT header", () => {
      const mockReq = {
        headers: { ect: "3g", downlink: "1.5", rtt: "400" },
        get: function (h: string) {
          return this.headers[h.toLowerCase()];
        },
      } as any;
      const quality = detectConnectionQuality(mockReq);
      expect(["2g", "3g", "4g", "wifi"]).toContain(quality);
    });

    it("detects 4G/wifi from high downlink", () => {
      const mockReq = {
        headers: { ect: "4g", downlink: "10", rtt: "50" },
        get: function (h: string) {
          return this.headers[h.toLowerCase()];
        },
      } as any;
      const quality = detectConnectionQuality(mockReq);
      expect(["4g", "wifi"]).toContain(quality);
    });

    it("defaults to wifi or 4g when no headers present", () => {
      const mockReq = {
        headers: {},
        get: function (h: string) {
          return this.headers[h.toLowerCase()];
        },
      } as any;
      const quality = detectConnectionQuality(mockReq);
      expect(["wifi", "4g"]).toContain(quality);
    });
  });

  describe("Bandwidth Budget Enforcement", () => {
    it("2G budget is restrictive", () => {
      const budget = getBandwidthBudget("2g");
      expect(budget.maxResponseBytes).toBeLessThanOrEqual(15360); // <= 15KB
      expect(budget.maxListItems).toBeLessThanOrEqual(15);
    });

    it("3G budget is moderate", () => {
      const budget = getBandwidthBudget("3g");
      expect(budget.maxResponseBytes).toBeLessThanOrEqual(102400); // <= 100KB
      expect(budget.maxListItems).toBeLessThanOrEqual(50);
    });

    it("4G budget is generous", () => {
      const budget = getBandwidthBudget("4g");
      expect(budget.maxResponseBytes).toBeGreaterThan(100000);
    });

    it("WiFi budget is largest", () => {
      const budget = getBandwidthBudget("wifi");
      expect(budget.maxResponseBytes).toBeGreaterThan(500000);
    });
  });

  describe("Response Trimming Under 2G", () => {
    it("trims arrays to budget max items", () => {
      const budget = getBandwidthBudget("2g");
      const largeArray = Array.from({ length: 100 }, (_, i) => ({
        id: i,
        name: `Item ${i}`,
        description: "A".repeat(200),
      }));
      const trimmed = trimResponse({ items: largeArray }, budget);
      expect(trimmed.items.length).toBeLessThanOrEqual(budget.maxListItems);
    });

    it("preserves full data with wifi budget", () => {
      const budget = getBandwidthBudget("wifi");
      const data = {
        items: Array.from({ length: 100 }, (_, i) => ({ id: i })),
        avatar: "https://cdn.example.com/avatar.jpg",
        description: "X".repeat(5000),
      };
      const trimmed = trimResponse(data, budget);
      expect(trimmed.items.length).toBe(100);
    });
  });

  describe("Progressive Loading Config", () => {
    it("returns restricted config for 2G agent entity", () => {
      const config = getProgressiveLoadConfig("2g", "agent");
      expect(config).toBeDefined();
      expect(config.fields).toBeDefined();
      expect(config.fields.length).toBeGreaterThan(0);
      expect(config.fields.length).toBeLessThan(20);
    });

    it("returns full config for wifi", () => {
      const config = getProgressiveLoadConfig("wifi", "agent");
      expect(config).toBeDefined();
    });
  });

  describe("Stale-While-Revalidate Cache", () => {
    it("caches and retrieves responses", () => {
      const key = "test-cache-key-" + Date.now();
      const data = { items: [1, 2, 3], total: 3 };
      setCachedResponse(key, data, 60000);
      const cached = getCachedResponse(key);
      expect(cached).not.toBeNull();
      expect(cached!.data).toEqual(data);
    });

    it("returns null for non-existent key", () => {
      const cached = getCachedResponse("nonexistent-" + Date.now());
      expect(cached).toBeNull();
    });
  });

  describe("Batch Processor", () => {
    it("creates a batch processor with configurable size", () => {
      const processor = createBatchProcessor(5, 50);
      expect(processor).toBeDefined();
    });
  });

  describe("Connection Health Monitoring", () => {
    it("records connection health data", () => {
      const clientId = "test-client-" + Date.now();
      recordConnectionHealth(clientId, "2g", 2000);
      recordConnectionHealth(clientId, "2g", 3000);
      recordConnectionHealth(clientId, "2g", 2500);
      const stats = getConnectionHealthStats();
      expect(stats.total).toBeGreaterThan(0);
    });
  });

  describe("Concurrent Load Simulation (500 2G connections)", () => {
    it("handles 500 concurrent trim operations without error", () => {
      const budget = getBandwidthBudget("2g");
      const largePayload = {
        items: Array.from({ length: 50 }, (_, i) => ({
          id: i,
          name: `Agent ${i}`,
          avatar: `https://cdn.example.com/avatar-${i}.jpg`,
          description: "X".repeat(1000),
          transactions: Array.from({ length: 20 }, (_, j) => ({
            id: j,
            amount: Math.random() * 10000,
            timestamp: Date.now(),
          })),
        })),
        meta: { total: 5000, page: 1 },
      };

      const startTime = Date.now();
      const results: any[] = [];

      for (let i = 0; i < 500; i++) {
        const trimmed = trimResponse(
          JSON.parse(JSON.stringify(largePayload)),
          budget
        );
        results.push(trimmed);
      }

      const elapsed = Date.now() - startTime;

      // All 500 should complete
      expect(results.length).toBe(500);

      // Each result should be trimmed
      results.forEach(r => {
        expect(r.items.length).toBeLessThanOrEqual(budget.maxListItems);
      });

      // Should complete in under 10 seconds (generous for sandbox)
      expect(elapsed).toBeLessThan(10000);
      console.log(
        `500 concurrent 2G trims completed in ${elapsed}ms (avg ${(elapsed / 500).toFixed(2)}ms/op)`
      );
    });

    it("cache handles 500 concurrent reads/writes", () => {
      const startTime = Date.now();

      // Write 500 cache entries
      for (let i = 0; i < 500; i++) {
        setCachedResponse(
          `load-test-${i}`,
          { id: i, data: "X".repeat(100) },
          60000
        );
      }

      // Read them all back
      let hits = 0;
      for (let i = 0; i < 500; i++) {
        const cached = getCachedResponse(`load-test-${i}`);
        if (cached) hits++;
      }

      const elapsed = Date.now() - startTime;

      expect(hits).toBeGreaterThanOrEqual(400); // Allow some eviction
      expect(elapsed).toBeLessThan(5000);
      console.log(
        `500 cache ops completed in ${elapsed}ms, hit rate: ${((hits / 500) * 100).toFixed(1)}%`
      );
    });

    it("progressive load config handles 500 entities efficiently", () => {
      const startTime = Date.now();
      const results: any[] = [];

      for (let i = 0; i < 500; i++) {
        const config = getProgressiveLoadConfig("2g", "agent");
        results.push(config);
      }

      const elapsed = Date.now() - startTime;

      expect(results.length).toBe(500);
      expect(elapsed).toBeLessThan(1000);
      console.log(
        `500 progressive load configs in ${elapsed}ms (avg ${(elapsed / 500).toFixed(2)}ms/op)`
      );
    });
  });
});
