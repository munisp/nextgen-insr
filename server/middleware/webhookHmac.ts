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

import express, { type Request, type Response, type NextFunction } from "express";

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
  headerName = "x-webhook-signature",
  options: { failClosed?: boolean } = {}
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const secret = process.env[secretEnvKey];
    if (!secret) {
      // FAIL-CLOSED (THREAT_MODEL.md §7.4): in production an unconfigured
      // signing secret is a deployment error, not a reason to accept
      // unverified webhooks. Answer 503 loudly so monitoring fires.
      // options.failClosed (DD-TSSEC A7-10) applies the same rule in EVERY
      // environment — used for providers with no native signing scheme where
      // a dev bypass would only ever admit unverifiable deliveries.
      if (process.env.NODE_ENV === "production" || options.failClosed) {
        logger.error(
          `[WebhookHmac] ${secretEnvKey} NOT SET${process.env.NODE_ENV === "production" ? " in production" : " (fail-closed route)"} — rejecting webhook. Set the secret or remove the route.`
        );
        res.status(503).json({
          error: `Webhook signing secret ${secretEnvKey} is not configured (PRECONDITION_FAILED)`,
        });
        return;
      }
      // Labeled dev/test bypass only — every skipped verification is logged.
      logger.warn(
        `[WebhookHmac] DEV BYPASS: ${secretEnvKey} not set — skipping signature check (never allowed in production)`
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
 * Mount this BEFORE any JSON parser on webhook routes.
 *
 * DD-TSSEC (A7-9): the previous implementation attached data/end listeners
 * to the request stream. Any express.json() mounted upstream left the stream
 * already-ended (the listeners never fired and the request hung), and any
 * express.json() mounted downstream then failed with "stream is not
 * readable" — so HMAC verification could never execute either way. This
 * implementation uses express.raw(): the body is buffered exactly once,
 * exposed as req.rawBody for signature verification, and req._body is set so
 * downstream JSON parsers skip the request instead of erroring.
 *
 * Example:
 *   app.post("/webhooks/x", captureRawBody, verifyWebhookHmac("X_SECRET"), handler);
 */
const rawBodyParser = express.raw({ type: "*/*", limit: "1mb" });

export function captureRawBody(
  req: Request,
  res: Response,
  next: NextFunction
) {
  rawBodyParser(req, res, (err?: unknown) => {
    if (err) {
      next(err);
      return;
    }
    (req as { rawBody?: Buffer }).rawBody = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.alloc(0);
    next();
  });
}
