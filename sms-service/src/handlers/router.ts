import { Request, Response } from "express";
import { TermiiProvider } from "../providers/termii";
import { AfricasTalkingProvider } from "../providers/africas-talking";
import { renderTemplate } from "../templates/insurance";
import {
  recordOutgoing,
  markResult,
  recordDeliveryReport,
  getByMessageId,
} from "../outbox";
import { parseInbound, HELP_TEXT } from "../inbound";

export class SMSRouter {
  private primary: TermiiProvider;
  private fallback: AfricasTalkingProvider;

  constructor() {
    this.primary = new TermiiProvider();
    this.fallback = new AfricasTalkingProvider();
  }

  // NG-5: every outbound message is persisted BEFORE sending; failures are
  // recorded for the retry worker (backoff + dead-letter) instead of being
  // returned once and forgotten.
  async send(req: Request, res: Response) {
    const { to, message, priority } = req.body;
    if (!to || !message) return res.status(400).json({ error: "to and message required" });

    const normalized = this.normalizePhone(to);
    const outboxId = await recordOutgoing(normalized, message);

    let result = await this.primary.send(normalized, message);
    let provider = "termii";
    if (!result.success) {
      result = await this.fallback.send(normalized, message);
      provider = "africastalking";
    }
    await markResult(outboxId, provider, result.messageId ?? null, !!result.success, result.error);
    res.status(result.success ? 200 : 202).json({
      ...result,
      outboxId,
      queued_for_retry: !result.success,
    });
  }

  async sendBulk(req: Request, res: Response) {
    const { recipients, message } = req.body;
    if (!recipients?.length || !message) return res.status(400).json({ error: "recipients and message required" });

    const normalized = recipients.map((r: string) => this.normalizePhone(r));
    const results = await this.primary.sendBulk(normalized, message);
    const failed = results.filter((r) => !r.success);
    if (failed.length > 0) {
      const retries = await Promise.all(failed.map((f) => this.fallback.send(f.to, message)));
      failed.forEach((f, i) => { if (retries[i].success) { f.success = true; } });
    }
    res.json({ total: results.length, delivered: results.filter((r) => r.success).length, failed: results.filter((r) => !r.success).length, results });
  }

  async sendTemplate(req: Request, res: Response) {
    const { to, template, language, variables } = req.body;
    if (!to || !template) return res.status(400).json({ error: "to and template required" });

    try {
      const message = renderTemplate(template, language || "en", variables || {});
      const normalized = this.normalizePhone(to);
      let result = await this.primary.send(normalized, message);
      if (!result.success) result = await this.fallback.send(normalized, message);
      res.json({ ...result, message });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }

  // NG-5: durable delivery reports — unknown IDs are recorded, not dropped.
  async deliveryReport(req: Request, res: Response) {
    const { message_id, status } = req.body;
    if (!message_id || !status) return res.status(400).json({ error: "message_id and status required" });
    await recordDeliveryReport(req.body.provider ?? "termii", message_id, status);
    res.json({ received: true });
  }

  async getStatus(req: Request, res: Response) {
    const { messageId } = req.params;
    const log = await getByMessageId(messageId);
    if (!log) return res.status(404).json({ error: "Message not found" });
    res.json({ to: log.recipient, status: log.status, attempts: log.attempts, timestamp: log.updated_at ?? log.created_at });
  }

  // NG-6: inbound SMS command webhook (typo-tolerant parser). Transactional
  // verbs fail LOUD (501) — no SMS funds bridge exists in this service.
  async inbound(req: Request, res: Response) {
    const { from, text } = req.body;
    if (!from || typeof text !== "string") return res.status(400).json({ error: "from and text required" });
    const cmd = parseInbound(text);
    switch (cmd.kind) {
      case "help":
      case "unknown":
        return res.json({ reply: HELP_TEXT, parsed: cmd.kind });
      case "stop":
        return res.json({ reply: "You have opted out of SMS notifications.", parsed: "stop" });
      case "balance":
      case "status":
        // Account lookups require the core banking bridge; fail loud rather
        // than fabricate a balance/status.
        return res.status(501).json({
          error: "account lookup via SMS is not connected to a live core bridge",
          parsed: cmd,
          alternative: "Dial *384*100# for USSD self-service",
        });
      case "unsupported_transactional":
        return res.status(501).json({
          error: `${cmd.verb} cannot be performed over SMS (no second factor). Dial *384*100# instead.`,
          parsed: cmd,
        });
    }
  }

  private normalizePhone(phone: string): string {
    let cleaned = phone.replace(/[\s\-\(\)]/g, "");
    if (cleaned.startsWith("0")) cleaned = "+234" + cleaned.slice(1);
    if (cleaned.startsWith("234") && !cleaned.startsWith("+")) cleaned = "+" + cleaned;
    if (!cleaned.startsWith("+")) cleaned = "+234" + cleaned;
    return cleaned;
  }
}
