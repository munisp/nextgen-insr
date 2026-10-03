import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";

// Security decision (2026-10-03): ALL sms-service endpoints (send, bulk,
// template, delivery-report, inbound, status) were unauthenticated — anyone
// reaching the port could send SMS at provider cost, inject fake delivery
// reports, and enumerate message status / recipient PII. Every /api/* route
// now requires the SMS_SERVICE_API_KEY shared secret (X-API-Key header or
// Bearer token), compared in constant time. The key is never logged.
// /health stays public for orchestrator liveness probes.

export const API_KEY_ENV = "SMS_SERVICE_API_KEY";

// requireApiKeyAtBoot fail-closes the process when the key is unconfigured:
// the service must never listen while unauthenticated.
export function requireApiKeyAtBoot(): string {
  const key = process.env[API_KEY_ENV];
  if (!key || key.length === 0) {
    console.error(`[SECURITY] ${API_KEY_ENV} is not set; refusing to start (all SMS endpoints require authentication)`);
    process.exit(1);
  }
  return key!;
}

export function apiKeyAuth(expectedKey: string) {
  const expected = Buffer.from(expectedKey, "utf8");
  return (req: Request, res: Response, next: NextFunction): void => {
    let provided = req.header("X-API-Key") || "";
    if (!provided) {
      const auth = req.header("Authorization") || "";
      provided = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
    }
    const providedBuf = Buffer.from(provided, "utf8");
    // timingSafeEqual throws on length mismatch; pad-check length first while
    // still performing a comparison to avoid a trivial length oracle.
    const ok =
      providedBuf.length === expected.length &&
      crypto.timingSafeEqual(providedBuf, expected);
    if (!ok) {
      res.status(401).json({ error: "invalid or missing API key" });
      return;
    }
    next();
  };
}
