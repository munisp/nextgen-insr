/**
 * floatReconciliation.ts — Float Reconciliation (PAY-6)
 *
 * REAL comparison logic (the previous header claimed "TigerBeetle atomicity,
 * Redis idempotency" while the file only listed transactions — that claim was
 * false and has been removed):
 *
 *   - checkAgentBalances derives each agent's expected float from the
 *     durable transaction ledger (signed SUM over settled float-affecting
 *     transaction types) and compares it against agents.premiumReserve,
 *     returning only agents whose stored balance diverges.
 *   - list/getSummary remain simple transaction browsers (honest contract).
 *
 * TB-vs-PG divergence detection runs in the Go float-reconciler service; its
 * durable correction rows are surfaced via paymentReconciliation.
 */
import { desc, count, sql } from "drizzle-orm";
import { z } from "zod";

import { transactions } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

/** Credit-minus-debit per agent over settled float-affecting transactions. */
const FLOAT_NET_SQL = sql`
  SELECT "agentId",
         COALESCE(SUM(CASE
           WHEN type IN ('Float Transfer Received','Cash In','Float Top-Up') THEN CAST(amount AS NUMERIC)
           WHEN type IN ('Float Transfer','Cash Out','Float Withdrawal') THEN -CAST(amount AS NUMERIC)
           ELSE 0 END), 0) AS net
    FROM transactions
   WHERE status = 'success' AND "deletedAt" IS NULL
   GROUP BY "agentId"
`;

export const floatReconciliationRouter = router({
  list: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(20), offset: z.number().min(0).default(0) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { data: [], total: 0 };
      const results = await db.select().from(transactions).orderBy(desc(transactions.createdAt)).limit(input.limit).offset(input.offset);
      const [{ total }] = await db.select({ total: count() }).from(transactions);
      return { data: results, total: Number(total) };
    }),
  getSummary: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { total: 0 };
    const [{ total }] = await db.select({ total: count() }).from(transactions);
    return { total: Number(total), lastUpdated: new Date().toISOString() };
  }),

  /**
   * REAL divergence check: compare the transaction-derived net float per
   * agent against agents.premiumReserve and return only mismatches.
   * Note: this compares PG-recorded flows against the PG balance column —
   * it cannot detect ledger legs that never reached PG at all (that is the
   * Go float-reconciler's job against TigerBeetle).
   */
  checkAgentBalances: protectedProcedure
    .input(z.object({ toleranceNGN: z.number().min(0).default(0.01) }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { discrepancies: [], checked: 0 };
      const tolerance = input?.toleranceNGN ?? 0.01;
      const rows = await db.execute(sql`
        SELECT a.id AS "agentDbId", a."agentId" AS "agentCode",
               CAST(a."premiumReserve" AS NUMERIC) AS recorded,
               COALESCE(f.net, 0) AS derived
          FROM agents a
          LEFT JOIN (${FLOAT_NET_SQL}) f ON f."agentId" = a.id
      `);
      const discrepancies: {
        agentDbId: number; agentCode: string;
        recordedNGN: number; derivedNGN: number; divergenceNGN: number;
      }[] = [];
      let checked = 0;
      for (const r of rows.rows as any[]) {
        checked++;
        const recorded = Number(r.recorded ?? 0);
        const derived = Number(r.derived ?? 0);
        const divergence = recorded - derived;
        if (Math.abs(divergence) > tolerance) {
          discrepancies.push({
            agentDbId: Number(r.agentDbId),
            agentCode: String(r.agentCode),
            recordedNGN: recorded,
            derivedNGN: derived,
            divergenceNGN: divergence,
          });
        }
      }
      return { discrepancies, checked, toleranceNGN: tolerance, comparedAt: new Date().toISOString() };
    }),
});
