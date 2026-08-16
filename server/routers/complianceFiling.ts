/**
 * F08: Compliance Filing & Regulatory Reporting
 * CBN/NDIC/FIRS filings, SAR generation, CTR reports, regulatory calendar
 */
import { TRPCError } from "@trpc/server";
import { eq, desc, and, gte, lte, count, sql } from "drizzle-orm";
import { z } from "zod";

import { complianceFilings } from "../../drizzle/schema";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";


const FILING_TYPES = [
  "SAR",
  "CTR",
  "STR",
  "CBN_RETURNS",
  "NDIC_REPORT",
  "FIRS_TAX",
  "AML_REPORT",
  "PCI_DSS_AUDIT",
];
const REGULATORS = ["CBN", "NDIC", "FIRS", "EFCC", "SEC", "NFIU"];

export const complianceFilingRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        page: z.number().default(1),
        limit: z.number().default(20),
        filingType: z.string().optional(),
        regulator: z.string().optional(),
        status: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) return { items: [], total: 0 };
        const conditions = [];
        if (input.filingType)
          conditions.push(eq(complianceFilings.filingType, input.filingType));
        if (input.regulator)
          conditions.push(
            eq(complianceFilings.createdAt, input.regulator as any)
          );
        if (input.status)
          conditions.push(eq(complianceFilings.status, input.status));
        const where = conditions.length > 0 ? and(...conditions) : undefined;
        const items = await db
          .select()
          .from(complianceFilings)
          .where(where)
          .orderBy(desc(complianceFilings.createdAt))
          .limit(input.limit)
          .offset((input.page - 1) * input.limit);
        const [{ total }] = await db
          .select({ total: count() })
          .from(complianceFilings)
          .where(where)
          .limit(100);
        return { items, total };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  createFiling: protectedProcedure
    .input(
      z.object({
        filingType: z.string(),
        regulator: z.string(),
        periodStart: z.string(),
        periodEnd: z.string(),
        reportData: z.any(),
        dueDate: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("Database unavailable");
        const [filing] = await db
          .insert(complianceFilings)
          .values({
            filingType: input.filingType,
            regulator: input.regulator,
            periodStart: new Date(input.periodStart),
            periodEnd: new Date(input.periodEnd),
            reportData: JSON.stringify(input.reportData),
            dueDate: new Date(input.dueDate),
            status: "draft",
            preparedBy: ctx.user?.id,
          } as any)
          .returning();
        return { filing };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  submitFiling: protectedProcedure
    .input(z.object({ filingId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("Database unavailable");
        await db
          .update(complianceFilings)
          .set({
            status: "submitted",
            submittedAt: new Date(),
          } as any)
          .where(eq(complianceFilings.id, input.filingId));
        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  acknowledgeFiling: protectedProcedure
    .input(z.object({ filingId: z.number(), acknowledgementRef: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("Database unavailable");
        await db
          .update(complianceFilings)
          .set({
            status: "acknowledged",
          })
          .where(eq(complianceFilings.id, input.filingId));
        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  upcomingDeadlines: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    if (!db) return { deadlines: [] };
    const thirtyDaysFromNow = new Date(Date.now() + 30 * 86400000);
    const items = await db
      .select()
      .from(complianceFilings)
      .where(
        and(
          lte(complianceFilings.createdAt, thirtyDaysFromNow),
          sql`${complianceFilings.status} NOT IN ('submitted', 'acknowledged')`
        )
      )
      .orderBy(complianceFilings.createdAt);
    return { deadlines: items };
  }),

  filingTypes: protectedProcedure.query(() => FILING_TYPES),
  regulators: protectedProcedure.query(() => REGULATORS),
});
