import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { auditLog, vatRecords, transactions } from "@schema";
import { desc, eq, sql, and, gte, lte, count } from "drizzle-orm";

// ── Middleware Integration (Sprint 44) ──────────────────────────────
import { publishEvent, type KafkaTopic } from "../kafkaClient";
import { cacheSet, cacheGet } from "../redisClient";
import { tbCreateTransfer } from "../tbClient";
import { fluvioProduce } from "../fluvio";
import { permifyCheck } from "../_core/permify";

export const taxCollectionRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
        search: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const database = await getDb();
        if (!database) return { data: [], total: 0, limit: 0, offset: 0 };
        const results = await database
          .select()
          .from(auditLog)
          .orderBy(desc(auditLog.id))
          .limit(input.limit)
          .offset(input.offset);

        const _totalRows = await database
          .select({ total: count() })
          .from(auditLog);
        const totalResult = Array.isArray(_totalRows)
          ? _totalRows[0]
          : _totalRows;

        return {
          data: results,
          total: totalResult?.total ?? 0,
          limit: input.limit,
          offset: input.offset,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      try {
        const database = await getDb();
        if (!database) return { data: [], total: 0, limit: 0, offset: 0 };
        const [record] = await database
          .select()
          .from(auditLog)
          .where(eq(auditLog.id, input.id))
          .limit(1);

        if (!record) {
          throw new Error(`Record with id ${input.id} not found`);
        }
        return record;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  getSummary: protectedProcedure.query(async () => {
    try {
      const database = await getDb();
      if (!database) return { data: [], total: 0, limit: 0, offset: 0 };
      const _totalRows = await database
        .select({ total: count() })
        .from(auditLog);
      const totalResult = Array.isArray(_totalRows)
        ? _totalRows[0]
        : _totalRows;

      return {
        totalRecords: totalResult?.total ?? 0,
        lastUpdated: new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }),

  getRecent: protectedProcedure
    .input(
      z.object({
        days: z.number().min(1).max(90).default(7),
        limit: z.number().min(1).max(50).default(10),
      })
    )
    .query(async ({ input }) => {
      try {
        const database = await getDb();
        if (!database) return { data: [], total: 0, limit: 0, offset: 0 };
        const since = new Date();
        since.setDate(since.getDate() - input.days);

        const results = await database
          .select()
          .from(auditLog)
          .orderBy(desc(auditLog.id))
          .limit(input.limit);

        return results;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  // ── Sprint 28 domain procedures ──
  taxTypes: protectedProcedure.query(async () => {
    return {
      taxTypes: [
        {
          id: "TT-001",
          name: "VAT",
          rate: 7.5,
          description: "Value Added Tax",
        },
        { id: "TT-002", name: "WHT", rate: 10, description: "Withholding Tax" },
      ],
    };
  }),
  // W29 (2026-11-27): analytics is a REAL aggregate over vat_records (the VAT
  // collection store, written by restBridge POST /api/vat-records and the
  // management router) LEFT JOIN transactions on the evidenced ref link
  // (vat_records.transactionId holds the originating transaction's ref — see
  // repo seed.mjs where vat rows reference "TXN-SEED-0001/0002/0005", the
  // transactions.ref values).
  // Shape derivations (consumer: client/src/pages/TaxCollectionPage.tsx):
  //   totalVolume     <- sum(vatRecords.vatAmount): total VAT collected
  //   totalPayments   <- count(vatRecords)
  //   totalCommission <- sum(transactions.commission) over transactions linked
  //                      via ref (agent commission earned on the collections)
  //   successRate     <- integer percent of VAT records whose linked
  //                      transaction has status='success' (0 when no records)
  // history stays fail-loud: no per-payment tax store exists (vat_records has
  // no taxpayer name / tax type columns the page's history tab expects).
  history: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message:
        "taxCollection.history is not implemented: no tax payment store exists in this service. Previously returned a fabricated 'remitted' payment.",
    });
  }),
  analytics: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "taxCollection.analytics requires the database; DATABASE_URL is not configured.",
      });
    }
    const [row] = await database
      .select({
        totalVolume: sql<string>`coalesce(sum(${vatRecords.vatAmount}::numeric), 0)`,
        totalPayments: sql<number>`count(*)::int`,
        succeeded: sql<number>`count(*) filter (where ${transactions.status} = 'success')::int`,
        totalCommission: sql<string>`coalesce(sum(${transactions.commission}::numeric), 0)`,
      })
      .from(vatRecords)
      .leftJoin(transactions, eq(transactions.ref, vatRecords.transactionId));
    const totalPayments = Number(row?.totalPayments ?? 0);
    const succeeded = Number(row?.succeeded ?? 0);
    return {
      totalVolume: Number(row?.totalVolume ?? 0),
      totalPayments,
      totalCommission: Number(row?.totalCommission ?? 0),
      successRate: totalPayments > 0 ? Math.round((succeeded / totalPayments) * 100) : 0,
    };
  }),
});
