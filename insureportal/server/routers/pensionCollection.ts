import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { auditLog, pfaRegistry, pensionContributions } from "@schema";
import { desc, eq, sql, and, gte, lte, count, asc, ne } from "drizzle-orm";

// ── Middleware Integration (Sprint 44) ──────────────────────────────
import { publishEvent, type KafkaTopic } from "../kafkaClient";
import { cacheSet, cacheGet } from "../redisClient";
import { tbCreateTransfer } from "../tbClient";
import { fluvioProduce } from "../fluvio";
import { permifyCheck } from "../_core/permify";

export const pensionCollectionRouter = router({
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
  // DD-LEGACY: previously returned fabricated PFAs, a fake "remitted"
  // contribution, and invented ₦25M portfolio analytics. Money-path reads
  // must be real or loud.
  //
  // 2026-11-27 (W30): pfas + analytics are now REAL reads over the W30
  // pension domain (drizzle/schema.ts: pfa_registry, pension_contributions —
  // migration 0047). Contract: client/src/pages/PensionCollectionPage.tsx.
  // Fail-closed PRECONDITION_FAILED when the DB is unavailable (W29
  // taxCollection.analytics pattern). `history` stays fail-loud: it serves
  // the contributions/employers tabs and is W31 scope.
  pfas: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "pensionCollection.pfas requires the database; DATABASE_URL is not configured.",
      });
    }
    // ALL registry rows are returned (active and inactive — the page renders
    // an Active/Inactive badge per card). contributorCount = distinct RSA
    // PINs with a non-failed contribution (a failed collection does not
    // establish a contributor relationship).
    const rows = await database
      .select({
        id: pfaRegistry.id,
        name: pfaRegistry.name,
        code: pfaRegistry.code,
        licenseNo: pfaRegistry.licenseNo,
        isActive: pfaRegistry.isActive,
        contributorCount: sql<number>`count(distinct ${pensionContributions.rsaPin})::int`,
      })
      .from(pfaRegistry)
      .leftJoin(
        pensionContributions,
        and(
          eq(pensionContributions.pfaId, pfaRegistry.id),
          ne(pensionContributions.status, "failed")
        )
      )
      .groupBy(pfaRegistry.id)
      .orderBy(asc(pfaRegistry.name));
    return {
      pfas: rows.map(r => ({
        id: r.id,
        name: r.name,
        code: r.code,
        licenseNo: r.licenseNo,
        contributorCount: Number(r.contributorCount),
        active: r.isActive,
      })),
    };
  }),
  history: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message:
        "pensionCollection.history is not implemented: no pension contribution store exists in this service. Previously returned a fabricated 'remitted' contribution.",
    });
  }),
  analytics: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "pensionCollection.analytics requires the database; DATABASE_URL is not configured.",
      });
    }
    // status <> 'failed' is the honesty filter: a failed collection is not
    // collected money. 'collected' + 'remitted' both count (remittance is a
    // later lifecycle stage of the same collected money).
    const [row] = await database
      .select({
        totalContributions: sql<number>`count(*)::int`,
        totalVolume: sql<string>`coalesce(sum(${pensionContributions.employeeAmount}::numeric + ${pensionContributions.employerAmount}::numeric), 0)`,
        totalCommission: sql<string>`coalesce(sum(${pensionContributions.commission}::numeric), 0)`,
      })
      .from(pensionContributions)
      .where(ne(pensionContributions.status, "failed"));
    return {
      totalVolume: Number(row?.totalVolume ?? 0),
      totalContributions: Number(row?.totalContributions ?? 0),
      totalCommission: Number(row?.totalCommission ?? 0),
    };
  }),
});
