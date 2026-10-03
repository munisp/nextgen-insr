"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChannelEngine = void 0;
// 2026-10-03 (W8-B7): multi-step flow support (see flows.ts). Flows are
// declared per-intent; an in-progress flow (state.intent + state.step > 0)
// takes precedence over classification, and an intent with a registered
// flow but no flat handler auto-starts the flow.
const flows_1 = require("./flows");
const replies_1 = require("./replies");
function logLoud(serviceName, operation, user, err) {
    console.error(`[${serviceName}] FAIL-CLOSED: ${operation} unavailable for ${user}: ${err instanceof Error ? err.message : String(err ?? "no backend path")}`);
}
class ChannelEngine {
    constructor(deps) {
        this.deps = deps;
        this.idleTimeoutMs = deps.idleTimeoutMs ?? 10 * 60 * 1000;
        this.now = deps.now ?? Date.now;
    }
    conversationId(msg) {
        return `${msg.channel}:${msg.channelUserId}`;
    }
    async handleMessage(msg) {
        const { store, replies, serviceName } = this.deps;
        const id = this.conversationId(msg);
        let state = (await store.get(id)) ??
            {
                conversationId: id,
                channel: msg.channel,
                channelUserId: msg.channelUserId,
                intent: null,
                step: 0,
                language: "en",
                memberId: null,
                data: {},
                lastActive: 0,
            };
        // Idle expiry mirrors the pre-Redis in-memory behavior.
        if (state.intent && this.now() - state.lastActive > this.idleTimeoutMs) {
            state = { ...state, intent: null, step: 0, data: {}, memberId: state.memberId };
        }
        state.lastActive = this.now();
        let reply;
        try {
            const ctx = await this.deps.resolveSession(msg, state);
            state.memberId = ctx.memberId;
            state.language = ctx.language;
            reply = await this.dispatch(ctx, msg, state);
        }
        catch (err) {
            // Session resolution broke (e.g. platform unreachable): fail closed.
            logLoud(serviceName, "session resolution", msg.channelUserId, err);
            reply = { text: (0, replies_1.unavailableReply)(replies) };
        }
        await store.set(id, state);
        return reply;
    }
    async dispatch(ctx, msg, state) {
        // 2026-10-03 (W8-B7): an in-progress flow owns the conversation until it
        // completes, is cancelled, or times out (idle reset in handleMessage).
        const activeFlow = state.intent && state.step > 0 ? this.deps.flows?.[state.intent] : undefined;
        if (activeFlow) {
            const decision = (0, flows_1.continueFlow)(activeFlow, state, msg.text, this.deps.serviceName);
            if (decision) {
                if (decision.kind === "complete") {
                    try {
                        return await activeFlow.complete(decision.state);
                    }
                    catch (err) {
                        logLoud(this.deps.serviceName, `flow "${activeFlow.intent}" completion`, msg.channelUserId, err);
                        return { text: (0, replies_1.handlerErrorReply)(this.deps.replies) };
                    }
                }
                return decision.reply;
            }
        }
        const intent = msg.intentHint ??
            (this.deps.classify ? this.deps.classify(msg.text) : "unknown");
        state.intent = intent;
        const handler = this.deps.handlers[intent];
        if (handler) {
            try {
                return await handler(ctx, msg, state);
            }
            catch (err) {
                logLoud(this.deps.serviceName, `intent "${intent}"`, msg.channelUserId, err);
                return { text: (0, replies_1.handlerErrorReply)(this.deps.replies) };
            }
        }
        // No flat handler: auto-start a registered flow for this intent.
        const flow = this.deps.flows?.[intent];
        if (flow) {
            const decision = (0, flows_1.startFlow)(flow, state);
            if (decision.kind === "reply")
                return decision.reply;
            // Unreachable today (startFlow always prompts); keep the union honest.
            return { text: (0, replies_1.unknownIntentReply)(this.deps.replies) };
        }
        // Honest fallback: we say what we can do; we never fabricate.
        return { text: (0, replies_1.unknownIntentReply)(this.deps.replies) };
    }
}
exports.ChannelEngine = ChannelEngine;
//# sourceMappingURL=engine.js.map