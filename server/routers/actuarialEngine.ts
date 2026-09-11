/**
 * actuarialEngine.ts — F-11: actuarial pricing engine v1 (ADVISORY, READ-ONLY).
 *
 * Every procedure is adminProcedure-gated: actuarial outputs are internal
 * pricing evidence, not customer-facing data. The engine performs ZERO writes
 * to policies / premiums / transactions — auto-repricing is deliberately out
 * of scope (advisory rate indications only).
 *
 * Data sources (discovered from drizzle/schema.ts + drizzle/schema.additions.ts;
 * do NOT change without re-verifying the live schema):
 *   - product line        = policies.coverageType            (coverage_type enum)
 *   - earned premium      = premiums.amount WHERE premiums.status = 'paid'
 *                           AND premiums.paidDate IN [periodStart, periodEnd]
 *                           (premiums = premium payment ledger,
 *                            drizzle/schema.additions.ts), joined
 *                           premiums.policyId → policies.id for the line
 *   - settled claims paid = claims.paidAmount WHERE claims.status = 'paid'
 *                           AND claims.settlementDate IN period, joined
 *                           claims.policyId → policies.id for the line
 *   - claim count         = COUNT(claims.id) same filter as above
 *   - current pure premium (current rate level) = AVG(policies.annualPremium)
 *                           over policies.status = 'active' for the line
 *   - exposure count      = COUNT(DISTINCT premiums.policyId) of paid rows
 *
 * Config storage follows the carrierLivePricing precedent (JSON documents in
 * system_config with prefixed keys, read via the `key` unique index):
 *   - actuarial_target_loss_ratio_<line> = {"targetLossRatio": 0.7, "tolerance": 0.05}
 *   - actuarial_expense_loading          = {"expenseRatio": 0.25, "profitLoadingPct": 5}
 * Missing config keys FAIL LOUD (PRECONDITION_FAILED) — never defaulted.
 *
 * Insufficient data (zero premium rows, zero claims, no active-policy rate
 * level) also fails loud PRECONDITION_FAILED: no data ≠ zero loss ratio.
 */
import { TRPCError } from "@trpc/server";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";

import {
  claims,
  coverageTypeEnum,
  policies,
  systemConfig,
} from "../../drizzle/schema";
import { premiums } from "../../drizzle/schema.additions";
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  ActuarialInputError,
  credibilityZ,
  indicatedPurePremium,
  lossRatio,
  rateAdequacy,
} from "../lib/actuarial";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

function requireDb(db: Db | null): Db {
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database unavailable",
    });
  }
  return db;
}

function precondition(message: string): TRPCError {
  return new TRPCError({ code: "PRECONDITION_FAILED", message });
}

/** Map pure-lib fail-loud errors onto tRPC codes (no silent fallbacks). */
function mapActuarialError(err: unknown): never {
  if (err instanceof ActuarialInputError) {
    throw precondition(err.message);
  }
  throw err;
}

// Product lines are the real coverage_type enum values (drizzle/schema.ts).
const productLineSchema = z.enum(coverageTypeEnum.enumValues);

const periodInput = z.object({
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  productLine: productLineSchema.optional(),
});

interface LinePeriodRow {
  productLine: string;
  total: number;
  claimCount: number;
}

/** Earned premium per line from the REAL premiums ledger (paid rows only). */
async function earnedPremiumByLine(
  db: Db,
  input: z.infer<typeof periodInput>
): Promise<LinePeriodRow[]> {
  const conditions = [
    eq(premiums.status, "paid"),
    gte(premiums.paidDate, input.periodStart),
    lte(premiums.paidDate, input.periodEnd),
  ];
  if (input.productLine) {
    conditions.push(eq(policies.coverageType, input.productLine));
  }
  const rows = await db
    .select({
      productLine: policies.coverageType,
      total: sql<string>`COALESCE(SUM(CAST(${premiums.amount} AS NUMERIC)), 0)`,
      exposures: sql<number>`COUNT(DISTINCT ${premiums.policyId})`,
    })
    .from(premiums)
    .innerJoin(policies, eq(premiums.policyId, policies.id))
    .where(and(...conditions))
    .groupBy(policies.coverageType);
  return rows.map(r => ({
    productLine: String(r.productLine),
    total: Number(r.total),
    claimCount: Number(r.exposures),
  }));
}

/** Settled claims paid + claim count per line from the REAL claims table. */
async function settledClaimsByLine(
  db: Db,
  input: z.infer<typeof periodInput>
): Promise<LinePeriodRow[]> {
  const conditions = [
    eq(claims.status, "paid"),
    gte(claims.settlementDate, input.periodStart),
    lte(claims.settlementDate, input.periodEnd),
  ];
  if (input.productLine) {
    conditions.push(eq(policies.coverageType, input.productLine));
  }
  const rows = await db
    .select({
      productLine: policies.coverageType,
      total: sql<string>`COALESCE(SUM(CAST(${claims.paidAmount} AS NUMERIC)), 0)`,
      claimCount: sql<number>`COUNT(${claims.id})`,
    })
    .from(claims)
    .innerJoin(policies, eq(claims.policyId, policies.id))
    .where(and(...conditions))
    .groupBy(policies.coverageType);
  return rows.map(r => ({
    productLine: String(r.productLine),
    total: Number(r.total),
    claimCount: Number(r.claimCount),
  }));
}

/** Read a JSON config document from system_config; fail loud when unset. */
async function readRequiredConfig<T extends Record<string, unknown>>(
  db: Db,
  key: string
): Promise<T> {
  const [row] = await db
    .select()
    .from(systemConfig)
    .where(eq(systemConfig.key, key))
    .limit(1);
  if (!row) {
    throw precondition(
      `system_config key '${key}' is unset — refusing to proceed on a fabricated default (set it before calling this procedure)`
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    throw precondition(
      `system_config key '${key}' is not valid JSON — cannot trust the stored configuration`
    );
  }
  return parsed as T;
}

export const actuarialEngineRouter = router({
  /**
   * Loss ratio per product line over a period from REAL rows.
   * PRECONDITION_FAILED when the period yields zero premium rows (no data ≠
   * zero loss ratio) or when the pure math rejects the inputs.
   */
  getLossRatios: adminProcedure.input(periodInput).query(async ({ input }) => {
    const db = requireDb(await getDb());
    const premiumRows = await earnedPremiumByLine(db, input);
    if (premiumRows.length === 0) {
      throw precondition(
        `zero paid premium rows in period ${input.periodStart.toISOString()}..${input.periodEnd.toISOString()}` +
          (input.productLine ? ` for product line '${input.productLine}'` : "") +
          " — a loss ratio cannot be computed honestly with no premium base"
      );
    }
    const claimRows = await settledClaimsByLine(db, input);
    const claimsByLine = new Map(claimRows.map(r => [r.productLine, r]));
    const asOf = new Date().toISOString();
    try {
      return {
        lines: premiumRows.map(p => {
          const c = claimsByLine.get(p.productLine);
          const settledClaimsPaid = c ? c.total : 0;
          const claimCount = c ? c.claimCount : 0;
          return {
            productLine: p.productLine,
            settledClaimsPaid,
            earnedPremium: p.total,
            lossRatio: lossRatio(settledClaimsPaid, p.total),
            claimCount,
            asOf,
          };
        }),
        asOf,
      };
    } catch (err) {
      mapActuarialError(err);
    }
  }),

  /**
   * Credibility-weighted indicated pure premium for one product line over a
   * period. PRECONDITION_FAILED when claimCount is 0 or no current premium
   * source exists (no active policies carrying annualPremium for the line).
   */
  getRateIndication: adminProcedure
    .input(periodInput.extend({ productLine: productLineSchema }))
    .query(async ({ input }) => {
      const db = requireDb(await getDb());
      const premiumRows = await earnedPremiumByLine(db, input);
      if (premiumRows.length === 0) {
        throw precondition(
          `zero paid premium rows in period for product line '${input.productLine}' — no exposure base`
        );
      }
      const exposureCount = premiumRows[0].claimCount; // distinct policies
      const claimRows = await settledClaimsByLine(db, input);
      const claimCount = claimRows.length > 0 ? claimRows[0].claimCount : 0;
      const settledClaimsPaid = claimRows.length > 0 ? claimRows[0].total : 0;
      if (claimCount === 0) {
        throw precondition(
          `zero settled claims in period for product line '${input.productLine}' — credibility-weighted indication requires observed claim data`
        );
      }
      const [rateLevel] = await db
        .select({
          currentPurePremium: sql<string>`AVG(CAST(${policies.annualPremium} AS NUMERIC))`,
          policyCount: sql<number>`COUNT(${policies.id})`,
        })
        .from(policies)
        .where(
          and(
            eq(policies.status, "active"),
            eq(policies.coverageType, input.productLine)
          )
        );
      if (!rateLevel || rateLevel.currentPurePremium === null) {
        throw precondition(
          `no active policies for product line '${input.productLine}' — no current premium source (policies.annualPremium) to blend against`
        );
      }
      const currentPurePremium = Number(rateLevel.currentPurePremium);
      try {
        const z = credibilityZ(claimCount);
        const observedPurePremium = settledClaimsPaid / exposureCount;
        const indicated = indicatedPurePremium(
          observedPurePremium,
          currentPurePremium,
          z
        );
        return {
          productLine: input.productLine,
          claimCount,
          exposureCount,
          credibilityZ: z,
          observedPurePremium,
          currentPurePremium,
          indicatedPurePremium: indicated,
          indicatedChangePct: (indicated / currentPurePremium - 1) * 100,
          asOf: new Date().toISOString(),
        };
      } catch (err) {
        mapActuarialError(err);
      }
    }),

  /**
   * Adequacy per line vs the target loss ratio from system_config
   * (key: actuarial_target_loss_ratio_<line>, carrierLivePricing precedent).
   * PRECONDITION_FAILED when the config key is unset — NEVER defaulted.
   */
  getRateAdequacy: adminProcedure
    .input(periodInput)
    .query(async ({ input }) => {
      const db = requireDb(await getDb());
      const premiumRows = await earnedPremiumByLine(db, input);
      if (premiumRows.length === 0) {
        throw precondition(
          `zero paid premium rows in period ${input.periodStart.toISOString()}..${input.periodEnd.toISOString()}` +
            (input.productLine
              ? ` for product line '${input.productLine}'`
              : "") +
            " — adequacy cannot be judged with no premium base"
        );
      }
      const claimRows = await settledClaimsByLine(db, input);
      const claimsByLine = new Map(claimRows.map(r => [r.productLine, r]));
      const asOf = new Date().toISOString();
      const lines = [];
      for (const p of premiumRows) {
        const key = `actuarial_target_loss_ratio_${p.productLine}`;
        const cfg = await readRequiredConfig<{
          targetLossRatio: number;
          tolerance: number;
        }>(db, key);
        if (
          typeof cfg.targetLossRatio !== "number" ||
          typeof cfg.tolerance !== "number"
        ) {
          throw precondition(
            `system_config key '${key}' must be JSON {"targetLossRatio": number, "tolerance": number}`
          );
        }
        const c = claimsByLine.get(p.productLine);
        try {
          const lr = lossRatio(c ? c.total : 0, p.total);
          lines.push({
            productLine: p.productLine,
            lossRatio: lr,
            targetLossRatio: cfg.targetLossRatio,
            tolerance: cfg.tolerance,
            adequacy: rateAdequacy(lr, cfg.targetLossRatio, cfg.tolerance),
            claimCount: c ? c.claimCount : 0,
            asOf,
          });
        } catch (err) {
          mapActuarialError(err);
        }
      }
      return { lines, asOf };
    }),

  /**
   * Expense loading configuration from system_config
   * (key: actuarial_expense_loading). Fails loud when unset.
   */
  getExpenseLoading: adminProcedure.query(async () => {
    const db = requireDb(await getDb());
    const cfg = await readRequiredConfig<{
      expenseRatio: number;
      profitLoadingPct: number;
    }>(db, "actuarial_expense_loading");
    if (
      typeof cfg.expenseRatio !== "number" ||
      typeof cfg.profitLoadingPct !== "number"
    ) {
      throw precondition(
        "system_config key 'actuarial_expense_loading' must be JSON {\"expenseRatio\": number, \"profitLoadingPct\": number}"
      );
    }
    return {
      expenseRatio: cfg.expenseRatio,
      profitLoadingPct: cfg.profitLoadingPct,
      sourceKey: "actuarial_expense_loading",
      asOf: new Date().toISOString(),
    };
  }),
});
