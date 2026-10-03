import express from "express";
import { ChatEngine } from "./engine/chat";
import { KnowledgeBase } from "./knowledge/base";
import { LanguageDetector } from "./language/detector";
// 2026-10-03 (W8-B4): platform catalog wiring. Platform is OPTIONAL: without
// PLATFORM_API_URL the service still serves honest static FAQ answers
// (catalog enrichment is skipped). But a PARTIAL config (URL set, service
// token missing) is a boot error — loadPlatformConfig fails fast and names
// the missing variable rather than silently degrading to fabricated answers.
import { PlatformClient, loadPlatformConfig } from "./clients/platform";

const app = express();
app.use(express.json());

const knowledgeBase = new KnowledgeBase();
const languageDetector = new LanguageDetector();
const platform = (process.env.PLATFORM_API_URL ?? "").trim()
  ? new PlatformClient(loadPlatformConfig()) // throws PlatformConfigError if misconfigured
  : null;
if (!platform) {
  console.log(
    "[ai-chatbot] PLATFORM_API_URL not set — catalog answers stay at honest static FAQ text"
  );
}
const chatEngine = new ChatEngine(knowledgeBase, languageDetector, undefined, platform);

app.post("/api/v1/chat", async (req, res) => {
  const { message, session_id, language } = req.body;
  const response = await chatEngine.respond(session_id || "default", message, language);
  res.json(response);
});

app.get("/api/v1/chat/languages", (_req, res) => {
  res.json({ languages: languageDetector.getSupportedLanguages() });
});

app.get("/api/v1/chat/faq", (_req, res) => {
  res.json({ faq: knowledgeBase.getFAQ() });
});

app.get("/health", (_req, res) => {
  res.json({ status: "healthy", service: "ai-chatbot" });
});

const port = process.env.PORT || 8100;
app.listen(port, () => {
  console.log(`AI Chatbot listening on port ${port}`);
});
