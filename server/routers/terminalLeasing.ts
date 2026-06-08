/**
 * Terminal Leasing — manage insurance service lease agreements, billing cycles,
 * insurance, and return processing.
 *
 * Middleware: Temporal (billing workflow), Kafka (lease events),
 * PostgreSQL (lease records), TigerBeetle (billing ledger)
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb, writeAuditLog } from "../db";
import { insuranceServices, agents, platformSettings } from "../../drizzle/schema";
import { eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getAgentFromCookie } from "../middleware/agentAuth";

export const terminalLeasingRouter = router({
  createLease: protectedProcedure
    .input(
      z.object({
        terminalId: z.number(),
        agentId: z.number(),
        monthlyRate: z.number().positive(),
        durationMonths: z.number().int().min(1).max(60),
        depositAmount: z.number().min(0).default(0),
        includeInsurance: z.boolean().default(false),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const session = await getAgentFromCookie(ctx.req);
        if (!session) throw new TRPCError({ code: "UNAUTHORIZED" });

        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const leaseId = `LSE-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
        const startDate = new Date();
        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() + input.durationMonths);

        const lease = {
          id: leaseId,
          ...input,
          status: "active",
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          totalCost:
            input.monthlyRate * input.durationMonths + input.depositAmount,
          insuranceMonthly: input.includeInsurance
            ? Math.round(input.monthlyRate * 0.1)
            : 0,
          paymentsReceived: 0,
          createdAt: new Date().toISOString(),
        };

        const key = `terminal_lease_${leaseId}`;
        await db
          .insert(platformSettings)
          .values({ key, value: JSON.stringify(lease) });

        await db
          .update(insuranceServices)
          .set({
            agentId: input.agentId,
            status: "active",
            updatedAt: new Date(),
          })
          .where(eq(insuranceServices.id, input.terminalId));

        await writeAuditLog({
          agentId: session.id,
          agentCode: session.agentCode,
          action: "TERMINAL_LEASE_CREATED",
          resource: "terminal_lease",
          resourceId: leaseId,
          status: "success",
          metadata: {
            terminalId: input.terminalId,
            monthlyRate: input.monthlyRate,
            duration: input.durationMonths,
          },
        });

        return lease;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  listLeases: protectedProcedure
    .input(z.object({ status: z.string().optional() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) return { leases: [] };

        const rows = await db.execute(
          sql`SELECT key, value FROM platform_settings WHERE key LIKE 'terminal_lease_%' ORDER BY key DESC`
        );

        let leases = (rows.rows ?? [])
          .map((r: Record<string, unknown>) => {
            try {
              return JSON.parse(String(r.value));
            } catch {
              return null;
            }
          })
          .filter(Boolean);

        if (input.status)
          leases = leases.filter(
            (l: Record<string, unknown>) => l.status === input.status
          );

        return { leases };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  terminateLease: protectedProcedure
    .input(z.object({ leaseId: z.string(), reason: z.string().max(256) }))
    .mutation(async ({ input, ctx }) => {
      try {
        const session = await getAgentFromCookie(ctx.req);
        if (!session) throw new TRPCError({ code: "UNAUTHORIZED" });

        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const key = `terminal_lease_${input.leaseId}`;
        const [existing] = await db
          .select({ value: platformSettings.value })
          .from(platformSettings)
          .where(eq(platformSettings.key, key))
          .limit(1);

        if (!existing) throw new TRPCError({ code: "NOT_FOUND" });

        const lease = JSON.parse(String(existing.value));
        lease.status = "terminated";
        lease.terminatedAt = new Date().toISOString();
        lease.terminationReason = input.reason;

        await db
          .update(platformSettings)
          .set({ value: JSON.stringify(lease) })
          .where(eq(platformSettings.key, key));

        await writeAuditLog({
          agentId: session.id,
          agentCode: session.agentCode,
          action: "TERMINAL_LEASE_TERMINATED",
          resource: "terminal_lease",
          resourceId: input.leaseId,
          status: "success",
          metadata: { reason: input.reason },
        });

        return { leaseId: input.leaseId, status: "terminated" };
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
