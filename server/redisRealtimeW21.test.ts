/**
 * redisRealtimeW21.test.ts — 2026-11-26 (W21)
 * ─────────────────────────────────────────────────────────────────────────────
 * Regression tests for the F5 finding (W20-B audit) in
 * server/lib/realtimeNotifications.ts:
 *
 * Pre-fix defects (W19/W20 class, reference: server/redisClient.ts):
 *  1. redisPublisher/redisSubscriber singletons were assigned BEFORE
 *     `await connect()`; a failed connect left half-open non-null clients
 *     behind (never cleared).
 *  2. No 'error' listener on either client — node-redis emits 'error' on
 *     socket failures and an unhandled 'error' EventEmitter event THROWS,
 *     which can crash the process.
 *  3. `initRedisPubSub().catch(() => {})` ran once at import with no retry —
 *     a boot-time Redis blip pinned the process to in-memory pub/sub for the
 *     process lifetime (notifications silently stop propagating across
 *     instances).
 *
 * Injection pattern follows redisClientW19/W20: a hoisted faithful fake of
 * the node-redis `createClient` surface used by the module, `vi.resetModules()`
 * per test, real Date-only clock injection (vi.useFakeTimers toFake:["Date"])
 * for the 30s retry window.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Hoisted mock-control state shared with the fake "redis" module below.
const h = vi.hoisted(() => ({
  instances: [] as Array<any>,
  connectError: null as Error | null,
  publishCalls: [] as Array<{ channel: string; message: string }>,
  errorLog: [] as string[],
  infoLog: [] as string[],
}));

// Faithful fake of the node-redis (redis@4) surface used by
// realtimeNotifications.ts: createClient({url}), .on("error"), .connect(),
// .disconnect(), .publish(), .subscribe(), .isReady. Like the real client,
// EventEmitter semantics apply — the module MUST attach an 'error' listener.
vi.mock("redis", () => ({
  createClient: (opts: { url: string }) => {
    const listeners = new Map<string, Array<(err: Error) => void>>();
    const client: any = {
      url: opts.url,
      isReady: false,
      isOpen: false,
      disconnectCount: 0,
      on(event: string, cb: (err: Error) => void) {
        listeners.set(event, [...(listeners.get(event) ?? []), cb]);
        return client;
      },
      listenerCount(event: string) {
        return (listeners.get(event) ?? []).length;
      },
      // Test-only helper: emit an 'error' event the way node-redis would on a
      // socket failure. Throws (like EventEmitter) if no listener is attached.
      __emitError(err: Error) {
        const cbs = listeners.get("error") ?? [];
        if (cbs.length === 0) throw err; // real EventEmitter behavior
        for (const cb of cbs) cb(err);
      },
      async connect() {
        if (h.connectError) throw h.connectError;
        client.isReady = true;
        client.isOpen = true;
      },
      async disconnect() {
        client.disconnectCount++;
        client.isReady = false;
        client.isOpen = false;
      },
      async publish(channel: string, message: string) {
        if (!client.isReady) throw new Error("Client is not ready");
        h.publishCalls.push({ channel, message });
        return 1;
      },
      async subscribe() {
        return;
      },
    };
    h.instances.push(client);
    return client;
  },
}));

// jwtVerify is unused by the paths under test; mocked so the static import
// stays hermetic (repo node_modules is husked).
vi.mock("jose", () => ({ jwtVerify: vi.fn() }));

// realtimeNotifications.ts uses the named `logger`; its envValidation import
// uses the default export. Mock both so pino stays out of this unit test.
vi.mock("./_core/logger", () => {
  const logger = {
    error: vi.fn((m: string) => h.errorLog.push(String(m))),
    warn: vi.fn(),
    info: vi.fn((m: string) => h.infoLog.push(String(m))),
  };
  return { default: logger, logger };
});

const T0 = new Date("2026-11-26T00:00:00Z");
const RETRY_INTERVAL_MS = 30_000; // must match INIT_RETRY_INTERVAL_MS

async function flush(turns = 10) {
  for (let i = 0; i < turns; i++) await new Promise(r => setImmediate(r));
}

async function freshModule() {
  vi.resetModules();
  const mod = await import("./lib/realtimeNotifications");
  await flush(); // let the module-load init settle deterministically
  return mod;
}

function makeNotification(channel = "transaction") {
  return {
    id: "n1",
    channel,
    title: "t",
    body: "b",
    severity: "info",
    timestamp: new Date().toISOString(),
  } as const;
}

beforeEach(() => {
  h.instances.length = 0;
  h.connectError = null;
  h.publishCalls.length = 0;
  h.errorLog.length = 0;
  h.infoLog.length = 0;
  delete process.env.REDIS_URL;
  // Date-only fake timers: honest clock injection for the retry window
  // (same pattern as redisClientW20.test.ts); setImmediate stays real.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.REDIS_URL;
});

describe("realtimeNotifications W21 — failed initial connect does not poison singletons", () => {
  it("failed boot init disposes both clients, leaves singletons null, publishes fall back to in-memory", async () => {
    process.env.REDIS_URL = "redis://fake:6379";
    h.connectError = new Error("connect ECONNREFUSED");
    const mod = await freshModule();

    // Boot init failed: 2 clients created, BOTH disposed, none half-open.
    expect(h.instances).toHaveLength(2);
    expect(h.instances[0].disconnectCount).toBe(1);
    expect(h.instances[1].disconnectCount).toBe(1);
    expect(
      h.infoLog.some(m => m.includes("using in-memory pub/sub"))
    ).toBe(true);

    // Publish falls back to in-memory (no Redis publish, no throw).
    await expect(
      mod.publishNotification(makeNotification() as any)
    ).resolves.toBeUndefined();
    expect(h.publishCalls).toHaveLength(0);
  });

  it("a later publish re-arms init (after the retry window) and Redis takes over", async () => {
    process.env.REDIS_URL = "redis://fake:6379";
    h.connectError = new Error("boot-time blip");
    const mod = await freshModule();
    expect(h.instances).toHaveLength(2); // failed boot pair

    // Inside the retry window: publish re-arm is throttled, no new clients.
    await mod.publishNotification(makeNotification() as any);
    await flush();
    expect(h.instances).toHaveLength(2);

    // Redis recovers; advance past the 30s retry window and publish again.
    h.connectError = null;
    vi.setSystemTime(T0.getTime() + RETRY_INTERVAL_MS + 1);
    await mod.publishNotification(makeNotification() as any); // still in-memory…
    await flush(); // …but the re-armed init has now connected

    // Fresh clients (2 more), previous pair was disposed, new pair is ready.
    expect(h.instances).toHaveLength(4);
    expect(h.instances[2].isReady).toBe(true);
    expect(h.instances[3].isReady).toBe(true);

    // Now publishes go through Redis (channel + notifications:all fan-out).
    await mod.publishNotification(makeNotification("fraud") as any);
    expect(h.publishCalls.map(c => c.channel)).toEqual([
      "notifications:fraud",
      "notifications:all",
    ]);
    expect(JSON.parse(h.publishCalls[0].message).channel).toBe("fraud");
  });

  it("without REDIS_URL the in-memory fallback contract is unchanged (no clients created)", async () => {
    const mod = await freshModule(); // REDIS_URL unset in beforeEach
    await expect(
      mod.publishNotification(makeNotification() as any)
    ).resolves.toBeUndefined();
    expect(h.instances).toHaveLength(0);
    expect(h.publishCalls).toHaveLength(0);
  });
});

describe("realtimeNotifications W21 — 'error' events are logged, not fatal", () => {
  it("publisher and subscriber have 'error' listeners; emitting 'error' does not throw and does not break publishing", async () => {
    process.env.REDIS_URL = "redis://fake:6379";
    const mod = await freshModule(); // healthy boot
    expect(h.instances).toHaveLength(2);
    const [publisher, subscriber] = h.instances;
    expect(publisher.isReady).toBe(true);

    // Pre-fix, NO 'error' listener existed: this would throw (EventEmitter
    // semantics — an unhandled 'error' crashes the process).
    expect(publisher.listenerCount("error")).toBeGreaterThan(0);
    expect(subscriber.listenerCount("error") > 0).toBe(true);
    expect(() => publisher.__emitError(new Error("socket reset"))).not.toThrow();
    expect(() => subscriber.__emitError(new Error("socket reset"))).not.toThrow();
    expect(
      h.errorLog.some(m => m.includes("Redis publisher error"))
    ).toBe(true);
    expect(
      h.errorLog.some(m => m.includes("Redis subscriber error"))
    ).toBe(true);

    // Publishing still works after the logged error.
    await mod.publishNotification(makeNotification("kyc") as any);
    expect(h.publishCalls.map(c => c.channel)).toEqual([
      "notifications:kyc",
      "notifications:all",
    ]);
  });

  it("error listeners are attached even on clients whose connect later fails", async () => {
    process.env.REDIS_URL = "redis://fake:6379";
    h.connectError = new Error("connect ECONNREFUSED");
    await freshModule();
    // Both disposed clients had listeners attached before connect was attempted.
    expect(h.instances[0].listenerCount("error")).toBeGreaterThan(0);
    expect(h.instances[1].listenerCount("error") > 0).toBe(true);
  });
});
