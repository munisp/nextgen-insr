// 2026-10-03 (W8-B1): ChannelEngine — shared intent routing skeleton
// extracted from whatsapp-bot/src/engine/conversation.ts,
// telegram-bot/src/engine/conversation.ts and ai-chatbot/src/engine/chat.ts.
//
// Pipeline: parse inbound ChannelMessage → load/create conversation state →
// resolve member session → determine intent (explicit hint > classifier) →
// dispatch to a registered handler → persist state → return Reply.
//
// Fail-closed rules baked in here (bots must not re-implement them):
//   - unknown intent → honest fallback reply, never a fabricated answer;
//   - session resolution failure → honest unavailability reply;
//   - handler throw → loud log + honest error reply (state still persisted);
//   - handlers receive a SessionContext whose memberId is null when no
//     account linking exists — member-data handlers must fail closed.
import { ConversationStore } from "./conversationStore";
// 2026-10-03 (W8-B7): multi-step flow support (see flows.ts). Flows are
// declared per-intent; an in-progress flow (state.intent + state.step > 0)
// takes precedence over classification, and an intent with a registered
// flow but no flat handler auto-starts the flow.
import { FlowDefinition, continueFlow, startFlow } from "./flows";
import {
  handlerErrorReply,
  ReplyTemplateConfig,
  unavailableReply,
  unknownIntentReply,
} from "./replies";
import {
  ChannelMessage,
  ConversationState,
  Intent,
  Reply,
  SessionContext,
} from "./types";

export type IntentHandler = (
  ctx: SessionContext,
  msg: ChannelMessage,
  state: ConversationState
) => Promise<Reply> | Reply;

export interface ChannelEngineDeps {
  store: ConversationStore<ConversationState>;
  /** Reply template config (brand + real support contacts). */
  replies: ReplyTemplateConfig;
  /** Service label for loud fail-closed logs, e.g. "whatsapp-bot". */
  serviceName: string;
  /**
   * Resolve the member session for a channel identity. Implementations that
   * have no member backend (e.g. telegram-bot today) should return an
   * unauthenticated context (memberId: null) — NOT throw — so non-member
   * intents still work. Throw only when resolution itself is broken (e.g.
   * the platform is unreachable); the engine maps that to an honest
   * unavailability reply.
   */
  resolveSession: (
    msg: ChannelMessage,
    state: ConversationState
  ) => Promise<SessionContext> | SessionContext;
  /** Text classifier when the message carries no explicit intent hint. */
  classify?: (text: string) => Intent;
  /** Intent handlers; missing entries fall through to unknownIntentReply. */
  handlers: Record<string, IntentHandler>;
  /**
   * Multi-step flow definitions keyed by intent id (2026-10-03, W8-B7). An
   * intent present here but NOT in `handlers` auto-starts its flow; an
   * in-progress flow continues via the flow machine instead of dispatch.
   */
  flows?: Record<string, FlowDefinition>;
  /** Idle timeout after which in-progress flows are reset (default 10 min). */
  idleTimeoutMs?: number;
  /** Now() override for tests. */
  now?: () => number;
}

function logLoud(serviceName: string, operation: string, user: string, err?: unknown): void {
  console.error(
    `[${serviceName}] FAIL-CLOSED: ${operation} unavailable for ${user}: ${
      err instanceof Error ? err.message : String(err ?? "no backend path")
    }`
  );
}

export class ChannelEngine {
  private readonly deps: ChannelEngineDeps;
  private readonly idleTimeoutMs: number;
  private readonly now: () => number;

  constructor(deps: ChannelEngineDeps) {
    this.deps = deps;
    this.idleTimeoutMs = deps.idleTimeoutMs ?? 10 * 60 * 1000;
    this.now = deps.now ?? Date.now;
  }

  private conversationId(msg: ChannelMessage): string {
    return `${msg.channel}:${msg.channelUserId}`;
  }

  async handleMessage(msg: ChannelMessage): Promise<Reply> {
    const { store, replies, serviceName } = this.deps;
    const id = this.conversationId(msg);
    let state =
      (await store.get(id)) ??
      ({
        conversationId: id,
        channel: msg.channel,
        channelUserId: msg.channelUserId,
        intent: null,
        step: 0,
        language: "en",
        memberId: null,
        data: {},
        lastActive: 0,
      } satisfies ConversationState);
    // Idle expiry mirrors the pre-Redis in-memory behavior.
    if (state.intent && this.now() - state.lastActive > this.idleTimeoutMs) {
      state = { ...state, intent: null, step: 0, data: {}, memberId: state.memberId };
    }
    state.lastActive = this.now();

    let reply: Reply;
    try {
      const ctx = await this.deps.resolveSession(msg, state);
      state.memberId = ctx.memberId;
      state.language = ctx.language;
      reply = await this.dispatch(ctx, msg, state);
    } catch (err) {
      // Session resolution broke (e.g. platform unreachable): fail closed.
      logLoud(serviceName, "session resolution", msg.channelUserId, err);
      reply = { text: unavailableReply(replies) };
    }

    await store.set(id, state);
    return reply;
  }

  private async dispatch(
    ctx: SessionContext,
    msg: ChannelMessage,
    state: ConversationState
  ): Promise<Reply> {
    // 2026-10-03 (W8-B7): an in-progress flow owns the conversation until it
    // completes, is cancelled, or times out (idle reset in handleMessage).
    const activeFlow =
      state.intent && state.step > 0 ? this.deps.flows?.[state.intent] : undefined;
    if (activeFlow) {
      const decision = continueFlow(activeFlow, state, msg.text, this.deps.serviceName);
      if (decision) {
        if (decision.kind === "complete") {
          try {
            return await activeFlow.complete(decision.state);
          } catch (err) {
            logLoud(this.deps.serviceName, `flow "${activeFlow.intent}" completion`, msg.channelUserId, err);
            return { text: handlerErrorReply(this.deps.replies) };
          }
        }
        return decision.reply;
      }
    }

    const intent: Intent =
      msg.intentHint ??
      (this.deps.classify ? this.deps.classify(msg.text) : "unknown");
    state.intent = intent;

    const handler = this.deps.handlers[intent];
    if (handler) {
      try {
        return await handler(ctx, msg, state);
      } catch (err) {
        logLoud(this.deps.serviceName, `intent "${intent}"`, msg.channelUserId, err);
        return { text: handlerErrorReply(this.deps.replies) };
      }
    }
    // No flat handler: auto-start a registered flow for this intent.
    const flow = this.deps.flows?.[intent];
    if (flow) {
      const decision = startFlow(flow, state);
      if (decision.kind === "reply") return decision.reply;
      // Unreachable today (startFlow always prompts); keep the union honest.
      return { text: unknownIntentReply(this.deps.replies) };
    }
    // Honest fallback: we say what we can do; we never fabricate.
    return { text: unknownIntentReply(this.deps.replies) };
  }
}
