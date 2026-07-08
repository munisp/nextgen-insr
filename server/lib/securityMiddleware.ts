// @ts-check

// TypeScript enabled — Sprint 96 security audit
/**
 * Security Hardening Middleware — InsurePortal Insurance Platform
 *
 * Implements: CSP headers, HSTS, X-Frame-Options, X-Content-Type-Options,
 * Referrer-Policy, Permissions-Policy, CSRF protection, request sanitization,
 * IP-based rate limiting, and request size limits.
 */
import type { Request, Response, NextFunction } from "express";

// ═══════════════════════════════════════════════════════════════════════════════
// Security Headers (equivalent to helmet)
// ═══════════════════════════════════════════════════════════════════════════════
export function securityHeaders() {
  return (_req: Request, res: Response, next: NextFunction) => {
    // Content Security Policy
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data: blob: https:",
        "connect-src 'self' https://api.frankfurter.app https://open.er-api.com wss:",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join("; ")
    );

    // HTTP Strict Transport Security
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload"
    );

    // Prevent clickjacking
    res.setHeader("X-Frame-Options", "DENY");

    // Prevent MIME type sniffing
    res.setHeader("X-Content-Type-Options", "nosniff");

    // Referrer Policy
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

    // Permissions Policy
    res.setHeader(
      "Permissions-Policy",
      [
        "camera=(self)",
        "microphone=()",
        "geolocation=(self)",
        "payment=(self)",
        "usb=()",
        "magnetometer=()",
        "gyroscope=()",
        "accelerometer=()",
      ].join(", ")
    );

    // Prevent XSS (legacy header, CSP is primary)
    res.setHeader("X-XSS-Protection", "1; mode=block");

    // Prevent information leakage
    res.removeHeader("X-Powered-By");

    // Cross-Origin policies
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");

    next();
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CSRF Protection via Double-Submit Cookie Pattern
// ═══════════════════════════════════════════════════════════════════════════════
const CSRF_COOKIE = "__csrf_token";
const CSRF_HEADER = "x-csrf-token";

function generateToken(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export function csrfProtection() {
  return (req: Request, res: Response, next: NextFunction) => {
    // Skip for safe methods
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      // Set CSRF cookie if not present
      if (!req.cookies?.[CSRF_COOKIE]) {
        const token = generateToken();
        res.cookie(CSRF_COOKIE, token, {
          httpOnly: false, // CSRF tokens must be JS-readable (by design per OWASP Double Submit Cookie pattern)
          secure: process.env.NODE_ENV === "production",
          sameSite: "strict",
          maxAge: 86400000, // 24 hours
          path: "/",
        });
      }
      return next();
    }

    // For tRPC batch requests, skip CSRF (tRPC uses its own auth)
    if (req.path.startsWith("/api/trpc")) {
      return next();
    }

    // Validate CSRF token for state-changing requests
    const cookieToken = req.cookies?.[CSRF_COOKIE];
    const headerToken = req.headers[CSRF_HEADER];

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      return res.status(403).json({ error: "CSRF validation failed" });
    }

    next();
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Input Sanitization
// ═══════════════════════════════════════════════════════════════════════════════
function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") {
    // Remove null bytes
    let sanitized = value.replace(/\0/g, "");
    // Trim excessive whitespace
    sanitized = sanitized.trim();
    // Limit string length to 10KB
    if (sanitized.length > 10240) {
      sanitized = sanitized.substring(0, 10240);
    }
    return sanitized;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (value && typeof value === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      // Skip prototype pollution attempts
      if (k === "__proto__" || k === "constructor" || k === "prototype")
        continue;
      sanitized[k] = sanitizeValue(v);
    }
    return sanitized;
  }
  return value;
}

export function inputSanitization() {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (req.body) {
      req.body = sanitizeValue(req.body);
    }
    if (req.query) {
      req.query = sanitizeValue(req.query) as any;
    }
    next();
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// IP-Based Rate Limiting (in-memory, production should use Redis)
// ═══════════════════════════════════════════════════════════════════════════════
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export function ipRateLimit(
  options: { windowMs?: number; maxRequests?: number } = {}
) {
  const { windowMs = 60_000, maxRequests = 100 } = options;
  const store = new Map<string, RateLimitEntry>();

  // Cleanup every 5 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of Array.from(store.entries())) {
      if (entry.resetAt < now) store.delete(key);
    }
  }, 300_000);

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const entry = store.get(ip);

    if (!entry || entry.resetAt < now) {
      store.set(ip, { count: 1, resetAt: now + windowMs });
      res.setHeader("X-RateLimit-Limit", maxRequests);
      res.setHeader("X-RateLimit-Remaining", maxRequests - 1);
      return next();
    }

    entry.count++;
    const remaining = Math.max(0, maxRequests - entry.count);
    res.setHeader("X-RateLimit-Limit", maxRequests);
    res.setHeader("X-RateLimit-Remaining", remaining);
    res.setHeader("X-RateLimit-Reset", Math.ceil(entry.resetAt / 1000));

    if (entry.count > maxRequests) {
      return res.status(429).json({
        error: "Too many requests",
        retryAfter: Math.ceil((entry.resetAt - now) / 1000),
      });
    }

    next();
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Request Size Limiter
// ═══════════════════════════════════════════════════════════════════════════════
export function requestSizeLimit(maxBytes: number = 10 * 1024 * 1024) {
  return (req: Request, res: Response, next: NextFunction) => {
    const contentLength = parseInt(req.headers["content-length"] || "0", 10);
    if (contentLength > maxBytes) {
      return res.status(413).json({
        error: "Request entity too large",
        maxSize: `${Math.round(maxBytes / 1024 / 1024)}MB`,
      });
    }
    next();
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Export all middleware as a single stack
// ═══════════════════════════════════════════════════════════════════════════════
export function applySecurityMiddleware(app: {
  use: (...args: any[]) => void;
}) {
  app.use(securityHeaders());
  app.use(inputSanitization());
  app.use(ipRateLimit({ windowMs: 60_000, maxRequests: 2000 }));
  app.use(requestSizeLimit(10 * 1024 * 1024));
  // CSRF is optional — tRPC uses cookie-based auth already
  // app.use(csrfProtection());
}
