// 2026-10-03 (W8-B7): First-class multi-step flow support for ChannelEngine.
// Closes the API gap reported by whatsapp-bot (W8-B2): the engine previously
// modelled only flat intent → handler dispatch, so bots with step machines
// (quote → details → confirm) could not adopt it.
//
// Model (mapped honestly onto ConversationState):
//   state.intent = flow intent id, state.step = 1..N means "waiting for the
//   user's answer to steps[step-1]". state.data accumulates step answers.
//   - start: an intent with a registered flow and no flat handler enters the
//     flow (step=1, first prompt sent);
//   - continue: inbound text is optionally validated (invalid → error reply,
//     stay on step), stored under the step's storeAs key, then either the
//     next prompt or the flow's async complete() terminal is returned;
//   - cancel: a cancel word (default "cancel"/"menu"/"0") at any step resets
//     the flow and returns onCancel;
//   - timeout: ChannelEngine's idle-timeout reset (state.expiresAt=0 /
//     lastActive) already abandons stale flows — unchanged semantics;
//   - corrupted state (step out of range for the definition): fail LOUD
//     (console.error) and reset — never silently guess a step.
// Flow state lives in the ConversationStore, so it inherits Redis
// persistence + TTL with no separate storage path.
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
  complete: (
    state: ConversationState
  ) => Promise<Reply> | Reply;
  /** Words that cancel the flow at any step (case-insensitive). */
  cancelWords?: string[];
  /** Reply after a cancel. Default: honest "cancelled" text. */
  onCancel?: (state: ConversationState) => Reply;
}

export const DEFAULT_CANCEL_WORDS = ["cancel", "menu", "0"];

function promptReply(step: FlowStep, state: ConversationState): Reply {
  return typeof step.prompt === "function" ? step.prompt(state) : step.prompt;
}

function resetFlow(state: ConversationState): void {
  state.intent = null;
  state.step = 0;
}

/**
 * Outcome of a flow decision — ChannelEngine translates this into state
 * mutations + Reply. Kept as a pure function so the semantics are unit-
 * testable without Redis.
 */
export type FlowDecision =
  | { kind: "reply"; reply: Reply; state: ConversationState }
  | { kind: "complete"; state: ConversationState };

/** Begin a flow: enter step 1 and return its prompt. */
export function startFlow(
  flow: FlowDefinition,
  state: ConversationState
): FlowDecision {
  state.intent = flow.intent;
  state.step = 1;
  return { kind: "reply", reply: promptReply(flow.steps[0], state), state };
}

/**
 * Advance an in-progress flow with the user's text. Returns null when the
 * state does not belong to this flow (caller falls back to normal dispatch).
 * Throws on corrupted step so the engine can fail loud + reset.
 */
export function continueFlow(
  flow: FlowDefinition,
  state: ConversationState,
  text: string,
  serviceName: string
): FlowDecision | null {
  if (state.intent !== flow.intent) return null;

  const cancelWords = (flow.cancelWords ?? DEFAULT_CANCEL_WORDS).map((w) =>
    w.toLowerCase()
  );
  if (cancelWords.includes(text.trim().toLowerCase())) {
    resetFlow(state);
    const reply = flow.onCancel
      ? flow.onCancel(state)
      : { text: "Okay, I've cancelled that. Nothing was submitted or charged." };
    return { kind: "reply", reply, state };
  }

  const idx = state.step - 1;
  if (idx < 0 || idx >= flow.steps.length) {
    // Fail-loud: never silently guess which step we were on.
    console.error(
      `[${serviceName}] CORRUPT FLOW STATE: intent=${flow.intent} step=${state.step} ` +
        `but flow has ${flow.steps.length} step(s) — resetting conversation ` +
        `${state.conversationId}`
    );
    resetFlow(state);
    return {
      kind: "reply",
      reply: {
        text:
          "Something went wrong with our conversation state, so I've reset it. " +
          "Nothing was submitted or charged. Please start again.",
      },
      state,
    };
  }

  const step = flow.steps[idx];
  const verdict = step.validate ? step.validate(text, state) : true;
  if (verdict !== true) {
    // Invalid answer: stay on the step, return the honest error text.
    return { kind: "reply", reply: { text: verdict }, state };
  }
  if (step.storeAs) state.data[step.storeAs] = text;

  if (idx === flow.steps.length - 1) {
    // Last answer collected: reset, then let complete() own the reply.
    resetFlow(state);
    return { kind: "complete", state };
  }
  state.step += 1;
  return { kind: "reply", reply: promptReply(flow.steps[idx + 1], state), state };
}
