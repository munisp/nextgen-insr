// 2026-10-03 (W8-B2): Adapter-layer tests for the channel-core migration.
// Prove the thin whatsapp adapters preserve behavior over channel-core:
//   - store adapter: roundtrip/delete/listByUser on REAL Redis (no mocks;
//     skip-if-unreachable per repo convention), correct key prefix + TTL;
//   - platform wrapper: fail-fast config names "whatsapp-bot", unreachable
//     backend maps to PlatformUnavailableError, and the superjson GET wire
//     format + Bearer token reach the server intact (stub HTTP server).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Redis from "ioredis";
import {
  RedisConversationStore,
  ConversationState,
} from "../lib/conversationStore";
import { closeRedisClients } from "../lib/redisClient";
import {
  PlatformClient,
  PlatformUnavailableError,
  loadPlatformConfig,
  PlatformConfigError,
} from "../clients/platform";

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
const PREFIX = "wa:test:w8b2:";
const storeOpts = { url: REDIS_URL, keyPrefix: PREFIX };

const sampleState = (phone: string): ConversationState => ({
  phone,
  intent: "file_claim",
  step: 2,
  data: { policyNumber: "POL-ADAPTER-1" },
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

describe.skipIf(!redisUp)("W8-B2 store adapter (real Redis)", () => {
  it("roundtrips whatsapp ConversationState keyed by phone, with idle TTL", async () => {
    const store = new RedisConversationStore(storeOpts);
    const state = sampleState("2341000000001");
    await store.set(state);
    const got = await store.get(state.phone);
    expect(got).toEqual(state);

    const r = new Redis(REDIS_URL, { lazyConnect: true });
    try {
      const ttl = await r.ttl(`${PREFIX}${state.phone}`);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(600);
    } finally {
      r.disconnect();
    }
  });

  it("delete removes state and listByUser indexes by phone", async () => {
    const store = new RedisConversationStore(storeOpts);
    const phone = "2341000000002";
    await store.set(sampleState(phone));
    expect(await store.listByUser(phone)).toContain(phone);
    await store.delete(phone);
    expect(await store.get(phone)).toBeNull();
    expect(await store.listByUser(phone)).not.toContain(phone);
  });

  it("honors the WA_CONVERSATION_TTL_SECONDS-style override via options", async () => {
    const store = new RedisConversationStore({ ...storeOpts, ttlSeconds: 42 });
    const state = sampleState("2341000000003");
    await store.set(state);
    const r = new Redis(REDIS_URL, { lazyConnect: true });
    try {
      const ttl = await r.ttl(`${PREFIX}${state.phone}`);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(42);
    } finally {
      r.disconnect();
    }
  });
});

describe("W8-B2 platform client wrapper", () => {
  it("loadPlatformConfig fail-fast errors name whatsapp-bot", () => {
    expect(() =>
      loadPlatformConfig({ PLATFORM_SERVICE_TOKEN: "x" } as NodeJS.ProcessEnv)
    ).toThrow(PlatformConfigError);
    expect(() =>
      loadPlatformConfig({ PLATFORM_SERVICE_TOKEN: "x" } as NodeJS.ProcessEnv)
    ).toThrow(/whatsapp-bot/);
    expect(() =>
      loadPlatformConfig({
        PLATFORM_API_URL: "https://platform.example",
      } as NodeJS.ProcessEnv)
    ).toThrow(PlatformConfigError);
  });

  it("unreachable backend maps to PlatformUnavailableError", async () => {
    const client = new PlatformClient(
      loadPlatformConfig({
        PLATFORM_API_URL: "http://127.0.0.1:1",
        PLATFORM_SERVICE_TOKEN: "test-token",
      } as NodeJS.ProcessEnv)
    );
    await expect(client.listMotorProducts()).rejects.toBeInstanceOf(
      PlatformUnavailableError
    );
  });

  it("sends superjson GET input, Bearer token and channel attribution header", async () => {
    const http = await import("node:http");
    let seen: { url?: string; auth?: string; channel?: string } = {};
    const server = http.createServer((req, res) => {
      seen = {
        url: req.url,
        auth: req.headers.authorization,
        channel: req.headers["x-channel-service"] as string | undefined,
      };
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          result: { data: { json: { data: [], total: 0 } } },
        })
      );
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    try {
      const client = new PlatformClient(
        loadPlatformConfig({
          PLATFORM_API_URL: `http://127.0.0.1:${port}`,
          PLATFORM_SERVICE_TOKEN: "adapter-token",
        } as NodeJS.ProcessEnv)
      );
      const products = await client.listMotorProducts();
      expect(products).toEqual([]);
      expect(seen.url).toContain(
        "/api/trpc/insuranceProductCatalog.listProducts?input="
      );
      expect(seen.url).toContain(encodeURIComponent(JSON.stringify({ json: { productType: "motor", isActive: true, limit: 5, offset: 0 } })));
      expect(seen.auth).toBe("Bearer adapter-token");
      expect(seen.channel).toBe("whatsapp-bot");
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it("malformed catalog shape fails closed (PlatformUnavailableError)", async () => {
    const http = await import("node:http");
    const server = http.createServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ result: { data: { json: { nope: true } } } }));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    try {
      const client = new PlatformClient(
        loadPlatformConfig({
          PLATFORM_API_URL: `http://127.0.0.1:${port}`,
          PLATFORM_SERVICE_TOKEN: "t",
        } as NodeJS.ProcessEnv)
      );
      await expect(client.listMotorProducts()).rejects.toBeInstanceOf(
        PlatformUnavailableError
      );
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});
