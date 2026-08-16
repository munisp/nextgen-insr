/**
 * InsurePortal Structured Logger
 * Uses pino for JSON-structured logging with request ID correlation.
 * Log level is controlled by LOG_LEVEL env var (default: info in prod, debug in dev).
 *
 * Production output: JSON lines with service name, version, trace IDs for
 * Promtail/Loki/OpenSearch ingestion.
 */
import crypto from "crypto";

import type { Request, Response, NextFunction } from "express";
import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";
const SERVICE_NAME = process.env.SERVICE_NAME ?? "insurance-portal";
const SERVICE_VERSION = process.env.SERVICE_VERSION ?? "1.0.0";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? "debug" : "info"),
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss",
            ignore: "pid,hostname",
          },
        },
      }
    : {
        formatters: {
          level(label) {
            return { level: label };
          },
          log(obj) {
            return { ...obj, service: SERVICE_NAME, version: SERVICE_VERSION };
          },
        },
        timestamp: pino.stdTimeFunctions.isoTime,
        base: {
          service: SERVICE_NAME,
          env: process.env.NODE_ENV ?? "production",
          version: SERVICE_VERSION,
        },
        redact: {
          paths: [
            "password",
            "secret",
            "token",
            "authorization",
            "cookie",
            "*.password",
            "*.secret",
            "*.token",
          ],
          censor: "[REDACTED]",
        },
      }),
});

/**
 * Create a child logger with a fixed request ID for per-request correlation.
 */
export function childLogger(requestId: string) {
  return logger.child({ requestId });
}

/**
 * Express middleware: injects X-Request-ID header and attaches a child logger
 * to `req.log` for per-request structured logging with trace correlation.
 */
export function requestLoggingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const requestId =
    (req.headers["x-request-id"] as string) || crypto.randomUUID();
  const traceId = (req.headers["x-trace-id"] as string) || crypto.randomUUID();
  const startTime = Date.now();

  res.setHeader("X-Request-ID", requestId);
  res.setHeader("X-Trace-ID", traceId);

  const reqLogger = logger.child({
    requestId,
    traceId,
    method: req.method,
    path: req.path,
    userAgent: req.headers["user-agent"],
    ip: req.ip ?? req.socket.remoteAddress,
  });

  (req as unknown as Record<string, unknown>).log = reqLogger;

  res.on("finish", () => {
    const duration = Date.now() - startTime;
    const logData = {
      statusCode: res.statusCode,
      duration,
      contentLength: res.getHeader("content-length"),
    };

    if (res.statusCode >= 500) {
      reqLogger.error(
        logData,
        `${req.method} ${req.path} ${res.statusCode} ${duration}ms`
      );
    } else if (res.statusCode >= 400) {
      reqLogger.warn(
        logData,
        `${req.method} ${req.path} ${res.statusCode} ${duration}ms`
      );
    } else {
      reqLogger.info(
        logData,
        `${req.method} ${req.path} ${res.statusCode} ${duration}ms`
      );
    }
  });

  next();
}

/**
 * Log a structured audit event (always at INFO level regardless of LOG_LEVEL).
 */
export function auditLog(event: {
  actor: string;
  action: string;
  resource: string;
  resourceId?: string;
  ip?: string;
  metadata?: Record<string, unknown>;
}) {
  logger.info(
    { audit: true, ...event },
    `AUDIT: ${event.actor} → ${event.action} on ${event.resource}`
  );
}

/**
 * Log a security event (authentication, authorization failures, suspicious activity).
 */
export function securityLog(event: {
  type:
    | "auth_failure"
    | "auth_success"
    | "permission_denied"
    | "rate_limited"
    | "suspicious";
  actor?: string;
  ip?: string;
  resource?: string;
  details?: string;
}) {
  logger.warn(
    { security: true, ...event },
    `SECURITY: ${event.type} — ${event.details ?? ""}`
  );
}

export default logger;
