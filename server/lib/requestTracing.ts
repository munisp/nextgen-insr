// TypeScript enabled — Sprint 96 security audit
/**
 * Request Tracing Middleware
 *
 * Adds X-Request-ID header to all requests for distributed tracing.
 * If the client sends an X-Request-ID, it is preserved; otherwise a new UUID is generated.
 */
import { randomUUID } from "crypto";

import type { Request, Response, NextFunction } from "express";

export function requestTracingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const requestId = (req.headers["x-request-id"] as string) || randomUUID();
  req.headers["x-request-id"] = requestId;
  res.setHeader("X-Request-ID", requestId);
  res.setHeader("X-Response-Time-Start", Date.now().toString());

  // Capture response time
  const start = process.hrtime.bigint();
  const originalEnd = res.end.bind(res);
  res.end = function (...args: Parameters<typeof originalEnd>) {
    const duration = Number(process.hrtime.bigint() - start) / 1e6; // ms
    res.setHeader("X-Response-Time", `${duration.toFixed(2)}ms`);
    return originalEnd(...args);
  } as typeof res.end;

  next();
}

/**
 * Security headers middleware
 * Adds comprehensive security headers to all responses
 */
export function securityHeadersMiddleware(
  _req: Request,
  res: Response,
  next: NextFunction
) {
  // Prevent MIME type sniffing
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Prevent clickjacking
  res.setHeader("X-Frame-Options", "DENY");
  // XSS Protection (legacy browsers)
  res.setHeader("X-XSS-Protection", "1; mode=block");
  // Referrer policy
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  // Permissions policy
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(self), payment=(self)"
  );
  // Content Security Policy
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://fonts.googleapis.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' wss: https:",
      "frame-ancestors 'none'",
    ].join("; ")
  );
  // Strict Transport Security
  res.setHeader(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains; preload"
  );
  // Cache control for API responses
  if (_req.path.startsWith("/api/")) {
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate"
    );
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }

  next();
}

/**
 * Input sanitization helper
 * Strips potential XSS vectors from string inputs
 */
export function sanitizeInput(input: string): string {
  return input
    .replace(/[<>]/g, "") // Remove angle brackets
    .replace(/javascript:/gi, "") // Remove javascript: protocol
    .replace(/on\w+\s*=/gi, "") // Remove inline event handlers
    .replace(/data:\s*text\/html/gi, "") // Remove data:text/html
    .trim();
}

/**
 * Rate limit key generator
 * Creates a composite key from IP + user ID for rate limiting
 */
export function getRateLimitKey(req: Request): string {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const userId = (req as any).userId || "anonymous";
  return `${ip}:${userId}`;
}
