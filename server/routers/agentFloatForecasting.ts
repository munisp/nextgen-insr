import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { agents, auditLog, transactions } from "../../drizzle/schema";
import { eq, sql, and, gte, count, sum, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { logger } from "../_core/logger";
import { getRedisClient, releaseLock } from "../lib/redisClient";
import {
  tbCreateTransfer,
  tbEnsureAgentAccount,
  type TBTransferRequest,
  type TBTransferResponse,
} from "../tbClient";

/**
 * Agent Float Forecasting Router
 * Predicts agent float demand using historical transaction patterns,
 * seasonal adjustments, and agent-level risk scoring.
 *
 * Business Rules:
 * - Forecast horizon: 7/14/30 days
 * - Stockout risk threshold: < 20% remaining float = HIGH risk
 * - Seasonal multiplier: Month-end (25th-5th) = 1.4x, Friday = 1.2x
 * - Agent tier adjustments: Super agents get 1.5x buffer recommendation
 * - Alert when predicted demand exceeds 80% of current premium reserve
 */

const TIER_BUFFERS: Record<string, number> = {
  super_agent: 1.5,
  senior: 1.3,
  standard: 1.1,
  probationary: 1.0,
};

// 2026-11-28 (W31): SEASONAL_MULTIPLIERS/getSeasonalMultiplier removed —
// they existed only to feed the fabricated getStats demand figure
// (hardcoded 200000/30 × seasonalFactor). The ported F-12 getStats (below)
// reports no seasonal factor; nothing honest consumed these constants.
// TIER_BUFFERS/calculateStockoutRisk remain dead-but-retained per the W30
// note (reserved for a future honest `list` design).

function calculateStockoutRisk(currentFloat: number, avgDailyDemand: number): { risk: string; daysRemaining: number } {
  if (avgDailyDemand <= 0) return { risk: "low", daysRemaining: 999 };
  const daysRemaining = Math.floor(currentFloat / avgDailyDemand);
  if (daysRemaining <= 1) return { risk: "critical", daysRemaining };
  if (daysRemaining <= 3) return { risk: "high", daysRemaining };
  if (daysRemaining <= 7) return { risk: "medium", daysRemaining };
  return { risk: "low", daysRemaining };
}

// ── W29 (2026-11-27): B17 trailing-average forecaster ported from main ──────
// Source: main server/routers/agentFloatForecasting.ts (computeForecasts +
// getForecast). Method 'trailing_average' — NO ML: daily net float outflow is
// the trailing average of (cash-out − cash-in) over the window (successful
// transactions only), projected forward over the horizon. Below
// MIN_HISTORY_DAYS distinct activity days the query FAILS LOUD
// (PRECONDITION_FAILED, INSUFFICIENT_DATA) — a thin history projected as a
// forecast would be fabrication.
// Documented portal deltas (main -> portal):
//  D1 tx vocabulary (REVERSED on 2026-11-28 merge back to main): the
//     portal delta ('Premium Payment'/'Claim Payout') no longer applies —
//     main's txTypeEnum HAS 'Cash In'/'Cash Out' and the forecast basis is
//     the same Cash In/Cash Out vocabulary as main's original (and as the
//     root integration test seeds). 'Transfer' remains excluded, mirrored.
//  D2 agentId: main accepts the agents.agentId string code; portal legacy
//     callers pass the numeric agents.id PK — both accepted (union), each
//     resolved to the PK, NOT_FOUND when the agent does not exist.
//  D3 horizon: portal legacy alias for days; resolution days ?? horizon ?? 7
//     (main's .default(7) preserved in effect).
const MIN_HISTORY_DAYS = 7;
const CASH_IN_TYPE = "Cash In";
const CASH_OUT_TYPE = "Cash Out";

// ── W31 (2026-11-28): B17 triggerReplenishment ported from main ─────────────
// Source: main server/routers/agentFloatForecasting.ts (replenishOne +
// triggerReplenishment). A replenishment is a REAL money movement:
// TigerBeetle double-entry (sys-bank-reserve → float-<agentId>) +
// authoritative agents.premiumReserve update + transactions audit row +
// audit_log entry, under a Redis lock, admin-gated. Failure posture
// (2026-11-27, W32-A): FAIL-CLOSED on every leg — the lock, the ledger
// leg, and the PG legs (balance + transaction row + audit row, one atomic
// transaction). D10–D13 below were fail-open weaknesses probe-proven by
// the W31-A verifier; they are FIXED on this path as of W32-A.
// Documented portal deltas (main -> portal), D4-D7:
//  D4 tx vocabulary (REVERSED on 2026-11-28 merge back to main): main's
//     txTypeEnum HAS 'Float Transfer Received' and txChannelEnum HAS
//     'Internal' — the audit row uses the in-enum type
//     'Float Transfer Received' and channel 'Internal' (main's original
//     labels); transfers remain excluded from the forecast basis.
//  D5 TB transfer code (REVERSED on 2026-11-28 merge): main's
//     floatManagement.topUp convention (code 100, CASH_IN — the same money
//     primitive) is kept; portal's code 300 was a portal-specific delta.
//  D6 MAX_FLOAT_NGN mirrors main's floatManagement MAX_FLOAT (₦5,000,000,
//     server/routers/floatManagement.ts) — identical value on both trees.
//  D7 audit row also records agentId (main's audit_log has the column too,
//     so this port survives the merge unchanged).
// 2026-11-27 (W32-A): the D10–D13 money-path weaknesses (probe-proven by
// the W31-A verifier) are FIXED on this path. Caller survey (2026-11-27;
// corrected after the W32-A verifier REVISE — the first draft's claim that
// "~30 call sites depend on the null-return contract" was WRONG on both
// the count and two characterizations): tbCreateTransfer is imported by
// ~30 non-wave files, but grep-visible `tbCreateTransfer(` hits number
// only 9 across 7 files, and 2 of those hits are doc-comment references
// (disputeMiddleware.ts:119, settlementMiddleware.ts:123) — leaving 7 REAL
// invocations in 7 files: transactions.ts:673, disputeMiddleware.ts:137,
// observabilityMiddleware.ts:98, commissionMiddleware.ts:188,
// settlementMiddleware.ts:142, txDisputeArbitration.ts:207 and
// settlementNettingEngine.ts:183. The remaining ~23 importers never call
// it. Of the 7 real invocations, the genuine fail-OPEN dependents on the
// null-return contract are transactions.ts:673 (null branches to the
// PG-only fallback "…persisted to PostgreSQL only", :692-696) and
// disputeMiddleware.ts:137 (returns null on a null result; its catch logs
// "(fail-open)" and returns null); observabilityMiddleware.ts:98,
// txDisputeArbitration.ts:207 and settlementNettingEngine.ts:183 are
// null-tolerant fire-and-forget audit/observability entries whose results
// are ignored. commissionMiddleware.ts:188 and settlementMiddleware.ts:142
// are FAIL-CLOSED wrappers — both THROW on null ("TigerBeetle returned
// null") and rethrow in catch (logged "(fail-closed)"). acquireLock is
// shared with permifyMiddleware's idempotency guard (a Redis outage there
// merely degrades duplicate detection — flip it to fail-closed and every
// idempotent financial procedure starts rejecting under Redis outage).
// The genuine fail-open dependents make a shared flip unsafe, so the
// shared modules were NOT changed; this router wraps them with fail-closed
// LOCAL helpers (acquireReplenishmentLock / strictTBCreateTransfer below):
//  D10 FIXED — TB leg was fail-OPEN on the portal tree (portal
//     tbCreateTransfer returned null on sidecar outage/timeout/rejection,
//     so replenishOne SUCCEEDED with the PG balance moved,
//     tbTransferId=null and tx metadata.tbSyncStatus "pending" — silent
//     PG/TB divergence; main's tbCreateTransfer already throws
//     TBLedgerUnavailableError instead). strictTBCreateTransfer is kept
//     as a local fail-closed guard: it throws on a falsy ledger result
//     BEFORE any PG write; ordering is TB-first-then-PG, and a PG failure
//     after the ledger leg committed triggers a compensating ledger
//     reversal (see replenishOne for the residual-window analysis).
//  D11 FIXED — Redis lock was fail-OPEN on the portal tree (acquireLock
//     `catch { return true }`: a Redis outage silently removed mutual
//     exclusion). Main's shared acquireLock is already fail-closed (F4);
//     this router's acquireReplenishmentLock still calls the Redis client
//     directly and DENIES the operation (PRECONDITION_FAILED) when the
//     backend errors, and fails CONFLICT on contention. releaseLock stays
//     shared/fail-open: a failed release self-heals via the lock TTL and
//     cannot strand funds.
//  D12 FIXED — lost-update race: replenishOne read premiumReserve before
//     the lock and wrote current+amount non-atomically (probe: concurrent
//     2500+2500 from 3000 gave PG 5500 vs TB 5000). Now the balance is
//     re-read INSIDE the lock (the handler's pre-lock read is only an
//     existence check) and the PG write is an atomic conditional UPDATE
//     ("premiumReserve" = COALESCE("premiumReserve",0)+$amt WHERE id=$id
//     AND COALESCE("premiumReserve",0)+$amt <= cap RETURNING) — no stale
//     read and no read-modify-write window, so concurrent top-ups cannot
//     lose an update even if the lock were bypassed entirely.
//  D13 FIXED — audit_log insert had `.catch(() => {})`, silently dropping
//     audit-write failure (a replenishment could persist with NO audit
//     row). Now the audit insert runs inside the same PG transaction as
//     the balance credit and transaction row with NO catch: an audit
//     failure aborts and rolls back the whole operation (and triggers the
//     ledger compensation). Audit is part of the funds trail — a money
//     movement without its audit row cannot persist.
const MAX_FLOAT_NGN = 5_000_000;
const AUTO_REPLENISH_CAP = 25;

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

const round2 = (n: number) => Math.round(n * 100) / 100;

type AgentFlowRow = {
  agentPk: number;
  cashIn: string | number;
  cashOut: string | number;
  activeDays: number;
  dataPoints: number;
};

// Portal getDb() returns an any-typed instance (noop-proxy union), so awaited
// query rows are `any`; row types are asserted explicitly (main's flowRows
// cast pattern) to keep strict use-site checking.
type AgentRow = {
  id: number;
  agentId: string;
  name: string;
  location: string | null;
  premiumReserve: string | number | null;
};

export type FloatForecast = {
  id: string; // agents.agentId
  name: string;
  location?: string;
  currentFloat: number;
  avgDailyVolume: number;
  avgDailyNetOutflow: number;
  predictedNeed: number;
  shortfall: number;
  risk: "low" | "medium" | "high" | "critical";
  activeDays: number;
};

/**
 * Compute trailing-average forecasts from the transactions table.
 * windowDays = max(horizonDays, MIN_HISTORY_DAYS): the history window is
 * never shorter than the minimum-history requirement, so the 1d horizon
 * still forecasts from a 7-day window.
 */
async function computeForecasts(
  db: Db,
  horizonDays: number,
  agentPk?: number
): Promise<{
  method: "trailing_average";
  windowDays: number;
  horizonDays: number;
  historyDayCount: number;
  minHistoryDays: number;
  dataPoints: number;
  forecasts: FloatForecast[];
}> {
  const windowDays = Math.max(horizonDays, MIN_HISTORY_DAYS);
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const scope = [
    gte(transactions.createdAt, since),
    eq(transactions.status, "success"),
    inArray(transactions.type, [CASH_IN_TYPE, CASH_OUT_TYPE]),
    agentPk != null ? eq(transactions.agentId, agentPk) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c != null);

  const flowRows = (await db
    .select({
      agentPk: transactions.agentId,
      cashIn: sql<string>`coalesce(sum(cast(${transactions.amount} as numeric)) filter (where ${transactions.type} = ${CASH_IN_TYPE}), 0)`,
      cashOut: sql<string>`coalesce(sum(cast(${transactions.amount} as numeric)) filter (where ${transactions.type} = ${CASH_OUT_TYPE}), 0)`,
      activeDays: sql<number>`count(distinct date_trunc('day', ${transactions.createdAt}))::int`,
      dataPoints: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .where(and(...scope))
    .groupBy(transactions.agentId)) as AgentFlowRow[];

  const [historyRow] = await db
    .select({
      days: sql<number>`count(distinct date_trunc('day', ${transactions.createdAt}))::int`,
    })
    .from(transactions)
    .where(and(...scope));
  const historyDayCount = Number(historyRow?.days ?? 0);

  if (historyDayCount < MIN_HISTORY_DAYS) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        `INSUFFICIENT_DATA: only ${historyDayCount} day(s) of successful ` +
        `${CASH_IN_TYPE}/${CASH_OUT_TYPE} history in the trailing ${windowDays}-day window ` +
        `(minimum ${MIN_HISTORY_DAYS} required for a trailing-average forecast)`,
    });
  }

  const agentRows = (await db
    .select({
      id: agents.id,
      agentId: agents.agentId,
      name: agents.name,
      location: agents.location,
      premiumReserve: agents.premiumReserve,
    })
    .from(agents)
    .where(
      agentPk != null
        ? eq(agents.id, agentPk)
        : flowRows.length > 0
          ? inArray(
              agents.id,
              flowRows.map(r => r.agentPk)
            )
          : sql`false`
    )) as AgentRow[];
  const byPk = new Map(agentRows.map(a => [a.id, a] as const));

  let dataPoints = 0;
  const forecasts: FloatForecast[] = [];
  for (const flow of flowRows) {
    const agent = byPk.get(flow.agentPk);
    if (!agent) continue;
    const cashIn = Number(flow.cashIn);
    const cashOut = Number(flow.cashOut);
    dataPoints += Number(flow.dataPoints);
    const avgDailyNetOutflow = (cashOut - cashIn) / windowDays;
    const predictedNeed = round2(Math.max(0, avgDailyNetOutflow * horizonDays));
    const currentFloat = round2(Number(agent.premiumReserve ?? 0));
    const shortfall = round2(Math.max(0, predictedNeed - currentFloat));
    const risk: FloatForecast["risk"] =
      shortfall <= 0
        ? "low"
        : currentFloat <= 0 || shortfall >= currentFloat
          ? "critical"
          : shortfall >= 0.5 * currentFloat
            ? "high"
            : "medium";
    forecasts.push({
      id: agent.agentId,
      name: agent.name,
      ...(agent.location != null ? { location: agent.location } : {}),
      currentFloat,
      avgDailyVolume: round2((cashIn + cashOut) / windowDays),
      avgDailyNetOutflow: round2(avgDailyNetOutflow),
      predictedNeed,
      shortfall,
      risk,
      activeDays: Number(flow.activeDays),
    });
  }
  forecasts.sort((a, b) => b.shortfall - a.shortfall);
  return {
    method: "trailing_average",
    windowDays,
    horizonDays,
    historyDayCount,
    minHistoryDays: MIN_HISTORY_DAYS,
    dataPoints,
    forecasts,
  };
}

/**
 * 2026-11-27 (W32-A, D11): fail-CLOSED replenishment lock. On the portal
 * tree the shared redisClient.acquireLock was fail-OPEN
 * (`catch { return true }`); on MAIN the shared acquireLock is already
 * fail-CLOSED (F4 — returns false on a Redis error, see
 * server/lib/redisClient.ts). This local helper is retained after the
 * 2026-11-28 merge because its contract is STRONGER than the shared one:
 * it distinguishes backend-unavailable (PRECONDITION_FAILED — refuse to
 * move money without mutual exclusion) from mere contention (CONFLICT),
 * where the shared helper conflates both into `false`. Calls the Redis
 * client directly and DENIES the operation when the lock backend errors.
 */
async function acquireReplenishmentLock(
  agentId: string,
  lockKey: string,
  ttlMs: number
): Promise<void> {
  let result: string | null;
  try {
    result = await getRedisClient().set(
      `lock:${lockKey}`,
      "1",
      "PX",
      ttlMs,
      "NX"
    );
  } catch (err) {
    logger.error(
      `[FloatForecast] lock backend error acquiring ${lockKey} — replenishment DENIED (fail-closed): ${err}`
    );
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "triggerReplenishment: lock backend unavailable — refusing to move money without mutual exclusion (fail-closed)",
    });
  }
  if (result !== "OK") {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Another replenishment is in progress for agent ${agentId}`,
    });
  }
}

/**
 * 2026-11-27 (W32-A, D10): fail-CLOSED wrapper around the shared
 * tbCreateTransfer. On the portal tree the shared helper returned null on
 * sidecar outage/timeout/rejection (fail-open); on MAIN the shared helper
 * is ALREADY fail-closed (throws TBLedgerUnavailableError on outage,
 * timeout, or HTTP rejection — see server/tbClient.ts, F-04). The wrapper
 * is retained after the 2026-11-28 merge as a local defense-in-depth guard:
 * this money path must never treat a falsy ledger result as success, even
 * if the shared contract ever drifts back. A null/empty result throws
 * BEFORE any PG write, so a failed ledger leg can never produce a phantom
 * PG balance.
 */
async function strictTBCreateTransfer(
  req: TBTransferRequest
): Promise<TBTransferResponse> {
  const result = await tbCreateTransfer(req);
  if (!result) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "triggerReplenishment: TigerBeetle ledger leg failed or is unreachable — replenishment refused, no funds moved (fail-closed)",
    });
  }
  return result;
}

/**
 * Execute ONE real float replenishment: TigerBeetle double-entry
 * (sys-bank-reserve → float-{agentId}) + atomic PG balance credit +
 * transaction row + audit entry. Same money primitives as
 * transactions.create's float-credit path.
 * W31 (2026-11-28): ported from main; portal deltas D4/D5/D7 above.
 * 2026-11-27 (W32-A): failure posture hardened fail-closed (fixes D10–D13):
 *  - the lock is fail-CLOSED (a Redis error denies the operation);
 *  - the ledger leg is fail-CLOSED and runs BEFORE the PG legs — a ledger
 *    failure throws and no PG state is touched;
 *  - the PG legs (balance credit + transaction row + audit row) commit as
 *    ONE transaction — any failure (including the audit insert) rolls all
 *    three back;
 *  - if the PG transaction fails after the ledger leg committed, a
 *    compensating ledger reversal (float-{agentId} → sys-bank-reserve) is
 *    posted. RESIDUAL WINDOW: if the compensation itself fails, PG and TB
 *    diverge (TB ahead by amountNGN) until manual reconciliation — that
 *    window is LOUD (logger.error with agent/amount/tbTransferId/ref) and
 *    detectable by comparing agents.premiumReserve against the TB
 *    /agent/{id}/balance endpoint; it is never silent.
 */
async function replenishOne(
  db: Db,
  // 2026-11-27 (W32-A, D12): the handler's pre-lock agent row is used only
  // for the NOT_FOUND existence check and the id/agentId pair — its
  // premiumReserve is NEVER trusted for money (stale by construction).
  agent: { id: number; agentId: string },
  amountNGN: number,
  reference: string
): Promise<{ agentId: string; amountNGN: number; ref: string; newBalanceNGN: number; tbTransferId: string }> {
  const lockKey = `float-replenish:${agent.agentId}`;
  // 2026-11-27 (W32-A, D11): fail-closed — throws CONFLICT on contention,
  // PRECONDITION_FAILED when the lock backend is down.
  await acquireReplenishmentLock(agent.agentId, lockKey, 15_000);
  try {
    // 2026-11-27 (W32-A, D12): FRESH balance read INSIDE the lock.
    const [fresh] = (await db
      .select({ premiumReserve: agents.premiumReserve })
      .from(agents)
      .where(eq(agents.id, agent.id))
      .limit(1)) as { premiumReserve: string | number | null }[];
    if (!fresh) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `triggerReplenishment: agent '${agent.agentId}' no longer exists`,
      });
    }
    const currentBalance = Number(fresh.premiumReserve ?? 0);
    // Pre-flight cap check (inside the lock): avoids posting a ledger leg
    // that would only have to be compensated. The atomic UPDATE below
    // repeats the cap as a WHERE guard — THAT guard is authoritative.
    if (currentBalance + amountNGN > MAX_FLOAT_NGN) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          `triggerReplenishment: replenishing ${agent.agentId} by ₦${amountNGN.toLocaleString()} ` +
          `would exceed the ₦${MAX_FLOAT_NGN.toLocaleString()} max float ` +
          `(current ₦${currentBalance.toLocaleString()})`,
      });
    }
    // 2026-11-28 (merge note): on main, tbEnsureAgentAccount is itself
    // fail-closed (throws TBLedgerUnavailableError when the sidecar is
    // unreachable) — portal treated it as best-effort. Either way the
    // strict transfer below is the authoritative ledger gate.
    await tbEnsureAgentAccount(agent.agentId);
    // 2026-11-27 (W32-A, D10): fail-closed ledger leg, TB-first-then-PG —
    // throws before any PG write when the ledger cannot commit.
    const tbResult = await strictTBCreateTransfer({
      debitAccountId: "sys-bank-reserve",
      creditAccountId: `float-${agent.agentId}`,
      amount: Math.round(amountNGN * 100),
      ledger: 2000,
      code: 100, // CASH_IN — main's floatManagement.topUp convention (D5 reversed on merge)
      ref: reference,
      txType: "Float Top-Up",
      agentId: agent.agentId,
    });
    let newBalance: number;
    try {
      // 2026-11-27 (W32-A, D12/D13): the three PG legs are ONE atomic
      // transaction. The balance credit is a conditional additive UPDATE
      // (lost-update-proof: PostgreSQL computes premiumReserve+$amt at
      // write time under the row lock); the audit insert has NO catch, so
      // an audit failure rolls back the balance credit and the
      // transaction row with it.
      // 2026-11-28 (merge): tx is typed from main's getDb() (the portal's
      // getDb returned an any-typed noop-proxy union, hence the portal
      // annotated the callback parameter as `any` — which tripped main's
      // no-unsafe-call ratchet; the typed form is required here).
      newBalance = await db.transaction(async (tx) => {
        const upd = (await tx.execute(
          sql`UPDATE "agents"
              SET "premiumReserve" = COALESCE("premiumReserve", 0) + ${amountNGN},
                  "updatedAt" = now()
              WHERE "id" = ${agent.id}
                AND COALESCE("premiumReserve", 0) + ${amountNGN} <= ${MAX_FLOAT_NGN}
              RETURNING "premiumReserve"`
        )) as unknown as { rows: { premiumReserve: string | number }[] };
        const row = upd.rows[0];
        if (!row) {
          // Defense-in-depth: reachable only if a writer outside this lock
          // raced the pre-flight cap check above.
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              `triggerReplenishment: replenishing ${agent.agentId} by ₦${amountNGN.toLocaleString()} ` +
              `would exceed the ₦${MAX_FLOAT_NGN.toLocaleString()} max float ` +
              `(re-checked atomically at write time)`,
          });
        }
        await tx.insert(transactions).values({
          ref: reference,
          agentId: agent.id,
          // D4 reversed on merge: main's enum HAS 'Float Transfer Received'
          // and channel 'Internal' — the audit row uses them directly
          // (main's original labels).
          type: "Float Transfer Received",
          amount: String(amountNGN),
          fee: "0",
          commission: "0",
          channel: "Internal",
          status: "success",
          fraudScore: "0.00",
          metadata: {
            source: "agentFloatForecasting.triggerReplenishment",
            // 2026-11-27 (W32-A, D10): the ledger leg is fail-closed now —
            // reaching this row means the transfer committed, so
            // tbSyncStatus is always "synced" and tbTransferId is never
            // null. The "pending" marker is retained in the vocabulary for
            // historical rows only.
            tbSyncStatus: "synced",
            tbTransferId: tbResult.id,
          },
        });
        // 2026-11-27 (W32-A, D13): NO `.catch(() => {})` — the audit row is
        // part of the funds trail; if this insert fails the whole
        // transaction aborts (balance credit + transaction row roll back)
        // and the ledger leg is compensated below.
        await tx.insert(auditLog).values({
          agentId: agent.id, // D7: portal audit_log carries agentId
          action: "FLOAT_REPLENISH",
          resource: "agent_float",
          resourceId: String(agent.id),
          status: "success",
          metadata: {
            agentId: agent.agentId,
            amountNGN,
            newBalance: Number(row.premiumReserve),
            ref: reference,
            tbTransferId: tbResult.id,
          },
        });
        return Number(row.premiumReserve);
      });
    } catch (pgErr) {
      // The ledger leg committed but PostgreSQL did not — compensate
      // (reverse) the ledger leg so the system state stays explainable.
      // 2026-11-28 (merge adjustment): main's shared tbCreateTransfer is
      // FAIL-CLOSED — it throws TBLedgerUnavailableError instead of
      // returning null — so the compensation outcome is captured by
      // try/catch rather than a null check.
      let compensation: TBTransferResponse | null = null;
      try {
        compensation = await tbCreateTransfer({
          debitAccountId: `float-${agent.agentId}`,
          creditAccountId: "sys-bank-reserve",
          amount: Math.round(amountNGN * 100),
          ledger: 2000,
          code: 100, // CASH_IN — compensation of the same primitive (D5 reversed)
          ref: `CMP-${reference}`.slice(0, 32),
          txType: "Float Top-Up Reversal",
          agentId: agent.agentId,
        });
        logger.warn(
          `[FloatForecast] Replenishment aborted after the ledger leg committed; compensation transfer ${compensation.id} reversed ₦${amountNGN} for agent ${agent.agentId} (ref ${reference}, original tbTransferId ${tbResult.id}) — PG and TB consistent, no funds moved`
        );
      } catch {
        compensation = null;
        // The ONLY residual divergence window: TB holds a credit that PG
        // does not, and the reversal failed too. LOUD by design — every
        // identifier needed for manual reconciliation is in this line.
        logger.error(
          `[FloatForecast] CRITICAL PG/TB DIVERGENCE: replenishment aborted after the ledger leg committed AND compensation failed — agent ${agent.agentId}, amount ₦${amountNGN}, tbTransferId ${tbResult.id}, ref ${reference}. Manual reconciliation required (compare agents.premiumReserve with TB /agent/${agent.agentId}/balance).`
        );
      }
      if (pgErr instanceof TRPCError) throw pgErr;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          `triggerReplenishment: database write failed for agent ${agent.agentId} after the ledger leg committed; ` +
          (compensation
            ? "the ledger leg was compensated (reversed) — no funds moved"
            : `compensation ALSO failed — PG/TB divergence logged for manual reconciliation (tbTransferId ${tbResult.id}, ref ${reference})`),
      });
    }
    logger.info(
      `[FloatForecast] Replenished ₦${amountNGN} for agent ${agent.agentId} | TB: ${tbResult.id}`
    );
    return {
      agentId: agent.agentId,
      amountNGN,
      ref: reference,
      newBalanceNGN: newBalance,
      tbTransferId: tbResult.id,
    };
  } finally {
    // 2026-11-27 (W32-A): release stays fail-open (shared helper) — a
    // failed release self-heals via the lock TTL, so it cannot strand
    // funds or deadlock the path.
    await releaseLock(lockKey);
  }
}

// transactions.ref is varchar(32): RPL- + base36 timestamp + random suffix.
const newReplenishRef = () =>
  `RPL-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 15)}`.slice(
    0,
    32
  );

export const agentFloatForecastingRouter = router({
  // 2026-11-27 (W30): converted to fail-loud NOT_IMPLEMENTED. The previous
  // body fabricated its numbers: it read `agent.monthlyTarget` (no such
  // column on the agents table — the read always fell through to the
  // hardcoded 200000/30 "average daily demand"), fell back to a hardcoded
  // 50000 float when premiumReserve was NULL, and reported a hardcoded
  // confidence: 0.85. No honest per-row source exists for that shape: the
  // real ported forecaster (computeForecasts, used by getForecast below) is
  // fleet/window-scoped, deliberately fails loud below MIN_HISTORY_DAYS of
  // history, and emits a different contract (avgDailyNetOutflow/
  // predictedNeed/shortfall/risk) — it cannot populate list's paginated
  // per-agent {avgDailyDemand, seasonalMultiplier, forecastedDemand7d,
  // recommendedTopUp, stockoutRisk, daysUntilStockout, confidence} rows
  // without re-inventing them. No client consumes this procedure
  // (client/src/pages/AgentFloatForecasting.tsx uses getStats/getForecast),
  // so fail-loud is the honest disposition. A future honest list would page
  // agents and join each against computeForecasts output — a design item.
  list: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
      riskFilter: z.enum(["all", "critical", "high", "medium", "low"]).default("all"),
    }))
    .query(async () => {
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message:
          "agentFloatForecasting.list is not implemented: its per-agent demand figures were derived from a nonexistent agents.monthlyTarget column with hardcoded fallbacks (fabrication). Use agentFloatForecasting.getForecast for the real trailing-average forecast.",
      });
    }),

  // W29 (2026-11-27): REAL trailing-average forecast (main B17 semantics) —
  // fleet-wide when agentId is absent, fail-loud on insufficient history.
  // Backward compatible: legacy { agentId: <numeric PK>, horizon: "7"|"14"|"30" }
  // calls resolve to the same forecast, scoped to that agent (deltas D2/D3
  // above). The previous monthlyTarget-based projection is replaced: the
  // agents table has no monthlyTarget column — it was fabrication.
  getForecast: protectedProcedure
    .input(
      z.object({
        days: z.number().int().min(1).max(90).optional(),
        horizon: z.enum(["7", "14", "30"]).optional(),
        agentId: z
          .union([z.number().int().positive(), z.string().min(1)])
          .optional(),
      })
    )
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "agentFloatForecasting.getForecast: database unavailable",
        });
      }
      const horizonDays =
        input.days ?? (input.horizon ? parseInt(input.horizon, 10) : 7);
      let agentPk: number | undefined;
      if (typeof input.agentId === "number") {
        const [agent] = await database
          .select({ id: agents.id })
          .from(agents)
          .where(eq(agents.id, input.agentId))
          .limit(1);
        if (!agent) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `getForecast: agent id ${input.agentId} not found`,
          });
        }
        agentPk = agent.id;
      } else if (typeof input.agentId === "string") {
        const [agent] = await database
          .select({ id: agents.id })
          .from(agents)
          .where(eq(agents.agentId, input.agentId))
          .limit(1);
        if (!agent) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `getForecast: agent '${input.agentId}' not found`,
          });
        }
        agentPk = agent.id;
      }
      const result = await computeForecasts(database, horizonDays, agentPk);
      return { ...result, generatedAt: new Date().toISOString() };
    }),

  // W31 (2026-11-28): ported from main's F-12 getStats (real aggregates over
  // agents.premiumReserve + transactions), replacing the fabricated body
  // (agentCount × hardcoded 50000 float, agentCount × 0.12 stockout risk,
  // hardcoded avgAccuracy 0.85, demand from a hardcoded 200000/30 —
  // confirmed fabrication in the W30 verifier pass).
  // Documented portal deltas (main -> portal):
  //  D8 db-unavailable: main returns a zeroed payload; portal fails closed
  //     (PRECONDITION_FAILED) per the W29/W30 house rule — zeros on outage
  //     are indistinguishable from a real empty fleet (fabrication).
  //  D9 predictedDemand7d: consumed by client/src/pages/
  //     AgentFloatForecasting.tsx:262 but absent from main's shape. Real
  //     source: sum of the ported forecaster's per-agent 7-day
  //     predictedNeed (same trailing-average basis as getForecast). null
  //     when trailing history is below MIN_HISTORY_DAYS
  //     (INSUFFICIENT_DATA) — no honest basis exists, so none is invented;
  //     any other forecaster error propagates.
  //  STOP avgAccuracy (page :275): no honest source exists — there is no
  //     forecast-accuracy telemetry table and the method is a trailing
  //     average, not a scored model, so no measured accuracy can be
  //     computed. The field is emitted as explicit null (never a fabricated
  //     number); null documents "no measurement exists" in-band and keeps
  //     the page's pre-existing `?? 94.7` client fallback (client debt,
  //     out of W31-A scope, flagged in w31a-report) type-checking.
  //  NOTE stockoutRisk is main's definition: the PERCENTAGE of monitored
  //     agents whose premiumReserve <= 0 (0-100). The page labels it
  //     "Agents Below Threshold" and renders it as a count next to
  //     agentsMonitored (:247-250) — a client display-semantics mismatch,
  //     flagged in w31a-report (client files are out of W31-A scope).
  getStats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "agentFloatForecasting.getStats: database unavailable",
      });
    }
    const [{ total: a }] = await db.select({ total: count() }).from(agents);
    const [{ total: t }] = await db
      .select({ total: count() })
      .from(transactions);
    // F-12: real float aggregates from agents.premiumReserve — the
    // ledger-backed float balance this router forecasts against.
    const [floatRow] = await db
      .select({
        totalFloat: sum(agents.premiumReserve),
        atRisk: sql<number>`count(*) filter (where cast(${agents.premiumReserve} as numeric) <= 0)::int`,
      })
      .from(agents);
    const totalAgents = Number(a ?? 0);
    const atRisk = Number(floatRow?.atRisk ?? 0);
    // D9: real 7-day predicted demand from the same forecaster getForecast
    // exposes; null when the history floor is not met.
    let predictedDemand7d: number | null;
    try {
      const { forecasts } = await computeForecasts(db, 7);
      predictedDemand7d = round2(
        forecasts.reduce((acc, f) => acc + f.predictedNeed, 0)
      );
    } catch (err) {
      if (err instanceof TRPCError && err.code === "PRECONDITION_FAILED") {
        predictedDemand7d = null;
      } else {
        throw err;
      }
    }
    return {
      totalAgents,
      agentsMonitored: totalAgents,
      totalFloat: Number(floatRow?.totalFloat ?? 0),
      stockoutRisk:
        totalAgents > 0 ? Math.round((atRisk / totalAgents) * 100) : 0,
      totalTransactions: Number(t ?? 0),
      predictedDemand7d,
      // STOP field: no honest accuracy source — explicit null, never a
      // fabricated score (see comment above).
      avgAccuracy: null,
      lastUpdated: new Date().toISOString(),
    };
  }),

  // W31 (2026-11-28): REAL replenishment ported from main B17 — TB
  // double-entry + PG balance + transaction row + audit entry, admin-gated.
  // agentId 'all-below-threshold' replenishes every agent whose computed
  // 7-day shortfall is positive, by exactly that shortfall. Fixes the
  // pre-existing contract drift: client/src/pages/AgentFloatForecasting.tsx
  // (:162, :192, :289) called this procedure while the server router did
  // not implement it.
  triggerReplenishment: adminProcedure
    .input(
      z.object({
        agentId: z.string().min(1),
        amount: z.number().positive().max(MAX_FLOAT_NGN),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "agentFloatForecasting.triggerReplenishment: database unavailable",
        });
      }
      if (input.agentId === "all-below-threshold") {
        // Auto mode: the passed amount is a UI artifact; each agent is
        // topped up by its OWN computed shortfall — never a blanket figure.
        const { forecasts } = await computeForecasts(db, 7);
        const targets = forecasts
          .filter(f => f.shortfall > 0)
          .slice(0, AUTO_REPLENISH_CAP);
        const replenished = [];
        for (const target of targets) {
          const [agent] = await db
            .select({
              id: agents.id,
              agentId: agents.agentId,
              premiumReserve: agents.premiumReserve,
            })
            .from(agents)
            .where(eq(agents.agentId, target.id))
            .limit(1);
          if (!agent) continue;
          replenished.push(
            await replenishOne(db, agent, target.shortfall, newReplenishRef())
          );
        }
        return {
          mode: "auto" as const,
          basis:
            "per-agent 7-day trailing-average shortfall (not the requested blanket amount)",
          replenished,
          cappedAt: AUTO_REPLENISH_CAP,
        };
      }
      const [agent] = await db
        .select({
          id: agents.id,
          agentId: agents.agentId,
          premiumReserve: agents.premiumReserve,
        })
        .from(agents)
        .where(eq(agents.agentId, input.agentId))
        .limit(1);
      if (!agent) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `triggerReplenishment: agent '${input.agentId}' not found`,
        });
      }
      const result = await replenishOne(
        db,
        agent,
        input.amount,
        newReplenishRef()
      );
      return { mode: "single" as const, replenished: [result] };
    }),
// 2026-11-28 (merge): root-only procedure kept (the portal tree never had
  // it; no client consumes it). Root's original returned a fabricated
  // { total: 0 } when the DB was unavailable — indistinguishable from an
  // empty fleet — so the merged version is fail-closed (PRECONDITION_FAILED)
  // per this file's D8/W29-W30 house rule; no assertion relied on the old
  // zero payload (nothing calls this procedure).
  getSummary: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "agentFloatForecasting.getSummary: database unavailable",
      });
    }
    const [{ total }] = await db.select({ total: count() }).from(transactions);
    return { total: Number(total ?? 0), lastUpdated: new Date().toISOString() };
  }),
});
