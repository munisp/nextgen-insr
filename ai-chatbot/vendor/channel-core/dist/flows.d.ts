import { ConversationState, Intent, Reply } from "./types";
export interface FlowStep {
    /**
     * Prompt sent when the flow ENTERS this step. Static reply or a function
     * of the accumulated state.
     */
    prompt: Reply | ((state: ConversationState) => Reply);
    /**
     * Optional validator for the user's answer. Return true when valid, or an
     * error reply string when invalid (the user stays on this step). Without a
     * validator any non-empty answer is accepted.
     */
    validate?: (text: string, state: ConversationState) => true | string;
    /** Key under which the answer is stored in state.data. */
    storeAs?: string;
}
export interface FlowDefinition {
    /** Intent id that starts this flow (matches classifier/handler intent). */
    intent: Intent;
    steps: FlowStep[];
    /**
     * Terminal step: called after the last step's answer is collected. May be
     * async (real backend calls). The flow is reset before this is called, so
     * complete() owns the final reply; on throw the engine's fail-closed
     * handler-error path applies.
     */
    complete: (state: ConversationState) => Promise<Reply> | Reply;
    /** Words that cancel the flow at any step (case-insensitive). */
    cancelWords?: string[];
    /** Reply after a cancel. Default: honest "cancelled" text. */
    onCancel?: (state: ConversationState) => Reply;
}
export declare const DEFAULT_CANCEL_WORDS: string[];
/**
 * Outcome of a flow decision — ChannelEngine translates this into state
 * mutations + Reply. Kept as a pure function so the semantics are unit-
 * testable without Redis.
 */
export type FlowDecision = {
    kind: "reply";
    reply: Reply;
    state: ConversationState;
} | {
    kind: "complete";
    state: ConversationState;
};
/** Begin a flow: enter step 1 and return its prompt. */
export declare function startFlow(flow: FlowDefinition, state: ConversationState): FlowDecision;
/**
 * Advance an in-progress flow with the user's text. Returns null when the
 * state does not belong to this flow (caller falls back to normal dispatch).
 * Throws on corrupted step so the engine can fail loud + reset.
 */
export declare function continueFlow(flow: FlowDefinition, state: ConversationState, text: string, serviceName: string): FlowDecision | null;
//# sourceMappingURL=flows.d.ts.map