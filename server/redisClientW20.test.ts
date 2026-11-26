/**
 * redisClientW20.test.ts — 2026-11-26 (W20)
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests for the bounded connect-failure backoff in getDirectClient.
 *
 * Risk addressed: after W19, a black-holed Redis host still made EVERY cache
 * call pay up to connectTimeout (~3s) before proxy fallback — a slow-death
 * latency storm. Now, after BACKOFF_THRESHOLD (2) consecutive connect
 * failures, getDirectClient enters a 30s cooldown during which it returns
 * null immediately (callers take the designed proxy-degradation path).
 * After the cooldown one probe is allowed; success resets the counter,
 * failure re-enters cooldown.
 *
 * Injection pattern follows redisClientW19.test.ts: a hoisted fake ioredis
 * module + proxy fetch stubs. Cooldown time travel uses vitest fake timers
 * (vi.setSystemTime mocks Date.now) — honest DI of the clock, no module
 * hackery.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Hoisted mock-control state shared with the fake ioredis module below.
const h = vi.hoisted(() => ({
  instances: [] as Array<{ status: string; disconnectCount: number }>,
  connectError: null as Error | null,
  getValue: "direct-value" as string | null,
}));

vi.mock("ioredis", () => {
  class FakeRedis {
    status = "wait";
    disconnectCount = 0;
    constructor(public url: string, public opts: unknown) {
      h.instances.push(this);
    }
    on() {
      return this;
    }
    async connect() {
      if (h.connectError) {
        this.status = "end";
        throw h.connectError;
      }
      this.status = "ready";
    }
    get(_key: string) {
      return this.status === "ready"
        ? Promise.resolve(h.getValue)
        : Promise.reject(new Error("not ready"));
    }
    disconnect() {
      this.disconnectCount++;
      this.status = "end";
    }
  }
  return { default: FakeRedis };
});

// redisClient.ts only needs logger.error/warn/info; mock it so this unit test
// stays hermetic (pino is irrelevant to the contract under test).
vi.mock("./_core/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// env.ts defaults redisUrl to "redis://redis:6379" when REDIS_URL is unset,
// so the direct (ioredis) path is active in these tests by default.

async function freshModule() {
  vi.resetModules();
  return import("./redisClient");
}

function stubProxyFetch(payload: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn(async () => ({
    ok,
    status,
    json: async () => payload,
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const COOLDOWN_MS = 30_000; // must match BACKOFF_COOLDOWN_MS in redisClient.ts

beforeEach(() => {
  h.instances.length = 0;
  h.connectError = null;
  h.getValue = "direct-value";
  // Fake timers mock Date.now by default in vitest — this is the clock
  // getDirectClient compares against cooldownUntil.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-26T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("redisClient W20 — bounded connect-failure backoff", () => {
  it("(a) after 2 failed connects, getDirectClient returns null without attempting connect", async () => {
    h.connectError = new Error("connect timeout (black hole)");
    const fetchMock = stubProxyFetch({ value: "proxy-value" });
    const mod = await freshModule();

    // Failures 1 and 2 each pay a connect attempt, then fall back to proxy.
    await expect(mod.cacheGet("k")).resolves.toBe("proxy-value");
    await expect(mod.cacheGet("k")).resolves.toBe("proxy-value");
    expect(h.instances).toHaveLength(2);
    expect(h.instances[0].disconnectCount).toBe(1);
    expect(h.instances[1].disconnectCount).toBe(1);

    // Cooldown is now active: further calls must NOT attempt connect at all.
    await expect(mod.cacheGet("k")).resolves.toBe("proxy-value");
    await expect(mod.cacheGet("k")).resolves.toBe("proxy-value");
    expect(h.instances).toHaveLength(2); // connect call count stopped growing
    expect(fetchMock).toHaveBeenCalledTimes(4); // all 4 calls hit the proxy
  });

  it("(b) after the cooldown elapses exactly one probe is allowed; failure re-enters cooldown", async () => {
    h.connectError = new Error("connect timeout (black hole)");
    const fetchMock = stubProxyFetch({ value: "proxy-value" });
    const mod = await freshModule();

    await mod.cacheGet("k");
    await mod.cacheGet("k"); // cooldown entered (2 failures)
    expect(h.instances).toHaveLength(2);

    // Still inside the cooldown window: no probe.
    vi.setSystemTime(Date.now() + COOLDOWN_MS - 1);
    await expect(mod.cacheGet("k")).resolves.toBe("proxy-value");
    expect(h.instances).toHaveLength(2);

    // Cooldown elapsed: exactly one probe is attempted (and fails again).
    vi.setSystemTime(Date.now() + 2);
    await expect(mod.cacheGet("k")).resolves.toBe("proxy-value");
    expect(h.instances).toHaveLength(3);
    expect(h.instances[2].disconnectCount).toBe(1);

    // Failed probe re-enters cooldown: next call does not connect.
    await expect(mod.cacheGet("k")).resolves.toBe("proxy-value");
    expect(h.instances).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("(c) a successful probe resets the backoff — subsequent calls use the direct client", async () => {
    h.connectError = new Error("connect timeout (black hole)");
    const fetchMock = stubProxyFetch({ value: "proxy-value" });
    const mod = await freshModule();

    await mod.cacheGet("k");
    await mod.cacheGet("k"); // cooldown entered
    expect(h.instances).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Redis recovers during the cooldown; time travel past it and probe.
    h.connectError = null;
    vi.setSystemTime(Date.now() + COOLDOWN_MS + 1);
    await expect(mod.cacheGet("k")).resolves.toBe("direct-value");
    expect(h.instances).toHaveLength(3);
    expect(h.instances[2].status).toBe("ready");

    // Backoff reset: subsequent calls use the cached direct client, no proxy,
    // no new connect attempts.
    await expect(mod.cacheGet("k")).resolves.toBe("direct-value");
    await expect(mod.cacheGet("k")).resolves.toBe("direct-value");
    expect(h.instances).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(2); // unchanged since recovery
  });
});
