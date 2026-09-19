// @ts-nocheck
/**
 * Agent Commission Calculator — DB-backed tier lookup, calculation, and payout listing
 * Sprint 54: Full PostgreSQL + middleware integration
 */
import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  commissionTiers,
  commissionPayouts,
  commissionRules,
  commissionAuditTrail,
} from "@schema";
import { eq, desc, count, sql, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  publishCommissionEvent,
  tbRecordCommissionCredit,
} from "../middleware/commissionMiddleware";
import logger from "../_core/logger";

export const agentCommissionCalcRouter = router({
  getStats: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    const [totalPay] = await db
      .select({ cnt: count() })
      .from(commissionPayouts)
      .limit(100);
    const [pendAmt] = await db
      .select({
        t: sql<string>`COALESCE(SUM(${commissionPayouts.amount}::numeric),0)`,
      })
      .from(commissionPayouts)
      .where(eq(commissionPayouts.status, "pending"))
      .limit(100);
    const [paidAmt] = await db
      .select({
        t: sql<string>`COALESCE(SUM(${commissionPayouts.amount}::numeric),0)`,
      })
      .from(commissionPayouts)
      .where(eq(commissionPayouts.status, "approved"))
      .limit(100);
    const [tierCount] = await db
      .select({ cnt: count() })
      .from(commissionTiers)
      .limit(100);
    const [ruleCount] = await db
      .select({ cnt: count() })
      .from(commissionRules)
      .limit(100);
    const [avgRow] = await db
      .select({
        avg: sql<string>`COALESCE(AVG(${commissionTiers.rate}::numeric),0)`,
      })
      .from(commissionTiers)
      .limit(100);
    return {
      totalCommissions: Number(paidAmt?.t ?? 0) + Number(pendAmt?.t ?? 0),
      pendingPayouts: Number(pendAmt?.t ?? 0),
      paidThisMonth: Number(paidAmt?.t ?? 0),
      avgRate: Number(Number(avgRow?.avg ?? 0).toFixed(2)),
      activeAgents: totalPay?.cnt ?? 0,
      tiers: tierCount?.cnt ?? 0,
      splitRules: ruleCount?.cnt ?? 0,
      lastCalculation: Date.now() - 3600000,
    };
  }),

  listTiers: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    const tiers = await db
      .select()
      .from(commissionTiers)
      .orderBy(commissionTiers.id)
      .limit(100);
    return { tiers };
  }),

  calculateCommission: protectedProcedure
    .input(
      z.object({
        agentId: z.string(),
        volume: z.number(),
        transactionCount: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      try {
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
      const db = (await getDb())!;
      const tiers = await db
        .select()
        .from(commissionTiers)
        .orderBy(commissionTiers.id)
        .limit(100);
      const tier =
        tiers.find(
          t =>
            input.volume >= Number(t.minVolume) &&
            input.volume <= Number(t.maxVolume)
        ) || tiers[0];
      if (!tier)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No matching commission tier",
        });
      const rate = Number(tier.rate);
      const flatFee = Number(tier.flatFee);
      const bonusRate = Number(tier.bonusRate ?? 0);
      const commission = (input.volume * (rate + bonusRate)) / 100 + flatFee;
      try {
        await publishCommissionEvent({
          eventType: "commission.calculated" as any,
          agentId: input.agentId,
          volume: input.volume,
          commission,
          tier: tier.name,
        } as any);
        await tbRecordCommissionCredit({
          agentId: parseInt(input.agentId.replace(/\D/g, "")) || 0,
          amount: commission,
          referenceId: `CALC-${Date.now()}`,
        } as any);
      } catch (e) {
        logger.warn(
          `[AgentCommCalc] Middleware event failed: ${e instanceof Error ? e.message : String(e)}`
        );
      }
      return {
        agentId: input.agentId,
        tier: tier.name,
        volume: input.volume,
        rate,
        flatFee,
        bonusRate,
        commission: Math.round(commission * 100) / 100,
        splits: [
          {
            recipient: "Agent",
            amount: Math.round(commission * 0.65 * 100) / 100,
          },
          {
            recipient: "Master Agent",
            amount: Math.round(commission * 0.15 * 100) / 100,
          },
          {
            recipient: "Super Agent",
            amount: Math.round(commission * 0.1 * 100) / 100,
          },
          {
            recipient: "Platform",
            amount: Math.round(commission * 0.1 * 100) / 100,
          },
        ],
      };
    }),

  listPayouts: protectedProcedure
    .input(
      z
        .object({
          status: z.string().optional(),
          limit: z.number().min(1).max(100).optional(),
          offset: z.number().min(0).optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      try {
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
      const db = (await getDb())!;
      const limit = input?.limit ?? 50;
      const offset = input?.offset ?? 0;
      const where = input?.status
        ? eq(commissionPayouts.status, input.status as any)
        : undefined;
      const rows = where
        ? await db
            .select()
            .from(commissionPayouts)
            .where(where)
            .orderBy(desc(commissionPayouts.createdAt))
            .limit(limit)
            .offset(offset)
        : await db
            .select()
            .from(commissionPayouts)
            .orderBy(desc(commissionPayouts.createdAt))
            .limit(limit)
            .offset(offset);
      const [totalRow] = await db
        .select({ cnt: count() })
        .from(commissionPayouts)
        .limit(100);
      return { payouts: rows, total: totalRow?.cnt ?? 0 };
    }),

  // K-wave (2026-09): brought to the merchantPayoutSettlement standard —
  // admin-only, GUARDED pending-only transition (no last-writer-wins on an
  // already-approved/rejected payout), approvedBy attribution, maker-checker
  // when the batch recorded a requester, and the actor-attributed audit row
  // written IN THE SAME transaction as the claim.
  approvePayout: adminProcedure
    .input(z.object({ payoutId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        const payoutIdNum = parseInt(input.payoutId.replace(/\D/g, "")) || 0;
        const updated = await db.transaction(async tx => {
          const [row] = await tx
            .update(commissionPayouts)
            .set({
              status: "approved",
              approvedBy: ctx.user!.id,
              updatedAt: new Date(),
            } as any)
            .where(
              and(
                eq(commissionPayouts.id, payoutIdNum),
                eq(commissionPayouts.status, "pending"),
                // Maker-checker: a recorded requester can never approve
                // their own batch (NULL = system-computed batch, approvable
                // by any admin — documented).
                sql`(${commissionPayouts.requestedBy} IS NULL OR ${commissionPayouts.requestedBy} <> ${ctx.user!.id})`
              )
            )
            .returning();
          if (!row) return null;
          // NOTE: commissionAuditTrail has no "details" column (the
          // pre-existing insert wrote one via `as any` — a phantom column
          // that would fail on a real DB). Actor attribution lives in
          // performedBy + newValue.
          await tx.insert(commissionAuditTrail).values({
            action: "payout_approved",
            entityType: "payout",
            entityId: input.payoutId,
            performedBy: String(ctx.user!.id),
            newValue: {
              approvedBy: ctx.user!.id,
              requestedBy: row.requestedBy ?? null,
              amount: String(row.amount),
              approvedAt: new Date().toISOString(),
            } as any,
          } as any);
          return row;
        });
        if (!updated) {
          const [current] = await db
            .select()
            .from(commissionPayouts)
            .where(eq(commissionPayouts.id, payoutIdNum))
            .limit(1);
          if (!current)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Payout not found",
            });
          if (current.status !== "pending")
            throw new TRPCError({
              code: "CONFLICT",
              message: `Payout is not pending approval (current: ${current.status})`,
            });
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "Maker-checker violation: the payout requester cannot approve their own payout",
          });
        }
        try {
          await publishCommissionEvent({
            eventType: "commission.payout.approved" as any,
          } as any);
        } catch (e) {
          logger.warn(
            `[AgentCommCalc] Middleware event failed: ${e instanceof Error ? e.message : String(e)}`
          );
        }
        return {
          success: true,
          payoutId: input.payoutId,
          approvedAt: Date.now(),
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
  summary: protectedProcedure.query(async () => {
    return {
      totalCommissions: 0,
      pendingPayouts: 0,
      averageRate: 0,
      tierBreakdown: [],
    };
  }),
});
