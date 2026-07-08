// @ts-check

// TypeScript enabled — Sprint 96 security audit
/**
 * Rate Limit Configuration
 *
 * Centralized rate limit rules for all API endpoints.
 * Configurable per-endpoint, per-role, and per-IP limits.
 */

export interface RateLimitRule {
  endpoint: string;
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
  keyBy: "ip" | "user" | "api-key";
  burstAllowance?: number; // Extra burst capacity
  skipRoles?: string[]; // Roles exempt from this rule
  message?: string;
}

/**
 * Default rate limit rules organized by category
 */
export const rateLimitRules: RateLimitRule[] = [
  // === Authentication ===
  {
    endpoint: "/api/trpc/auth.logout",
    windowMs: 60_000,
    maxRequests: 10,
    keyBy: "ip",
    message: "Too many logout attempts",
  },

  // === Transaction Processing (Critical - Strict) ===
  {
    endpoint: "/api/trpc/transactions.create",
    windowMs: 60_000,
    maxRequests: 30,
    keyBy: "user",
    burstAllowance: 5,
    message:
      "Transaction rate limit exceeded. Please wait before processing more transactions.",
  },
  {
    endpoint: "/api/trpc/transactions.reverse",
    windowMs: 300_000,
    maxRequests: 5,
    keyBy: "user",
    message: "Too many reversal attempts. Contact support if needed.",
  },

  // === Agent Operations ===
  {
    endpoint: "/api/trpc/agents.create",
    windowMs: 3_600_000,
    maxRequests: 10,
    keyBy: "user",
    skipRoles: ["admin"],
    message: "Agent creation rate limit exceeded.",
  },
  {
    endpoint: "/api/trpc/agents.update",
    windowMs: 60_000,
    maxRequests: 20,
    keyBy: "user",
    message: "Too many agent updates.",
  },

  // === Float Management ===
  {
    endpoint: "/api/trpc/float.requestTopUp",
    windowMs: 300_000,
    maxRequests: 3,
    keyBy: "user",
    message: "Float top-up request rate limit. Please wait 5 minutes.",
  },

  // === KYC Operations ===
  {
    endpoint: "/api/trpc/kyc.submit",
    windowMs: 3_600_000,
    maxRequests: 5,
    keyBy: "user",
    message: "KYC submission rate limit. Maximum 5 per hour.",
  },

  // === Fraud Detection ===
  {
    endpoint: "/api/trpc/fraud.resolve",
    windowMs: 60_000,
    maxRequests: 20,
    keyBy: "user",
    skipRoles: ["admin"],
    message: "Fraud resolution rate limit exceeded.",
  },

  // === Reports (Resource-Intensive) ===
  {
    endpoint: "/api/trpc/reports.generate",
    windowMs: 300_000,
    maxRequests: 5,
    keyBy: "user",
    message:
      "Report generation is resource-intensive. Please wait between requests.",
  },
  {
    endpoint: "/api/trpc/reports.export",
    windowMs: 60_000,
    maxRequests: 10,
    keyBy: "user",
    message: "Export rate limit exceeded.",
  },

  // === Settlement ===
  {
    endpoint: "/api/trpc/settlement.process",
    windowMs: 3_600_000,
    maxRequests: 3,
    keyBy: "user",
    skipRoles: ["admin"],
    message: "Settlement processing is limited to 3 per hour.",
  },

  // === AI Chat Support ===
  {
    endpoint: "/api/trpc/aiChatSupport.sendMessage",
    windowMs: 60_000,
    maxRequests: 20,
    keyBy: "user",
    message: "Chat message rate limit. Please slow down.",
  },

  // === Stripe/Payments ===
  {
    endpoint: "/api/trpc/stripe.createCheckout",
    windowMs: 300_000,
    maxRequests: 5,
    keyBy: "user",
    message: "Too many checkout attempts.",
  },

  // === General API (Catch-all) ===
  {
    endpoint: "/api/trpc/*",
    windowMs: 60_000,
    maxRequests: 100,
    keyBy: "ip",
    burstAllowance: 20,
    message: "API rate limit exceeded. Please try again later.",
  },

  // === Webhook Endpoints ===
  {
    endpoint: "/api/stripe/webhook",
    windowMs: 60_000,
    maxRequests: 200,
    keyBy: "ip",
    message: "Webhook rate limit exceeded.",
  },
];

/**
 * Get rate limit rule for a specific endpoint
 */
export function getRateLimitRule(endpoint: string): RateLimitRule | undefined {
  // Exact match first
  const exact = rateLimitRules.find(r => r.endpoint === endpoint);
  if (exact) return exact;

  // Wildcard match
  return rateLimitRules.find(r => {
    if (!r.endpoint.includes("*")) return false;
    const pattern = r.endpoint.replace("*", "");
    return endpoint.startsWith(pattern);
  });
}

/**
 * Check if a role is exempt from a rate limit rule
 */
export function isRoleExempt(rule: RateLimitRule, role: string): boolean {
  return rule.skipRoles?.includes(role) ?? false;
}

/**
 * Get effective max requests (including burst allowance)
 */
export function getEffectiveLimit(rule: RateLimitRule): number {
  return rule.maxRequests + (rule.burstAllowance ?? 0);
}
