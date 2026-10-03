// 2026-10-03 (W8-B7): Canonical per-platform conversation-ID extractors.
// Before this module each bot hand-rolled its ID derivation at its ingress
// layer (triplicated logic, triplicated edge-case bugs):
//   whatsapp-bot/src/handlers/webhook.ts   — message.from (E.164 phone)
//   telegram-bot/src/index.ts              — msg.chat.id (numeric chat id)
//   ai-chatbot/src/index.ts                — req.body.session_id || "default"
//
// The semantics genuinely differ per platform (phone-keyed vs chatId-keyed
// vs client-session-keyed), so this is NOT a one-size wrapper: each
// platform gets its own strategy function with its own validation. All
// strategies are FAIL-CLOSED: an unidentifiable conversation throws
// ConversationIdError instead of silently keying state under "undefined"
// (which would merge strangers' conversations into one Redis key — an
// identity failure). ai-chatbot's "default" fallback is preserved exactly
// because it is that service's documented wire contract for anonymous
// single-user sessions.

/** Thrown when an inbound message carries no usable conversation identity. */
export class ConversationIdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConversationIdError";
  }
}

/**
 * WhatsApp Cloud API webhook message → conversation id.
 * Accepts the raw `messages[i]` object from the webhook payload (or anything
 * with a `from` field). The id is the sender's E.164 phone number as
 * delivered by Meta; it must be a non-empty string of digits/`+` only.
 */
export function whatsappConversationId(message: { from?: unknown }): string {
  const from = typeof message?.from === "string" ? message.from.trim() : "";
  if (!from) {
    throw new ConversationIdError(
      "whatsapp message has no `from` — refusing to key conversation state " +
        "under an empty/undefined identity (fail-closed)"
    );
  }
  if (!/^\+?[0-9]{5,15}$/.test(from)) {
    throw new ConversationIdError(
      `whatsapp message 'from' is not an E.164 phone number: ${JSON.stringify(from).slice(0, 40)}`
    );
  }
  return from;
}

/**
 * Telegram update → numeric chat id. Accepts a message-like object
 * (`{ chat: { id } }`, which covers both Message and CallbackQuery.message)
 * or a bare number. Returns the NUMBER because the Telegram Bot API requires
 * the numeric id for sendMessage; use String(id) only at the store key edge.
 * Throws when the id is absent or not a finite safe integer.
 */
export function telegramChatId(
  source: { chat?: { id?: unknown } } | number | null | undefined
): number {
  const raw =
    typeof source === "number" ? source : (source?.chat?.id as unknown);
  if (typeof raw !== "number" || !Number.isSafeInteger(raw)) {
    throw new ConversationIdError(
      "telegram update has no numeric chat.id — refusing to key conversation " +
        "state under an undefined identity (fail-closed)"
    );
  }
  return raw;
}

/**
 * ai-chatbot REST body → session id. Honest passthrough of the service's
 * existing contract: a client-supplied session_id is used verbatim (trimmed);
 * when absent the documented "default" single-session bucket is used
 * (anonymous web chat has no user identity to key on — that is the real
 * semantic, not a fabrication).
 */
export function webChatSessionId(body: { session_id?: unknown }): string {
  const raw = typeof body?.session_id === "string" ? body.session_id.trim() : "";
  return raw || "default";
}
