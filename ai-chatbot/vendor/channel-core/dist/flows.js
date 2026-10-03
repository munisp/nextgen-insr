"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CANCEL_WORDS = void 0;
exports.startFlow = startFlow;
exports.continueFlow = continueFlow;
exports.DEFAULT_CANCEL_WORDS = ["cancel", "menu", "0"];
function promptReply(step, state) {
    return typeof step.prompt === "function" ? step.prompt(state) : step.prompt;
}
function resetFlow(state) {
    state.intent = null;
    state.step = 0;
}
/** Begin a flow: enter step 1 and return its prompt. */
function startFlow(flow, state) {
    state.intent = flow.intent;
    state.step = 1;
    return { kind: "reply", reply: promptReply(flow.steps[0], state), state };
}
/**
 * Advance an in-progress flow with the user's text. Returns null when the
 * state does not belong to this flow (caller falls back to normal dispatch).
 * Throws on corrupted step so the engine can fail loud + reset.
 */
function continueFlow(flow, state, text, serviceName) {
    if (state.intent !== flow.intent)
        return null;
    const cancelWords = (flow.cancelWords ?? exports.DEFAULT_CANCEL_WORDS).map((w) => w.toLowerCase());
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
        console.error(`[${serviceName}] CORRUPT FLOW STATE: intent=${flow.intent} step=${state.step} ` +
            `but flow has ${flow.steps.length} step(s) — resetting conversation ` +
            `${state.conversationId}`);
        resetFlow(state);
        return {
            kind: "reply",
            reply: {
                text: "Something went wrong with our conversation state, so I've reset it. " +
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
    if (step.storeAs)
        state.data[step.storeAs] = text;
    if (idx === flow.steps.length - 1) {
        // Last answer collected: reset, then let complete() own the reply.
        resetFlow(state);
        return { kind: "complete", state };
    }
    state.step += 1;
    return { kind: "reply", reply: promptReply(flow.steps[idx + 1], state), state };
}
//# sourceMappingURL=flows.js.map