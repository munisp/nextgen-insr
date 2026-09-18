import express from "express";
import { SMSRouter } from "./handlers/router";
import { initOutbox, startRetryWorker } from "./outbox";

const app = express();
app.use(express.json());

const smsRouter = new SMSRouter();

// Send SMS
app.post("/api/v1/sms/send", (req, res) => smsRouter.send(req, res));

// Send bulk SMS
app.post("/api/v1/sms/bulk", (req, res) => smsRouter.sendBulk(req, res));

// Send templated SMS
app.post("/api/v1/sms/template", (req, res) => smsRouter.sendTemplate(req, res));

// Delivery report webhook
app.post("/api/v1/sms/delivery-report", (req, res) => smsRouter.deliveryReport(req, res));

// SMS status check
app.get("/api/v1/sms/status/:messageId", (req, res) => smsRouter.getStatus(req, res));

// NG-6: inbound SMS command webhook (telco MO delivery)
app.post("/api/v1/sms/inbound", (req, res) => smsRouter.inbound(req, res));

// Health
app.get("/health", (_req, res) => res.json({ status: "healthy", service: "sms-service" }));

// NG-5: durable outbox + retry worker (Termii/AfricasTalking alternating).
initOutbox()
  .then(() => startRetryWorker([
    { name: "termii", send: (to, body) => (smsRouter as any).primary.send(to, body) },
    { name: "africastalking", send: (to, body) => (smsRouter as any).fallback.send(to, body) },
  ]))
  .catch((e) => console.error(`[sms] outbox init failed: ${e}`));

const port = process.env.PORT || 8095;
app.listen(port, () => console.log(`InsurePortal SMS Service on port ${port}`));
