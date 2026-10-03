// 2026-10-03 (W8-B1): Shared channel types extracted from the triplicated
// whatsapp-bot / telegram-bot / ai-chatbot implementations. See the W8
// scoping note (channel-core plan) for the triplication evidence table.

/** Channels served (or planned) by bots consuming this library. */
export type Channel = "whatsapp" | "telegram" | "web_chat" | "ussd" | "sms";

/**
 * Normalized inbound message from any channel adapter. Adapters (WhatsApp
 * webhook, Telegram update, chat REST call) translate wire formats into this
 * shape before handing off to ChannelEngine.
 */
export interface ChannelMessage {
  channel: Channel;
  /** Stable per-channel user identity (phone, chatId, sessionId, msisdn). */
  channelUserId: string;
  /** Free text the user sent, or the normalized button/list reply id. */
  text: string;
  /** Channel-native message id (for dedup/logging); optional. */
  messageId?: string;
  /** Epoch ms when the channel received the message. */
  timestamp: number;
  /**
   * Explicit intent supplied by the channel (e.g. an interactive button id
   * that would never match the regex classifier — the whatsapp-bot R1a fix).
   */
  intentHint?: string;
  metadata?: Record<string, string>;
}

/**
 * Intent identifier. The shared insurance intents below cover the union used
 * by the three bots; bots may define additional intents (string) and register
 * handlers for them — unknown intents fall through to the honest fallback.
 */
export type KnownIntent =
  | "greeting"
  | "buy_motor_insurance"
  | "buy_life_insurance"
  | "buy_health_insurance"
  | "buy_funeral_cover"
  | "buy_insurance"
  | "file_claim"
  | "check_policy"
  | "pay_premium"
  | "get_quote"
  | "talk_to_agent"
  | "help"
  | "menu"
  | "unknown";

export type Intent = KnownIntent | (string & {});

/**
 * Channel-agnostic reply. Channel adapters render `buttons`/`list` into
 * their native interactive formats (WhatsApp interactive message, Telegram
 * inline keyboard, numbered USSD menu, ...).
 */
export interface Reply {
  text: string;
  buttons?: Array<{ id: string; title: string }>;
  list?: {
    title: string;
    sections: Array<{
      title: string;
      rows: Array<{ id: string; title: string; description?: string }>;
    }>;
  };
}

/**
 * Resolved session for one channel user. `memberId` is null when the channel
 * identity has not been linked to a platform member — handlers that need
 * member data MUST fail closed (honest unavailability reply) in that case.
 */
export interface SessionContext {
  conversationId: string;
  channel: Channel;
  channelUserId: string;
  /** Platform member id when account linking has resolved one; else null. */
  memberId: string | null;
  /** Whether the platform has authenticated/linked this channel identity. */
  authenticated: boolean;
  language: string;
  /** Free-form per-conversation working data (multi-step flow state). */
  data: Record<string, string>;
  lastActive: number;
}

/** Persisted conversation state (superset of the three bots' state shapes). */
export interface ConversationState {
  conversationId: string;
  channel: Channel;
  channelUserId: string;
  /** Current multi-step intent, if a flow is in progress. */
  intent: Intent | null;
  step: number;
  language: string;
  memberId: string | null;
  data: Record<string, string>;
  lastActive: number;
}
