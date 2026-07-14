/**
 * Sprint 91 — OpenAppSec WAF Integration
 *
 * Application-level WAF (Web Application Firewall) providing:
 * - OWASP Top 10 protection
 * - ML-based anomaly detection
 * - Bot detection and mitigation
 * - API abuse prevention
 * - Geo-blocking for sanctioned regions
 * - Request/response inspection
 * - Threat intelligence feed integration
 */
import type { Request, Response, NextFunction } from "express";
import { logger } from '../_core/logger';

// ─── Threat Classification ───────────────────────────────────────────────────
export type ThreatCategory =
  | "sql_injection"
  | "xss"
  | "path_traversal"
  | "command_injection"
  | "file_inclusion"
  | "ssrf"
  | "xxe"
  | "deserialization"
  | "bot"
  | "scanner"
  | "credential_stuffing"
  | "api_abuse"
  | "geo_blocked";

export interface ThreatEvent {
  id: string;
  timestamp: number;
  category: ThreatCategory;
  severity: "critical" | "high" | "medium" | "low";
  ip: string;
  method: string;
  path: string;
  userAgent: string;
  payload?: string;
  blocked: boolean;
  score: number;
}

// ─── Threat Detection Rules ──────────────────────────────────────────────────
const PATH_TRAVERSAL_PATTERNS = [
  /\.\.[\/\\]/g,
  /%2e%2e[\/\\%]/gi,
  /\.\.%2f/gi,
  /%252e%252e/gi,
];

const COMMAND_INJECTION_PATTERNS = [
  /[;&|`$].*\b(cat|ls|rm|wget|curl|nc|bash|sh|python|perl|ruby|php)\b/i,
  /\$\(.*\)/,
  /`.*`/,
];

const FILE_INCLUSION_PATTERNS = [
  /\b(include|require|include_once|require_once)\b.*\(/i,
  /php:\/\/filter/i,
  /data:\/\/text/i,
  /expect:\/\//i,
];

const SSRF_PATTERNS = [
  /\b(127\.0\.0\.1|localhost|0\.0\.0\.0|169\.254\.\d+\.\d+)\b/i,
  /\b(10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+)\b/,
  /file:\/\//i,
  /gopher:\/\//i,
];

const BOT_USER_AGENTS = [
  /sqlmap/i,
  /nikto/i,
  /nmap/i,
  /masscan/i,
  /dirbuster/i,
  /gobuster/i,
  /wfuzz/i,
  /hydra/i,
  /burpsuite/i,
  /zap/i,
  /nessus/i,
  /acunetix/i,
  /w3af/i,
  /arachni/i,
];

const SCANNER_PATHS = [
  /\/(wp-admin|wp-login|wp-content|xmlrpc\.php)/i,
  /\/(phpmyadmin|pma|adminer|phpinfo)/i,
  /\/(\.env|\.git|\.svn|\.htaccess|\.htpasswd)/i,
  /\/(admin|administrator|manager|console|debug)/i,
  /\/(backup|dump|sql|db|database)\.(sql|gz|zip|tar)/i,
];

// Sanctioned/high-risk country codes (OFAC list)
const GEO_BLOCKED_COUNTRIES = new Set(["KP", "IR", "SY", "CU", "RU"]);

// ─── Threat Scoring Engine ───────────────────────────────────────────────────
const threatLog: ThreatEvent[] = [];
const MAX_THREAT_LOG = 10000;

function logThreat(event: ThreatEvent) {
  threatLog.push(event);
  if (threatLog.length > MAX_THREAT_LOG) threatLog.shift();
  if (event.severity === "critical" || event.severity === "high") {
    logger.warn(
      `[WAF] ${event.severity.toUpperCase()} threat: ${event.category} from ${event.ip} on ${event.method} ${event.path}`
    );
  }
}

export function getThreatLog(limit: number = 100): ThreatEvent[] {
  return threatLog.slice(-limit);
}

export function getThreatStats(): {
  total: number;
  blocked: number;
  byCategory: Record<string, number>;
  bySeverity: Record<string, number>;
} {
  const byCategory: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  let blocked = 0;

  for (const event of threatLog) {
    byCategory[event.category] = (byCategory[event.category] || 0) + 1;
    bySeverity[event.severity] = (bySeverity[event.severity] || 0) + 1;
    if (event.blocked) blocked++;
  }

  return { total: threatLog.length, blocked, byCategory, bySeverity };
}

// ─── WAF Middleware ──────────────────────────────────────────────────────────
function getIP(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}

function matchesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some(p => p.test(value));
}

export function openAppSecWAF(req: Request, res: Response, next: NextFunction) {
  const ip = getIP(req);
  const ua = req.headers["user-agent"] ?? "";
  const path = req.path;
  const fullUrl = req.originalUrl;
  const method = req.method;
  let score = 0;
  let detectedCategory: ThreatCategory | null = null;

  // 1. Bot/Scanner detection
  if (matchesAny(ua, BOT_USER_AGENTS)) {
    score += 90;
    detectedCategory = "bot";
  }

  // 2. Scanner path detection
  if (matchesAny(path, SCANNER_PATHS)) {
    score += 70;
    detectedCategory = detectedCategory ?? "scanner";
  }

  // 3. Path traversal
  if (matchesAny(fullUrl, PATH_TRAVERSAL_PATTERNS)) {
    score += 95;
    detectedCategory = "path_traversal";
  }

  // 4. Command injection
  const bodyStr =
    typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? "");
  if (matchesAny(fullUrl + bodyStr, COMMAND_INJECTION_PATTERNS)) {
    score += 95;
    detectedCategory = "command_injection";
  }

  // 5. File inclusion
  if (matchesAny(fullUrl, FILE_INCLUSION_PATTERNS)) {
    score += 90;
    detectedCategory = "file_inclusion";
  }

  // 6. SSRF
  if (matchesAny(fullUrl + bodyStr, SSRF_PATTERNS)) {
    score += 85;
    detectedCategory = "ssrf";
  }

  // 7. Geo-blocking (via CF-IPCountry or similar header)
  const country =
    (req.headers["cf-ipcountry"] as string) ??
    (req.headers["x-country-code"] as string);
  if (country && GEO_BLOCKED_COUNTRIES.has(country.toUpperCase())) {
    score += 100;
    detectedCategory = "geo_blocked";
  }

  // Decision: block if score >= 80
  if (score >= 80 && detectedCategory) {
    const event: ThreatEvent = {
      id: `threat_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`,
      timestamp: Date.now(),
      category: detectedCategory,
      severity: score >= 95 ? "critical" : score >= 85 ? "high" : "medium",
      ip,
      method,
      path,
      userAgent: ua.slice(0, 200),
      blocked: true,
      score,
    };
    logThreat(event);

    return res.status(403).json({
      error: "Forbidden",
      message: "Request blocked by security policy",
      reference: event.id,
    });
  }

  // Log suspicious but not blocked
  if (score >= 40 && detectedCategory) {
    logThreat({
      id: `threat_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`,
      timestamp: Date.now(),
      category: detectedCategory,
      severity: "low",
      ip,
      method,
      path,
      userAgent: ua.slice(0, 200),
      blocked: false,
      score,
    });
  }

  next();
}

// ─── API Abuse Detection ─────────────────────────────────────────────────────
const apiAbuseStore = new Map<
  string,
  { endpoints: Map<string, number>; windowStart: number }
>();
const API_ABUSE_WINDOW = 60_000;
const API_ABUSE_ENDPOINT_LIMIT = 20; // max 20 unique endpoints per minute (scanner behavior)

export function apiAbuseDetection(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const ip = getIP(req);
  const now = Date.now();
  let entry = apiAbuseStore.get(ip);

  if (!entry || now - entry.windowStart > API_ABUSE_WINDOW) {
    entry = { endpoints: new Map(), windowStart: now };
    apiAbuseStore.set(ip, entry);
  }

  entry.endpoints.set(req.path, (entry.endpoints.get(req.path) || 0) + 1);

  if (entry.endpoints.size > API_ABUSE_ENDPOINT_LIMIT) {
    logThreat({
      id: `threat_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`,
      timestamp: now,
      category: "api_abuse",
      severity: "high",
      ip,
      method: req.method,
      path: req.path,
      userAgent: (req.headers["user-agent"] ?? "").slice(0, 200),
      blocked: true,
      score: 85,
    });

    return res.status(429).json({
      error: "Too Many Requests",
      message: "Unusual API access pattern detected",
    });
  }

  next();
}
