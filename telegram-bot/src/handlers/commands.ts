/**
 * 2026-10-01 (R1d): Rewritten after audit.
 *
 * The previous handlers rendered member data (policies, claims, premiums,
 * claim status, nearby agents) fetched from /api/v1 endpoints that do not
 * exist in the monolith, with errors swallowed into silent empty lists. The
 * monolith exposes no public member self-service API and no Telegram account
 * linking mechanism, so these commands now answer honestly and point users to
 * official channels (see src/messages.ts). Nothing here fabricates data.
 */
import TelegramBot from "node-telegram-bot-api";
import { ConversationManager } from "../engine/conversation";
// 2026-10-03 (W8-B7): canonical conversation-ID extractor (fail-closed) for
// state-key derivation; sendMessage addressing stays on msg.chat.id.
import { telegramChatId } from "@insureportal/channel-core";
import {
  AGENT_LOCATOR_UNAVAILABLE,
  CLAIM_FILE_UNAVAILABLE,
  CLAIM_STATUS_UNAVAILABLE,
  MEMBER_DATA_UNAVAILABLE,
  PAY_VIA_OFFICIAL_CHANNELS,
} from "../messages";

export class InsuranceCommandHandler {
  constructor(private bot: TelegramBot, private conversation: ConversationManager) {}

  async handleStart(msg: TelegramBot.Message) {
    const name = msg.from?.first_name || "there";
    const text = `🏦 *Welcome to InsurePortal, ${name}!*\n\nYour insurance companion on Telegram.\n\n*What I can do:*\n📋 /policies — Policy information\n📝 /claims — Claims information\n🆕 /fileclaim — How to file a claim\n💳 /premium — Premium payment info\n📍 /agent — Find an agent\n🆘 /emergency — Emergency contacts\n🌐 /language en|ha|yo|ig — Change language`;
    this.bot.sendMessage(msg.chat.id, text, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "📋 Policies", callback_data: "policies" }, { text: "📝 Claims", callback_data: "claims" }],
          [{ text: "🆕 File Claim", callback_data: "file_claim" }, { text: "💳 Premium", callback_data: "premium" }],
          [{ text: "📍 Find Agent", callback_data: "find_agent" }, { text: "🆘 Emergency", callback_data: "emergency" }],
        ],
      },
    });
  }

  async handleHelp(msg: TelegramBot.Message) {
    this.bot.sendMessage(msg.chat.id,
      "*InsurePortal Bot Commands:*\n\n" +
      "/start — Welcome & main menu\n" +
      "/policies — Policy information\n" +
      "/claims — Claims information\n" +
      "/fileclaim — How to file a claim\n" +
      "/status — Claim status information\n" +
      "/premium — Premium information\n" +
      "/pay — How to pay your premium\n" +
      "/agent — How to find an agent\n" +
      "/emergency — Emergency contacts\n" +
      "/language [en|ha|yo|ig] — Set language\n" +
      "/help — Show this message",
      { parse_mode: "Markdown" }
    );
  }

  // 2026-10-01 (R1d): member self-service is not exposed by the monolith and
  // there is no account-linking mechanism — answer honestly.
  async handlePolicies(msg: TelegramBot.Message) {
    this.bot.sendMessage(msg.chat.id, MEMBER_DATA_UNAVAILABLE, { parse_mode: "Markdown" });
  }

  async handleClaims(msg: TelegramBot.Message) {
    this.bot.sendMessage(msg.chat.id, MEMBER_DATA_UNAVAILABLE, { parse_mode: "Markdown" });
  }

  async handleFileClaim(msg: TelegramBot.Message) {
    this.bot.sendMessage(msg.chat.id, CLAIM_FILE_UNAVAILABLE, { parse_mode: "Markdown" });
  }

  async handlePremium(msg: TelegramBot.Message) {
    this.bot.sendMessage(msg.chat.id, MEMBER_DATA_UNAVAILABLE, { parse_mode: "Markdown" });
  }

  async handleFindAgent(msg: TelegramBot.Message) {
    this.bot.sendMessage(msg.chat.id, AGENT_LOCATOR_UNAVAILABLE, { parse_mode: "Markdown" });
  }

  async handleClaimStatus(msg: TelegramBot.Message) {
    this.bot.sendMessage(msg.chat.id, CLAIM_STATUS_UNAVAILABLE, { parse_mode: "Markdown" });
  }

  // 2026-10-01 (R1d): hardcoded bank account numbers and a fabricated Paystack
  // link/USSD code were removed. There is no real payment-collection endpoint
  // for members, so we direct to official channels and never invent details.
  async handlePayPremium(msg: TelegramBot.Message) {
    this.bot.sendMessage(msg.chat.id, PAY_VIA_OFFICIAL_CHANNELS, { parse_mode: "Markdown" });
  }

  async handleEmergency(msg: TelegramBot.Message) {
    // 2026-10-01 (R1d): removed fabricated company hotline numbers; only
    // well-known Nigerian national emergency numbers are listed.
    this.bot.sendMessage(msg.chat.id,
      "🆘 *Emergency Contacts (Nigeria)*\n\n" +
      "🚨 National Emergency: 112\n" +
      "👮 Police: 199\n" +
      "🚗 FRSC (Road Accidents): 122\n" +
      "🚑 Ambulance: 112\n\n" +
      "_For insurance emergencies, contact your insurer via the hotline on " +
      "your policy document or the official InsurePortal app._",
      { parse_mode: "Markdown" }
    );
  }

  async handleLanguage(msg: TelegramBot.Message, lang: string) {
    const supported: Record<string, string> = { en: "English", ha: "Hausa", yo: "Yoruba", ig: "Igbo" };
    if (!supported[lang]) {
      this.bot.sendMessage(msg.chat.id, "Supported languages: en (English), ha (Hausa), yo (Yoruba), ig (Igbo)");
      return;
    }
    await this.conversation.setLanguage(telegramChatId(msg), lang);
    this.bot.sendMessage(msg.chat.id, `🌐 Language set to *${supported[lang]}*`, { parse_mode: "Markdown" });
  }
}
