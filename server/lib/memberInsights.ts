/**
 * memberInsights.ts — W11-B3a (2026-10-24): heuristic intelligence for the
 * member surface (Phase 3). Pure READ-ONLY computation over the caller's
 * REAL data — no autonomous actions, no writes, no new tables:
 *
 *   - Policy renewals: policies (dual identity space — policies.customerId
 *     is written as BOTH users.id and customers.id with no FK,
 *     memberGuards.ts §dual) whose coalesce(renewalDate, endDate) falls in
 *     [now, now+14d] while status = 'active'.
 *   - Failed refunds: the caller's transactions carrying
 *     metadata.refund.status = "failed_refund_pending" (memberFunds.ts:848 —
 *     a provider rejected fulfillment AFTER a verified capture; manual ops
 *     reversal required). Surfaced verbatim, never auto-retried.
 *   - Recurring payments: periodicity detection over the caller's own
 *     transactions, grouped by the payee natural key recomputed from the
 *     transaction metadata (the same keyed-HMAC tuple as
 *     memberPayees.payeeNaturalKey). A group is RECURRING when it has >= 3
 *     occurrences and EVERY consecutive interval is 30±5 days; it is DUE
 *     SOON when the latest occurrence is 25–35 days old. Momo cash-in rows
 *     carry no wallet identifier in metadata (memberMobileMoney.ts:389) so
 *     they can never be grouped to a payee — excluded by construction.
 *   - KYC: the caller has NO kyc_sessions row of type "customer_kyc" in
 *     status "verified" (memberIdentity.ts adjudication writes).
 *
 * Ranking (fixed, documented): renewal > failed refund > recurring due >
 * kyc. Scores are stable constants so ordering is deterministic and
 * testable; ties break on score desc then type asc.
 *
 * Anomaly check: amount vs the caller's OWN history for the same payee
 * natural key (transaction amounts + payee_directory.lastAmountKobo).
 * FAILS CLOSED — fewer than MIN_HISTORY historical amounts, an incomplete
 * identifier tuple, or an unknown caller → anomalous:false (never a false
 * alarm). Flags only when amount > ANOMALY_MULTIPLE × median AND amount >=
 * ANOMALY_FLOOR_KOBO (₦5,000) — conservative, member-facing soft confirm.
 */
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";

import {
  kycSessions,
  policies,
  transactions,
} from "../../drizzle/schema";
import type { DrizzleDb } from "./memberGuards";
import { payeeNaturalKey, type PayeeRail } from "./memberPayees";

// ── Detection constants (2026-10-24, W11-B3a) ───────────────────────────────
export const RENEWAL_WINDOW_DAYS = 14;
export const RECURRING_MIN_OCCURRENCES = 3;
export const RECURRING_INTERVAL_DAYS = 30;
export const RECURRING_INTERVAL_TOLERANCE_DAYS = 5;
export const DUE_SOON_MIN_AGE_DAYS = 25;
export const DUE_SOON_MAX_AGE_DAYS = 35;
export const ANOMALY_MULTIPLE = 3;
/** ₦5,000 absolute floor — below this an amount is never "anomalous". */
export const ANOMALY_FLOOR_KOBO = 500_000;
/** One prior payment is not a pattern; two is the minimum history. */
export const ANOMALY_MIN_HISTORY = 2;

const DAY_MS = 86_400_000;

export type InsightActionType =
  | "policy_renewal_due"
  | "failed_refund_pending"
  | "recurring_bill_due"
  | "kyc_incomplete";

export interface InsightAction {
  type: InsightActionType;
  /** Fixed rank score — higher surfaces first. */
  priority: number;
  /** Human-readable reason, safe for member display. */
  explain: string;
  /** Opaque refs only (ids / references) — never PII payloads. */
  payload: Record<string, unknown>;
}

export interface RecurringCandidate {
  naturalKey: string;
  rail: PayeeRail;
  occurrences: number;
  cadenceDays: number;
  averageAmountKobo: number;
  lastPaidAt: Date;
  nextExpectedAt: Date;
  dueSoon: boolean;
  transactionIds: number[];
}

interface CallerTx {
  id: number;
  ref: string;
  type: string;
  amount: string;
  status: string;
  metadata: unknown;
  createdAt: Date;
}

/** Caller's own member-bound transactions (newest first), soft-deletes out. */
export async function listCallerTransactions(
  d: DrizzleDb,
  customerId: number
): Promise<CallerTx[]> {
  const rows = await d
    .select({
      id: transactions.id,
      ref: transactions.ref,
      type: transactions.type,
      amount: transactions.amount,
      status: transactions.status,
      metadata: transactions.metadata,
      createdAt: transactions.createdAt,
    })
    .from(transactions)
    .where(
      and(
        sql`${transactions.metadata}->>'memberCustomerId' = ${String(customerId)}`,
        isNull(transactions.deletedAt)
      )
    )
    .orderBy(desc(transactions.createdAt), desc(transactions.id))
    .limit(500);
  return rows as CallerTx[];
}

function metaOf(tx: CallerTx): Record<string, unknown> {
  return (tx.metadata ?? {}) as Record<string, unknown>;
}

/**
 * Recompute the payee natural key from a transaction row's write-time
 * metadata. Returns null when the rail carries no per-payee identifier in
 * metadata (momo cash-in: provider only) or the tuple is incomplete —
 * fail-closed, such rows never join a recurring group.
 */
export function txPayeeNaturalKey(tx: CallerTx): {
  rail: PayeeRail;
  naturalKey: string;
} | null {
  const m = metaOf(tx);
  const s = (v: unknown) => (typeof v === "string" ? v : null);
  if (tx.type === "Bill Payment") {
    const naturalKey = payeeNaturalKey("bill", {
      billerCode: s(m.biller),
      meterNumber: s(m.customerNumber),
    });
    return naturalKey ? { rail: "bill", naturalKey } : null;
  }
  if (tx.type === "Airtime") {
    const naturalKey = payeeNaturalKey("airtime", {
      network: s(m.network),
      phone: s(m.phoneNumber),
    });
    return naturalKey ? { rail: "airtime", naturalKey } : null;
  }
  return null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Periodicity detector. A payee group is recurring ONLY when it has
 * >= RECURRING_MIN_OCCURRENCES paid rows and every consecutive interval is
 * RECURRING_INTERVAL_DAYS ± RECURRING_INTERVAL_TOLERANCE_DAYS. Irregular
 * intervals (a single outlier gap) disqualify the group — conservative by
 * design so one-off bursts never surface as "subscriptions".
 */
export function detectRecurring(
  txs: CallerTx[],
  now: Date = new Date()
): RecurringCandidate[] {
  const groups = new Map<string, { rail: PayeeRail; rows: CallerTx[] }>();
  for (const tx of txs) {
    // Failed / reversed rows are not payments — they never count toward a
    // cadence (a rejected vend must not extend a "subscription").
    if (tx.status === "failed" || tx.status === "reversed") continue;
    const key = txPayeeNaturalKey(tx);
    if (!key) continue;
    const g = groups.get(key.naturalKey) ?? { rail: key.rail, rows: [] };
    g.rows.push(tx);
    groups.set(key.naturalKey, g);
  }

  const out: RecurringCandidate[] = [];
  for (const [naturalKey, { rail, rows }] of groups) {
    if (rows.length < RECURRING_MIN_OCCURRENCES) continue;
    const asc = [...rows].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
    );
    const intervals: number[] = [];
    for (let i = 1; i < asc.length; i++) {
      intervals.push(
        (asc[i].createdAt.getTime() - asc[i - 1].createdAt.getTime()) / DAY_MS
      );
    }
    const periodic = intervals.every(
      d =>
        Math.abs(d - RECURRING_INTERVAL_DAYS) <= RECURRING_INTERVAL_TOLERANCE_DAYS
    );
    if (!periodic) continue;
    const cadenceDays = Math.round(median(intervals));
    const last = asc[asc.length - 1];
    const ageDays = (now.getTime() - last.createdAt.getTime()) / DAY_MS;
    const amountsKobo = asc.map(t => Math.round(Number(t.amount) * 100));
    out.push({
      naturalKey,
      rail,
      occurrences: asc.length,
      cadenceDays,
      averageAmountKobo: Math.round(median(amountsKobo)),
      lastPaidAt: last.createdAt,
      nextExpectedAt: new Date(last.createdAt.getTime() + cadenceDays * DAY_MS),
      dueSoon: ageDays >= DUE_SOON_MIN_AGE_DAYS && ageDays <= DUE_SOON_MAX_AGE_DAYS,
      transactionIds: asc.map(t => t.id),
    });
  }
  // Deterministic order: due-soon first, then most recent activity.
  out.sort((a, b) =>
    a.dueSoon !== b.dueSoon
      ? a.dueSoon
        ? -1
        : 1
      : b.lastPaidAt.getTime() - a.lastPaidAt.getTime()
  );
  return out;
}

/** Caller's unresolved post-capture refund flags (memberFunds.ts:848). */
export async function listFailedRefunds(
  d: DrizzleDb,
  customerId: number
): Promise<Array<{ id: number; ref: string; amount: string; createdAt: Date }>> {
  const rows = await d
    .select({
      id: transactions.id,
      ref: transactions.ref,
      amount: transactions.amount,
      createdAt: transactions.createdAt,
    })
    .from(transactions)
    .where(
      and(
        sql`${transactions.metadata}->>'memberCustomerId' = ${String(customerId)}`,
        sql`${transactions.metadata}->'refund'->>'status' = 'failed_refund_pending'`,
        isNull(transactions.deletedAt)
      )
    )
    .orderBy(desc(transactions.createdAt))
    .limit(50);
  return rows as Array<{ id: number; ref: string; amount: string; createdAt: Date }>;
}

/** Active policies whose renewal/end date falls within the next 14 days. */
export async function listRenewalsDue(
  d: DrizzleDb,
  userId: number,
  customerId: number,
  now: Date = new Date()
): Promise<Array<{ id: number; policyNumber: string; dueDate: Date }>> {
  const until = new Date(now.getTime() + RENEWAL_WINDOW_DAYS * DAY_MS);
  const due = sql`coalesce(${policies.renewalDate}, ${policies.endDate})`;
  const rows = await d
    .select({
      id: policies.id,
      policyNumber: policies.policyNumber,
      dueDate: sql<Date>`coalesce(${policies.renewalDate}, ${policies.endDate})`,
    })
    .from(policies)
    .where(
      and(
        or(
          eq(policies.customerId, userId),
          eq(policies.customerId, customerId)
        ),
        eq(policies.status, "active"),
        sql`${due} is not null`,
        sql`${due} >= ${now.toISOString()}::timestamp`,
        sql`${due} <= ${until.toISOString()}::timestamp`
      )
    )
    .orderBy(sql`coalesce(${policies.renewalDate}, ${policies.endDate}) asc`)
    .limit(20);
  return rows.map(r => ({ ...r, dueDate: new Date(r.dueDate) }));
}

/** True when the caller has a verified member KYC document session. */
export async function hasVerifiedKyc(
  d: DrizzleDb,
  customerId: number
): Promise<boolean> {
  const [row] = await d
    .select({ id: kycSessions.id })
    .from(kycSessions)
    .where(
      and(
        eq(kycSessions.customerId, customerId),
        eq(kycSessions.type, "customer_kyc"),
        eq(kycSessions.status, "verified")
      )
    )
    .limit(1);
  return !!row;
}

/**
 * Ranked next-best actions for the caller. Suggestions ONLY — each action
 * carries refs the client may deep-link on; nothing here performs or
 * schedules any mutation.
 */
export async function computeNextBestActions(
  d: DrizzleDb,
  userId: number,
  customerId: number,
  now: Date = new Date()
): Promise<InsightAction[]> {
  const [renewals, refunds, txs, kycOk] = await Promise.all([
    listRenewalsDue(d, userId, customerId, now),
    listFailedRefunds(d, customerId),
    listCallerTransactions(d, customerId),
    hasVerifiedKyc(d, customerId),
  ]);
  const recurring = detectRecurring(txs, now).filter(c => c.dueSoon);

  const actions: InsightAction[] = [];
  for (const r of renewals) {
    actions.push({
      type: "policy_renewal_due",
      priority: 100,
      explain: `Policy ${r.policyNumber} renews on ${r.dueDate
        .toISOString()
        .slice(0, 10)} (within ${RENEWAL_WINDOW_DAYS} days).`,
      payload: { policyId: r.id, policyNumber: r.policyNumber, dueDate: r.dueDate },
    });
  }
  for (const f of refunds) {
    actions.push({
      type: "failed_refund_pending",
      priority: 90,
      explain:
        `Payment ${f.ref} was captured but the provider rejected fulfillment — ` +
        "a manual refund is pending with operations.",
      payload: { transactionId: f.id, reference: f.ref, amount: f.amount },
    });
  }
  for (const c of recurring) {
    actions.push({
      type: "recurring_bill_due",
      priority: 70,
      explain:
        `Your recurring ${c.rail} payment (every ~${c.cadenceDays} days, ` +
        `~₦${(c.averageAmountKobo / 100).toLocaleString("en-NG")}) looks due around ` +
        `${c.nextExpectedAt.toISOString().slice(0, 10)}.`,
      payload: {
        naturalKey: c.naturalKey,
        rail: c.rail,
        nextExpectedAt: c.nextExpectedAt,
        transactionIds: c.transactionIds,
      },
    });
  }
  if (!kycOk) {
    actions.push({
      type: "kyc_incomplete",
      priority: 40,
      explain:
        "Your identity verification is not complete — finish KYC to unlock higher limits.",
      payload: {},
    });
  }
  actions.sort((a, b) =>
    b.priority !== a.priority
      ? b.priority - a.priority
      : a.type.localeCompare(b.type)
  );
  return actions;
}

export interface AnomalyResult {
  anomalous: boolean;
  /** amountKobo / historical median, 2dp; null when not computed. */
  multiple: number | null;
  reason: string;
}

/**
 * Conservative amount check vs the caller's OWN history for the payee.
 * FAIL-CLOSED: any insufficiency (unknown tuple, < ANOMALY_MIN_HISTORY
 * historical amounts, zero median) → anomalous:false. Flags only when the
 * amount exceeds BOTH ANOMALY_MULTIPLE × median and ANOMALY_FLOOR_KOBO.
 */
export function evaluateAmountAnomaly(
  historyKobo: number[],
  amountKobo: number
): AnomalyResult {
  if (historyKobo.length < ANOMALY_MIN_HISTORY) {
    return {
      anomalous: false,
      multiple: null,
      reason: "insufficient_history",
    };
  }
  const med = median(historyKobo);
  if (!(med > 0)) {
    return { anomalous: false, multiple: null, reason: "insufficient_history" };
  }
  const multiple = Math.round((amountKobo / med) * 100) / 100;
  if (amountKobo < ANOMALY_FLOOR_KOBO) {
    return { anomalous: false, multiple, reason: "below_floor" };
  }
  if (amountKobo > ANOMALY_MULTIPLE * med) {
    return { anomalous: true, multiple, reason: "exceeds_historical_multiple" };
  }
  return { anomalous: false, multiple, reason: "within_historical_range" };
}

/**
 * Gather the caller's historical amounts (kobo) for one payee natural key:
 * member-bound transactions matching the key plus the payee_directory
 * lastAmountKobo (so a payee known only via the directory still counts).
 */
export async function payeeHistoryKobo(
  d: DrizzleDb,
  customerId: number,
  naturalKey: string
): Promise<number[]> {
  const txs = await listCallerTransactions(d, customerId);
  const amounts = txs
    .filter(t => t.status !== "failed" && t.status !== "reversed")
    .filter(t => txPayeeNaturalKey(t)?.naturalKey === naturalKey)
    .map(t => Math.round(Number(t.amount) * 100));
  const { payeeDirectory } = await import("../../drizzle/schema");
  const [payee] = await d
    .select({ lastAmountKobo: payeeDirectory.lastAmountKobo })
    .from(payeeDirectory)
    .where(
      and(
        eq(payeeDirectory.customerId, customerId),
        eq(payeeDirectory.naturalKey, naturalKey)
      )
    )
    .limit(1);
  if (payee?.lastAmountKobo != null && payee.lastAmountKobo > 0) {
    amounts.push(Number(payee.lastAmountKobo));
  }
  return amounts;
}
