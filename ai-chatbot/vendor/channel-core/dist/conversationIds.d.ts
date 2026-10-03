/** Thrown when an inbound message carries no usable conversation identity. */
export declare class ConversationIdError extends Error {
    constructor(message: string);
}
/**
 * WhatsApp Cloud API webhook message → conversation id.
 * Accepts the raw `messages[i]` object from the webhook payload (or anything
 * with a `from` field). The id is the sender's E.164 phone number as
 * delivered by Meta; it must be a non-empty string of digits/`+` only.
 */
export declare function whatsappConversationId(message: {
    from?: unknown;
}): string;
/**
 * Telegram update → numeric chat id. Accepts a message-like object
 * (`{ chat: { id } }`, which covers both Message and CallbackQuery.message)
 * or a bare number. Returns the NUMBER because the Telegram Bot API requires
 * the numeric id for sendMessage; use String(id) only at the store key edge.
 * Throws when the id is absent or not a finite safe integer.
 */
export declare function telegramChatId(source: {
    chat?: {
        id?: unknown;
    };
} | number | null | undefined): number;
/**
 * ai-chatbot REST body → session id. Honest passthrough of the service's
 * existing contract: a client-supplied session_id is used verbatim (trimmed);
 * when absent the documented "default" single-session bucket is used
 * (anonymous web chat has no user identity to key on — that is the real
 * semantic, not a fabrication).
 */
export declare function webChatSessionId(body: {
    session_id?: unknown;
}): string;
//# sourceMappingURL=conversationIds.d.ts.map