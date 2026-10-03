import { ConversationStore } from "./conversationStore";
import { FlowDefinition } from "./flows";
import { ReplyTemplateConfig } from "./replies";
import { ChannelMessage, ConversationState, Intent, Reply, SessionContext } from "./types";
export type IntentHandler = (ctx: SessionContext, msg: ChannelMessage, state: ConversationState) => Promise<Reply> | Reply;
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
    resolveSession: (msg: ChannelMessage, state: ConversationState) => Promise<SessionContext> | SessionContext;
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
export declare class ChannelEngine {
    private readonly deps;
    private readonly idleTimeoutMs;
    private readonly now;
    constructor(deps: ChannelEngineDeps);
    private conversationId;
    handleMessage(msg: ChannelMessage): Promise<Reply>;
    private dispatch;
}
//# sourceMappingURL=engine.d.ts.map