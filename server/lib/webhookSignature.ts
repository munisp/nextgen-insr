// @ts-check

// TypeScript enabled — Sprint 96 security audit
/**
 * Webhook HMAC Signature Verification
 *
 * Generates and verifies HMAC-SHA256 signatures for webhook payloads.
 * Prevents replay attacks with timestamp validation.
 */
import crypto from "crypto";

const TIMESTAMP_TOLERANCE_SECONDS = 300; // 5 minutes

interface SignatureResult {
  signature: string;
  timestamp: number;
}

/**
 * Generate HMAC-SHA256 signature for a webhook payload
 */
export function generateWebhookSignature(
  payload: string | Buffer,
  secret: string
): SignatureResult {
  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = `${timestamp}.${typeof payload === "string" ? payload : payload.toString("utf8")}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");
  return { signature: `v1=${signature}`, timestamp };
}

/**
 * Verify HMAC-SHA256 signature of a webhook payload
 */
export function verifyWebhookSignature(
  payload: string | Buffer,
  signature: string,
  timestamp: number,
  secret: string
): { valid: boolean; error?: string } {
  // Check timestamp freshness (prevent replay attacks)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > TIMESTAMP_TOLERANCE_SECONDS) {
    return {
      valid: false,
      error: "Timestamp outside tolerance window (possible replay attack)",
    };
  }

  // Compute expected signature
  const signedPayload = `${timestamp}.${typeof payload === "string" ? payload : payload.toString("utf8")}`;
  const expectedSignature =
    "v1=" +
    crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");

  // Constant-time comparison to prevent timing attacks
  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (sigBuffer.length !== expectedBuffer.length) {
    return { valid: false, error: "Signature length mismatch" };
  }
  if (!crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    return { valid: false, error: "Signature mismatch" };
  }

  return { valid: true };
}

/**
 * Express middleware for webhook signature verification
 */
export function webhookSignatureMiddleware(secret: string) {
  return (req: any, res: any, next: any) => {
    const signature = req.headers["x-webhook-signature"] as string;
    const timestamp = parseInt(
      req.headers["x-webhook-timestamp"] as string,
      10
    );

    if (!signature || !timestamp) {
      return res
        .status(401)
        .json({ error: "Missing webhook signature headers" });
    }

    const body =
      typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    const result = verifyWebhookSignature(body, signature, timestamp, secret);

    if (!result.valid) {
      return res.status(401).json({ error: result.error });
    }

    next();
  };
}
