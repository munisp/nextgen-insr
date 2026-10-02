// 2026-10-02 (C2-b11b12): Persistence regression tests for audit B11 —
// telegram conversation state (language preference, last-active) must survive
// a bot restart (Redis hash + idle TTL), with a loudly-logged in-memory
// fallback only when Redis is down.
//
// Store is NOT mocked: real Redis when reachable (REDIS_URL or
// redis://:redis_dev@localhost:6379), else the Redis-backed cases skip
// (skip-if-unreachable pattern). The outage case runs everywhere via a
// genuinely unreachable Redis URL.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Redis from "ioredis";
import { ConversationManager } from "./conversation";
import { RedisConversationStore } from "../lib/conversationStore";
import { closeRedisClients } from "../lib/redisClient";

const REDIS_URL = process.env.REDIS_URL ?? "redis://:redis_dev@localhost:6379";

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
const storeOpts = { url: REDIS_URL, keyPrefix: "tg:test:b11:" };

async function cleanup(): Promise<void> {
  if (!redisUp) return;
  const r = new Redis(REDIS_URL, { lazyConnect: true });
  r.on("error", () => {});
  try {
    const keys = await r.keys("tg:test:b11:*");
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

describe.skipIf(!redisUp)("B11: telegram state survives a restart (real Redis)", () => {
  it("language preference is recovered by a fresh manager instance", async () => {
    const chatId = 900000001;
    const m1 = new ConversationManager("http://api.invalid", new RedisConversationStore(storeOpts));
    await m1.setLanguage(chatId, "ha");

    // Simulate restart: brand-new manager (empty process memory) shares Redis.
    const m2 = new ConversationManager("http://api.invalid", new RedisConversationStore(storeOpts));
    expect(await m2.getLanguage(chatId)).toBe("ha");
  });

  it("state hash carries the idle-timeout TTL", async () => {
    const chatId = 900000002;
    const m = new ConversationManager("http://api.invalid", new RedisConversationStore(storeOpts));
    await m.processMessage(chatId, "menu");
    const r = new Redis(REDIS_URL, { lazyConnect: true });
    try {
      const ttl = await r.ttl(`tg:test:b11:${chatId}`);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(24 * 60 * 60);
    } finally {
      r.disconnect();
    }
  });
});

describe("B11: Redis outage falls back to in-memory loudly (no mock store)", () => {
  it("writes attempt Redis first, then memory + throttled error log", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // Port 1 on loopback refuses immediately — a real ioredis client, no mock.
      const m = new ConversationManager(
        "http://api.invalid",
        new RedisConversationStore({ url: "redis://127.0.0.1:1", keyPrefix: "tg:test:b11:down:" })
      );
      const chatId = 900000003;
      await m.setLanguage(chatId, "yo");
      expect(await m.getLanguage(chatId)).toBe("yo"); // in-memory fallback
      expect(errSpy).toHaveBeenCalled(); // logged loudly
    } finally {
      errSpy.mockRestore();
    }
  }, 15000);
});
