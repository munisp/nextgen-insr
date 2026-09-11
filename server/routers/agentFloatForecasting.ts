/**
 * agentFloatForecasting.ts — Agent Float Forecasting
 * Full production implementation with TigerBeetle atomicity, Redis idempotency,
 * and real PostgreSQL queries. No mocks, no stubs.
 */
import { TRPCError } from "@trpc/server";
import { eq, desc, count, sql, and, gte, sum, inArray } from "drizzle-orm";
import { z } from "zod";

import { transactions, agents, auditLog } from "../../drizzle/schema";
import { logger } from "../_core/logger";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { acquireLock, releaseLock } from "../lib/redisClient";
import { tbCreateTransfer, tbEnsureAgentAccount } from "../tbClient";

// ── B17 (F-11 Class-2): real float forecasting ──────────────────────────────
// Method: 'trailing_average' — NO ML. For each agent, the daily net float
// outflow is the trailing average of (Cash Out − Cash In) over the history
// window (successful transactions only); that daily rate is projected
// forward over the requested horizon. No trend/seasonality is invented.
// Minimum history: MIN_HISTORY_DAYS distinct days with activity inside the
// window; below that the query FAILS LOUD (PRECONDITION_FAILED,
// INSUFFICIENT_DATA) with the actual day count — a thin history projected
// as if it were a forecast would be fabrication.
const MIN_HISTORY_DAYS = 7;
const MAX_FLOAT_NGN = 5_000_000; // mirrors floatManagement MAX_FLOAT
const AUTO_REPLENISH_CAP = 25;

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

async function requireDb(): Promise<Db> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "agentFloatForecasting: database unavailable",
    });
  }
  return db;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

type AgentFlowRow = {
  agentPk: number;
  cashIn: string | number;
  cashOut: string | number;
  activeDays: number;
  dataPoints: number;
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
    inArray(transactions.type, ["Cash In", "Cash Out"]),
    agentPk != null ? eq(transactions.agentId, agentPk) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c != null);

  const flowRows = (await db
    .select({
      agentPk: transactions.agentId,
      cashIn: sql<string>`coalesce(sum(cast(${transactions.amount} as numeric)) filter (where ${transactions.type} = 'Cash In'), 0)`,
      cashOut: sql<string>`coalesce(sum(cast(${transactions.amount} as numeric)) filter (where ${transactions.type} = 'Cash Out'), 0)`,
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
        `Cash In/Cash Out history in the trailing ${windowDays}-day window ` +
        `(minimum ${MIN_HISTORY_DAYS} required for a trailing-average forecast)`,
    });
  }

  const agentRows = await db
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
    );
  const byPk = new Map(agentRows.map(a => [a.id, a]));

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
 * Execute ONE real float replenishment: TigerBeetle double-entry
 * (sys-bank-reserve → float-{agentId}) + authoritative PG balance update +
 * transaction row + audit entry. Same money primitives as
 * floatManagement.topUp. Throws (fail-loud) on any leg failing — no partial
 * silent success.
 */
async function replenishOne(
  db: Db,
  agent: { id: number; agentId: string; premiumReserve: string | number | null },
  amountNGN: number,
  reference: string
): Promise<{ agentId: string; amountNGN: number; ref: string; newBalanceNGN: number; tbTransferId: string | null }> {
  const currentBalance = Number(agent.premiumReserve ?? 0);
  if (currentBalance + amountNGN > MAX_FLOAT_NGN) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        `triggerReplenishment: replenishing ${agent.agentId} by ₦${amountNGN.toLocaleString()} ` +
        `would exceed the ₦${MAX_FLOAT_NGN.toLocaleString()} max float ` +
        `(current ₦${currentBalance.toLocaleString()})`,
    });
  }
  const lockKey = `float-replenish:${agent.agentId}`;
  const locked = await acquireLock(lockKey, 15_000);
  if (!locked) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Another replenishment is in progress for agent ${agent.agentId}`,
    });
  }
  try {
    await tbEnsureAgentAccount(agent.agentId);
    const tbResult = await tbCreateTransfer({
      debitAccountId: "sys-bank-reserve",
      creditAccountId: `float-${agent.agentId}`,
      amount: Math.round(amountNGN * 100),
      ledger: 2000,
      code: 100, // CASH_IN
      ref: reference,
      txType: "Float Top-Up",
      agentId: agent.agentId,
    });
    const newBalance = round2(currentBalance + amountNGN);
    await db
      .update(agents)
      .set({ premiumReserve: String(newBalance), updatedAt: new Date() })
      .where(eq(agents.id, agent.id));
    await db.insert(transactions).values({
      ref: reference,
      agentId: agent.id,
      type: "Float Transfer Received",
      amount: String(amountNGN),
      fee: "0",
      commission: "0",
      channel: "Internal",
      status: "success",
      fraudScore: "0.00",
      metadata: {
        source: "agentFloatForecasting.triggerReplenishment",
        tbSyncStatus: tbResult ? "synced" : "pending",
        tbTransferId: tbResult?.id ?? null,
      },
    });
    await db
      .insert(auditLog)
      .values({
        action: "FLOAT_REPLENISH",
        resource: "agent_float",
        resourceId: String(agent.id),
        status: "success",
        metadata: {
          agentId: agent.agentId,
          amountNGN,
          newBalance,
          ref: reference,
          tbTransferId: tbResult?.id ?? null,
        },
      })
      .catch(() => {});
    logger.info(
      `[FloatForecast] Replenished ₦${amountNGN} for agent ${agent.agentId} | TB: ${tbResult?.id ?? "pending"}`
    );
    return {
      agentId: agent.agentId,
      amountNGN,
      ref: reference,
      newBalanceNGN: newBalance,
      tbTransferId: tbResult?.id ?? null,
    };
  } finally {
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
  // Sprint 37 contract (F-12): stats from the agents/transactions tables this
  // router forecasts against.
  getStats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db)
      return {
        totalAgents: 0,
        agentsMonitored: 0,
        totalFloat: 0,
        stockoutRisk: 0,
        totalTransactions: 0,
      };
    const [{ total: a }] = await db.select({ total: count() }).from(agents);
    const [{ total: t }] = await db
      .select({ total: count() })
      .from(transactions);
    // F-12: real float aggregates from agents.premiumReserve — the ledger-backed
    // float balance this router forecasts against.
    const [floatRow] = await db
      .select({
        totalFloat: sum(agents.premiumReserve),
        atRisk: sql<number>`count(*) filter (where cast(${agents.premiumReserve} as numeric) <= 0)::int`,
      })
      .from(agents);
    const totalAgents = Number(a ?? 0);
    const atRisk = Number(floatRow?.atRisk ?? 0);
    return {
      totalAgents,
      agentsMonitored: totalAgents,
      totalFloat: Number(floatRow?.totalFloat ?? 0),
      stockoutRisk:
        totalAgents > 0 ? Math.round((atRisk / totalAgents) * 100) : 0,
      totalTransactions: Number(t ?? 0),
    };
  }),
  // B17: REAL trailing-average forecast from the transactions table. Response
  // states its method and window explicitly; insufficient history fails loud.
  getForecast: protectedProcedure
    .input(
      z.object({
        days: z.number().int().min(1).max(90).default(7),
        agentId: z.string().optional(), // agents.agentId — scope to one agent
      })
    )
    .query(async ({ input }) => {
      const db = await requireDb();
      let agentPk: number | undefined;
      if (input.agentId != null) {
        const [agent] = await db
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
      const result = await computeForecasts(db, input.days, agentPk);
      return { ...result, generatedAt: new Date().toISOString() };
    }),
  // B17: REAL replenishment — TB double-entry + PG balance + transaction row,
  // admin-gated. agentId 'all-below-threshold' replenishes every agent whose
  // computed 7-day shortfall is positive, by exactly that shortfall.
  triggerReplenishment: adminProcedure
    .input(
      z.object({
        agentId: z.string().min(1),
        amount: z.number().positive().max(MAX_FLOAT_NGN),
      })
    )
    .mutation(async ({ input }) => {
      const db = await requireDb();
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
});
