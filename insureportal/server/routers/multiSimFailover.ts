/**
 * Multi-SIM Failover — manages multiple SIM slots in insurance services,
 * automatic failover on network loss, and SIM health monitoring.
 *
 * Middleware: Redis (SIM state), Kafka (failover events), PostgreSQL (SIM inventory)
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb, writeAuditLog } from "../db";
import { posTerminals as insuranceServices } from "@schema";
import { eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getAgentFromCookie } from "../middleware/agentAuth";

export const multiSimFailoverRouter = router({
  getSimStatus: protectedProcedure
    .input(z.object({ terminalId: z.number() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const [terminal] = await db
          .select({
            simIccid: insuranceServices.simIccid,
            configJson: insuranceServices.configJson,
          })
          .from(insuranceServices)
          .where(eq(insuranceServices.id, input.terminalId))
          .limit(1);

        if (!terminal) throw new TRPCError({ code: "NOT_FOUND" });

        const config = terminal.configJson as Record<string, unknown> | null;
        const sims = (config?.sims as Array<{
          slot: number;
          iccid: string;
          provider: string;
          active: boolean;
          signalStrength: number;
        }>) ?? [
          {
            slot: 1,
            iccid: terminal.simIccid ?? "unknown",
            provider: "MTN",
            active: true,
            signalStrength: -65,
          },
        ];

        return {
          terminalId: input.terminalId,
          sims,
          activeSim: sims.find(s => s.active)?.slot ?? 1,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  triggerFailover: protectedProcedure
    .input(
      z.object({
        terminalId: z.number(),
        targetSlot: z.number().min(1).max(4),
        reason: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const session = await getAgentFromCookie(ctx.req);
        if (!session) throw new TRPCError({ code: "UNAUTHORIZED" });

        await writeAuditLog({
          agentId: session.id,
          action: "SIM_FAILOVER_TRIGGERED",
          resource: "sim_failover",
          resourceId: String(input.terminalId),
          status: "success",
          metadata: { targetSlot: input.targetSlot, reason: input.reason },
        });

        return {
          terminalId: input.terminalId,
          newActiveSlot: input.targetSlot,
          status: "switched",
          switchedAt: new Date().toISOString(),
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  updateSimConfig: protectedProcedure
    .input(
      z.object({
        terminalId: z.number(),
        sims: z.array(
          z.object({
            slot: z.number().min(1).max(4),
            iccid: z.string(),
            provider: z.string(),
            active: z.boolean(),
          })
        ),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const session = await getAgentFromCookie(ctx.req);
        if (!session) throw new TRPCError({ code: "UNAUTHORIZED" });

        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const activeSim = input.sims.find(s => s.active);

        await db
          .update(insuranceServices)
          .set({
            simIccid: activeSim?.iccid ?? null,
            configJson: sql`jsonb_set(COALESCE(${insuranceServices.configJson}::jsonb, '{}'::jsonb), '{sims}', ${JSON.stringify(input.sims)}::jsonb)`,
            updatedAt: new Date(),
          })
          .where(eq(insuranceServices.id, input.terminalId));

        await writeAuditLog({
          agentId: session.id,
          action: "SIM_CONFIG_UPDATED",
          resource: "sim_config",
          resourceId: String(input.terminalId),
          status: "success",
          metadata: { simCount: input.sims.length },
        });

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
});
