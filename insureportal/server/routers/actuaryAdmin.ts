/**
 * actuaryAdmin.ts — W34-D (2026-11-28) actuary_admin mutation surface.
 * Design: actuary-design/design.md Appendix E + §7.2/§7.4.
 *
 * Every procedure runs behind actuaryAdminProcedure (see
 * routers/actuaryRoleGuard.ts): actuary_admin Permify permission, ALWAYS
 * Permify-checked, fail-closed — Permify-down denies (W23 posture).
 *
 *   upsertRateVersion    draft → filing → approved → retired lifecycle.
 *                        draft→filing and filing→approved REQUIRE a NAICOM
 *                        filing reference (§7.2 filing-readiness gate); the
 *                        filing ref is captured here (RateAdmin page).
 *                        Approve retires any other approved version for the
 *                        same line in the SAME transaction (single-active
 *                        invariant, Appendix D — the Go service enforces it
 *                        again transactionally on activate).
 *   approveRun           completed → approved for reserve/capital runs
 *                        (filing eligibility flip, §7.2). Refuses to approve
 *                        runs in any other status (no silent rewrites).
 *   upsertAssumptionSet  naicomFilingReady gate: flipping the attestation
 *                        true records approvedBy/approvedAt from the caller
 *                        (a human attestation, never auto-set).
 *   manageReferralRules  rule CRUD + priority reordering (Appendix E).
 *
 * All money/metadata writes follow the W29 fail-closed DB posture:
 * unavailable DB → PRECONDITION_FAILED, never a silent in-memory success.
 */
import { z } from "zod";
import { router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { eq, and, asc, ne } from "drizzle-orm";
import { getDb } from "../db";
import {
  actProductLines,
  actRateVersions,
  actAssumptionSets,
  actReserveRuns,
  actCapitalRuns,
  actReferralRules,
  auditLog,
} from "@schema";
import { actuaryAdminProcedure } from "./actuaryRoleGuard";

const productLineSchema = z.string().min(1).max(64);

/** W29 fail-closed posture (mirrors savingsProducts.deposit). */
async function requireRealDb() {
  const db = await getDb();
  if (!db || (db as { _isNoop?: boolean })._isNoop) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Actuary admin mutations require the database; no database is configured (fail-closed — never a silent in-memory success).",
    });
  }
  return db;
}

async function audit(entry: {
  action: string;
  resourceId: string;
  metadata: Record<string, unknown>;
}) {
  const db = await getDb();
  await (db as NonNullable<typeof db>).insert(auditLog).values({
    action: entry.action,
    resource: "actuary_engine",
    resourceId: entry.resourceId,
    status: "success",
    metadata: entry.metadata,
  });
}

export const actuaryAdminRouter = router({
  upsertRateVersion: actuaryAdminProcedure("manage_rates")
    .input(
      z.object({
        productLine: productLineSchema,
        version: z.string().min(1).max(32),
        action: z.enum(["create", "submitFiling", "approve", "retire"]),
        naicomFilingRef: z.string().min(1).max(128).optional(),
        effectiveFrom: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        effectiveTo: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        modelRegistryId: z.number().int().positive().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await requireRealDb();
      const [line] = await db
        .select()
        .from(actProductLines)
        .where(eq(actProductLines.code, input.productLine as never))
        .limit(1);
      if (!line) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Unknown actuary product line: ${input.productLine}`,
        });
      }
      const [existing] = await db
        .select()
        .from(actRateVersions)
        .where(
          and(
            eq(actRateVersions.productLineId, line.id),
            eq(actRateVersions.version, input.version)
          )
        )
        .limit(1);

      if (input.action === "create") {
        if (existing) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Rate version ${input.version} already exists for ${input.productLine} (unique(productLineId, version)).`,
          });
        }
        const [created] = await db
          .insert(actRateVersions)
          .values({
            productLineId: line.id,
            version: input.version,
            status: "draft",
            effectiveFrom: input.effectiveFrom
              ? new Date(input.effectiveFrom)
              : null,
            effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null,
            naicomFilingRef: input.naicomFilingRef ?? null,
            modelRegistryId: input.modelRegistryId ?? null,
            createdBy: ctx.user!.id,
          })
          .returning();
        await audit({
          action: "actuary_rate_version_created",
          resourceId: String(created.id),
          metadata: {
            productLine: input.productLine,
            version: input.version,
            userId: ctx.user!.id,
          },
        });
        return { id: created.id, status: created.status, transitioned: false as const };
      }

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Rate version ${input.version} not found for ${input.productLine}.`,
        });
      }

      // Lifecycle state machine (design Appendix E): draft → filing →
      // approved → retired. Skips are forbidden — an unfiled draft must
      // never jump to approved.
      const transitions: Record<string, string> = {
        submitFiling: "draft",
        approve: "filing",
        retire: "approved",
      };
      const expectedFrom = transitions[input.action];
      if (existing.status !== expectedFrom) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Illegal transition ${existing.status} → ${input.action} (expected status '${expectedFrom}'). Lifecycle: draft → filing → approved → retired.`,
        });
      }

      if (input.action === "submitFiling") {
        // Filing transition requires the NAICOM reference — either already
        // captured on the row or supplied with this call.
        const ref = input.naicomFilingRef ?? existing.naicomFilingRef;
        if (!ref) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "draft → filing requires a NAICOM filing reference (naicomFilingRef). Rates must be filed before approval (design §7.2).",
          });
        }
        const [updated] = await db
          .update(actRateVersions)
          .set({
            status: "filing",
            naicomFilingRef: ref,
            effectiveFrom: input.effectiveFrom
              ? new Date(input.effectiveFrom)
              : existing.effectiveFrom,
            effectiveTo: input.effectiveTo
              ? new Date(input.effectiveTo)
              : existing.effectiveTo,
            updatedAt: new Date(),
          })
          .where(eq(actRateVersions.id, existing.id))
          .returning();
        await audit({
          action: "actuary_rate_version_filing_submitted",
          resourceId: String(updated.id),
          metadata: {
            productLine: input.productLine,
            version: input.version,
            naicomFilingRef: ref,
            userId: ctx.user!.id,
          },
        });
        return { id: updated.id, status: updated.status, transitioned: true as const };
      }

      if (input.action === "approve") {
        // Approved requires the filing ref captured at the filing stage —
        // the NAICOM-filing-readiness gate is enforced twice (here and at
        // submitFiling) so it cannot be bypassed by direct row edits.
        if (!existing.naicomFilingRef) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "filing → approved requires a NAICOM filing reference on the version row.",
          });
        }
        // Single-active-per-line invariant (Appendix D): retire every other
        // approved version for this line in the SAME transaction.
        const [updated] = await db.transaction(async tx => {
          await tx
            .update(actRateVersions)
            .set({ status: "retired", updatedAt: new Date() })
            .where(
              and(
                eq(actRateVersions.productLineId, line.id),
                eq(actRateVersions.status, "approved"),
                ne(actRateVersions.id, existing.id)
              )
            );
          const [row] = await tx
            .update(actRateVersions)
            .set({
              status: "approved",
              approvedBy: ctx.user!.id,
              approvedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(actRateVersions.id, existing.id))
            .returning();
          return [row];
        });
        await audit({
          action: "actuary_rate_version_approved",
          resourceId: String(updated.id),
          metadata: {
            productLine: input.productLine,
            version: input.version,
            naicomFilingRef: existing.naicomFilingRef,
            userId: ctx.user!.id,
          },
        });
        return { id: updated.id, status: updated.status, transitioned: true as const };
      }

      // retire
      const [updated] = await db
        .update(actRateVersions)
        .set({ status: "retired", updatedAt: new Date() })
        .where(eq(actRateVersions.id, existing.id))
        .returning();
      await audit({
        action: "actuary_rate_version_retired",
        resourceId: String(updated.id),
        metadata: {
          productLine: input.productLine,
          version: input.version,
          userId: ctx.user!.id,
        },
      });
      return { id: updated.id, status: updated.status, transitioned: true as const };
    }),

  approveRun: actuaryAdminProcedure("approve_runs")
    .input(
      z.object({
        kind: z.enum(["reserve", "capital"]),
        id: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await requireRealDb();
      const table =
        input.kind === "reserve" ? actReserveRuns : actCapitalRuns;
      const [run] = await db
        .select()
        .from(table)
        .where(eq(table.id, input.id))
        .limit(1);
      if (!run) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `${input.kind} run ${input.id} not found.`,
        });
      }
      if (run.status !== "completed") {
        // Never silently rewrite a run that is not awaiting approval —
        // the filing-eligibility flip is a controlled transition (§7.2).
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `${input.kind} run ${input.id} is in status '${run.status}', not 'completed' — nothing to approve.`,
        });
      }
      const [updated] = await db
        .update(table)
        .set({
          status: "approved",
          approvedBy: ctx.user!.id,
          approvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(table.id, input.id))
        .returning();
      await audit({
        action: `actuary_${input.kind}_run_approved`,
        resourceId: String(updated.id),
        metadata: { kind: input.kind, userId: ctx.user!.id },
      });
      return { id: updated.id, kind: input.kind, status: updated.status };
    }),

  upsertAssumptionSet: actuaryAdminProcedure("manage_assumptions")
    .input(
      z.object({
        name: z.string().min(1).max(128),
        scope: z.enum(["pricing", "reserving", "capital", "life"]),
        version: z.string().min(1).max(32),
        payload: z.record(z.string(), z.unknown()),
        // naicomFilingReady gate: flipping true is a human attestation by
        // the actuary_admin caller — recorded with approvedBy/approvedAt.
        naicomFilingReady: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await requireRealDb();
      const [existing] = await db
        .select()
        .from(actAssumptionSets)
        .where(
          and(
            eq(actAssumptionSets.name, input.name),
            eq(actAssumptionSets.scope, input.scope),
            eq(actAssumptionSets.version, input.version)
          )
        )
        .limit(1);
      const filingAttestation =
        input.naicomFilingReady && !existing?.naicomFilingReady;
      if (existing) {
        const [updated] = await db
          .update(actAssumptionSets)
          .set({
            payload: input.payload,
            naicomFilingReady: input.naicomFilingReady,
            // Only a NEW attestation flips the approver; clearing the flag
            // keeps the prior approver audit fields untouched.
            ...(filingAttestation
              ? { approvedBy: ctx.user!.id, approvedAt: new Date() }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(actAssumptionSets.id, existing.id))
          .returning();
        await audit({
          action: "actuary_assumption_set_updated",
          resourceId: String(updated.id),
          metadata: {
            name: input.name,
            scope: input.scope,
            version: input.version,
            naicomFilingReady: input.naicomFilingReady,
            userId: ctx.user!.id,
          },
        });
        return { id: updated.id, created: false as const, naicomFilingReady: updated.naicomFilingReady };
      }
      const [created] = await db
        .insert(actAssumptionSets)
        .values({
          name: input.name,
          scope: input.scope,
          version: input.version,
          payload: input.payload,
          naicomFilingReady: input.naicomFilingReady,
          ...(filingAttestation
            ? { approvedBy: ctx.user!.id, approvedAt: new Date() }
            : {}),
        })
        .returning();
      await audit({
        action: "actuary_assumption_set_created",
        resourceId: String(created.id),
        metadata: {
          name: input.name,
          scope: input.scope,
          version: input.version,
          naicomFilingReady: input.naicomFilingReady,
          userId: ctx.user!.id,
        },
      });
      return { id: created.id, created: true as const, naicomFilingReady: created.naicomFilingReady };
    }),

  manageReferralRules: actuaryAdminProcedure("manage_referral_rules")
    .input(
      z.object({
        action: z.enum(["upsert", "disable", "reorder"]),
        rule: z
          .object({
            id: z.number().int().positive().optional(),
            productLine: productLineSchema,
            predicate: z.record(z.string(), z.unknown()),
            action: z.enum(["refer", "decline"]),
            reasonCode: z.string().min(1).max(64),
            priority: z.number().int().min(0).max(10000).default(100),
            isActive: z.boolean().default(true),
          })
          .optional(),
        priorities: z
          .array(
            z.object({
              id: z.number().int().positive(),
              priority: z.number().int().min(0).max(10000),
            })
          )
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await requireRealDb();

      if (input.action === "reorder") {
        if (!input.priorities || input.priorities.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "reorder requires a non-empty priorities array.",
          });
        }
        await db.transaction(async tx => {
          for (const p of input.priorities!) {
            await tx
              .update(actReferralRules)
              .set({ priority: p.priority, updatedAt: new Date() })
              .where(eq(actReferralRules.id, p.id));
          }
        });
        await audit({
          action: "actuary_referral_rules_reordered",
          resourceId: "*",
          metadata: { priorities: input.priorities, userId: ctx.user!.id },
        });
        return { reordered: input.priorities.length };
      }

      const rule = input.rule;
      if (!rule) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${input.action} requires the rule payload.`,
        });
      }

      if (input.action === "disable") {
        if (!rule.id) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "disable requires rule.id.",
          });
        }
        const [updated] = await db
          .update(actReferralRules)
          .set({ isActive: false, updatedAt: new Date() })
          .where(eq(actReferralRules.id, rule.id))
          .returning();
        if (!updated) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Referral rule ${rule.id} not found.`,
          });
        }
        await audit({
          action: "actuary_referral_rule_disabled",
          resourceId: String(updated.id),
          metadata: { userId: ctx.user!.id },
        });
        return { id: updated.id, isActive: updated.isActive };
      }

      // upsert
      const [line] = await db
        .select()
        .from(actProductLines)
        .where(eq(actProductLines.code, rule.productLine as never))
        .limit(1);
      if (!line) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Unknown actuary product line: ${rule.productLine}`,
        });
      }
      if (rule.id) {
        const [updated] = await db
          .update(actReferralRules)
          .set({
            productLineId: line.id,
            predicate: rule.predicate,
            action: rule.action,
            reasonCode: rule.reasonCode,
            priority: rule.priority,
            isActive: rule.isActive,
            updatedAt: new Date(),
          })
          .where(eq(actReferralRules.id, rule.id))
          .returning();
        if (!updated) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Referral rule ${rule.id} not found.`,
          });
        }
        await audit({
          action: "actuary_referral_rule_updated",
          resourceId: String(updated.id),
          metadata: {
            productLine: rule.productLine,
            reasonCode: rule.reasonCode,
            userId: ctx.user!.id,
          },
        });
        return { id: updated.id, created: false as const };
      }
      const [created] = await db
        .insert(actReferralRules)
        .values({
          productLineId: line.id,
          predicate: rule.predicate,
          action: rule.action,
          reasonCode: rule.reasonCode,
          priority: rule.priority,
          isActive: rule.isActive,
        })
        .returning();
      await audit({
        action: "actuary_referral_rule_created",
        resourceId: String(created.id),
        metadata: {
          productLine: rule.productLine,
          reasonCode: rule.reasonCode,
          userId: ctx.user!.id,
        },
      });
      return { id: created.id, created: true as const };
    }),

  // Read-back for the RateAdmin page: versions + rules listings belong to
  // the admin surface (gated like the mutations above).
  listRateVersions: actuaryAdminProcedure("manage_rates")
    .input(z.object({ productLine: productLineSchema.optional() }).optional())
    .query(async ({ input }) => {
      const db = await requireRealDb();
      const rows = await db
        .select({
          id: actRateVersions.id,
          productLineId: actRateVersions.productLineId,
          lineCode: actProductLines.code,
          version: actRateVersions.version,
          status: actRateVersions.status,
          naicomFilingRef: actRateVersions.naicomFilingRef,
          effectiveFrom: actRateVersions.effectiveFrom,
          effectiveTo: actRateVersions.effectiveTo,
          modelRegistryId: actRateVersions.modelRegistryId,
          createdBy: actRateVersions.createdBy,
          approvedBy: actRateVersions.approvedBy,
          approvedAt: actRateVersions.approvedAt,
          createdAt: actRateVersions.createdAt,
        })
        .from(actRateVersions)
        .leftJoin(
          actProductLines,
          eq(actRateVersions.productLineId, actProductLines.id)
        )
        .orderBy(asc(actRateVersions.id))
        .limit(500);
      const filtered = input?.productLine
        ? rows.filter(r => r.lineCode === input.productLine)
        : rows;
      return { versions: filtered, count: filtered.length };
    }),

  listReferralRules: actuaryAdminProcedure("manage_referral_rules")
    .input(z.object({ productLine: productLineSchema.optional() }).optional())
    .query(async ({ input }) => {
      const db = await requireRealDb();
      const rows = await db
        .select({
          id: actReferralRules.id,
          productLineId: actReferralRules.productLineId,
          lineCode: actProductLines.code,
          predicate: actReferralRules.predicate,
          action: actReferralRules.action,
          reasonCode: actReferralRules.reasonCode,
          priority: actReferralRules.priority,
          isActive: actReferralRules.isActive,
          createdAt: actReferralRules.createdAt,
        })
        .from(actReferralRules)
        .leftJoin(
          actProductLines,
          eq(actReferralRules.productLineId, actProductLines.id)
        )
        .orderBy(asc(actReferralRules.priority), asc(actReferralRules.id))
        .limit(500);
      const filtered = input?.productLine
        ? rows.filter(r => r.lineCode === input.productLine)
        : rows;
      return { rules: filtered, count: filtered.length };
    }),
});
