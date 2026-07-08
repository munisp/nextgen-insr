// @ts-check

// TypeScript enabled — Sprint 96 security audit
import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { logger } from '../_core/logger';

export function structuredLoggingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const requestId =
    (req.headers["x-request-id"] as string) || crypto.randomUUID();
  const start = Date.now();

  // Attach request ID to request and response
  (req as any).requestId = requestId;
  res.setHeader("X-Request-ID", requestId);

  // Log on response finish
  res.on("finish", () => {
    const latency = Date.now() - start;
    const logEntry = {
      timestamp: new Date().toISOString(),
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      latencyMs: latency,
      userAgent: req.headers["user-agent"]?.substring(0, 100),
      ip: req.ip || req.socket.remoteAddress,
      userId: (req as any).user?.id ?? null,
    };

    if (res.statusCode >= 500) {
      logger.error("[REQ]: " + JSON.stringify(logEntry));
    } else if (res.statusCode >= 400) {
      logger.warn("[REQ]: " + JSON.stringify(logEntry));
    } else if (latency > 5000) {
      logger.warn("[SLOW]: " + JSON.stringify(logEntry));
    }
  });

  next();
}
