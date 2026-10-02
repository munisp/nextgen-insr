/**
 * 2026-10-01 (R1d): Rewritten after audit.
 *
 * Removed: every call to /api/v1/{policies,claims,claims/:id,premiums/due,
 * agents/nearby} — those endpoints do not exist in the monolith
 * (server/restBridge.ts only exposes authenticated admin routes), and errors
 * were swallowed so users saw silent empty lists. Also removed the multi-step
 * claim-filing state machine that "submitted" to the non-existent
 * POST /api/v1/claims.
 *
 * What remains is local-only conversation state (language preference, main
 * menu, intent hints). Member-data features return honest unavailability
 * messages via src/messages.ts until a real member-facing backend and
 * account-linking mechanism exist. The apiBase URL is still injected and
 * validated at startup (src/config.ts) so real endpoints can be wired here
 * once they exist.
 */
// 2026-10-02 (C2-b11b12, audit B11): state shape + Redis store live in
// src/lib/conversationStore.ts (re-exported for existing imports).
import {
  ConversationState,
  RedisConversationStore,
} from "../lib/conversationStore";

export { ConversationState, RedisConversationStore };

interface BotResponse {
  text: string;
  keyboard?: Array<Array<{ text: string; callback_data: string }>>;
}

export class ConversationManager {
  // 2026-10-02 (C2-b11b12, audit B11): state now persisted in Redis
  // (hash + idle TTL) via RedisConversationStore so restarts no longer wipe
  // per-chat state; in-memory only as a loudly-logged outage fallback.
  private store: RedisConversationStore;
  private apiBase: string;

  constructor(apiBase: string, store?: RedisConversationStore) {
    this.apiBase = apiBase;
    this.store = store ?? new RedisConversationStore();
  }

  /** Base URL of the monolith API (validated at startup). Reserved for real
   *  member endpoints once they exist — 2026-10-01 (R1d). */
  get apiBaseUrl(): string {
    return this.apiBase;
  }

  private async getState(chatId: number): Promise<ConversationState> {
    const state =
      (await this.store.get(chatId)) ??
      { chatId, language: "en", lastActive: Date.now() };
    state.lastActive = Date.now();
    await this.store.set(state);
    return state;
  }

  async processMessage(chatId: number, text: string, _langCode?: string): Promise<BotResponse> {
    await this.getState(chatId);

    if (text.toLowerCase() === "menu" || text === "0") {
      return {
        text: "📋 *Main Menu*\n\nWhat would you like to do?",
        keyboard: [
          [{ text: "📋 Policies", callback_data: "policies" }, { text: "📝 Claims", callback_data: "claims" }],
          [{ text: "🆕 File Claim", callback_data: "file_claim" }, { text: "💳 Premium", callback_data: "premium" }],
        ],
      };
    }

    // Intent hints — static, no fabricated data.
    const lower = text.toLowerCase();
    if (lower.includes("policy") || lower.includes("coverage")) {
      return { text: "📋 Use /policies for policy information." };
    }
    if (lower.includes("claim") || lower.includes("accident") || lower.includes("damage")) {
      return { text: "📝 Use /fileclaim for claim guidance or /claims for claim information." };
    }
    if (lower.includes("pay") || lower.includes("premium")) {
      return { text: "💳 Use /premium for premium information or /pay for payment options." };
    }
    if (lower.includes("agent") || lower.includes("office")) {
      return { text: "📍 Use /agent for how to find an agent." };
    }
    if (lower.includes("emergency") || lower.includes("urgent") || lower.includes("help")) {
      return { text: "🆘 Use /emergency for emergency contact numbers." };
    }

    return {
      text: "I can help you with insurance services! Try:\n\n📋 /policies\n📝 /fileclaim\n💳 /premium\n📍 /agent\n🆘 /emergency\n\nOr just describe what you need!",
    };
  }

  async setLanguage(chatId: number, lang: string): Promise<void> {
    const state = await this.getState(chatId);
    state.language = lang;
    await this.store.set(state);
  }

  /** Test/diagnostic hook: read persisted language for a chat. */
  async getLanguage(chatId: number): Promise<string> {
    return (await this.store.get(chatId))?.language ?? "en";
  }
}
