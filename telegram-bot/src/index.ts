/**
 * 2026-10-01 (R1d): Hardened startup and dispatch after audit.
 * - Fail-fast on missing TELEGRAM_BOT_TOKEN / API_URL (no localhost default).
 * - Every handler is wrapped so errors are logged and the user gets an honest
 *   failure message instead of silence.
 * - Photo/document handlers no longer pretend evidence was attached to a
 *   claim; location handler no longer calls the non-existent agents/nearby API.
 */
import express from "express";
import TelegramBot from "node-telegram-bot-api";
import { config } from "./config";
import { CLAIM_EVIDENCE_UNSUPPORTED, SERVICE_ERROR } from "./messages";
import { InsuranceCommandHandler } from "./handlers/commands";
import { ConversationManager } from "./engine/conversation";
import { CallbackHandler } from "./handlers/callbacks";
// 2026-10-03 (W8-B7): conversation-ID extraction is now channel-core's
// canonical telegramChatId() — same numeric chat.id semantics as before, but
// fail-closed (throws ConversationIdError, caught by the safe() wrapper)
// instead of keying state under an absent/NaN id.
import { telegramChatId } from "@insureportal/channel-core";

const app = express();
app.use(express.json());

const bot = new TelegramBot(config.telegramBotToken, { polling: !config.telegramWebhookUrl });
const conversationManager = new ConversationManager(config.apiBaseUrl);
const commandHandler = new InsuranceCommandHandler(bot, conversationManager);
const callbackHandler = new CallbackHandler(bot, conversationManager);

// 2026-10-01 (R1d): never swallow errors — log them and tell the user honestly.
function safe(chatIdOf: (msg: TelegramBot.Message) => number, fn: (msg: TelegramBot.Message, match: RegExpExecArray | null) => Promise<void> | void) {
  return async (msg: TelegramBot.Message, match: RegExpExecArray | null) => {
    try {
      await fn(msg, match);
    } catch (e) {
      console.error("[telegram-bot] Handler error:", e);
      bot.sendMessage(chatIdOf(msg), SERVICE_ERROR).catch((e2) => console.error("[telegram-bot] Failed to send error notice:", e2));
    }
  };
}
const chatId = (msg: TelegramBot.Message) => telegramChatId(msg);

// Register commands
bot.onText(/\/start/, safe(chatId, (msg) => commandHandler.handleStart(msg)));
bot.onText(/\/help/, safe(chatId, (msg) => commandHandler.handleHelp(msg)));
bot.onText(/\/policies/, safe(chatId, (msg) => commandHandler.handlePolicies(msg)));
bot.onText(/\/claims/, safe(chatId, (msg) => commandHandler.handleClaims(msg)));
bot.onText(/\/fileclaim/, safe(chatId, (msg) => commandHandler.handleFileClaim(msg)));
bot.onText(/\/premium/, safe(chatId, (msg) => commandHandler.handlePremium(msg)));
bot.onText(/\/agent/, safe(chatId, (msg) => commandHandler.handleFindAgent(msg)));
bot.onText(/\/status(?:\s+.+)?/, safe(chatId, (msg) => commandHandler.handleClaimStatus(msg)));
bot.onText(/\/pay(?:\s+.+)?/, safe(chatId, (msg) => commandHandler.handlePayPremium(msg)));
bot.onText(/\/emergency/, safe(chatId, (msg) => commandHandler.handleEmergency(msg)));
bot.onText(/\/language (.+)/, safe(chatId, (msg, match) => commandHandler.handleLanguage(msg, match![1])));

// Handle callback queries (inline buttons)
bot.on("callback_query", async (query) => {
  try {
    await callbackHandler.handle(query);
  } catch (e) {
    console.error("[telegram-bot] Callback handler error:", e);
    if (query.message) {
      bot.sendMessage(query.message.chat.id, SERVICE_ERROR).catch(() => {});
    }
  }
});

// Handle free-text messages (conversational flow)
bot.on("message", (msg) => {
  if (msg.text?.startsWith("/")) return; // skip commands
  if (!msg.text) return; // photos/documents/locations handled below
  conversationManager.processMessage(telegramChatId(msg), msg.text, msg.from?.language_code).then((response) => {
    if (response.keyboard) {
      bot.sendMessage(msg.chat.id, response.text, {
        reply_markup: { inline_keyboard: response.keyboard },
        parse_mode: "Markdown",
      });
    } else {
      bot.sendMessage(msg.chat.id, response.text, { parse_mode: "Markdown" });
    }
  }).catch((e) => {
    console.error("[telegram-bot] Message handler error:", e);
    bot.sendMessage(msg.chat.id, SERVICE_ERROR).catch(() => {});
  });
});

// 2026-10-01 (R1d): photos/documents were previously acknowledged as
// "attached to your claim evidence" — that was fabricated; no claim backend
// exists. Be honest instead.
bot.on("photo", (msg) => {
  bot.sendMessage(msg.chat.id, CLAIM_EVIDENCE_UNSUPPORTED, { parse_mode: "Markdown" })
    .catch((e) => console.error("[telegram-bot] photo reply error:", e));
});

bot.on("document", (msg) => {
  bot.sendMessage(msg.chat.id, CLAIM_EVIDENCE_UNSUPPORTED, { parse_mode: "Markdown" })
    .catch((e) => console.error("[telegram-bot] document reply error:", e));
});

// Webhook endpoint
if (config.telegramWebhookUrl) {
  app.post(`/webhook/${config.telegramBotToken}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });
  bot.setWebHook(`${config.telegramWebhookUrl}/webhook/${config.telegramBotToken}`);
}

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "healthy", service: "telegram-bot", uptime: process.uptime() });
});

app.listen(config.port, () => {
  console.log(`InsurePortal Telegram Bot running on port ${config.port}`);
});
