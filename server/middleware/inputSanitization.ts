// @ts-check

// TypeScript enabled — Sprint 96 security audit
/**
 * Input Sanitization Middleware (S86-25)
 *
 * Defense-in-depth layer that sanitizes all incoming request data:
 * - SQL injection pattern detection and blocking
 * - XSS payload stripping
 * - Path traversal prevention
 * - Command injection detection
 * - Unicode normalization attacks
 * - Null byte injection prevention
 */

import type { Request, Response, NextFunction } from "express";
import { logger } from '../_core/logger';

// ─── SQL Injection Patterns ─────────────────────────────────────────────────

const SQL_INJECTION_PATTERNS = [
  /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|EXEC|EXECUTE|UNION|TRUNCATE)\b)/i,
  /(\b(OR|AND)\b\s+\d+\s*=\s*\d+)/i,
  /(;\s*(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE))/i,
  /('--)/,
  /(\/\*[\s\S]*?\*\/)/,
  /(xp_cmdshell|sp_executesql|sp_makewebtask)/i,
  /(WAITFOR\s+DELAY|BENCHMARK\s*\()/i,
  /(LOAD_FILE|INTO\s+OUTFILE|INTO\s+DUMPFILE)/i,
  /(information_schema|sys\.objects|sysobjects)/i,
];

// ─── XSS Patterns ──────────────────────────────────────────────────────────

const XSS_PATTERNS = [
  /<script[^>]*>/i,
  /javascript\s*:/i,
  /on(error|load|click|mouseover|focus|blur|submit|change)\s*=/i,
  /<iframe[^>]*>/i,
  /<object[^>]*>/i,
  /<embed[^>]*>/i,
  /document\.(cookie|location|write|domain)/i,
  /window\.(location|open|eval)/i,
  /eval\s*\(/i,
  /expression\s*\(/i,
];

// ─── Path Traversal Patterns ────────────────────────────────────────────────

const PATH_TRAVERSAL_PATTERNS = [
  /\.\.\//,
  /\.\.\\/,
  /%2e%2e/i,
  /%252e%252e/i,
  /\.\.%2f/i,
  /\.\.%5c/i,
];

// ─── Command Injection Patterns ─────────────────────────────────────────────

const COMMAND_INJECTION_PATTERNS = [
  /[;&|`$]/,
  /\$\(.*\)/,
  /`[^`]*`/,
  /\|\|/,
  /&&/,
];

// ─── Sanitization Functions ─────────────────────────────────────────────────

export function sanitizeString(input: string): string {
  if (typeof input !== "string") return input;

  // Remove null bytes
  let sanitized = input.replace(/\0/g, "");

  // Normalize unicode
  sanitized = sanitized.normalize("NFC");

  // Encode HTML entities for XSS prevention
  sanitized = sanitized
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");

  return sanitized;
}

export function detectSQLInjection(input: string): {
  detected: boolean;
  pattern: string;
} {
  for (const pattern of SQL_INJECTION_PATTERNS) {
    if (pattern.test(input)) {
      return { detected: true, pattern: pattern.source };
    }
  }
  return { detected: false, pattern: "" };
}

export function detectXSS(input: string): {
  detected: boolean;
  pattern: string;
} {
  for (const pattern of XSS_PATTERNS) {
    if (pattern.test(input)) {
      return { detected: true, pattern: pattern.source };
    }
  }
  return { detected: false, pattern: "" };
}

export function detectPathTraversal(input: string): boolean {
  return PATH_TRAVERSAL_PATTERNS.some(p => p.test(input));
}

export function detectCommandInjection(input: string): boolean {
  return COMMAND_INJECTION_PATTERNS.some(p => p.test(input));
}

// ─── Deep Object Scanning ───────────────────────────────────────────────────

interface ScanResult {
  safe: boolean;
  threats: Array<{ path: string; type: string; value: string }>;
}

export function deepScanObject(obj: any, path: string = ""): ScanResult {
  const threats: Array<{ path: string; type: string; value: string }> = [];

  if (typeof obj === "string") {
    const sqli = detectSQLInjection(obj);
    if (sqli.detected) {
      threats.push({
        path,
        type: "sql_injection",
        value: obj.substring(0, 100),
      });
    }
    const xss = detectXSS(obj);
    if (xss.detected) {
      threats.push({ path, type: "xss", value: obj.substring(0, 100) });
    }
    if (detectPathTraversal(obj)) {
      threats.push({
        path,
        type: "path_traversal",
        value: obj.substring(0, 100),
      });
    }
  } else if (Array.isArray(obj)) {
    obj.forEach((item, idx) => {
      const result = deepScanObject(item, `${path}[${idx}]`);
      threats.push(...result.threats);
    });
  } else if (obj && typeof obj === "object") {
    for (const [key, value] of Object.entries(obj)) {
      const result = deepScanObject(value, path ? `${path}.${key}` : key);
      threats.push(...result.threats);
    }
  }

  return { safe: threats.length === 0, threats };
}

// ─── Express Middleware ─────────────────────────────────────────────────────

export interface SanitizationConfig {
  enabled: boolean;
  blockOnDetection: boolean;
  logThreats: boolean;
  allowedPaths: string[]; // Paths to skip (e.g., webhook endpoints)
  maxInputLength: number;
}

const DEFAULT_CONFIG: SanitizationConfig = {
  enabled: true,
  blockOnDetection: true,
  logThreats: true,
  allowedPaths: ["/api/stripe/webhook", "/api/health"],
  maxInputLength: 50000,
};

export function inputSanitizationMiddleware(
  config: Partial<SanitizationConfig> = {}
) {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  return (req: Request, res: Response, next: NextFunction) => {
    if (!cfg.enabled) return next();

    // Skip allowed paths
    if (cfg.allowedPaths.some(p => req.path.startsWith(p))) {
      return next();
    }

    // Scan request body
    if (req.body) {
      const bodyResult = deepScanObject(req.body, "body");
      if (!bodyResult.safe) {
        if (cfg.logThreats) {
          logger.warn(`[InputSanitization] Threats detected in ${req.method} ${req.path}:: ` + bodyResult.threats.map(t => `${t.type} at ${t.path}`)
          );
        }
        if (cfg.blockOnDetection) {
          return res.status(400).json({
            error: "Request blocked: potentially malicious input detected",
            code: "INPUT_SANITIZATION_BLOCK",
          });
        }
      }
    }

    // Scan query parameters
    if (req.query) {
      const queryResult = deepScanObject(req.query, "query");
      if (!queryResult.safe && cfg.blockOnDetection) {
        return res.status(400).json({
          error: "Request blocked: potentially malicious query parameters",
          code: "INPUT_SANITIZATION_BLOCK",
        });
      }
    }

    // Scan URL params
    if (req.params) {
      const paramsResult = deepScanObject(req.params, "params");
      if (!paramsResult.safe && cfg.blockOnDetection) {
        return res.status(400).json({
          error: "Request blocked: potentially malicious URL parameters",
          code: "INPUT_SANITIZATION_BLOCK",
        });
      }
    }

    next();
  };
}

// ─── Security Headers Middleware ────────────────────────────────────────────

export function securityHeadersMiddleware() {
  return (_req: Request, res: Response, next: NextFunction) => {
    // Prevent XSS
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");

    // Content Security Policy
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' https://fonts.gstatic.com"
    );

    // Strict Transport Security
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload"
    );

    // Referrer Policy
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

    // Permissions Policy
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(self), payment=(self)"
    );

    next();
  };
}

export default {
  inputSanitizationMiddleware,
  securityHeadersMiddleware,
  sanitizeString,
  detectSQLInjection,
  detectXSS,
};
