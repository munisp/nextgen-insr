// 2026-10-03 (W8-B1): RedisConversationStore tests against a REAL Redis
// (REDIS_TEST_URL, compiled 7.2.5 in the sandbox) plus fail-closed
// degradation tests against an unreachable URL. No mocks.
import { afterAll, describe, expect, it, vi } from "vitest";
import { RedisConversationStore } from "../conversationStore";
import { closeRedisClients, getRedisClient } from "../redisClient";

interface TestState {
  userId: string;
  step: number;
  data: Record<string, string>;
}

const REDIS_URL = process.env.REDIS_TEST_URL ?? "redis://127.0.0.1:6399";
const DEAD_URL = "redis://127.0.0.1:6499"; // nothing listens here

function makeStore(url: string, keyPrefix: string) {
  return new RedisConversationStore<TestState>({
    url,
    keyPrefix,
    ttlSeconds: 60,
    serviceName: "channel-core-test",
    getUserId: (s) => s.userId,
  });
}

afterAll(async () => {
  await closeRedisClients();
});

describe("RedisConversationStore (real Redis)", () => {
  it("round-trips state and exposes it via listByUser", async () => {
    const store = makeStore(REDIS_URL, "test:conv:");
    const state: TestState = { userId: "user-1", step: 2, data: { a: "b" } };
    await store.set("c1", state);
    await store.set("c2", { userId: "user-1", step: 0, data: {} });
    await store.set("c3", { userId: "user-2", step: 1, data: {} });

    expect(await store.get("c1")).toEqual(state);
    expect((await store.listByUser("user-1")).sort()).toEqual(["c1", "c2"]);
    expect(await store.listByUser("user-2")).toEqual(["c3"]);
    expect(await store.listByUser("nobody")).toEqual([]);
  });

  it("applies the configured TTL to the conversation key", async () => {
    const store = makeStore(REDIS_URL, "test:ttl:");
    await store.set("t1", { userId: "u", step: 0, data: {} });
    const ttl = await getRedisClient(REDIS_URL).ttl("test:ttl:t1");
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });

  it("returns null after delete and removes the user index entry", async () => {
    const store = makeStore(REDIS_URL, "test:del:");
    await store.set("d1", { userId: "u9", step: 1, data: {} });
    await store.delete("d1");
    expect(await store.get("d1")).toBeNull();
    expect(await store.listByUser("u9")).toEqual([]);
  });

  it("returns null for a conversation that was never stored", async () => {
    const store = makeStore(REDIS_URL, "test:miss:");
    expect(await store.get("nope")).toBeNull();
  });
});

describe("RedisConversationStore (fail-closed degradation)", () => {
  it("falls back to memory with a loud throttled log; never silent loss", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = makeStore(DEAD_URL, "test:dead:");
    const state: TestState = { userId: "u-dead", step: 3, data: { k: "v" } };
    await store.set("x1", state);
    expect(await store.get("x1")).toEqual(state);
    expect(await store.listByUser("u-dead")).toEqual(["x1"]);
    const messages = spy.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes("REDIS OUTAGE"))).toBe(true);
    spy.mockRestore();
  });
});
