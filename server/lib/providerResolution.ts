/**
 * providerResolution.ts — resolve provider-pending transactions via the
 * provider's status endpoint instead of blind re-dispatch (F-02 funds safety).
 *
 * A transaction row is the stable local identity: it is inserted with the
 * caller's unique `ref` BEFORE any provider call. When a retry arrives for
 * the same reference after an UNKNOWN outcome (timeout / 5xx / malformed
 * reply), the correct move is a provider status lookup — never a second
 * dispatch that could double-effect funds.
 *
 * Resolution semantics (fail-closed):
 *   provider says completed -> local row becomes success (commission earned)
 *   provider says failed    -> local row becomes failed (loud, with reason)
 *   provider says pending   -> row stays pending (no effect, no fabrication)
 *   lookup inconclusive     -> row stays pending / unknown_outcome
 */
import { and, eq } from "drizzle-orm";

import {
  lookupProviderStatus,
  type ProviderClientConfig,
} from "./providerDispatch";
import { transactions, type Transaction } from "../../drizzle/schema";
import { logger } from "../_core/logger";
import { getDb } from "../db";

export type ProviderResolution =
  | "completed"
  | "failed"
  | "still_pending"
  | "unknown"
  | "already_resolved"
  | "no_provider_lookup";

export interface ResolveResult {
  transaction: Transaction;
  resolution: ProviderResolution;
}

function metadataOf(tx: Transaction): Record<string, unknown> {
  return (tx.metadata as Record<string, unknown> | null) ?? {};
}

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/**
 * Re-read the row after an expected-state guarded transition matched 0 rows
 * (a concurrent resolver won the race). Returns the fresh row so callers
 * never act on the stale in-memory status.
 */
async function currentRow(db: Db, tx: Transaction): Promise<Transaction> {
  const [fresh] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.ref, tx.ref))
    .limit(1);
  return fresh ?? tx;
}

/**
 * Attempt to resolve a provider-pending transaction through the provider's
 * status endpoint. Safe to call on any transaction: already-final rows are
 * returned unchanged.
 */
export async function resolveProviderTx(opts: {
  transaction: Transaction;
  client: ProviderClientConfig | null;
  /** Commission (NGN) credited when the provider confirms fulfilment. */
  commissionOnCompletion?: number;
}): Promise<ResolveResult> {
  const tx = opts.transaction;
  if (tx.status === "success" || tx.status === "failed") {
    return { transaction: tx, resolution: "already_resolved" };
  }
  if (!opts.client) {
    return { transaction: tx, resolution: "no_provider_lookup" };
  }

  const lookup = await lookupProviderStatus({
    ...opts.client,
    reference: tx.ref,
  });

  const db = await getDb();
  if (!db) return { transaction: tx, resolution: "unknown" };

  const meta = metadataOf(tx);

  if (lookup.status === "completed") {
    const commission = opts.commissionOnCompletion ?? Number(tx.commission ?? 0);
    const [updated] = await db
      .update(transactions)
      .set({
        status: "success",
        commission: String(commission),
        metadata: {
          ...meta,
          providerStatus: "completed",
          providerRef: lookup.providerRef ?? meta.providerRef ?? null,
          resolvedVia: "provider_status_lookup",
          resolvedAt: new Date().toISOString(),
        },
        updatedAt: new Date(),
      })
      // Expected-state guard (F4): only a still-pending row may transition.
      // A concurrent conflicting resolution (completion vs failure) matches
      // 0 rows on the loser's UPDATE instead of last-writer-wins.
      .where(and(eq(transactions.ref, tx.ref), eq(transactions.status, "pending")))
      .returning();
    if (!updated) {
      return { transaction: await currentRow(db, tx), resolution: "already_resolved" };
    }
    logger.info(
      `[ProviderResolution] ${tx.ref} resolved completed via status lookup`
    );
    return { transaction: updated, resolution: "completed" };
  }

  if (lookup.status === "failed") {
    const [updated] = await db
      .update(transactions)
      .set({
        status: "failed",
        failureReason: lookup.reason ?? "provider reported failure",
        metadata: {
          ...meta,
          providerStatus: "failed",
          providerRef: lookup.providerRef ?? meta.providerRef ?? null,
          resolvedVia: "provider_status_lookup",
          resolvedAt: new Date().toISOString(),
        },
        updatedAt: new Date(),
      })
      // Expected-state guard (F4): see the completed branch above.
      .where(and(eq(transactions.ref, tx.ref), eq(transactions.status, "pending")))
      .returning();
    if (!updated) {
      return { transaction: await currentRow(db, tx), resolution: "already_resolved" };
    }
    logger.warn(
      `[ProviderResolution] ${tx.ref} resolved failed via status lookup`
    );
    return { transaction: updated, resolution: "failed" };
  }

  if (lookup.status === "pending") {
    return { transaction: tx, resolution: "still_pending" };
  }
  return { transaction: tx, resolution: "unknown" };
}
