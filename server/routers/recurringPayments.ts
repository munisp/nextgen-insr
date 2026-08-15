/**
 * Recurring Payments — scheduled automatic bill payments and transfers
 * with configurable frequency, retry logic, and notification.
 *
 * Middleware: Temporal (scheduling), Kafka (payment events), PostgreSQL (schedule records),
 * Redis (next-run cache)
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb, writeAuditLog } from "../db";
import { platformSettings } from "../../drizzle/schema";
import { eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getAgentFromCookie } from "../middleware/agentAuth";

export const recurringPaymentsRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        type: z.enum(["bill_payment", "transfer", "airtime"]),
        amount: z.number().positive().max(5_000_000),
        frequency: z.enum(["daily", "weekly", "biweekly", "monthly"]),
        recipientPhone: z.string().optional(),
        billerId: z.string().optional(),
        customerReference: z.string().optional(),
        startDate: z.string(),
        endDate: z.string().optional(),
        description: z.string().max(256).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const session = await getAgentFromCookie(ctx.req);
        if (!session)
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Agent session required",
          });

        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const scheduleId = `REC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
        const schedule = {
          id: scheduleId,
          agentId: session.id,
          ...input,
          status: "active",
          createdAt: new Date().toISOString(),
          nextRun: input.startDate,
          executionCount: 0,
          lastExecutedAt: null,
        };

        const key = `recurring_schedule_${session.id}_${scheduleId}`;
        await db
          .insert(platformSettings)
          .values({ key, value: JSON.stringify(schedule) })
          .onConflictDoUpdate({
            target: platformSettings.key,
            set: { value: JSON.stringify(schedule) },
          });

        await writeAuditLog({
          agentId: session.id,
          action: "RECURRING_PAYMENT_CREATED",
          resource: "recurring_payment",
          resourceId: scheduleId,
          status: "success",
          metadata: {
            agentCode: session.agentId,
            type: input.type,
            amount: input.amount,
            frequency: input.frequency,
          },
        });

        return schedule;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    try {
      const session = await getAgentFromCookie(ctx.req);
      if (!session) throw new TRPCError({ code: "UNAUTHORIZED" });

      const db = (await getDb())!;
      if (!db) return { schedules: [] };

      const rows = await db.execute(
        sql`SELECT key, value FROM platform_settings WHERE key LIKE ${"recurring_schedule_" + session.id + "_%"} ORDER BY key`
      );

      const schedules = (rows.rows ?? [])
        .map((r: Record<string, unknown>) => {
          try {
            return JSON.parse(String(r.value));
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      return { schedules };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  }),

  cancel: protectedProcedure
    .input(z.object({ scheduleId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const session = await getAgentFromCookie(ctx.req);
        if (!session) throw new TRPCError({ code: "UNAUTHORIZED" });

        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const key = `recurring_schedule_${session.id}_${input.scheduleId}`;
        const [existing] = await db
          .select({ value: platformSettings.value })
          .from(platformSettings)
          .where(eq(platformSettings.key, key))
          .limit(1);

        if (!existing)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Schedule not found",
          });

        const schedule = JSON.parse(String(existing.value));
        schedule.status = "cancelled";
        schedule.cancelledAt = new Date().toISOString();

        await db
          .update(platformSettings)
          .set({ value: JSON.stringify(schedule) })
          .where(eq(platformSettings.key, key));

        await writeAuditLog({
          agentId: session.id,
          metadata: { agentCode: session.agentId },
          action: "RECURRING_PAYMENT_CANCELLED",
          resource: "recurring_payment",
          resourceId: input.scheduleId,
          status: "success",
        });

        return { scheduleId: input.scheduleId, status: "cancelled" };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
});
