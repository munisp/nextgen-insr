/**
 * Billing Ledger tRPC Router — Sprint 81 + Sprint 79 test-compatible
 *
 * F-12 (wave-3): every procedure now reads/writes the REAL
 * platform_billing_ledger / tenant_billing_config tables. The previous
 * revision was mockware: aggregateRevenue/getLiveSplitMetrics returned
 * hardcoded fixtures (transactionCount 150, grossFees 22500, platformRevenue
 * 6300), getClientBillingConfig returned a fabricated "CLIENT-001"/28%
 * contract, query returned a single canned row, and recordSplit persisted
 * NOTHING while claiming syncedToTigerBeetle/syncedToOpenSearch: true.
 */
import { TRPCError } from "@trpc/server";
import { eq, and, desc, gte, lte, sql, count } from "drizzle-orm";
import { z } from "zod";

import {
  platformBillingLedger,
  tenantBillingConfig,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

async function requireDb() {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "billingLedger: database unavailable",
    });
  }
  return db;
}

const num = (v: unknown) => Number(v ?? 0);

export const billingLedgerRouter = router({
  /**
   * Persist a revenue split into the real ledger. transactionRef is the
   * idempotency key (unique index pbl_tx_ref_unique, F-02) — duplicate
   * submissions are rejected loudly instead of double-recording.
   */
  recordSplit: protectedProcedure
    .input(
      z.object({
        transactionId: z.number().int(),
        transactionRef: z.string().min(1).max(64),
        transactionType: z.string().max(32),
        grossAmount: z.number(),
        grossFee: z.number(),
        clientShare: z.number(),
        platformShare: z.number(),
        agentCommission: z.number(),
        switchFee: z.number(),
        aggregatorFee: z.number().default(0),
        billingModel: z.enum(["revenue_share", "subscription", "hybrid"]),
        agentId: z.number().int(),
        policyTransactionId: z.number().int().optional(),
        currency: z.string().length(3).default("NGN"),
        region: z.string().max(32).optional(),
        carrier: z.string().max(32).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const platformNetFee =
        input.platformShare - input.switchFee - input.aggregatorFee;
      const [row] = await db
        .insert(platformBillingLedger)
        .values({
          transactionId: input.transactionId,
          transactionRef: input.transactionRef,
          transactionType: input.transactionType,
          agentId: input.agentId,
          policyTransactionId: input.policyTransactionId ?? null,
          grossAmount: String(input.grossAmount),
          grossFee: String(input.grossFee),
          agentCommission: String(input.agentCommission),
          switchFee: String(input.switchFee),
          aggregatorFee: String(input.aggregatorFee),
          platformNetFee: String(platformNetFee),
          billingModel: input.billingModel,
          clientRevenue: String(input.clientShare),
          platformRevenue: String(input.platformShare),
          revenueSharePct:
            input.grossFee > 0
              ? String((input.platformShare / input.grossFee) * 100)
              : null,
          currency: input.currency,
          region: input.region ?? null,
          carrier: input.carrier ?? null,
        })
        .returning();
      if (!row) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "recordSplit: insert returned no row",
        });
      }
      return row;
    }),

  query: protectedProcedure
    .input(
      z.object({
        tenantId: z.number().optional(),
        agentId: z.number().optional(),
        billingModel: z
          .enum(["revenue_share", "subscription", "hybrid"])
          .optional(),
        dateFrom: z.number().optional(),
        dateTo: z.number().optional(),
        transactionType: z.string().optional(),
        region: z.string().optional(),
        carrier: z.string().optional(),
        page: z.number().default(1),
        pageSize: z.number().default(50),
      })
    )
    .query(async ({ input }) => {
      const db = await requireDb();
      if (input.tenantId !== undefined) {
        // platform_billing_ledger has no tenant attribution column — a
        // tenant-scoped query would silently return platform-wide data.
        throw new TRPCError({
          code: "NOT_IMPLEMENTED",
          message:
            "query: tenant-scoped filtering is not delivered — platform_billing_ledger has no tenant_id column",
        });
      }
      const conditions = [];
      if (input.agentId !== undefined)
        conditions.push(eq(platformBillingLedger.agentId, input.agentId));
      if (input.billingModel)
        conditions.push(eq(platformBillingLedger.billingModel, input.billingModel));
      if (input.transactionType)
        conditions.push(eq(platformBillingLedger.transactionType, input.transactionType));
      if (input.region)
        conditions.push(eq(platformBillingLedger.region, input.region));
      if (input.carrier)
        conditions.push(eq(platformBillingLedger.carrier, input.carrier));
      if (input.dateFrom)
        conditions.push(gte(platformBillingLedger.createdAt, new Date(input.dateFrom)));
      if (input.dateTo)
        conditions.push(lte(platformBillingLedger.createdAt, new Date(input.dateTo)));
      const where = conditions.length ? and(...conditions) : undefined;
      const [entries, [{ total }]] = await Promise.all([
        db
          .select()
          .from(platformBillingLedger)
          .where(where)
          .orderBy(desc(platformBillingLedger.createdAt))
          .limit(input.pageSize)
          .offset((input.page - 1) * input.pageSize),
        db.select({ total: count() }).from(platformBillingLedger).where(where),
      ]);
      const totalRows = num(total);
      return {
        entries,
        page: input.page,
        pageSize: input.pageSize,
        total: totalRows,
        totalPages: Math.max(1, Math.ceil(totalRows / input.pageSize)),
      };
    }),

  aggregateRevenue: protectedProcedure
    .input(
      z.object({
        tenantId: z.number().optional(),
        period: z.enum(["hourly", "daily", "weekly", "monthly"]),
        dateFrom: z.number().optional(),
        dateTo: z.number().optional(),
        groupBy: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const db = await requireDb();
      if (input.tenantId !== undefined) {
        throw new TRPCError({
          code: "NOT_IMPLEMENTED",
          message:
            "aggregateRevenue: tenant-scoped aggregation is not delivered — platform_billing_ledger has no tenant_id column",
        });
      }
      const conditions = [];
      if (input.dateFrom)
        conditions.push(gte(platformBillingLedger.createdAt, new Date(input.dateFrom)));
      if (input.dateTo)
        conditions.push(lte(platformBillingLedger.createdAt, new Date(input.dateTo)));
      const where = conditions.length ? and(...conditions) : undefined;
      // zod enum (hourly|daily|weekly|monthly) mapped to PG date_trunc units
      // (hour|day|week|month) — quoted literal, enum-constrained, no injection.
      const pgUnit = { hourly: "hour", daily: "day", weekly: "week", monthly: "month" }[input.period];
      const aggregations = await db
        .select({
          periodStart: sql<string>`date_trunc(${sql.raw(`'${pgUnit}'`)}, created_at)::text`,
          transactionCount: count(),
          grossFees: sql<string>`COALESCE(SUM(CAST(gross_fee AS NUMERIC)), 0)`,
          platformRevenue: sql<string>`COALESCE(SUM(CAST(platform_revenue AS NUMERIC)), 0)`,
          clientRevenue: sql<string>`COALESCE(SUM(CAST(client_revenue AS NUMERIC)), 0)`,
        })
        .from(platformBillingLedger)
        .where(where)
        .groupBy(sql`date_trunc(${sql.raw(`'${pgUnit}'`)}, created_at)`)
        .orderBy(sql`date_trunc(${sql.raw(`'${pgUnit}'`)}, created_at)`);
      const [totalsRow] = await db
        .select({
          totalGrossFees: sql<string>`COALESCE(SUM(CAST(gross_fee AS NUMERIC)), 0)`,
          totalPlatformRevenue: sql<string>`COALESCE(SUM(CAST(platform_revenue AS NUMERIC)), 0)`,
          totalClientRevenue: sql<string>`COALESCE(SUM(CAST(client_revenue AS NUMERIC)), 0)`,
          totalTransactions: count(),
        })
        .from(platformBillingLedger)
        .where(where);
      return {
        period: input.period,
        aggregations: aggregations.map((a) => ({
          periodStart: a.periodStart,
          transactionCount: num(a.transactionCount),
          grossFees: num(a.grossFees),
          platformRevenue: num(a.platformRevenue),
          clientRevenue: num(a.clientRevenue),
        })),
        totals: {
          totalGrossFees: num(totalsRow?.totalGrossFees),
          totalPlatformRevenue: num(totalsRow?.totalPlatformRevenue),
          totalClientRevenue: num(totalsRow?.totalClientRevenue),
          totalTransactions: num(totalsRow?.totalTransactions),
        },
      };
    }),

  getClientBillingConfig: protectedProcedure
    .input(
      z.object({
        clientId: z.string().optional(),
        tenantId: z.number().optional(),
      })
    )
    .query(async ({ input }) => {
      const db = await requireDb();
      if (input.clientId !== undefined && input.tenantId === undefined) {
        // tenant_billing_config is keyed by tenant_id; there is no delivered
        // client-keyed billing contract table.
        throw new TRPCError({
          code: "NOT_IMPLEMENTED",
          message:
            "getClientBillingConfig: client-keyed lookup is not delivered — tenant_billing_config is keyed by tenant_id",
        });
      }
      const tenantId = input.tenantId ?? 1;
      const [row] = await db
        .select()
        .from(tenantBillingConfig)
        .where(eq(tenantBillingConfig.tenantId, tenantId))
        .limit(1);
      // Honest absence: no fabricated default contract.
      return row ?? null;
    }),

  getLiveSplitMetrics: protectedProcedure
    .input(z.object({ tenantId: z.number().optional() }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      if (input?.tenantId !== undefined) {
        throw new TRPCError({
          code: "NOT_IMPLEMENTED",
          message:
            "getLiveSplitMetrics: tenant-scoped metrics are not delivered — platform_billing_ledger has no tenant_id column",
        });
      }
      const sums = {
        grossFees: sql<string>`COALESCE(SUM(CAST(gross_fee AS NUMERIC)), 0)`,
        platformShare: sql<string>`COALESCE(SUM(CAST(platform_revenue AS NUMERIC)), 0)`,
        clientShare: sql<string>`COALESCE(SUM(CAST(client_revenue AS NUMERIC)), 0)`,
        transactionCount: count(),
      };
      const [today] = await db
        .select(sums)
        .from(platformBillingLedger)
        .where(gte(platformBillingLedger.createdAt, sql`date_trunc('day', now())`));
      const [month] = await db
        .select(sums)
        .from(platformBillingLedger)
        .where(gte(platformBillingLedger.createdAt, sql`date_trunc('month', now())`));
      const map = (r: typeof today | undefined) => ({
        grossFees: num(r?.grossFees),
        platformShare: num(r?.platformShare),
        clientShare: num(r?.clientShare),
        transactionCount: num(r?.transactionCount),
      });
      const t = map(today);
      return {
        today: t,
        thisMonth: map(month),
        splitEfficiency: {
          // Real derived ratio: platform share of gross fees collected today.
          currentSplitPct:
            t.grossFees > 0 ? (t.platformShare / t.grossFees) * 100 : 0,
        },
        lastUpdated: Date.now(),
      };
    }),
});
