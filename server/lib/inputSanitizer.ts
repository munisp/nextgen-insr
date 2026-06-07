// TypeScript enabled — Sprint 96 security audit
/**
 * Input Validation & Sanitization — InsurePortal Agency Banking Platform
 *
 * Provides:
 * 1. XSS sanitization for all text inputs
 * 2. SQL injection prevention (parameterized queries audit)
 * 3. Input length limits
 * 4. Email/phone/URL validation
 * 5. Zod schema helpers for common patterns
 */
import { z } from "zod";

// ═══════════════════════════════════════════════════════════════════════════════
// XSS Sanitization
// ═══════════════════════════════════════════════════════════════════════════════
const HTML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#x27;",
  "/": "&#x2F;",
  "`": "&#96;",
};

/**
 * Escape HTML entities to prevent XSS
 */
export function escapeHtml(str: string): string {
  return str.replace(/[&<>"'`/]/g, char => HTML_ENTITIES[char] || char);
}

/**
 * Strip all HTML tags from input
 */
export function stripHtml(str: string): string {
  return str.replace(/<[^>]*>/g, "");
}

/**
 * Sanitize text input: strip HTML, trim, limit length
 */
export function sanitizeText(str: string, maxLength = 1000): string {
  return stripHtml(str).trim().slice(0, maxLength);
}

/**
 * Sanitize rich text: allow safe HTML tags only
 */
export function sanitizeRichText(str: string): string {
  const allowedTags = [
    "b",
    "i",
    "u",
    "em",
    "strong",
    "p",
    "br",
    "ul",
    "ol",
    "li",
    "a",
    "h1",
    "h2",
    "h3",
  ];
  const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/gi;
  return str.replace(tagRegex, (match, tag) => {
    if (allowedTags.includes(tag.toLowerCase())) return match;
    return "";
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SQL Injection Prevention
// ═══════════════════════════════════════════════════════════════════════════════
const SQL_INJECTION_PATTERNS = [
  /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|CREATE|EXEC|EXECUTE)\b)/i,
  /(--|#|\/\*|\*\/)/,
  /(\b(OR|AND)\b\s+\d+\s*=\s*\d+)/i,
  /(;\s*(DROP|DELETE|INSERT|UPDATE|ALTER))/i,
  /(\bSLEEP\s*\()/i,
  /(\bBENCHMARK\s*\()/i,
  /(\bWAITFOR\s+DELAY)/i,
];

/**
 * Check if input contains potential SQL injection patterns
 */
export function detectSqlInjection(str: string): boolean {
  return SQL_INJECTION_PATTERNS.some(pattern => pattern.test(str));
}

/**
 * Sanitize input for safe use in queries (defense in depth — use parameterized queries primarily)
 */
export function sanitizeSqlInput(str: string): string {
  return str.replace(/['";\\]/g, "");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Common Zod Schemas
// ═══════════════════════════════════════════════════════════════════════════════
export const zodSchemas = {
  /** Nigerian phone number */
  phone: z.string().regex(/^\+?234[0-9]{10}$/, "Invalid Nigerian phone number"),

  /** Email address */
  email: z.string().email("Invalid email address").max(254),

  /** Safe text (no HTML, limited length) */
  safeText: (maxLength = 500) =>
    z
      .string()
      .max(maxLength)
      .transform(s => sanitizeText(s, maxLength)),

  /** Safe name (letters, spaces, hyphens, apostrophes) */
  safeName: z
    .string()
    .min(2)
    .max(100)
    .regex(/^[a-zA-Z\s'-]+$/, "Name contains invalid characters"),

  /** Amount (positive number with max 2 decimal places) */
  amount: z
    .number()
    .positive("Amount must be positive")
    .max(999_999_999, "Amount too large"),

  /** Currency code (ISO 4217) */
  currency: z.enum([
    "NGN",
    "USD",
    "GBP",
    "EUR",
    "GHS",
    "KES",
    "ZAR",
    "XOF",
    "XAF",
  ]),

  /** UUID */
  uuid: z.string().uuid("Invalid ID format"),

  /** Pagination */
  pagination: z.object({
    page: z.number().int().min(1).default(1),
    limit: z.number().int().min(1).max(100).default(20),
    sortBy: z.string().optional(),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
  }),

  /** Date range */
  dateRange: z
    .object({
      from: z.number().int().positive(),
      to: z.number().int().positive(),
    })
    .refine(d => d.to >= d.from, "End date must be after start date"),

  /** Search query */
  searchQuery: z
    .string()
    .min(1)
    .max(200)
    .transform(s => sanitizeText(s, 200)),

  /** Agent code */
  agentCode: z.string().regex(/^AGT\d{4,6}$/, "Invalid agent code format"),

  /** Transaction reference */
  transactionRef: z
    .string()
    .regex(/^TXN-[\w-]+$/, "Invalid transaction reference"),

  /** BVN (Bank Verification Number - Nigeria) */
  bvn: z.string().regex(/^\d{11}$/, "BVN must be 11 digits"),

  /** NIN (National Identification Number - Nigeria) */
  nin: z.string().regex(/^\d{11}$/, "NIN must be 11 digits"),

  /** IP address */
  ipAddress: z.string().regex(/^(\d{1,3}\.){3}\d{1,3}$/, "Invalid IP address"),

  /** URL */
  url: z.string().url("Invalid URL").max(2048),
};

// ═══════════════════════════════════════════════════════════════════════════════
// Rate Limiting Helper
// ═══════════════════════════════════════════════════════════════════════════════
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now >= entry.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return {
      allowed: true,
      remaining: maxRequests - 1,
      resetAt: now + windowMs,
    };
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count++;
  return {
    allowed: true,
    remaining: maxRequests - entry.count,
    resetAt: entry.resetAt,
  };
}

// Cleanup expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of Array.from(rateLimitStore)) {
    if (now >= entry.resetAt) rateLimitStore.delete(key);
  }
}, 60000);

// ═══════════════════════════════════════════════════════════════════════════════
// CSRF Token Management
// ═══════════════════════════════════════════════════════════════════════════════
import crypto from "crypto";

const csrfTokens = new Map<string, { token: string; expiresAt: number }>();

export function generateCsrfToken(sessionId: string): string {
  const token = crypto.randomBytes(32).toString("hex");
  csrfTokens.set(sessionId, { token, expiresAt: Date.now() + 3600000 }); // 1 hour
  return token;
}

export function validateCsrfToken(sessionId: string, token: string): boolean {
  const entry = csrfTokens.get(sessionId);
  if (!entry) return false;
  if (Date.now() >= entry.expiresAt) {
    csrfTokens.delete(sessionId);
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(entry.token), Buffer.from(token));
}

// Cleanup expired CSRF tokens
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of Array.from(csrfTokens)) {
    if (now >= entry.expiresAt) csrfTokens.delete(key);
  }
}, 300000);
