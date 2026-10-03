// 2026-10-03 (W8-B4): Adapter-layer tests for the channel-core migration.
// Mirror of whatsapp-bot's W8-B2 / telegram-bot's W8-B3 adapter tests,
// adapted to this service's wire contract (string sessionId keys,
// "chat:session:" prefix, 24h TTL default). Proves the thin ai-chatbot
// adapters preserve behavior over channel-core:
//   - store adapter: roundtrip/delete/listByUser on REAL Redis (no mocks;
//     skip-if-unreachable per repo convention), correct key prefix + TTL,
//     HISTORY_CAP still enforced by the adapter;
//   - outage path: unreachable Redis degrades to memory with a loudly
//     throttled [ai-chatbot] error log (error mapping);
//   - config fail-fast: loadPlatformConfig refuses a missing
//     PLATFORM_API_URL / PLATFORM_SERVICE_TOKEN and names "ai-chatbot".
// Note: ai-chatbot wires PlatformClient ONLY for catalog intents
// (insuranceProductCatalog.listProducts is serviceOrUser-safe); member-scoped
// intents stay honest-unavailable, so there is no member-data flow to test.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Redis from "ioredis";
import { RedisSessionStore, HISTORY_CAP } from "../lib/sessionStore";
import { closeRedisClients } from "../lib/redisClient";
import { loadPlatformConfig, PlatformConfigError } from "../clients/platform";
import { replyConfig, supportContactLine, unavailableReply } from "../lib/replies";

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
const PREFIX = "chat:test:w8b4:";
const storeOpts = { url: REDIS_URL, keyPrefix: PREFIX };

const sampleSession = () => ({
  language: "ha" as const,
  history: ["sannu", "yaya inshora?"],
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

describe.skipIf(!redisUp)("W8-B4 store adapter (real Redis)", () => {
  it("roundtrips ChatSession keyed by sessionId, with idle TTL", async () => {
    const store = new RedisSessionStore(storeOpts);
    const sid = "sess-w8b4-1";
    const session = sampleSession();
    await store.set(sid, session);
    expect(await store.get(sid)).toEqual(session);

    const r = new Redis(REDIS_URL, { lazyConnect: true });
    try {
      const ttl = await r.ttl(`${PREFIX}${sid}`);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(24 * 60 * 60);
    } finally {
      r.disconnect();
    }
  });

  it("delete removes state and listByUser indexes by sessionId", async () => {
    const store = new RedisSessionStore(storeOpts);
    const sid = "sess-w8b4-2";
    await store.set(sid, sampleSession());
    expect(await store.listByUser(sid)).toContain(sid);
    await store.delete(sid);
    expect(await store.get(sid)).toBeNull();
    expect(await store.listByUser(sid)).not.toContain(sid);
  });

  it("honors the CHAT_SESSION_TTL_SECONDS-style override via options", async () => {
    const store = new RedisSessionStore({ ...storeOpts, ttlSeconds: 42 });
    const sid = "sess-w8b4-3";
    await store.set(sid, sampleSession());
    const r = new Redis(REDIS_URL, { lazyConnect: true });
    try {
      const ttl = await r.ttl(`${PREFIX}${sid}`);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(42);
    } finally {
      r.disconnect();
    }
  });

  it("adapter still caps history at HISTORY_CAP before persisting", async () => {
    const store = new RedisSessionStore(storeOpts);
    const sid = "sess-w8b4-4";
    const big = {
      language: "en" as const,
      history: Array.from({ length: HISTORY_CAP + 10 }, (_, i) => `m${i}`),
    };
    await store.set(sid, big);
    const got = (await store.get(sid))!;
    expect(got.history.length).toBe(HISTORY_CAP);
    expect(got.history[0]).toBe("m10"); // oldest dropped first
  });
});

describe("W8-B4 outage degradation (error mapping, no mock store)", () => {
  it("unreachable Redis falls back to memory with a loud [ai-chatbot] log", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // Port 1 on loopback refuses immediately — a real ioredis client.
      const store = new RedisSessionStore({
        url: "redis://127.0.0.1:1",
        keyPrefix: "chat:test:w8b4:down:",
      });
      const sid = "sess-w8b4-down";
      await store.set(sid, sampleSession());
      expect(await store.get(sid)).toEqual(sampleSession()); // memory fallback
      const logged = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(logged).toContain("[ai-chatbot] REDIS OUTAGE");
    } finally {
      errSpy.mockRestore();
    }
  }, 15000);
});

describe("W8-B4 platform config fail-fast", () => {
  it("loadPlatformConfig errors name ai-chatbot and the missing variable", () => {
    expect(() =>
      loadPlatformConfig({ PLATFORM_SERVICE_TOKEN: "x" } as NodeJS.ProcessEnv)
    ).toThrow(PlatformConfigError);
    expect(() =>
      loadPlatformConfig({ PLATFORM_SERVICE_TOKEN: "x" } as NodeJS.ProcessEnv)
    ).toThrow(/PLATFORM_API_URL.*ai-chatbot/);
    expect(() =>
      loadPlatformConfig({ PLATFORM_API_URL: "http://x" } as NodeJS.ProcessEnv)
    ).toThrow(/PLATFORM_SERVICE_TOKEN.*ai-chatbot/);
  });

  it("a full config loads with the ai-chatbot service identity", () => {
    const cfg = loadPlatformConfig({
      PLATFORM_API_URL: "http://platform:3000/",
      PLATFORM_SERVICE_TOKEN: "tok",
    } as NodeJS.ProcessEnv);
    expect(cfg.baseUrl).toBe("http://platform:3000");
    expect(cfg.serviceName).toBe("ai-chatbot");
  });
});

describe("W8-B4 honest reply templates (no invented contacts)", () => {
  it("support line uses env contacts when set, else points at the app", () => {
    expect(
      supportContactLine(replyConfig({ SUPPORT_PHONE: "+234-1-REAL" } as NodeJS.ProcessEnv))
    ).toContain("+234-1-REAL");
    const line = supportContactLine(replyConfig({} as NodeJS.ProcessEnv));
    expect(line).toContain("NGApp app");
    expect(line).not.toMatch(/\+234/); // never the old fabricated number
  });

  it("unavailable reply is fail-closed and fabricates nothing", () => {
    const text = unavailableReply(replyConfig({} as NodeJS.ProcessEnv));
    expect(text).toContain("couldn't verify");
    expect(text).toContain("Nothing has been registered or charged");
    expect(text).not.toMatch(/NGA-CLM-|PAY-|₦|\*384/);
  });
});
