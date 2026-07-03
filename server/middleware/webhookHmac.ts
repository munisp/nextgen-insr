// TypeScript enabled — Sprint 96 security audit
/**
 * P1-A: HMAC Webhook Verification Middleware
 *
 * Verifies inbound webhook payloads using HMAC-SHA256 signatures.
 * Supports multiple providers: TigerBeetle, Termii, and generic partners.
 *
 * Usage:
 *   app.post("/webhooks/tigerbeetle", verifyWebhookHmac("TIGERBEETLE_WEBHOOK_SECRET"), handler);
 *   app.post("/webhooks/termii",      verifyWebhookHmac("TERMII_WEBHOOK_SECRET"),      handler);
 */
import { createHmac, timingSafeEqual } from "crypto";
import type { Request, Response, NextFunction } from "express";
import { logger } from '../_core/logger';

/**
 * Returns an Express middleware that verifies the HMAC-SHA256 signature
 * of the raw request body against the given environment variable key.
 *
 * The expected signature header is `X-Webhook-Signature` (hex-encoded).
 * TigerBeetle uses the same convention; Termii uses `X-Termii-Signature`.
 */
export function verifyWebhookHmac(
  secretEnvKey: string,
  headerName = "x-webhook-signature"
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const secret = process.env[secretEnvKey];
    if (!secret) {
      // If no secret is configured, skip verification (dev/test mode)
      logger.warn(
        `[WebhookHmac] ${secretEnvKey} not set — skipping signature check`
      );
      return next();
    }

    const signature = req.headers[headerName] as string | undefined;
    if (!signature) {
      res.status(401).json({ error: "Missing webhook signature header" });
      return;
    }

    // Raw body must be captured before JSON parsing — use express.raw() upstream
    const rawBody: Buffer | undefined = (req as any).rawBody;
    if (!rawBody) {
      res.status(400).json({
        error:
          "Raw body not available — ensure express.raw() is applied before this route",
      });
      return;
    }

    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");

    // Constant-time comparison to prevent timing attacks
    let valid = false;
    try {
      const sigBuf = Buffer.from(signature.replace(/^sha256=/, ""), "hex");
      const expBuf = Buffer.from(expected, "hex");
      valid =
        sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf);
    } catch {
      valid = false;
    }

    if (!valid) {
      logger.warn(
        `[WebhookHmac] Signature mismatch for ${req.path} (env=${secretEnvKey})`
      );
      res.status(401).json({ error: "Invalid webhook signature" });
      return;
    }

    next();
  };
}

/**
 * Express middleware that captures the raw body buffer before JSON parsing.
 * Mount this BEFORE express.json() on webhook routes.
 *
 * Example:
 *   app.use("/webhooks", captureRawBody, express.json());
 */
export function captureRawBody(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    (req as any).rawBody = Buffer.concat(chunks);
    next();
  });
  req.on("error", next);
}
