// TypeScript enabled — Sprint 96 security audit
/**
 * Security Hardening Module — 54Link Agency Banking Platform
 *
 * Implements:
 * - Cryptographically secure CSRF token generation
 * - Account lockout after failed login attempts
 * - Structured security event logging
 * - Sensitive data masking in logs
 * - Per-endpoint rate limiting
 * - Request correlation ID propagation
 * - IP reputation tracking
 */
import { randomBytes, createHash } from "crypto";
import type { Request, Response, NextFunction } from "express";
import { logger } from './_core/logger';

// ═══════════════════════════════════════════════════════════════════════════════
// Cryptographically Secure CSRF Token
// ═══════════════════════════════════════════════════════════════════════════════
export function generateSecureCsrfToken(): string {
  return randomBytes(32).toString("hex");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Account Lockout Manager
// ═══════════════════════════════════════════════════════════════════════════════
interface LockoutEntry {
  failedAttempts: number;
  lockedUntil: number | null;
  lastAttempt: number;
}

const lockoutStore = new Map<string, LockoutEntry>();
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const ATTEMPT_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

export function isAccountLocked(identifier: string): {
  locked: boolean;
  remainingMs: number;
} {
  const entry = lockoutStore.get(identifier);
  if (!entry) return { locked: false, remainingMs: 0 };

  const now = Date.now();

  // Check if lockout has expired
  if (entry.lockedUntil && entry.lockedUntil > now) {
    return { locked: true, remainingMs: entry.lockedUntil - now };
  }

  // Reset if lockout expired
  if (entry.lockedUntil && entry.lockedUntil <= now) {
    lockoutStore.delete(identifier);
    return { locked: false, remainingMs: 0 };
  }

  return { locked: false, remainingMs: 0 };
}

export function recordFailedLogin(identifier: string): {
  locked: boolean;
  attemptsRemaining: number;
} {
  const now = Date.now();
  const entry = lockoutStore.get(identifier) || {
    failedAttempts: 0,
    lockedUntil: null,
    lastAttempt: 0,
  };

  // Reset counter if outside the attempt window
  if (now - entry.lastAttempt > ATTEMPT_WINDOW_MS) {
    entry.failedAttempts = 0;
  }

  entry.failedAttempts++;
  entry.lastAttempt = now;

  if (entry.failedAttempts >= MAX_FAILED_ATTEMPTS) {
    entry.lockedUntil = now + LOCKOUT_DURATION_MS;
    lockoutStore.set(identifier, entry);
    logSecurityEvent("ACCOUNT_LOCKED", {
      identifier,
      attempts: entry.failedAttempts,
    });
    return { locked: true, attemptsRemaining: 0 };
  }

  lockoutStore.set(identifier, entry);
  return {
    locked: false,
    attemptsRemaining: MAX_FAILED_ATTEMPTS - entry.failedAttempts,
  };
}

export function clearFailedLogins(identifier: string): void {
  lockoutStore.delete(identifier);
}

// Cleanup expired entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of Array.from(lockoutStore.entries())) {
    if (entry.lockedUntil && entry.lockedUntil < now) {
      lockoutStore.delete(key);
    } else if (now - entry.lastAttempt > ATTEMPT_WINDOW_MS) {
      lockoutStore.delete(key);
    }
  }
}, 600_000);

// ═══════════════════════════════════════════════════════════════════════════════
// Structured Security Event Logger
// ═══════════════════════════════════════════════════════════════════════════════
export type SecurityEventType =
  | "LOGIN_SUCCESS"
  | "LOGIN_FAILED"
  | "ACCOUNT_LOCKED"
  | "LOGOUT"
  | "CSRF_VIOLATION"
  | "RATE_LIMIT_EXCEEDED"
  | "UNAUTHORIZED_ACCESS"
  | "FORBIDDEN_ACCESS"
  | "SUSPICIOUS_INPUT"
  | "SESSION_EXPIRED"
  | "PASSWORD_CHANGED"
  | "ROLE_ESCALATION_ATTEMPT"
  | "DATA_EXPORT"
  | "ADMIN_ACTION"
  | "API_KEY_USED"
  | "IP_BLOCKED";

interface SecurityEvent {
  timestamp: string;
  event: SecurityEventType;
  severity: "info" | "warning" | "critical";
  correlationId?: string;
  ip?: string;
  userId?: string;
  userAgent?: string;
  details: Record<string, unknown>;
}

const securityEventLog: SecurityEvent[] = [];
const MAX_LOG_SIZE = 10_000;

export function logSecurityEvent(
  event: SecurityEventType,
  details: Record<string, unknown> = {},
  req?: Request
): void {
  const severity = getSeverity(event);
  const entry: SecurityEvent = {
    timestamp: new Date().toISOString(),
    event,
    severity,
    correlationId: req?.headers?.["x-request-id"] as string,
    ip: req
      ? maskIp(req.ip || req.socket.remoteAddress || "unknown")
      : undefined,
    userId: details.userId as string,
    userAgent: req?.headers?.["user-agent"]?.substring(0, 100),
    details: maskSensitiveData(details),
  };

  securityEventLog.push(entry);
  if (securityEventLog.length > MAX_LOG_SIZE) {
    securityEventLog.splice(0, securityEventLog.length - MAX_LOG_SIZE);
  }

  // Log to stdout in structured format
  const logLine = JSON.stringify(entry);
  if (severity === "critical") {
    logger.error(`[SECURITY:${severity.toUpperCase()}] ${logLine}`);
  } else if (severity === "warning") {
    logger.warn(`[SECURITY:${severity.toUpperCase()}] ${logLine}`);
  }
}

function getSeverity(
  event: SecurityEventType
): "info" | "warning" | "critical" {
  switch (event) {
    case "ACCOUNT_LOCKED":
    case "ROLE_ESCALATION_ATTEMPT":
    case "IP_BLOCKED":
      return "critical";
    case "LOGIN_FAILED":
    case "CSRF_VIOLATION":
    case "RATE_LIMIT_EXCEEDED":
    case "UNAUTHORIZED_ACCESS":
    case "FORBIDDEN_ACCESS":
    case "SUSPICIOUS_INPUT":
      return "warning";
    default:
      return "info";
  }
}

export function getSecurityEvents(options?: {
  limit?: number;
  severity?: "info" | "warning" | "critical";
  event?: SecurityEventType;
  since?: Date;
}): SecurityEvent[] {
  let events = [...securityEventLog];

  if (options?.severity) {
    events = events.filter(e => e.severity === options.severity);
  }
  if (options?.event) {
    events = events.filter(e => e.event === options.event);
  }
  if (options?.since) {
    const sinceStr = options.since.toISOString();
    events = events.filter(e => e.timestamp >= sinceStr);
  }

  events.reverse(); // newest first
  return events.slice(0, options?.limit || 100);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sensitive Data Masking
// ═══════════════════════════════════════════════════════════════════════════════
const SENSITIVE_KEYS = new Set([
  "password",
  "pin",
  "secret",
  "token",
  "apiKey",
  "api_key",
  "authorization",
  "cookie",
  "session",
  "credit_card",
  "ssn",
  "bvn",
  "nin",
  "passport",
  "account_number",
  "accountNumber",
]);

export function maskSensitiveData(
  data: Record<string, unknown>
): Record<string, unknown> {
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      masked[key] =
        typeof value === "string" ? maskString(value) : "[REDACTED]";
    } else if (typeof value === "string" && isEmail(value)) {
      masked[key] = maskEmail(value);
    } else if (typeof value === "string" && isPhoneNumber(value)) {
      masked[key] = maskPhone(value);
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      masked[key] = maskSensitiveData(value as Record<string, unknown>);
    } else {
      masked[key] = value;
    }
  }
  return masked;
}

function maskString(s: string): string {
  if (s.length <= 4) return "****";
  return (
    s.substring(0, 2) + "*".repeat(s.length - 4) + s.substring(s.length - 2)
  );
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return maskString(email);
  return local.substring(0, 2) + "***@" + domain;
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return "****";
  return phone.substring(0, 4) + "****" + phone.substring(phone.length - 2);
}

function maskIp(ip: string): string {
  // Mask last octet for privacy
  const parts = ip.split(".");
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.${parts[2]}.***`;
  }
  return ip.substring(0, ip.length / 2) + "***";
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function isPhoneNumber(s: string): boolean {
  return /^\+?\d{10,15}$/.test(s.replace(/[\s\-()]/g, ""));
}

// ═══════════════════════════════════════════════════════════════════════════════
// Per-Endpoint Rate Limiting
// ═══════════════════════════════════════════════════════════════════════════════
interface EndpointRateConfig {
  windowMs: number;
  maxRequests: number;
}

const endpointRateLimits: Record<string, EndpointRateConfig> = {
  "/api/trpc/agent.login": { windowMs: 60_000, maxRequests: 5 },
  "/api/trpc/auth.logout": { windowMs: 60_000, maxRequests: 10 },
  "/api/trpc/pinReset": { windowMs: 300_000, maxRequests: 3 },
  "/api/trpc/inviteCodes.validate": { windowMs: 60_000, maxRequests: 10 },
  "/api/trpc/partnerOnboarding": { windowMs: 300_000, maxRequests: 5 },
  "/api/health": { windowMs: 60_000, maxRequests: 60 },
};

const endpointStore = new Map<
  string,
  Map<string, { count: number; resetAt: number }>
>();

export function endpointRateLimit() {
  // Cleanup every 5 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [, ipMap] of Array.from(endpointStore.entries())) {
      for (const [ip, entry] of Array.from(ipMap.entries())) {
        if (entry.resetAt < now) ipMap.delete(ip);
      }
    }
  }, 300_000);

  return (req: Request, res: Response, next: NextFunction) => {
    // Find matching endpoint config
    const path = req.path;
    let config: EndpointRateConfig | undefined;
    for (const [pattern, cfg] of Object.entries(endpointRateLimits)) {
      if (path.startsWith(pattern)) {
        config = cfg;
        break;
      }
    }

    if (!config) return next();

    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const key = path;

    if (!endpointStore.has(key)) {
      endpointStore.set(key, new Map());
    }
    const ipMap = endpointStore.get(key)!;
    const now = Date.now();
    const entry = ipMap.get(ip);

    if (!entry || entry.resetAt < now) {
      ipMap.set(ip, { count: 1, resetAt: now + config.windowMs });
      return next();
    }

    entry.count++;
    if (entry.count > config.maxRequests) {
      logSecurityEvent(
        "RATE_LIMIT_EXCEEDED",
        { endpoint: path, ip: maskIp(ip), count: entry.count },
        req
      );
      res.setHeader("Retry-After", Math.ceil((entry.resetAt - now) / 1000));
      return res.status(429).json({
        error: "Rate limit exceeded for this endpoint",
        retryAfter: Math.ceil((entry.resetAt - now) / 1000),
      });
    }

    next();
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Request Correlation ID
// ═══════════════════════════════════════════════════════════════════════════════
export function correlationId() {
  return (req: Request, res: Response, next: NextFunction) => {
    const id =
      (req.headers["x-request-id"] as string) ||
      randomBytes(16).toString("hex");
    req.headers["x-request-id"] = id;
    res.setHeader("X-Request-ID", id);
    next();
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// IP Reputation Tracker
// ═══════════════════════════════════════════════════════════════════════════════
interface IpReputation {
  score: number; // 0-100, lower = worse
  violations: number;
  lastViolation: number;
}

const ipReputationStore = new Map<string, IpReputation>();

export function recordIpViolation(
  ip: string,
  severity: "low" | "medium" | "high"
): void {
  const entry = ipReputationStore.get(ip) || {
    score: 100,
    violations: 0,
    lastViolation: 0,
  };
  const deduction = severity === "high" ? 30 : severity === "medium" ? 15 : 5;
  entry.score = Math.max(0, entry.score - deduction);
  entry.violations++;
  entry.lastViolation = Date.now();
  ipReputationStore.set(ip, entry);

  if (entry.score <= 20) {
    logSecurityEvent("IP_BLOCKED", {
      ip: maskIp(ip),
      score: entry.score,
      violations: entry.violations,
    });
  }
}

export function getIpReputation(ip: string): IpReputation {
  return (
    ipReputationStore.get(ip) || { score: 100, violations: 0, lastViolation: 0 }
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Security Summary for Dashboard
// ═══════════════════════════════════════════════════════════════════════════════
export function getSecuritySummary(): {
  totalEvents: number;
  criticalEvents: number;
  warningEvents: number;
  lockedAccounts: number;
  blockedIps: number;
  recentEvents: SecurityEvent[];
} {
  const now = Date.now();
  const last24h = securityEventLog.filter(
    e => new Date(e.timestamp).getTime() > now - 86_400_000
  );

  let lockedAccounts = 0;
  for (const [, entry] of Array.from(lockoutStore.entries())) {
    if (entry.lockedUntil && entry.lockedUntil > now) lockedAccounts++;
  }

  let blockedIps = 0;
  for (const [, rep] of Array.from(ipReputationStore.entries())) {
    if (rep.score <= 20) blockedIps++;
  }

  return {
    totalEvents: last24h.length,
    criticalEvents: last24h.filter(e => e.severity === "critical").length,
    warningEvents: last24h.filter(e => e.severity === "warning").length,
    lockedAccounts,
    blockedIps,
    recentEvents: last24h.slice(-20).reverse(),
  };
}
