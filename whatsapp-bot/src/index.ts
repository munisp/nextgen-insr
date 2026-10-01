import express from "express";
import { WhatsAppWebhookHandler } from "./handlers/webhook";
import { ConversationEngine } from "./engine/conversation";
import { InsuranceIntentClassifier } from "./engine/intent";
import { loadPlatformConfig, PlatformClient } from "./clients/platform";

// 2026-10-01 (R1a): fail-fast startup. The bot must never run without a real
// platform backend configured (no localhost defaults) — otherwise it would be
// tempted to answer from thin air, which is exactly what the audit flagged.
const platformConfig = loadPlatformConfig();
const platformClient = new PlatformClient(platformConfig);

// Fail-closed on webhook identity: no hardcoded verification-token fallback.
const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
if (!verifyToken) {
  throw new Error(
    "WHATSAPP_VERIFY_TOKEN is not configured — refusing to start (fail-closed)."
  );
}

const app = express();
app.use(express.json());

const intentClassifier = new InsuranceIntentClassifier();
const conversationEngine = new ConversationEngine(intentClassifier, platformClient);
const webhookHandler = new WhatsAppWebhookHandler(conversationEngine);

// WhatsApp webhook verification
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === verifyToken) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// WhatsApp message webhook
app.post("/webhook", (req, res) => webhookHandler.handle(req, res));

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "healthy", service: "whatsapp-bot" });
});

const port = process.env.PORT || 8091;
app.listen(port, () => {
  console.log(`WhatsApp Bot listening on port ${port}`);
});
