// @ts-check

import { describe, it, expect, vi, beforeEach } from "vitest";
import { resilientFetch, getCircuitBreakerStatus } from "../resilientFetch";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("resilientFetch", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("should return data on successful request", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ status: "ok" }),
    });

    const result = await resilientFetch<{ status: string }>(
      "http://localhost:8090/health",
      { method: "GET" },
      { serviceName: "test-service-1" }
    );

    expect(result).toEqual({ status: "ok" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("should retry on 503 and succeed", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ recovered: true }),
      });

    const result = await resilientFetch<{ recovered: boolean }>(
      "http://localhost:8090/api",
      { method: "GET" },
      { serviceName: "test-service-2", retry: { baseDelayMs: 10 } }
    );

    expect(result).toEqual({ recovered: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("should return fallback when all retries fail", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    const result = await resilientFetch<{ fallback: boolean }>(
      "http://localhost:8090/api",
      { method: "GET" },
      {
        serviceName: "test-service-3",
        retry: { maxRetries: 1, baseDelayMs: 10 },
        fallback: { fallback: true },
      }
    );

    expect(result).toEqual({ fallback: true });
  });

  it("should open circuit breaker after threshold failures", async () => {
    mockFetch.mockRejectedValue(new Error("Connection refused"));

    const serviceName = "test-service-breaker";

    // Exhaust retries 5 times to trigger circuit breaker (threshold = 5)
    for (let i = 0; i < 5; i++) {
      try {
        await resilientFetch(
          "http://localhost:9999/fail",
          { method: "GET" },
          { serviceName, retry: { maxRetries: 0, baseDelayMs: 1 } }
        );
      } catch {
        // expected
      }
    }

    const status = getCircuitBreakerStatus();
    expect(status[serviceName]?.state).toBe("open");

    // Next request should be rejected immediately with fallback
    mockFetch.mockReset();
    const result = await resilientFetch<string>(
      "http://localhost:9999/fail",
      { method: "GET" },
      { serviceName, fallback: "circuit-open-fallback" }
    );

    expect(result).toBe("circuit-open-fallback");
    expect(mockFetch).not.toHaveBeenCalled(); // Request never made
  });

  it("should respect timeout", async () => {
    mockFetch.mockImplementation((_url: string, init: any) => {
      return new Promise((_, reject) => {
        const timer = setTimeout(
          () => reject(new Error("network timeout")),
          10000
        );
        // Listen to abort signal
        if (init?.signal) {
          init.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
          });
        }
      });
    });

    await expect(
      resilientFetch(
        "http://localhost:8090/slow",
        { method: "GET" },
        { serviceName: "test-timeout", timeoutMs: 50, retry: { maxRetries: 0 } }
      )
    ).rejects.toThrow();
  }, 10000);
});
