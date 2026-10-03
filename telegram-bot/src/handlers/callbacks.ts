/**
 * 2026-10-01 (R1d): Rewritten after audit.
 *
 * Removed: the pay_* branch that displayed hardcoded bank account numbers
 * (GTBank/Zenith), a fabricated Paystack payment link and an invented USSD
 * code; the claim-type/claim-submit flow that "submitted" to the
 * non-existent POST /api/v1/claims; and the policy_* placeholder that faked
 * loading policy details. All buttons now route to honest command handlers.
 */
import TelegramBot from "node-telegram-bot-api";
import { ConversationManager } from "../engine/conversation";
import { InsuranceCommandHandler } from "./commands";
// 2026-10-03 (W8-B7): canonical conversation-ID extractor (fail-closed).
import { telegramChatId } from "@insureportal/channel-core";

export class CallbackHandler {
  private commandHandler: InsuranceCommandHandler;

  constructor(private bot: TelegramBot, private conversation: ConversationManager) {
    this.commandHandler = new InsuranceCommandHandler(bot, conversation);
  }

  async handle(query: TelegramBot.CallbackQuery) {
    // 2026-10-03 (W8-B7): was query.message!.chat.id — the non-null assert
    // could key state under undefined; the canonical extractor throws
    // (fail-closed) on a malformed callback instead.
    const chatId = telegramChatId(query.message);
    const data = query.data || "";
    await this.bot.answerCallbackQuery(query.id);

    const msg = query.message as TelegramBot.Message;

    switch (data) {
      case "policies":
        await this.commandHandler.handlePolicies(msg);
        return;
      case "claims":
        await this.commandHandler.handleClaims(msg);
        return;
      case "file_claim":
        await this.commandHandler.handleFileClaim(msg);
        return;
      case "premium":
        await this.commandHandler.handlePremium(msg);
        return;
      case "find_agent":
        await this.commandHandler.handleFindAgent(msg);
        return;
      case "emergency":
        await this.commandHandler.handleEmergency(msg);
        return;
      default:
        // 2026-10-01 (R1d): unknown/legacy callback payloads — fail loud in
        // logs, honest no-op for the user.
        console.warn(`[telegram-bot] Unhandled callback_data "${data}" from chat ${chatId}`);
        return;
    }
  }
}
