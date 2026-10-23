/**
 * memberPayees.ts — W11-B1a (2026-10-05): server-side payee directory for the
 * member intelligence program.
 *
 * Records the DESTINATION of a successful member funds payment (bill /
 * airtime / momo cash-in) so the PWA can prefill the next one. Recording is
 * wired into server/lib/memberFunds.ts confirmMemberCapture AFTER a
 * gateway-verified "success" capture only — a failed or pending payment
 * NEVER creates a payee entry, and a payee-record failure NEVER fails the
 * payment confirm (logged + swallowed at the call site).
 *
 * Dedupe: encryptPii() random IVs make ciphertext unmatchable, so the
 * natural key is a keyed HMAC-SHA256 blind index over the rail-specific
 * identifier tuple (same blind-index discipline as customers.bvnHash /
 * piiDedupeHash, G2 audit 2026-02; keyed so the hashes are not a
 * cross-deployment dictionary of phone/meter numbers):
 *   bill:    bill:<billerCode>:<meterNumber>
 *   airtime: airtime:<network>:<phone>
 *   momo:    momo:<provider>:<walletNumber>
 * Components are trimmed before hashing (case preserved — biller codes and
 * meter numbers are case-sensitive on some providers; phone numbers are
 * digits). Upsert key = UNIQUE (customerId, rail, naturalKey).
 *
 * PII at rest: meterNumber / phone / walletNumber are AES-256-GCM encrypted
 * via encryptPii ("pii:v1:..." envelope). billerCode / network / provider are
 * non-personal routing identifiers and stay plaintext. Decryption happens
 * server-side only, for the owning member's list response.
 */
import crypto from "crypto";
import { and, desc, eq, sql } from "drizzle-orm";

import { payeeDirectory, type PayeeDirectoryEntry } from "../../drizzle/schema";
import { getFieldEncryptionKey } from "./envValidation";
import type { DrizzleDb } from "./memberGuards";
import { decryptPii, encryptPii } from "./piiCrypto";

export type PayeeRail = "bill" | "airtime" | "momo";

/** Columns that hold encryptPii envelopes (rest are plaintext). */
export const PAYEE_ENCRYPTED_FIELDS = [
  "meterNumber",
  "phone",
  "walletNumber",
] as const;

/** Identifiers supplied by the caller (rail-specific subset is used). */
export interface PayeeIdentifiers {
  billerCode?: string | null;
  meterNumber?: string | null;
  network?: string | null;
  phone?: string | null;
  provider?: string | null;
  walletNumber?: string | null;
}

function norm(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/**
 * Deterministic keyed blind index of the rail identifier tuple. Returns null
 * when the tuple is incomplete (a payee we cannot dedupe is never recorded —
 * fail-closed against junk rows).
 */
export function payeeNaturalKey(
  rail: PayeeRail,
  ids: PayeeIdentifiers
): string | null {
  let tuple: string;
  if (rail === "bill") {
    const biller = norm(ids.billerCode);
    const meter = norm(ids.meterNumber);
    if (!biller || !meter) return null;
    tuple = `bill:${biller}:${meter}`;
  } else if (rail === "airtime") {
    const network = norm(ids.network);
    const phone = norm(ids.phone);
    if (!network || !phone) return null;
    tuple = `airtime:${network}:${phone}`;
  } else {
    const provider = norm(ids.provider);
    const wallet = norm(ids.walletNumber);
    if (!provider || !wallet) return null;
    tuple = `momo:${provider}:${wallet}`;
  }
  return crypto
    .createHmac("sha256", getFieldEncryptionKey())
    .update(`payee-natural:v1:${tuple}`)
    .digest("hex");
}

/**
 * Upsert the caller's payee after a successful payment: insert on first use,
 * otherwise increment useCount and refresh lastAmountKobo / lastUsedAt and
 * the (re-encrypted) identifier columns. The label is NEVER overwritten —
 * rename() is the only label writer.
 *
 * Returns the row id, or null when the identifier tuple is incomplete (not
 * an error — nothing to dedupe on). Caller wraps this in error isolation;
 * this function itself throws on DB failure so the caller can log it.
 */
export async function recordPayee(
  d: DrizzleDb,
  opts: {
    customerId: number;
    rail: PayeeRail;
    identifiers: PayeeIdentifiers;
    amountKobo: number;
  }
): Promise<string | null> {
  const naturalKey = payeeNaturalKey(opts.rail, opts.identifiers);
  if (!naturalKey) return null;
  const now = new Date();
  const ids = opts.identifiers;
  const encrypted = {
    billerCode: norm(ids.billerCode) || null,
    meterNumber: encryptPii(norm(ids.meterNumber) || null),
    network: norm(ids.network) || null,
    phone: encryptPii(norm(ids.phone) || null),
    provider: norm(ids.provider) || null,
    walletNumber: encryptPii(norm(ids.walletNumber) || null),
  };
  const [row] = await d
    .insert(payeeDirectory)
    .values({
      customerId: opts.customerId,
      rail: opts.rail,
      ...encrypted,
      naturalKey,
      lastAmountKobo: opts.amountKobo,
      useCount: 1,
      lastUsedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        payeeDirectory.customerId,
        payeeDirectory.rail,
        payeeDirectory.naturalKey,
      ],
      set: {
        ...encrypted,
        lastAmountKobo: opts.amountKobo,
        lastUsedAt: now,
        updatedAt: now,
        useCount: sql`${payeeDirectory.useCount} + 1`,
      },
    })
    .returning({ id: payeeDirectory.id });
  return row?.id ?? null;
}

/** Member-facing view: decrypt the envelope columns for the OWNING member. */
export function decryptPayeeRow(row: PayeeDirectoryEntry) {
  return {
    id: row.id,
    rail: row.rail,
    label: row.label,
    billerCode: row.billerCode,
    meterNumber: decryptPii(row.meterNumber),
    network: row.network,
    phone: decryptPii(row.phone),
    provider: row.provider,
    walletNumber: decryptPii(row.walletNumber),
    lastAmountKobo: row.lastAmountKobo,
    useCount: row.useCount,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Caller's payees, most-recently-used first, capped. */
export async function listPayees(
  d: DrizzleDb,
  customerId: number,
  rail: PayeeRail | undefined,
  limit = 50
) {
  const rows = await d
    .select()
    .from(payeeDirectory)
    .where(
      and(
        eq(payeeDirectory.customerId, customerId),
        rail ? eq(payeeDirectory.rail, rail) : undefined
      )
    )
    .orderBy(desc(payeeDirectory.lastUsedAt), desc(payeeDirectory.id))
    .limit(limit);
  return rows.map(decryptPayeeRow);
}
