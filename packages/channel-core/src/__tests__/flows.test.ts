// 2026-10-03 (W8-B7): multi-step flow tests. Pure continueFlow/startFlow
// semantics plus end-to-end ChannelEngine runs against REAL Redis (no mocks
// on the state path). Covers: happy path, validation retry, cancel,
// corrupted-state fail-loud reset, idle timeout, and async completion
// failure mapping to the honest error reply.
import { afterAll, describe, expect, it, vi } from "vitest";
import { ChannelEngine } from "../engine";
import { continueFlow, startFlow, FlowDefinition } from "../flows";
import { RedisConversationStore } from "../conversationStore";
import { closeRedisClients } from "../redisClient";
import { assertTestRedisUrl } from "../testRedisGuard";
import { ChannelMessage, ConversationState, SessionContext } from "../types";

const REDIS_URL = assertTestRedisUrl(
  process.env.REDIS_TEST_URL ?? "redis://127.0.0.1:6399"
);

const replies = { brandName: "InsurePortal", supportPhone: null, supportEmail: null };

const quoteFlow: FlowDefinition = {
  intent: "get_quote",
  steps: [
    { prompt: { text: "Vehicle registration?" }, storeAs: "reg" },
    {
      prompt: (s) => ({ text: `Value in Naira for ${s.data.reg}?` }),
      storeAs: "value",
      validate: (text) =>
        /^[0-9]+$/.test(text.trim()) ? true : "Please enter digits only.",
    },
  ],
  complete: (s) => ({
    text: `Quote for ${s.data.reg} worth ${s.data.value}: computed.`,
  }),
};

function freshState(overrides: Partial<ConversationState> = {}): ConversationState {
  return {
    conversationId: "whatsapp:u1",
    channel: "whatsapp",
    channelUserId: "u1",
    intent: null,
    step: 0,
    language: "en",
    memberId: null,
    data: {},
    lastActive: Date.now(),
    ...overrides,
  };
}

describe("flow machine (pure)", () => {
  it("starts at step 1 with the first prompt", () => {
    const state = freshState();
    const d = startFlow(quoteFlow, state);
    expect(state.step).toBe(1);
    expect(d).toMatchObject({ kind: "reply", reply: { text: "Vehicle registration?" } });
  });

  it("collects answers, validates, and completes on the last step", () => {
    const state = freshState({ intent: "get_quote", step: 1 });
    const d1 = continueFlow(quoteFlow, state, "ABC-123", "test")!;
    expect(d1.kind).toBe("reply");
    expect(state.step).toBe(2);
    expect(state.data.reg).toBe("ABC-123");
    expect(d1.kind === "reply" && d1.reply.text).toContain("ABC-123");

    // invalid answer: stay on step 2 with the validator's honest error
    const d2 = continueFlow(quoteFlow, state, "lots", "test")!;
    expect(d2.kind === "reply" && d2.reply.text).toBe("Please enter digits only.");
    expect(state.step).toBe(2);

    const d3 = continueFlow(quoteFlow, state, "5000000", "test")!;
    expect(d3.kind).toBe("complete");
    expect(state.intent).toBeNull(); // reset before complete()
    expect(state.step).toBe(0);
    expect(state.data.value).toBe("5000000");
  });

  it("cancels on a cancel word at any step and resets", () => {
    const state = freshState({ intent: "get_quote", step: 2, data: { reg: "X" } });
    const d = continueFlow(quoteFlow, state, "menu", "test")!;
    expect(state.intent).toBeNull();
    expect(state.step).toBe(0);
    expect(d.kind === "reply" && d.reply.text).toMatch(/cancelled/i);
  });

  it("fails loud and resets on corrupted step state", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const state = freshState({ intent: "get_quote", step: 9 });
    const d = continueFlow(quoteFlow, state, "hello", "test")!;
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("CORRUPT FLOW STATE"));
    expect(state.intent).toBeNull();
    expect(d.kind === "reply" && d.reply.text).toMatch(/reset/i);
    spy.mockRestore();
  });

  it("returns null when the state belongs to a different flow", () => {
    const state = freshState({ intent: "file_claim", step: 1 });
    expect(continueFlow(quoteFlow, state, "x", "test")).toBeNull();
  });
});

describe("ChannelEngine + flows (real Redis)", () => {
  function makeEngine(flowOverride?: FlowDefinition, now: () => number = Date.now) {
    const store = new RedisConversationStore<ConversationState>({
      url: REDIS_URL,
      keyPrefix: `test:flows:${Math.random().toString(36).slice(2)}:`,
      ttlSeconds: 60,
      serviceName: "channel-core-test",
      getUserId: (s) => s.channelUserId,
    });
    const engine = new ChannelEngine({
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
      classify: (text) => (/quote/i.test(text) ? "get_quote" : "unknown"),
      handlers: {},
      flows: { get_quote: flowOverride ?? quoteFlow },
      now,
    });
    const user = `u-${Math.random().toString(36).slice(2)}`;
    const msg = (text: string): ChannelMessage => ({
      channel: "whatsapp",
      channelUserId: user,
      text,
      timestamp: Date.now(),
    });
    return { engine, msg, store };
  }

  afterAll(async () => {
    await closeRedisClients();
  });

  it("walks a full quote flow across messages, persisting state in Redis", async () => {
    const { engine, msg } = makeEngine();
    const r1 = await engine.handleMessage(msg("I want a quote"));
    expect(r1.text).toBe("Vehicle registration?");
    const r2 = await engine.handleMessage(msg("ABC-123"));
    expect(r2.text).toContain("ABC-123");
    const r3 = await engine.handleMessage(msg("5000000"));
    expect(r3.text).toBe("Quote for ABC-123 worth 5000000: computed.");
  });

  it("in-progress flow beats the classifier (text mentioning other intents)", async () => {
    const { engine, msg } = makeEngine();
    await engine.handleMessage(msg("quote please"));
    const r = await engine.handleMessage(msg("quote ABC-999")); // still the answer
    expect(r.text).toContain("ABC-999");
  });

  it("cancel word mid-flow resets; next message classifies fresh", async () => {
    const { engine, msg } = makeEngine();
    await engine.handleMessage(msg("quote"));
    const r = await engine.handleMessage(msg("cancel"));
    expect(r.text).toMatch(/cancelled/i);
    const r2 = await engine.handleMessage(msg("hello there"));
    expect(r2.text).toMatch(/can help/i); // unknownIntentReply fallback
  });

  it("idle timeout abandons a stale flow", async () => {
    let t = 1_000_000;
    const { engine, msg } = makeEngine(undefined, () => t);
    await engine.handleMessage(msg("quote"));
    t += 11 * 60 * 1000; // past the 10-minute idle timeout
    const r = await engine.handleMessage(msg("ABC-123"));
    // Flow was reset: "ABC-123" classifies as unknown → honest fallback.
    expect(r.text).toMatch(/can help/i);
  });

  it("complete() throwing maps to the honest handler-error reply (fail-closed)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing: FlowDefinition = {
      ...quoteFlow,
      complete: () => {
        throw new Error("backend down");
      },
    };
    const { engine, msg } = makeEngine(failing);
    await engine.handleMessage(msg("quote"));
    await engine.handleMessage(msg("ABC-123"));
    const r = await engine.handleMessage(msg("5000000"));
    expect(r.text).toMatch(/couldn't|unable|wrong|try again/i);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("backend down"));
    spy.mockRestore();
  });
});
