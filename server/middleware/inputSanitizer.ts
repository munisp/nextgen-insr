// TypeScript enabled — Sprint 96 security audit
/**
 * Input Sanitization Middleware
 *
 * Provides XSS prevention and input sanitization for all tRPC procedures.
 * Applied as a tRPC middleware that recursively sanitizes string inputs.
 */

// ── HTML entity encoding for XSS prevention ─────────────────────────────
const HTML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#x27;",
  "/": "&#x2F;",
};

export function sanitizeString(input: string): string {
  // Strip null bytes
  let clean = input.replace(/\0/g, "");
  // Encode HTML entities to prevent XSS
  clean = clean.replace(/[&<>"'/]/g, char => HTML_ENTITIES[char] || char);
  // Strip control characters (except newline, tab, carriage return)
  clean = clean.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  return clean;
}

export function sanitizeInput(input: unknown): unknown {
  if (typeof input === "string") {
    return sanitizeString(input);
  }
  if (Array.isArray(input)) {
    return input.map(sanitizeInput);
  }
  if (input !== null && typeof input === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      sanitized[key] = sanitizeInput(value);
    }
    return sanitized;
  }
  return input;
}

// ── Validation helpers ──────────────────────────────────────────────────
export function isValidNigerianPhone(phone: string): boolean {
  return /^0[789][01]\d{8}$/.test(phone);
}

export function isValidAgentCode(code: string): boolean {
  return /^AG-[A-Z]{2,4}-\d{4,8}$/.test(code);
}

export function isValidAmount(amount: number): boolean {
  return Number.isFinite(amount) && amount > 0 && amount <= 10_000_000;
}

// ── PIN complexity enforcement ──────────────────────────────────────────
export function validatePinComplexity(pin: string): {
  valid: boolean;
  reason?: string;
} {
  if (pin.length < 4)
    return { valid: false, reason: "PIN must be at least 4 digits" };
  if (pin.length > 8)
    return { valid: false, reason: "PIN must be at most 8 digits" };
  if (!/^\d+$/.test(pin))
    return { valid: false, reason: "PIN must contain only digits" };
  // Reject sequential PINs
  const sequential = [
    "1234",
    "2345",
    "3456",
    "4567",
    "5678",
    "6789",
    "0123",
    "9876",
    "8765",
    "7654",
    "6543",
    "5432",
    "4321",
    "3210",
  ];
  if (sequential.some(s => pin.includes(s)))
    return { valid: false, reason: "PIN must not contain sequential digits" };
  // Reject repeated digits
  if (/^(\d)\1+$/.test(pin))
    return { valid: false, reason: "PIN must not be all the same digit" };
  return { valid: true };
}

// ── Account lockout tracking (in-memory, production should use Redis) ───
const loginAttempts = new Map<string, { count: number; lockedUntil: number }>();
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

export function checkAccountLockout(agentId: string): {
  locked: boolean;
  remainingMs?: number;
} {
  const record = loginAttempts.get(agentId);
  if (!record) return { locked: false };
  if (record.lockedUntil > Date.now()) {
    return { locked: true, remainingMs: record.lockedUntil - Date.now() };
  }
  if (record.count >= MAX_ATTEMPTS && record.lockedUntil <= Date.now()) {
    // Lockout expired, reset
    loginAttempts.delete(agentId);
    return { locked: false };
  }
  return { locked: false };
}

export function recordFailedLogin(agentId: string): void {
  const record = loginAttempts.get(agentId) || { count: 0, lockedUntil: 0 };
  record.count++;
  if (record.count >= MAX_ATTEMPTS) {
    record.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
  }
  loginAttempts.set(agentId, record);
}

export function resetLoginAttempts(agentId: string): void {
  loginAttempts.delete(agentId);
}
