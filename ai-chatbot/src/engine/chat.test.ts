// 2026-10-02 (C2-b11b12): Persistence regression tests for audit B12 —
// chat sessions (language + history) must survive a service restart (Redis
// hash + idle TTL, history capped), with a loudly-logged in-memory fallback
// only when Redis is down.
//
// Store is NOT mocked: real Redis when reachable (REDIS_URL or
// redis://:redis_dev@localhost:6379), else the Redis-backed cases skip
// (skip-if-unreachable pattern). The outage case runs everywhere via a
// genuinely unreachable Redis URL.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Redis from "ioredis";
import { ChatEngine } from "./chat";
import { KnowledgeBase } from "../knowledge/base";
import { LanguageDetector } from "../language/detector";
import { RedisSessionStore, HISTORY_CAP } from "../lib/sessionStore";
import { closeRedisClients } from "../lib/redisClient";

// 2026-10-03 (W8-B7): fail-closed guard — tests refuse to run against
// any Redis not on the test allowlist (loopback 6399/6379 or an exact
// CHANNEL_CORE_TEST_REDIS_URL match), so a misconfigured env can never
// touch shared/prod data.
import { assertTestRedisUrl } from "@insureportal/channel-core";
const REDIS_URL = assertTestRedisUrl(
  process.env.REDIS_URL ?? "redis://:redis_dev@localhost:6379"
);

async function redisReachable(): Promise<boolean> {
  const probe = new Redis(REDIS_URL, {
    lazyConnect: true,
    connectTimeout: 800,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  probe.on("error", () => {});
  try {
    await probe.connect();
    await probe.ping();
    return true;
  } catch {
    return false;
  } finally {
    probe.disconnect();
  }
}

const redisUp = await redisReachable();
const storeOpts = { url: REDIS_URL, keyPrefix: "chat:test:b12:" };

function freshEngine(store?: RedisSessionStore): ChatEngine {
  return new ChatEngine(
    new KnowledgeBase(),
    new LanguageDetector(),
    store ?? new RedisSessionStore(storeOpts)
  );
}

async function cleanup(): Promise<void> {
  if (!redisUp) return;
  const r = new Redis(REDIS_URL, { lazyConnect: true });
  r.on("error", () => {});
  try {
    const keys = await r.keys("chat:test:b12:*");
    if (keys.length) await r.del(...keys);
  } finally {
    r.disconnect();
  }
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await closeRedisClients();
});

describe.skipIf(!redisUp)("B12: chat sessions survive a restart (real Redis)", () => {
  it("history is recovered by a fresh engine instance", async () => {
    const sid = "sess-restart-1";
    const e1 = freshEngine();
    await e1.respond(sid, "hello there");
    await e1.respond(sid, "second message");

    // Simulate restart: brand-new engine (empty process memory) shares Redis.
    const store2 = new RedisSessionStore(storeOpts);
    const recovered = await store2.get(sid);
    expect(recovered).not.toBeNull();
    expect(recovered!.history).toEqual(["hello there", "second message"]);
  });

  it("session hash carries the idle TTL and history stays capped", async () => {
    const sid = "sess-cap-1";
    const store = new RedisSessionStore(storeOpts);
    const e = freshEngine(store);
    for (let i = 0; i < HISTORY_CAP + 10; i++) {
      await e.respond(sid, `message ${i}`);
    }
    const session = (await store.get(sid))!;
    expect(session.history.length).toBe(HISTORY_CAP);
    expect(session.history[0]).toBe("message 10"); // oldest dropped first

    const r = new Redis(REDIS_URL, { lazyConnect: true });
    try {
      const ttl = await r.ttl(`chat:test:b12:${sid}`);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(24 * 60 * 60);
    } finally {
      r.disconnect();
    }
  });
});

describe("B12: Redis outage falls back to in-memory loudly (no mock store)", () => {
  it("writes attempt Redis first, then memory + throttled error log", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // Port 1 on loopback refuses immediately — a real ioredis client, no mock.
      const store = new RedisSessionStore({
        url: "redis://127.0.0.1:1",
        keyPrefix: "chat:test:b12:down:",
      });
      const e = freshEngine(store);
      await e.respond("sess-down-1", "hello");
      await e.respond("sess-down-1", "still here");
      expect((await store.get("sess-down-1"))!.history).toEqual(["hello", "still here"]);
      expect(errSpy).toHaveBeenCalled(); // logged loudly
    } finally {
      errSpy.mockRestore();
    }
  }, 15000);
});
