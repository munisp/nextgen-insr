/**
 * parametricEngine.ts — Q-wave Q2 (2026-09-25)
 *
 * tRPC surface for the Parametric Trigger Engine + STP claims expansion
 * (migration 0087). All write/admin surfaces are admin-gated; manual
 * readings use dual control (attester ≠ confirmer). The metrics endpoint is
 * the Lemonade-style claims-paid-speed trust metric, aggregated from REAL
 * claims timestamps (created → approved → paid), admin-gated.
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import {
  claims,
  claimWorkflowEvents,
  claimStpTiers,
  parametricEvents,
  parametricManualReadings,
  parametricPayoutSettlements,
  parametricProducts,
  parametricTriggerDefinitions,
} from "../../drizzle/schema";
import { adminProcedure, router } from "../_core/trpc";
import { getDb, writeAuditLog } from "../db";
import { datasourceConfigSchema } from "../lib/parametricDatasources";
import { evaluateTrigger } from "../lib/parametricEngine";

async function db() {
  const d = await getDb();
  if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
  return d;
}

const operatorEnum = z.enum(["gt", "gte", "lt", "lte", "eq"]);

export const parametricEngineRouter = router({
  // ── Trigger CRUD (admin) ──────────────────────────────────────────────────
  createTrigger: adminProcedure
    .input(z.object({
      name: z.string().min(3).max(128),
      metric: z.string().min(1).max(64),
      operator: operatorEnum,
      threshold: z.number().finite(),
      windowSeconds: z.number().int().positive().max(31_536_000),
      datasourceConfig: datasourceConfigSchema,
    }))
    .mutation(async ({ input, ctx }) => {
      const d = await db();
      const [trigger] = await d.insert(parametricTriggerDefinitions).values({
        name: input.name,
        metric: input.metric,
        operator: input.operator,
        threshold: String(input.threshold),
        windowSeconds: input.windowSeconds,
        datasourceConfig: input.datasourceConfig,
        status: "draft",
        createdBy: ctx.user?.id ?? null,
      }).returning();
      return { triggerId: trigger.id, status: trigger.status };
    }),

  listTriggers: adminProcedure.query(async () => {
    const d = await db();
    return d.select().from(parametricTriggerDefinitions)
      .orderBy(desc(parametricTriggerDefinitions.id)).limit(200);
  }),

  setTriggerStatus: adminProcedure
    .input(z.object({
      triggerId: z.number().int().positive(),
      status: z.enum(["draft", "active", "paused", "retired"]),
    }))
    .mutation(async ({ input }) => {
      const d = await db();
      const updated = await d.update(parametricTriggerDefinitions)
        .set({ status: input.status, updatedAt: new Date() })
        .where(eq(parametricTriggerDefinitions.id, input.triggerId))
        .returning({ id: parametricTriggerDefinitions.id });
      if (updated.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Trigger not found" });
      }
      return { success: true };
    }),

  // ── Product → trigger mapping (admin) ──────────────────────────────────────
  upsertProduct: adminProcedure
    .input(z.object({
      productId: z.number().int().positive(),
      triggerId: z.number().int().positive(),
      payoutAmount: z.number().positive().finite(),
      coveredPeril: z.string().min(1).max(64),
      status: z.enum(["active", "inactive"]).default("active"),
    }))
    .mutation(async ({ input }) => {
      const d = await db();
      const [row] = await d.insert(parametricProducts).values({
        productId: input.productId,
        triggerId: input.triggerId,
        payoutAmount: String(input.payoutAmount),
        coveredPeril: input.coveredPeril,
        status: input.status,
      }).onConflictDoUpdate({
        target: [parametricProducts.productId, parametricProducts.triggerId],
        set: {
          payoutAmount: String(input.payoutAmount),
          coveredPeril: input.coveredPeril,
          status: input.status,
          updatedAt: new Date(),
        },
      }).returning();
      return { id: row.id };
    }),

  listProducts: adminProcedure.query(async () => {
    const d = await db();
    return d.select().from(parametricProducts)
      .orderBy(desc(parametricProducts.id)).limit(200);
  }),

  // ── Manual datasource readings (dual control) ──────────────────────────────
  attestReading: adminProcedure
    .input(z.object({
      triggerId: z.number().int().positive(),
      metric: z.string().min(1).max(64),
      value: z.number().finite(),
      observedAt: z.string().datetime(),
      note: z.string().max(2000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const d = await db();
      const [row] = await d.insert(parametricManualReadings).values({
        triggerId: input.triggerId,
        metric: input.metric,
        value: String(input.value),
        observedAt: new Date(input.observedAt),
        attestedBy: ctx.user!.id,
        note: input.note ?? null,
      }).returning();
      return { readingId: row.id, status: "attested" };
    }),

  confirmReading: adminProcedure
    .input(z.object({ readingId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const d = await db();
      const [reading] = await d.select().from(parametricManualReadings)
        .where(eq(parametricManualReadings.id, input.readingId)).limit(1);
      if (!reading) throw new TRPCError({ code: "NOT_FOUND", message: "Reading not found" });
      // Dual control: the confirmer must be a DIFFERENT staff member.
      if (reading.attestedBy === ctx.user!.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Dual control: the attester cannot confirm their own reading",
        });
      }
      await d.update(parametricManualReadings).set({
        confirmedBy: ctx.user!.id,
        confirmedAt: new Date(),
      }).where(eq(parametricManualReadings.id, input.readingId));
      return { success: true };
    }),

  // ── Scheduler-invoked evaluation path (admin manual tick) ──────────────────
  evaluateNow: adminProcedure
    .input(z.object({ triggerId: z.number().int().positive() }))
    .mutation(async ({ input }) => evaluateTrigger(input.triggerId)),

  listEvents: adminProcedure
    .input(z.object({ triggerId: z.number().int().positive().optional() }).optional())
    .query(async ({ input }) => {
      const d = await db();
      const base = d.select().from(parametricEvents);
      const rows = input?.triggerId
        ? await base.where(eq(parametricEvents.triggerId, input.triggerId))
            .orderBy(desc(parametricEvents.id)).limit(200)
        : await base.orderBy(desc(parametricEvents.id)).limit(200);
      return rows;
    }),

  listPayouts: adminProcedure
    .input(z.object({ eventId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const d = await db();
      return d.select().from(parametricPayoutSettlements)
        .where(eq(parametricPayoutSettlements.eventId, input.eventId))
        .orderBy(desc(parametricPayoutSettlements.id)).limit(500);
    }),

  // ── STP tier configuration (admin) ──────────────────────────────────────────
  upsertStpTier: adminProcedure
    .input(z.object({
      productId: z.number().int().positive().nullable(),
      tierName: z.string().min(1).max(64),
      autoApproveCap: z.number().positive().finite(),
      maxFraudScore: z.number().min(0).max(100).nullable().default(null),
      isActive: z.boolean().default(true),
    }))
    .mutation(async ({ input, ctx }) => {
      const d = await db();
      // 2026-09-26 (Q24 fix): cap escalation above ₦200k is admin-gated but
      // was under-trailed — the conflict-update path silently rewrote
      // autoApproveCap/maxFraudScore with no actor identity and no audit_log
      // row. Read the prior row first so BOTH the insert and the
      // conflict-update paths write a hash-chained audit_log entry capturing
      // actor, product/tier and old → new values.
      const productCond = input.productId == null
        ? isNull(claimStpTiers.productId)
        : eq(claimStpTiers.productId, input.productId);
      const [existing] = await d.select().from(claimStpTiers)
        .where(and(productCond, eq(claimStpTiers.tierName, input.tierName)))
        .limit(1);
      const [row] = await d.insert(claimStpTiers).values({
        productId: input.productId,
        tierName: input.tierName,
        autoApproveCap: String(input.autoApproveCap),
        maxFraudScore: input.maxFraudScore == null ? null : String(input.maxFraudScore),
        isActive: input.isActive,
        createdBy: ctx.user?.id ?? null,
      }).onConflictDoUpdate({
        target: [claimStpTiers.productId, claimStpTiers.tierName],
        set: {
          autoApproveCap: String(input.autoApproveCap),
          maxFraudScore: input.maxFraudScore == null ? null : String(input.maxFraudScore),
          isActive: input.isActive,
          updatedAt: new Date(),
        },
      }).returning();
      await writeAuditLog({
        agentId: ctx.user?.id,
        action: existing ? "STP_TIER_UPDATED" : "STP_TIER_CREATED",
        resource: "claim_stp_tiers",
        resourceId: String(row.id),
        status: "success",
        metadata: {
          actorId: ctx.user?.id ?? null,
          productId: input.productId,
          tierName: input.tierName,
          oldAutoApproveCap: existing?.autoApproveCap ?? null,
          newAutoApproveCap: String(input.autoApproveCap),
          oldMaxFraudScore: existing?.maxFraudScore ?? null,
          newMaxFraudScore: input.maxFraudScore == null ? null : String(input.maxFraudScore),
          oldIsActive: existing?.isActive ?? null,
          newIsActive: input.isActive,
          changedAt: new Date().toISOString(),
        },
      });
      return { id: row.id };
    }),

  listStpTiers: adminProcedure.query(async () => {
    const d = await db();
    return d.select().from(claimStpTiers).orderBy(desc(claimStpTiers.id)).limit(200);
  }),

  // ── Claims-paid-speed trust metric (Lemonade-style), admin-gated ──────────
  // Real aggregation from claims timestamps: created → approved → paid.
  claimsPaidSpeedMetrics: adminProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(10_000).default(5_000),
      // Optional slice (e.g. per covered peril / claim type).
      claimType: z.string().max(64).optional(),
    }).optional())
    .query(async ({ input }) => {
      const d = await db();
      const limit = input?.limit ?? 5_000;

      // Paid claims with a recorded settlement timestamp.
      const paidClaims = await d.select({
        id: claims.id,
        createdAt: claims.createdAt,
        settlementDate: claims.settlementDate,
      }).from(claims).where(
        and(
          eq(claims.status, "paid"),
          isNotNull(claims.settlementDate),
          input?.claimType ? eq(claims.claimType, input.claimType) : undefined,
        ),
      ).orderBy(desc(claims.id)).limit(limit);

      if (paidClaims.length === 0) {
        return {
          sampleSize: 0,
          createdToApprovedMs: null,
          approvedToPaidMs: null,
          createdToPaidMs: null,
        };
      }

      // First approval event per claim (approval provenance).
      const ids = paidClaims.map(c => c.id);
      const approvalRows = await d.select({
        claimId: claimWorkflowEvents.claimId,
        approvedAt: sql<Date>`min(${claimWorkflowEvents.createdAt})`,
      }).from(claimWorkflowEvents).where(and(
        inArray(claimWorkflowEvents.claimId, ids),
        inArray(claimWorkflowEvents.eventType, ["claim.approved", "claim.partially_approved"]),
      )).groupBy(claimWorkflowEvents.claimId);
      const approvedAtByClaim = new Map(
        approvalRows.map(r => [r.claimId, new Date(r.approvedAt).getTime()]),
      );

      const pct = (values: number[], p: number): number | null => {
        if (values.length === 0) return null;
        const sorted = [...values].sort((a, b) => a - b);
        const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
        return sorted[idx];
      };
      const summarize = (values: number[]) => ({
        p50: pct(values, 50),
        p95: pct(values, 95),
        count: values.length,
      });

      const createdToApproved: number[] = [];
      const approvedToPaid: number[] = [];
      const createdToPaid: number[] = [];
      for (const c of paidClaims) {
        const created = new Date(c.createdAt).getTime();
        const paid = new Date(c.settlementDate!).getTime();
        const approved = approvedAtByClaim.get(c.id);
        if (Number.isFinite(paid) && Number.isFinite(created) && paid >= created) {
          createdToPaid.push(paid - created);
        }
        if (approved != null && Number.isFinite(approved)) {
          if (approved >= created) createdToApproved.push(approved - created);
          if (paid >= approved) approvedToPaid.push(paid - approved);
        }
      }

      return {
        sampleSize: paidClaims.length,
        createdToApprovedMs: summarize(createdToApproved),
        approvedToPaidMs: summarize(approvedToPaid),
        createdToPaidMs: summarize(createdToPaid),
      };
    }),
});
