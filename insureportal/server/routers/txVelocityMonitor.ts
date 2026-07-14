// Sprint 87: Upgraded from mock data to real DB queries — txVelocityMonitor
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { velocityLimits } from "@schema";
import { eq, desc, and, sql, count } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

const getCurrentTps = protectedProcedure
  .input(
    z.object({
      page: z.number().optional(),
      limit: z.number().optional(),
      search: z.string().optional(),
    })
  )
  .query(async ({ input }) => {
    try {
      const db = (await getDb())!;
      const lim = input.limit ?? 10;
      const offset = ((input.page ?? 1) - 1) * lim;
      const rows = await db
        .select()
        .from(velocityLimits)
        .orderBy(desc(velocityLimits.id))
        .limit(lim)
        .offset(offset);
      const [{ total }] = await db
        .select({ total: count() })
        .from(velocityLimits)
        .limit(100);
      return { items: rows, total, page: input.page ?? 1, limit: lim };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  });
const getVelocityHistory = protectedProcedure
  .input(
    z.object({
      page: z.number().optional(),
      limit: z.number().optional(),
      search: z.string().optional(),
    })
  )
  .query(async ({ input }) => {
    try {
      const db = (await getDb())!;
      const lim = input.limit ?? 10;
      const offset = ((input.page ?? 1) - 1) * lim;
      const rows = await db
        .select()
        .from(velocityLimits)
        .orderBy(desc(velocityLimits.id))
        .limit(lim)
        .offset(offset);
      const [{ total }] = await db
        .select({ total: count() })
        .from(velocityLimits)
        .limit(100);
      return { items: rows, total, page: input.page ?? 1, limit: lim };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  });
const getCircuitBreakerStatus = protectedProcedure
  .input(
    z.object({
      page: z.number().optional(),
      limit: z.number().optional(),
      search: z.string().optional(),
    })
  )
  .query(async ({ input }) => {
    try {
      const db = (await getDb())!;
      const lim = input.limit ?? 10;
      const offset = ((input.page ?? 1) - 1) * lim;
      const rows = await db
        .select()
        .from(velocityLimits)
        .orderBy(desc(velocityLimits.id))
        .limit(lim)
        .offset(offset);
      const [{ total }] = await db
        .select({ total: count() })
        .from(velocityLimits)
        .limit(100);
      return { items: rows, total, page: input.page ?? 1, limit: lim };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  });
const setThreshold = protectedProcedure
  .input(
    z.object({ id: z.number(), data: z.record(z.string(), z.any()).optional() })
  )
  .mutation(async ({ input }) => {
    try {
      const db = (await getDb())!;
      const [existing] = await db
        .select()
        .from(velocityLimits)
        .where(eq(velocityLimits.id, input.id))
        .limit(100);
      if (!existing)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "setThreshold: record not found",
        });
      if (input.data) {
        const [updated] = await db
          .update(velocityLimits)
          .set(input.data)
          .where(eq(velocityLimits.id, input.id))
          .returning();
        return { success: true, ...updated, message: "Record updated" };
      }
      return { success: true, ...existing, message: "No changes applied" };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  });
const resetCircuitBreaker = protectedProcedure
  .input(
    z.object({ id: z.number(), data: z.record(z.string(), z.any()).optional() })
  )
  .mutation(async ({ input }) => {
    try {
      const db = (await getDb())!;
      const [existing] = await db
        .select()
        .from(velocityLimits)
        .where(eq(velocityLimits.id, input.id))
        .limit(100);
      if (!existing)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "resetCircuitBreaker: record not found",
        });
      if (input.data) {
        const [updated] = await db
          .update(velocityLimits)
          .set(input.data)
          .where(eq(velocityLimits.id, input.id))
          .returning();
        return { success: true, ...updated, message: "Record updated" };
      }
      return { success: true, ...existing, message: "No changes applied" };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  });

export const txVelocityMonitorRouter = router({
  getCurrentTps,
  getVelocityHistory,
  getCircuitBreakerStatus,
  setThreshold,
  resetCircuitBreaker,
});
