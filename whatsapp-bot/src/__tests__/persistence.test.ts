// 2026-10-02 (C2-b11b12): Persistence regression tests for audit B11 —
// conversation state must survive a bot restart (Redis hash + idle TTL),
// with a loudly-logged in-memory fallback only when Redis is down.
//
// Store is NOT mocked: these tests run against a real Redis when reachable
// (REDIS_URL or redis://:redis_dev@localhost:6379), else the Redis-backed
// cases skip (repo-established skip-if-unreachable pattern). The outage
// fallback case runs everywhere via a genuinely unreachable Redis URL.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Redis from "ioredis";
import { ConversationEngine } from "../engine/conversation";
import { InsuranceIntentClassifier } from "../engine/intent";
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

const storeOpts = { url: REDIS_URL, keyPrefix: "wa:test:b11:" };

function freshEngine(store?: RedisConversationStore): ConversationEngine {
  return new ConversationEngine(
    new InsuranceIntentClassifier(),
    undefined,
    store ?? new RedisConversationStore(storeOpts)
  );
}

async function cleanup(): Promise<void> {
  if (!redisUp) return;
  const r = new Redis(REDIS_URL, { lazyConnect: true });
  r.on("error", () => {});
  try {
    const keys = await r.keys("wa:test:b11:*");
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

describe.skipIf(!redisUp)("B11: state survives a restart (real Redis)", () => {
  it("mid-claim conversation is recovered by a fresh engine instance", async () => {
    const phone = "2349111111111";
    const engine1 = freshEngine();
    const r1 = await engine1.processMessage(phone, "file a claim");
    expect(r1.text).toContain("policy number");
    const r2 = await engine1.processMessage(phone, "POL-RESTART-1");
    expect(r2.text).toContain("What type of claim");

    // Simulate restart: a brand-new engine (empty process memory) shares Redis.
    const engine2 = freshEngine();
    const r3 = await engine2.processMessage(phone, "claim_accident");
    // If state had been lost, the bot would have re-classified "claim_accident"
    // as a new intent instead of continuing the claim flow at step 3.
    expect(r3.text).toContain("describe what happened");
  });

  it("state hash carries the idle-timeout TTL", async () => {
    const phone = "2349222222222";
    await freshEngine().processMessage(phone, "menu");
    const r = new Redis(REDIS_URL, { lazyConnect: true });
    try {
      const ttl = await r.ttl(`wa:test:b11:${phone}`);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(600);
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
      const store = new RedisConversationStore({
        url: "redis://127.0.0.1:1",
        keyPrefix: "wa:test:b11:down:",
      });
      const engine = freshEngine(store);
      const phone = "2349333333333";
      const r1 = await engine.processMessage(phone, "file a claim");
      expect(r1.text).toContain("policy number");
      // In-memory fallback keeps the flow alive within this process...
      const r2 = await engine.processMessage(phone, "POL-DOWN-1");
      expect(r2.text).toContain("What type of claim");
      // ...and the outage was logged loudly.
      expect(errSpy).toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
  }, 15000);
});
