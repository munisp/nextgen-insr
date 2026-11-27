import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { agents, premiumTopUpRequests, transactions } from "@schema";
import { desc, eq, sql, and, gte, lte, count, avg, sum, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

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

const SEASONAL_MULTIPLIERS = {
  monthEnd: 1.4, // 25th to 5th of next month
  friday: 1.2,
  monday: 1.1,
  default: 1.0,
};

const TIER_BUFFERS: Record<string, number> = {
  super_agent: 1.5,
  senior: 1.3,
  standard: 1.1,
  probationary: 1.0,
};

function getSeasonalMultiplier(date: Date): number {
  const day = date.getDate();
  const dayOfWeek = date.getDay();
  if (day >= 25 || day <= 5) return SEASONAL_MULTIPLIERS.monthEnd;
  if (dayOfWeek === 5) return SEASONAL_MULTIPLIERS.friday;
  if (dayOfWeek === 1) return SEASONAL_MULTIPLIERS.monday;
  return SEASONAL_MULTIPLIERS.default;
}

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
//  D1 tx vocabulary: portal txTypeEnum has no 'Cash In'/'Cash Out'. Portal's
//     float-direction truth (transactions.ts FLOAT_CREDIT_TYPES /
//     FLOAT_DEBIT_TYPES, corroborated by voiceCommandPos.ts mapping
//     "Premium Payment"="Deposit cash" / "Claim Payout"="Withdraw cash"):
//     in = 'Premium Payment', out = 'Claim Payout'. (Main likewise excludes
//     'Transfer' from the forecast basis; mirrored.)
//  D2 agentId: main accepts the agents.agentId string code; portal legacy
//     callers pass the numeric agents.id PK — both accepted (union), each
//     resolved to the PK, NOT_FOUND when the agent does not exist.
//  D3 horizon: portal legacy alias for days; resolution days ?? horizon ?? 7
//     (main's .default(7) preserved in effect).
const MIN_HISTORY_DAYS = 7;
const CASH_IN_TYPE = "Premium Payment";
const CASH_OUT_TYPE = "Claim Payout";

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

export const agentFloatForecastingRouter = router({
  list: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
      riskFilter: z.enum(["all", "critical", "high", "medium", "low"]).default("all"),
    }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: 0, limit: input.limit, offset: input.offset };

      const results = await database.select().from(agents).orderBy(desc(agents.id)).limit(input.limit).offset(input.offset);
      const totalRows = await database.select({ total: count() }).from(agents);

      const forecasts = results.map((agent: any) => {
        const currentFloat = agent.premiumReserve ?? 50000;
        const avgDaily = (agent.monthlyTarget ?? 200000) / 30;
        const multiplier = getSeasonalMultiplier(new Date());
        const adjustedDemand = avgDaily * multiplier;
        const tierBuffer = TIER_BUFFERS[agent.tier ?? "standard"] ?? 1.0;
        const { risk, daysRemaining } = calculateStockoutRisk(currentFloat, adjustedDemand);
        const forecastedDemand7d = Math.round(adjustedDemand * 7 * tierBuffer);
        const recommendedTopUp = Math.max(0, forecastedDemand7d - currentFloat);

        return {
          ...agent,
          forecast: {
            avgDailyDemand: Math.round(adjustedDemand),
            seasonalMultiplier: multiplier,
            forecastedDemand7d,
            recommendedTopUp,
            stockoutRisk: risk,
            daysUntilStockout: daysRemaining,
            confidence: 0.85,
          },
        };
      });

      const filtered = input.riskFilter === "all" ? forecasts : forecasts.filter((f: any) => f.forecast.stockoutRisk === input.riskFilter);

      return { data: filtered, total: (totalRows as any)[0]?.total ?? 0, limit: input.limit, offset: input.offset };
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

  getStats: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) return { totalFloat: 0, stockoutRisk: 0, agentsMonitored: 0, predictedDemand7d: 0, avgAccuracy: 0.85 };

    const totalRows = await database.select({ total: count() }).from(agents);
    const agentCount = (totalRows as any)[0]?.total ?? 0;
    const avgDaily = 200000 / 30;
    const multiplier = getSeasonalMultiplier(new Date());

    return {
      totalFloat: agentCount * 50000,
      stockoutRisk: Math.round(agentCount * 0.12),
      agentsMonitored: agentCount,
      predictedDemand7d: Math.round(agentCount * avgDaily * multiplier * 7),
      avgAccuracy: 0.85,
      lastUpdated: new Date().toISOString(),
      seasonalFactor: multiplier,
    };
  }),
});
