// TypeScript enabled — Sprint 96 security audit
/**
 * Input Validation & Sanitization — InsurePortal Agency Banking Platform
 *
 * Centralized Zod schemas and sanitization for all tRPC inputs.
 * Prevents:
 * - SQL injection via parameterized queries + input sanitization
 * - XSS via HTML entity encoding
 * - NoSQL injection via type checking
 * - Path traversal via path normalization
 * - Prototype pollution via deep freeze
 */
import { z } from "zod";

// ── Sanitization Helpers ────────────────────────────────────────────────

export function sanitizeString(input: string): string {
  return input
    .replace(/[<>]/g, "") // Strip angle brackets (XSS)
    .replace(/javascript:/gi, "") // Strip JS protocol
    .replace(/on\w+=/gi, "") // Strip event handlers
    .replace(/\0/g, "") // Strip null bytes
    .trim();
}

export function sanitizeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

export function sanitizePath(input: string): string {
  return input
    .replace(/\.\./g, "") // Prevent path traversal
    .replace(/[~`!#$%^&*+=[\]\\';,/{}|":<>?]/g, "")
    .trim();
}

export function sanitizePhoneNumber(input: string): string {
  return input.replace(/[^\d+]/g, "").slice(0, 15);
}

export function sanitizeEmail(input: string): string {
  return input.toLowerCase().trim().slice(0, 254);
}

// ── Reusable Zod Schemas ────────────────────────────────────────────────

export const SafeString = z.string().min(1).max(500).transform(sanitizeString);
export const SafeLongString = z
  .string()
  .min(1)
  .max(5000)
  .transform(sanitizeString);
export const SafeEmail = z.string().email().max(254).transform(sanitizeEmail);
export const SafePhone = z
  .string()
  .min(10)
  .max(15)
  .transform(sanitizePhoneNumber);
export const SafeAgentCode = z
  .string()
  .regex(/^[A-Z0-9]{3,10}$/, "Invalid agent code format");
export const SafePin = z.string().regex(/^\d{4,6}$/, "PIN must be 4-6 digits");
export const SafeTransactionRef = z
  .string()
  .regex(/^[A-Z0-9-]{8,36}$/, "Invalid transaction reference");
export const SafeAmount = z.number().positive().max(10_000_000); // ₦10M max
export const SafeId = z.number().int().positive();
export const SafeUuid = z.string().uuid();
export const SafeDate = z.coerce.date();
export const SafePagination = z.object({
  page: z.number().int().min(1).max(10000).default(1),
  limit: z.number().int().min(1).max(100).default(20),
  sortBy: z.string().max(50).optional(),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

// ── Transaction Input Schema ────────────────────────────────────────────

export const TransactionInputSchema = z.object({
  type: z.enum([
    "cash_in",
    "cash_out",
    "transfer",
    "airtime",
    "bills",
    "card_payment",
    "qr_payment",
    "nfc_payment",
  ]),
  amount: SafeAmount,
  customer: SafeString.optional(),
  customerPhone: SafePhone.optional(),
  channel: z.enum(["pos", "mobile", "web", "ussd", "api"]).default("pos"),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// ── Agent Input Schema ──────────────────────────────────────────────────

export const AgentRegistrationSchema = z.object({
  agentCode: SafeAgentCode,
  name: SafeString,
  phone: SafePhone,
  email: SafeEmail.optional(),
  pin: SafePin,
  tier: z.enum(["basic", "standard", "premium", "enterprise"]).default("basic"),
  location: SafeString.optional(),
});

// ── Dispute Input Schema ────────────────────────────────────────────────

export const DisputeCreateSchema = z.object({
  transactionRef: SafeTransactionRef,
  reason: SafeLongString,
  category: z.enum([
    "unauthorized",
    "duplicate",
    "wrong_amount",
    "service_not_received",
    "other",
  ]),
  evidence: z.array(z.string().url()).max(5).optional(),
});

// ── Search Input Schema ─────────────────────────────────────────────────

export const GlobalSearchSchema = z.object({
  query: z.string().min(2).max(200).transform(sanitizeString),
  entityTypes: z
    .array(z.enum(["agents", "transactions", "customers", "disputes"]))
    .optional(),
  ...SafePagination.shape,
});

// ── Webhook Input Schema ────────────────────────────────────────────────

export const WebhookCreateSchema = z.object({
  name: SafeString,
  url: z.string().url().max(2048),
  events: z.array(z.string().max(100)).min(1).max(50),
  secret: z.string().min(16).max(256).optional(),
  active: z.boolean().default(true),
});

// ── Deep Freeze for Prototype Pollution Prevention ──────────────────────

export function deepFreeze<T extends Record<string, unknown>>(
  obj: T
): Readonly<T> {
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val && typeof val === "object" && !Object.isFrozen(val)) {
      deepFreeze(val as Record<string, unknown>);
    }
  }
  return obj;
}

// ── Request Size Limits ─────────────────────────────────────────────────

export const REQUEST_SIZE_LIMITS = {
  maxJsonBodyBytes: 1_048_576, // 1 MB
  maxFileUploadBytes: 10_485_760, // 10 MB
  maxUrlLength: 2048,
  maxHeaderSize: 8192,
  maxQueryParams: 50,
} as const;
