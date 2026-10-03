// 2026-10-03 (W8-B3): Adapter-layer tests for the channel-core migration.
// Mirror of whatsapp-bot's W8-B2 channelCoreAdapter.test.ts, adapted to this
// bot's wire contract (numeric chatId keys, 24h TTL default). Proves the thin
// telegram adapters preserve behavior over channel-core:
//   - store adapter: roundtrip/delete/listByUser on REAL Redis (no mocks;
//     skip-if-unreachable per repo convention), correct key prefix + TTL;
//   - outage path: unreachable Redis degrades to memory with a loudly
//     throttled [telegram-bot] error log (error mapping);
//   - config fail-fast: src/config.ts refuses to boot without the required
//     env vars and names the missing one.
// Note: telegram-bot has NO platform backend wiring (R1d — no public member
// tRPC procedures exist), so unlike whatsapp-bot there is no PlatformClient
// wrapper to test here; member-data replies stay honest-unavailable.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Redis from "ioredis";
import {
  RedisConversationStore,
  ConversationState,
} from "../lib/conversationStore";
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
const PREFIX = "tg:test:w8b3:";
const storeOpts = { url: REDIS_URL, keyPrefix: PREFIX };

const sampleState = (chatId: number): ConversationState => ({
  chatId,
  language: "ha",
  lastActive: Date.now(),
});

async function cleanup(): Promise<void> {
  if (!redisUp) return;
  const r = new Redis(REDIS_URL, { lazyConnect: true });
  r.on("error", () => {});
  try {
    const keys = await r.keys(`${PREFIX}*`);
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

describe.skipIf(!redisUp)("W8-B3 store adapter (real Redis)", () => {
  it("roundtrips telegram ConversationState keyed by chatId, with idle TTL", async () => {
    const store = new RedisConversationStore(storeOpts);
    const state = sampleState(910000001);
    await store.set(state);
    const got = await store.get(state.chatId);
    expect(got).toEqual(state);
    // chatId must survive as a number (pre-migration HASH used Number()).
    expect(typeof got!.chatId).toBe("number");

    const r = new Redis(REDIS_URL, { lazyConnect: true });
    try {
      const ttl = await r.ttl(`${PREFIX}${state.chatId}`);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(24 * 60 * 60);
    } finally {
      r.disconnect();
    }
  });

  it("delete removes state and listByUser indexes by chatId", async () => {
    const store = new RedisConversationStore(storeOpts);
    const chatId = 910000002;
    await store.set(sampleState(chatId));
    expect(await store.listByUser(chatId)).toContain(String(chatId));
    await store.delete(chatId);
    expect(await store.get(chatId)).toBeNull();
    expect(await store.listByUser(chatId)).not.toContain(String(chatId));
  });

  it("honors the TG_CONVERSATION_TTL_SECONDS-style override via options", async () => {
    const store = new RedisConversationStore({ ...storeOpts, ttlSeconds: 42 });
    const state = sampleState(910000003);
    await store.set(state);
    const r = new Redis(REDIS_URL, { lazyConnect: true });
    try {
      const ttl = await r.ttl(`${PREFIX}${state.chatId}`);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(42);
    } finally {
      r.disconnect();
    }
  });
});

describe("W8-B3 outage degradation (error mapping, no mock store)", () => {
  it("unreachable Redis falls back to memory with a loud [telegram-bot] log", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // Port 1 on loopback refuses immediately — a real ioredis client.
      const store = new RedisConversationStore({
        url: "redis://127.0.0.1:1",
        keyPrefix: "tg:test:w8b3:down:",
      });
      const state = sampleState(910000004);
      await store.set(state);
      expect(await store.get(state.chatId)).toEqual(state); // memory fallback
      const logged = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(logged).toContain("[telegram-bot] REDIS OUTAGE");
    } finally {
      errSpy.mockRestore();
    }
  }, 15000);
});

describe("W8-B3 config fail-fast", () => {
  it("refuses to boot without TELEGRAM_BOT_TOKEN / API_URL and names them", async () => {
    const savedToken = process.env.TELEGRAM_BOT_TOKEN;
    const savedApi = process.env.API_URL;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.API_URL;
    vi.resetModules();
    try {
      await expect(import("../config")).rejects.toThrow(
        /TELEGRAM_BOT_TOKEN/
      );
      process.env.TELEGRAM_BOT_TOKEN = "test-token";
      vi.resetModules();
      await expect(import("../config")).rejects.toThrow(/API_URL/);
    } finally {
      if (savedToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = savedToken;
      else delete process.env.TELEGRAM_BOT_TOKEN;
      if (savedApi !== undefined) process.env.API_URL = savedApi;
      else delete process.env.API_URL;
      vi.resetModules();
    }
  });
});
