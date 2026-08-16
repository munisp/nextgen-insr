/**
 * providerReconciliation.ts — provider/local state reconciliation (F-02).
 *
 * Scans provider-dispatched transactions (airtime vending, bill payments,
 * mobile-money cash-in/cash-out) that are still locally pending and compares
 * each against the provider's status endpoint. Any provider/local divergence
 * (e.g. provider says COMPLETED while the local ledger still shows pending,
 * or provider says FAILED while local shows submitted) is FLAGGED loudly:
 * written to the audit log and returned in the report.
 *
 * Scope note: the reconciler FLAGS divergences; it never silently moves
 * funds to "fix" them. Resolution of an unknown outcome happens through the
 * idempotent retry path (resolveProviderTx) or operator review of the
 * divergence report. Rows whose provider is not configured (no base URL)
 * cannot be reconciled and are reported honestly as unreconcilable.
 */
import { and, eq, sql } from "drizzle-orm";

import {
  lookupProviderStatus,
  type ProviderClientConfig,
} from "./providerDispatch";
import { auditLog, transactions } from "../../drizzle/schema";
import { logger } from "../_core/logger";
import { getDb } from "../db";

export interface ReconciliationDivergence {
  ref: string;
  type: string;
  localStatus: string;
  localProviderStatus: string | null;
  providerReportedStatus: string;
  note: string;
}

export interface ReconciliationReport {
  checked: number;
  consistent: number;
  divergences: ReconciliationDivergence[];
  /** Rows whose provider cannot be queried (no base URL configured). */
  unreconcilable: number;
  /** Status lookups that were inconclusive (timeout/malformed). */
  unknown: number;
}

function clientForType(type: string): ProviderClientConfig | null {
  const pick = (url?: string, apiKey?: string, timeoutEnv?: string) =>
    url
      ? {
          baseUrl: url,
          apiKey,
          timeoutMs: Number(timeoutEnv ?? 10_000),
        }
      : null;
  if (type === "Airtime") {
    return pick(
      process.env.AIRTIME_PROVIDER_URL,
      process.env.AIRTIME_PROVIDER_API_KEY,
      process.env.AIRTIME_PROVIDER_TIMEOUT_MS
    );
  }
  if (type === "Bill Payment") {
    return pick(
      process.env.BILL_PROVIDER_URL,
      process.env.BILL_PROVIDER_API_KEY,
      process.env.BILL_PROVIDER_TIMEOUT_MS
    );
  }
  // Cash In / Cash Out / Mobile Money*
  return pick(
    process.env.MOBILE_MONEY_PROVIDER_URL,
    process.env.MOBILE_MONEY_PROVIDER_API_KEY,
    process.env.MOBILE_MONEY_PROVIDER_TIMEOUT_MS
  );
}

/**
 * Run one reconciliation pass over provider-dispatched transactions that are
 * still locally pending.
 */
export async function reconcileProviderOperations(opts?: {
  limit?: number;
  /** Only consider rows older than this many milliseconds (default 0). */
  olderThanMs?: number;
}): Promise<ReconciliationReport> {
  const report: ReconciliationReport = {
    checked: 0,
    consistent: 0,
    divergences: [],
    unreconcilable: 0,
    unknown: 0,
  };
  const db = await getDb();
  if (!db) return report;

  const cutoff = new Date(Date.now() - (opts?.olderThanMs ?? 0));
  const rows = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.status, "pending"),
        sql`(${transactions.type}::text IN ('Airtime','Bill Payment','Cash In','Cash Out') OR ${transactions.type}::text LIKE 'Mobile Money%')`,
        sql`(${transactions.metadata}->>'providerStatus') IN ('submitted','unknown_outcome','pending_provider')`,
        sql`${transactions.createdAt} <= ${cutoff}`
      )
    )
    .limit(opts?.limit ?? 200);

  for (const tx of rows) {
    report.checked++;
    const meta = (tx.metadata as Record<string, unknown> | null) ?? {};
    const localProviderStatus =
      typeof meta.providerStatus === "string" ? meta.providerStatus : null;
    const client = clientForType(tx.type);
    if (!client) {
      report.unreconcilable++;
      continue;
    }
    const lookup = await lookupProviderStatus({ ...client, reference: tx.ref });

    if (lookup.status === "unknown") {
      report.unknown++;
      continue;
    }
    if (lookup.status === "pending") {
      report.consistent++;
      continue;
    }

    // Provider reached a definitive state while local is still pending.
    const diverged =
      (lookup.status === "completed" && tx.status !== "success") ||
      (lookup.status === "failed" && tx.status !== "failed");
    if (diverged) {
      const divergence: ReconciliationDivergence = {
        ref: tx.ref,
        type: tx.type,
        localStatus: tx.status,
        localProviderStatus,
        providerReportedStatus: lookup.status,
        note: `provider reports ${lookup.status.toUpperCase()} but local row is ${tx.status}/${localProviderStatus ?? "n/a"} — manual review required`,
      };
      report.divergences.push(divergence);
      logger.error(
        `[ProviderReconciliation] DIVERGENCE ${tx.ref}: provider=${lookup.status} local=${tx.status}/${localProviderStatus}`
      );
      await db
        .insert(auditLog)
        .values({
          action: "PROVIDER_RECONCILIATION_DIVERGENCE",
          resource: "provider_reconciliation",
          resourceId: tx.ref,
          status: "warning",
          metadata: divergence as unknown as Record<string, unknown>,
        })
        .catch(err =>
          logger.error(
            `[ProviderReconciliation] failed to persist divergence flag for ${tx.ref}: ${err}`
          )
        );
    } else {
      report.consistent++;
    }
  }

  return report;
}
