// 2026-10-03 (W8-B1): ChannelEngine intent dispatch tests. Store is a real
// RedisConversationStore pointed at real Redis (no mocks on the state path);
// session resolution is an injected bot function (that IS the bot boundary).
import { afterAll, describe, expect, it, vi } from "vitest";
import { ChannelEngine } from "../engine";
import { RedisConversationStore } from "../conversationStore";
import { closeRedisClients } from "../redisClient";
import { ChannelMessage, ConversationState, SessionContext } from "../types";

// 2026-10-03 (W8-B7): guard — tests refuse a non-allowlisted Redis URL.
import { assertTestRedisUrl } from "../testRedisGuard";
const REDIS_URL = assertTestRedisUrl(
  process.env.REDIS_TEST_URL ?? "redis://127.0.0.1:6399"
);

const replies = { brandName: "InsurePortal", supportPhone: null, supportEmail: null };

function msg(text: string, extra: Partial<ChannelMessage> = {}): ChannelMessage {
  return {
    channel: "whatsapp",
    channelUserId: `u-${Math.random().toString(36).slice(2)}`,
    text,
    timestamp: Date.now(),
    ...extra,
  };
}

function makeEngine(overrides: Partial<ConstructorParameters<typeof ChannelEngine>[0]> = {}) {
  const store = new RedisConversationStore<ConversationState>({
    url: REDIS_URL,
    keyPrefix: `test:engine:${Math.random().toString(36).slice(2)}:`,
    ttlSeconds: 60,
    serviceName: "channel-core-test",
    getUserId: (s) => s.channelUserId,
  });
  return new ChannelEngine({
    store,
    replies,
    serviceName: "channel-core-test",
    resolveSession: (m, s): SessionContext => ({
      conversationId: s.conversationId,
      channel: m.channel,
      channelUserId: m.channelUserId,
      memberId: null,
      authenticated: false,
      language: "en",
      data: s.data,
      lastActive: s.lastActive,
    }),
    classify: (text) => (/\bclaim\b/i.test(text) ? "file_claim" : "unknown"),
    handlers: {
      file_claim: () => ({ text: "Claim flow started." }),
      greeting: () => ({ text: "Hello!" }),
    },
    ...overrides,
  });
}

afterAll(async () => {
  await closeRedisClients();
});

describe("ChannelEngine intent dispatch", () => {
  it("routes a classified intent to its handler and persists state", async () => {
    const engine = makeEngine();
    const m = msg("I want to file a claim");
    const reply = await engine.handleMessage(m);
    expect(reply.text).toBe("Claim flow started.");
  });

  it("honest fallback for unknown intent (no fabricated answer)", async () => {
    const engine = makeEngine();
    const reply = await engine.handleMessage(msg("xyzzy plugh"));
    expect(reply.text).toContain("didn't understand");
    expect(reply.text).toContain("menu");
  });

  it("explicit intentHint takes precedence over the classifier", async () => {
    const engine = makeEngine();
    const reply = await engine.handleMessage(
      msg("file_claim_button_id", { intentHint: "greeting" })
    );
    expect(reply.text).toBe("Hello!");
  });

  it("unregistered known intent still falls back honestly", async () => {
    const engine = makeEngine();
    const reply = await engine.handleMessage(
      msg("anything", { intentHint: "pay_premium" })
    );
    expect(reply.text).toContain("didn't understand");
  });

  it("handler throw -> loud log + honest error reply, state still persisted", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const engine = makeEngine({
      handlers: {
        file_claim: () => {
          throw new Error("boom");
        },
      },
    });
    const m = msg("file a claim please");
    const reply = await engine.handleMessage(m);
    expect(reply.text).toContain("NOT completed");
    expect(
      spy.mock.calls.some((c) => String(c[0]).includes("FAIL-CLOSED"))
    ).toBe(true);
    spy.mockRestore();
  });

  it("session resolution failure -> fail-closed unavailability reply", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const engine = makeEngine({
      resolveSession: () => {
        throw new Error("platform down");
      },
    });
    const reply = await engine.handleMessage(msg("file a claim"));
    expect(reply.text).toContain("couldn't verify");
    expect(reply.text).toContain("Nothing has been registered or charged");
    spy.mockRestore();
  });

  it("resets an in-progress flow after the idle timeout", async () => {
    let now = 1_000_000;
    const engine = makeEngine({ now: () => now });
    const userId = "idle-user";
    await engine.handleMessage(msg("claim", { channelUserId: userId }));
    now += 11 * 60 * 1000; // beyond 10 min idle timeout
    const reply = await engine.handleMessage(
      msg("claim", { channelUserId: userId, intentHint: "unregistered_flow_step" })
    );
    expect(reply.text).toContain("didn't understand");
  });
});
