/**
 * redisClientW19.test.ts — 2026-11-26 (W19)
 * ─────────────────────────────────────────────────────────────────────────────
 * Regression tests for the cacheGet promise-rejection escape
 * (CI job 139493405438, server/embedded-factory.test.ts flake:
 *  TRPCError "Stream isn't writeable and enableOfflineQueue options is false").
 *
 * Root cause (proven against real ioredis@5.11.1 in the W19 /tmp harness):
 *  ioredis sendCommand (Redis.js:376) rejects the command promise
 *  ASYNCHRONOUSLY when the stream is dead and enableOfflineQueue:false —
 *  it never throws synchronously. The old cacheGet did
 *  `return client.get(key)` (no await) inside try/catch, and a bare
 *  `return <promise>` does NOT observe rejections, so the error escaped to
 *  the tRPC caller. Aggravated by getDirectClient caching its singleton
 *  BEFORE `await connect()`, so one failed connect poisoned every later call.
 *
 * These tests inject a faithful fake ioredis (rejects get() whenever the
 * client is not status "ready", mirroring Redis.js:376) and assert:
 *   1. cacheGet returns null (never rejects) on async command rejection
 *   2. cacheGet returns null on a synchronous throw from the client
 *   3. cacheGet still returns the value on a healthy client (happy path kept)
 *   4. a failed connect() does not poison the singleton — later calls retry
 *   5. proxy fallback (fetch) still works when no direct client exists
 *   6. the other exports keep their fail-open contract on rejection
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const CI_ERROR = "Stream isn't writeable and enableOfflineQueue options is false";

// Hoisted mock-control state shared with the fake ioredis module below.
const h = vi.hoisted(() => ({
  instances: [] as Array<{ status: string; disconnectCount: number }>,
  connectError: null as Error | null,
  getSyncThrow: null as Error | null,
  cmdError: null as Error | null,
  getValue: "direct-value" as string | null,
}));

// Faithful fake of the ioredis surface used by server/redisClient.ts:
// commands reject (not throw-sync) when the client isn't ready — exactly what
// Redis.js sendCommand does at line 376 with enableOfflineQueue:false.
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
    private notReady() {
      return this.status !== "ready" ? new Error(CI_ERROR) : null;
    }
    get(_key: string) {
      if (h.getSyncThrow) throw h.getSyncThrow;
      const err = h.cmdError ?? this.notReady();
      return err ? Promise.reject(err) : Promise.resolve(h.getValue);
    }
    setex() {
      const err = h.cmdError ?? this.notReady();
      return err ? Promise.reject(err) : Promise.resolve("OK");
    }
    set() {
      const err = h.cmdError ?? this.notReady();
      return err ? Promise.reject(err) : Promise.resolve("OK");
    }
    del() {
      const err = h.cmdError ?? this.notReady();
      return err ? Promise.reject(err) : Promise.resolve(1);
    }
    incr() {
      const err = h.cmdError ?? this.notReady();
      return err ? Promise.reject(err) : Promise.resolve(1);
    }
    expire() {
      return Promise.resolve(1);
    }
    publish() {
      const err = h.cmdError ?? this.notReady();
      return err ? Promise.reject(err) : Promise.resolve(1);
    }
    ping() {
      const err = h.cmdError ?? this.notReady();
      return err ? Promise.reject(err) : Promise.resolve("PONG");
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

beforeEach(() => {
  h.instances.length = 0;
  h.connectError = null;
  h.getSyncThrow = null;
  h.cmdError = null;
  h.getValue = "direct-value";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("redisClient W19 — cacheGet rejection escape (CI job 139493405438)", () => {
  it("returns null (never rejects) when client.get rejects asynchronously", async () => {
    h.cmdError = new Error(CI_ERROR); // exact CI message
    const mod = await freshModule();
    await expect(mod.cacheGet("embed:pp:1")).resolves.toBeNull();
  });

  it("returns null (never throws) when client.get throws synchronously", async () => {
    h.getSyncThrow = new Error("sync boom");
    const mod = await freshModule();
    await expect(mod.cacheGet("embed:pp:1")).resolves.toBeNull();
  });

  it("still returns the cached value on a healthy client (happy path kept)", async () => {
    h.getValue = JSON.stringify({ id: 7 });
    const mod = await freshModule();
    await expect(mod.cacheGet("embed:pp:7")).resolves.toBe(h.getValue);
  });

  it("a failed connect() does not poison the singleton — later calls retry and succeed", async () => {
    // 1st call: connect fails -> proxy fallback serves the value.
    h.connectError = new Error("connect ECONNREFUSED");
    const fetchMock = stubProxyFetch({ value: "proxy-value" });
    const mod = await freshModule();
    await expect(mod.cacheGet("embed:pp:1")).resolves.toBe("proxy-value");

    // 2nd call: Redis is healthy again. Pre-fix, the poisoned singleton
    // (status "end") was returned and get() rejected — escaping cacheGet's
    // try/catch with exactly the CI TRPCError. Post-fix, connect is retried
    // and the direct value is served.
    h.connectError = null;
    await expect(mod.cacheGet("embed:pp:1")).resolves.toBe("direct-value");
    // The failed client must have been disposed, not reused.
    expect(h.instances).toHaveLength(2);
    expect(h.instances[0].disconnectCount).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("redisClient W19 — proxy fallback when no direct client exists", () => {
  async function freshProxyOnlyModule() {
    vi.resetModules();
    vi.doMock("./_core/env", () => ({
      ENV: {
        redisUrl: undefined,
        platformBaseUrl: "http://proxy.test",
        platformApiKey: "k",
      },
    }));
    const mod = await import("./redisClient");
    vi.doUnmock("./_core/env");
    return mod;
  }

  it("cacheGet serves the proxy value when REDIS_URL is absent", async () => {
    const fetchMock = stubProxyFetch({ value: "proxied" });
    const mod = await freshProxyOnlyModule();
    await expect(mod.cacheGet("embed:pp:9")).resolves.toBe("proxied");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("http://proxy.test/v1/cache/embed%3App%3A9");
  });

  it("cacheGet returns null (never throws) when the proxy errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }))
    );
    const mod = await freshProxyOnlyModule();
    await expect(mod.cacheGet("embed:pp:9")).resolves.toBeNull();
  });

  it("cacheSet posts through the proxy and returns true", async () => {
    const fetchMock = stubProxyFetch({ ok: true });
    const mod = await freshProxyOnlyModule();
    await expect(mod.cacheSet("k", "v", 60)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://proxy.test/v1/cache",
      expect.objectContaining({ method: "POST" })
    );
  });
});

describe("redisClient W19 — fail-open contract of the other exports", () => {
  it("cacheSet/cacheDel/cacheIncr/cachePublish/redisIsHealthy degrade, never throw", async () => {
    h.cmdError = new Error(CI_ERROR);
    const mod = await freshModule();
    await expect(mod.cacheSet("k", "v")).resolves.toBe(false);
    await expect(mod.cacheSet("k", "v", 30)).resolves.toBe(false);
    await expect(mod.cacheDel("k")).resolves.toBe(false);
    await expect(mod.cacheIncr("k")).resolves.toBe(0);
    await expect(mod.cachePublish("ch", "msg")).resolves.toBe(false);
    await expect(mod.redisIsHealthy()).resolves.toBe(false);
  });
});
