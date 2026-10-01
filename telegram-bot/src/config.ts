/**
 * 2026-10-01 (R1d): Centralised, fail-closed environment configuration.
 * The previous code silently defaulted API_URL to http://localhost:5000 and
 * started with an empty TELEGRAM_BOT_TOKEN, which made the bot run against a
 * non-existent backend and fail silently at runtime. We now refuse to start
 * when required configuration is missing.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    // Fail-fast at startup — never run with a fabricated default.
    throw new Error(`[telegram-bot] Missing required environment variable: ${name}`);
  }
  return value.trim();
}

export const config = {
  telegramBotToken: requireEnv("TELEGRAM_BOT_TOKEN"),
  // Optional: when set, the bot uses webhooks instead of polling.
  telegramWebhookUrl: (process.env.TELEGRAM_WEBHOOK_URL || "").trim(),
  // 2026-10-01 (R1d): base URL of the monolith API. No localhost default.
  apiBaseUrl: requireEnv("API_URL").replace(/\/+$/, ""),
  port: parseInt(process.env.PORT || "8094", 10),
};
