// TypeScript enabled — Sprint 96 security audit
/**
 * piiCrypto.ts — OPS-3: field-level encryption at rest for PII columns
 * (BVN, NIN, date-of-birth) on customers / kyc_sessions.
 *
 * Implements the piiScanner.ts recommendation ("Implement field-level
 * encryption for PII") using the same crypto discipline as the existing
 * encrypted_fields vault subsystem (server/routers/encryptedFieldsCrud.ts):
 *
 *   - AES-256-GCM, per-value random 16-byte salt and 16-byte IV.
 *   - Record key = scrypt(FIELD_ENCRYPTION_KEY, salt) — the master key comes
 *     from getFieldEncryptionKey(), which FAILS LOUD in production when the
 *     env var is missing or set to a known default. There is no fallback key.
 *   - Self-describing envelope: "pii:v1:<salt>:<iv>:<tag>:<ciphertext>" (hex).
 *     The v1 tag supports future key rotation (a v2 envelope can coexist).
 *
 * Read compatibility: decryptPii() returns legacy plaintext values untouched
 * (values not carrying the pii: prefix were written before encryption
 * landed). New writes are ALWAYS encrypted. Backfill of historical rows is a
 * documented operator task (MIGRATION_ROLLBACK.md §7) — never an automatic
 * online rewrite.
 *
 * GDPR/NDPR erasure note: because every value uses a random salt/IV, erasure
 * = setting the column to NULL (existing gdprDashboard flow). No key
 * management coupling — crypto-shredding of individual rows is trivially
 * achieved by NULLing the envelope.
 */
import crypto from "crypto";

import { getFieldEncryptionKey } from "./envValidation";

const ALGORITHM = "aes-256-gcm";
const ENVELOPE_PREFIX = "pii";
const ENVELOPE_VERSION = "v1";

export function isEncryptedPii(value: unknown): value is string {
  return (
    typeof value === "string" && value.startsWith(`${ENVELOPE_PREFIX}:`)
  );
}

/**
 * Encrypt a PII value for storage. null/undefined/"" pass through as null
 * (columns stay nullable). Throws (fail-loud) if the master key is
 * unavailable in production.
 */
export function encryptPii(plaintext: string | null | undefined): string | null {
  if (plaintext === null || plaintext === undefined || plaintext === "") {
    return null;
  }
  if (isEncryptedPii(plaintext)) return plaintext; // never double-encrypt
  const salt = crypto.randomBytes(16);
  const recordKey = crypto.scryptSync(getFieldEncryptionKey(), salt, 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, recordKey, iv);
  const encrypted =
    cipher.update(plaintext, "utf8", "hex") + cipher.final("hex");
  return [
    ENVELOPE_PREFIX,
    ENVELOPE_VERSION,
    salt.toString("hex"),
    iv.toString("hex"),
    cipher.getAuthTag().toString("hex"),
    encrypted,
  ].join(":");
}

/**
 * Decrypt a stored PII value. Legacy plaintext (no envelope prefix) is
 * returned as-is for read compatibility with pre-encryption rows.
 * Throws on tampered/corrupt envelopes (GCM auth-tag failure) — fail loud.
 */
export function decryptPii(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (!isEncryptedPii(value)) return value; // legacy plaintext row
  const parts = value.split(":");
  if (parts.length !== 6 || parts[1] !== ENVELOPE_VERSION) {
    throw new Error(
      `[piiCrypto] Unsupported PII envelope (prefix=${parts[0]}, version=${parts[1]}) — refusing to guess`
    );
  }
  const [, , saltHex, ivHex, tagHex, ciphertext] = parts;
  const recordKey = crypto.scryptSync(
    getFieldEncryptionKey(),
    Buffer.from(saltHex, "hex"),
    32
  );
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    recordKey,
    Buffer.from(ivHex, "hex")
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return decipher.update(ciphertext, "hex", "utf8") + decipher.final("utf8");
}

/**
 * Encrypt the named PII fields of an insert/update payload, in place on a
 * copy. Fields absent from the payload are left untouched.
 */
export function encryptPiiFields<T extends Record<string, unknown>>(
  payload: T,
  fields: readonly string[]
): T {
  const out: Record<string, unknown> = { ...payload };
  for (const f of fields) {
    if (f in out) {
      out[f] = encryptPii(out[f] as string | null | undefined);
    }
  }
  return out as T;
}

/**
 * Decrypt the named PII fields of a row read from the DB, in place on a copy.
 */
export function decryptPiiFields<T extends Record<string, unknown>>(
  row: T,
  fields: readonly string[]
): T {
  const out: Record<string, unknown> = { ...row };
  for (const f of fields) {
    if (f in out) {
      out[f] = decryptPii(out[f] as string | null | undefined);
    }
  }
  return out as T;
}

/** PII columns encrypted at rest on the customers table. */
export const CUSTOMER_PII_FIELDS = ["bvn", "nin", "dateOfBirth"] as const;

/**
 * G2 audit 2026-02 (#7): deterministic blind index for duplicate-identity
 * detection. encryptPii() uses a random IV so ciphertext can never be
 * deduplicated or unique-indexed; this keyed HMAC can. Returns null for
 * empty input. Digits-only normalization (BVN/NIN are 11-digit strings).
 */
export function piiDedupeHash(plaintext: string | null | undefined): string | null {
  if (plaintext === null || plaintext === undefined || plaintext === "") return null;
  const normalized = plaintext.replace(/\D/g, "");
  if (normalized === "") return null;
  return crypto
    .createHmac("sha256", getFieldEncryptionKey())
    .update(`pii-dedupe:v1:${normalized}`)
    .digest("hex");
}
