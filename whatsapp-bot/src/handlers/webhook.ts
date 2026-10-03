import { Request, Response } from "express";
import { ConversationEngine } from "../engine/conversation";
import { WhatsAppClient } from "../clients/whatsapp";
// 2026-10-03 (W8-B7): conversation-ID extraction is now channel-core's
// canonical whatsappConversationId() (fail-closed: a message without a valid
// E.164 `from` is skipped with a loud log instead of keying state under
// "undefined", which would merge strangers' conversations into one key).
import {
  ConversationIdError,
  whatsappConversationId,
} from "@insureportal/channel-core";

export class WhatsAppWebhookHandler {
  private engine: ConversationEngine;
  private client: WhatsAppClient;

  constructor(engine: ConversationEngine) {
    this.engine = engine;
    this.client = new WhatsAppClient();
  }

  async handle(req: Request, res: Response): Promise<void> {
    try {
      const body = req.body;

      if (body.object !== "whatsapp_business_account") {
        res.sendStatus(404);
        return;
      }

      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          if (change.field !== "messages") continue;

          const messages = change.value?.messages || [];
          for (const message of messages) {
            // 2026-10-03 (W8-B7): canonical extractor; invalid identity skips
            // this message (loudly) rather than corrupting shared state.
            let from: string;
            try {
              from = whatsappConversationId(message);
            } catch (err) {
              if (err instanceof ConversationIdError) {
                console.error(`[whatsapp-bot] dropping unidentifiable message: ${err.message}`);
                continue;
              }
              throw err;
            }
            const text = message.text?.body || "";
            const messageType = message.type;

            let userInput = text;
            if (messageType === "interactive") {
              userInput =
                message.interactive?.button_reply?.id ||
                message.interactive?.list_reply?.id ||
                text;
            }

            const response = await this.engine.processMessage(from, userInput);
            await this.client.sendMessage(from, response);
          }
        }
      }

      res.sendStatus(200);
    } catch (error) {
      console.error("Webhook error:", error);
      res.sendStatus(500);
    }
  }
}
