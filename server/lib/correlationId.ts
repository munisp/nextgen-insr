// @ts-check

// TypeScript enabled — Sprint 96 security audit
/**
 * Request Correlation ID & Structured Logging — InsurePortal Insurance Platform
 *
 * F16: Correlation ID propagation across all middleware
 * F17: Structured JSON logging with levels and rotation
 * F20: API versioning middleware
 */
import { randomUUID } from "crypto";
import type { Request, Response, NextFunction } from "express";

// ═══════════════════════════════════════════════════════════════════════════════
// F16: Correlation ID Middleware
// ═══════════════════════════════════════════════════════════════════════════════

const CORRELATION_HEADER = "X-Correlation-ID";
const REQUEST_ID_HEADER = "X-Request-ID";

export function correlationIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const correlationId =
    (req.headers[CORRELATION_HEADER.toLowerCase()] as string) ?? randomUUID();
  const requestId = randomUUID();

  // Attach to request for downstream use
  (req as any).correlationId = correlationId;
  (req as any).requestId = requestId;

  // Set response headers
  res.setHeader(CORRELATION_HEADER, correlationId);
  res.setHeader(REQUEST_ID_HEADER, requestId);

  next();
}

export function getCorrelationId(req: Request): string {
  return (req as any).correlationId ?? "unknown";
}

export function getRequestId(req: Request): string {
  return (req as any).requestId ?? "unknown";
}

// ═══════════════════════════════════════════════════════════════════════════════
// F17: Structured JSON Logger
// ═══════════════════════════════════════════════════════════════════════════════

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? "info";

export interface StructuredLog {
  timestamp: string;
  level: LogLevel;
  message: string;
  service: string;
  correlationId?: string;
  requestId?: string;
  userId?: string;
  duration?: number;
  error?: { message: string; stack?: string; code?: string };
  metadata?: Record<string, unknown>;
}

export function createLogger(service: string) {
  function log(
    level: LogLevel,
    message: string,
    extra?: Partial<StructuredLog>
  ) {
    if (LOG_LEVELS[level] < LOG_LEVELS[currentLevel]) return;

    const entry: StructuredLog = {
      timestamp: new Date().toISOString(),
      level,
      message,
      service,
      ...extra,
    };

    const output = JSON.stringify(entry);

    if (level === "error" || level === "fatal") {
      process.stderr.write(output + "\n");
    } else {
      process.stdout.write(output + "\n");
    }
  }

  return {
    debug: (msg: string, extra?: Partial<StructuredLog>) =>
      log("debug", msg, extra),
    info: (msg: string, extra?: Partial<StructuredLog>) =>
      log("info", msg, extra),
    warn: (msg: string, extra?: Partial<StructuredLog>) =>
      log("warn", msg, extra),
    error: (msg: string, extra?: Partial<StructuredLog>) =>
      log("error", msg, extra),
    fatal: (msg: string, extra?: Partial<StructuredLog>) =>
      log("fatal", msg, extra),
  };
}

// ── Request Logging Middleware ───────────────────────────────────────────

const requestLogger = createLogger("http");

export function requestLoggingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    const level: LogLevel =
      res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";

    requestLogger[level](`${req.method} ${req.path} ${res.statusCode}`, {
      correlationId: getCorrelationId(req),
      requestId: getRequestId(req),
      userId: (req as any).user?.id?.toString(),
      duration,
      metadata: {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        contentLength: res.getHeader("content-length"),
        userAgent: req.headers["user-agent"],
        ip: req.ip,
      },
    });
  });

  next();
}

// ═══════════════════════════════════════════════════════════════════════════════
// F20: API Versioning Middleware
// ═══════════════════════════════════════════════════════════════════════════════

const API_VERSION_HEADER = "X-API-Version";
const SUPPORTED_VERSIONS = ["v1", "v2"];
const DEFAULT_VERSION = "v1";

export function apiVersionMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const requestedVersion =
    (req.headers[API_VERSION_HEADER.toLowerCase()] as string) ??
    DEFAULT_VERSION;
  const version = SUPPORTED_VERSIONS.includes(requestedVersion)
    ? requestedVersion
    : DEFAULT_VERSION;

  (req as any).apiVersion = version;
  res.setHeader(API_VERSION_HEADER, version);
  res.setHeader("X-API-Supported-Versions", SUPPORTED_VERSIONS.join(", "));

  // Deprecation warning for v1
  if (version === "v1") {
    res.setHeader("Deprecation", "true");
    res.setHeader("Sunset", "2027-01-01");
  }

  next();
}

export function getApiVersion(req: Request): string {
  return (req as any).apiVersion ?? DEFAULT_VERSION;
}
