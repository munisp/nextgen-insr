/**
 * actuary.ts — W34-D (2026-11-28) actuary engine read/quote surface.
 * Design: actuary-design/design.md Appendix E (tRPC signatures), Appendix D
 * (frozen Go pricing-service contract consumed via server/actuaryAdapter.ts).
 *
 * Procedures:
 *   rateQuote         protected — any authenticated channel (Appendix I §1).
 *                     Passthrough to Go POST /v1/rate via the circuit-broken
 *                     adapter; SERVICE_UNAVAILABLE on outage/open circuit —
 *                     NEVER a fabricated premium (fail-closed, §7.1 posture).
 *   reserveEstimate   actuary|admin — latest act_reserve_runs row per line;
 *                     honest found:false when no run exists (no fabricated
 *                     reserves).
 *   capitalReport     actuary|admin — latest act_capital_runs per model
 *                     (naicom_rbc + internal_ec); honest found:false.
 *   adequacyMonitor   actuary|admin — act_adequacy_alerts feed + latest
 *                     priced-vs-actual LR per line; honest empties.
 *   accumulationMap   protected — persisted geo-cell aggregate grid from
 *                     act_accumulation_cells (the PG snapshot of the Go-side
 *                     Redis accumulation aggregates, design §4.g).
 *   listReferrals     underwriter|actuary queue read (act_referrals).
 *   decideReferral    underwriter|actuary — Go POST /v1/referrals/{id}/decide
 *                     (the Go service owns the decision audit event,
 *                     Appendix D); local act_referrals row mirror updated
 *                     best-effort with pgSync reported honestly.
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { eq, desc, and, asc } from "drizzle-orm";
import { getDb } from "../db";
import {
  actProductLines,
  actReserveRuns,
  actCapitalRuns,
  actAdequacyAlerts,
  actAccumulationCells,
  actReferrals,
  auditLog,
} from "@schema";
import {
  getActuaryAdapter,
  ActuaryServiceRefusedError,
  ActuaryServiceUnavailableError,
} from "../actuaryAdapter";
import { actuaryReadProcedure } from "./actuaryRoleGuard";

// ── Input schemas (Appendix D wire shapes) ──────────────────────────────────
const productLineSchema = z.string().min(1).max(64);

const rateQuoteInput = z.object({
  productLine: productLineSchema,
  // Rating variables keyed by the rate version's GLM artefact (Appendix F):
  // vehicle_class, age_band, territory, … — passed through verbatim; the Go
  // service validates them against the approved rate version (fail-closed
  // on out-of-domain, Appendix I step 7).
  variables: z.record(z.string(), z.unknown()).default({}),
  // NGN major units, positive; the Go boundary converts to kobo minor
  // units (design §4.a float discipline).
  sumInsured: z.number().positive().max(1e12),
  exposures: z.number().positive().max(1e9),
  geoCell: z.string().min(1).max(64).optional(),
  quoteRef: z.string().min(1).max(64).optional(),
});

const reserveMethodSchema = z.enum(["chainladder", "bf", "mack"]);

/** Map adapter failures onto tRPC codes — outage/refusal is always loud. */
function mapAdapterError(e: unknown): never {
  if (e instanceof ActuaryServiceUnavailableError) {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: e.message,
    });
  }
  if (e instanceof ActuaryServiceRefusedError) {
    throw new TRPCError({
      // The Go service's own fail-closed 503 (no approved rate version,
      // Appendix I step 3) must surface as 503-class, not a 500.
      code: e.status >= 500 ? "SERVICE_UNAVAILABLE" : "BAD_REQUEST",
      message: e.message,
    });
  }
  throw e;
}

/** W29 fail-closed DB posture for read procedures: the noop chain is NOT
 *  data — report unavailability instead of returning fabricated zeros. */
async function requireRealDb() {
  const db = await getDb();
  if (!db || (db as { _isNoop?: boolean })._isNoop) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Actuary read requires the database; no database is configured (fail-closed — never fabricated results).",
    });
  }
  return db;
}

async function resolveProductLine(db: Awaited<ReturnType<typeof getDb>>, code: string) {
  const rows = await (db as NonNullable<typeof db>)
    .select()
    .from(actProductLines)
    .where(eq(actProductLines.code, code as never))
    .limit(1);
  return rows[0];
}

export const actuaryRouter = router({
  rateQuote: protectedProcedure
    .input(rateQuoteInput)
    .mutation(async ({ ctx, input }) => {
      const adapter = getActuaryAdapter();
      let result;
      try {
        result = await adapter.rate(input);
      } catch (e) {
        mapAdapterError(e);
      }
      // Best-effort audit trail (mirrors goServiceBridge.restartService):
      // audit persistence must not block quoting, and the response carries
      // no synthetic fields beyond the Go wire shape.
      try {
        const db = await getDb();
        if (db && !(db as { _isNoop?: boolean })._isNoop) {
          await db.insert(auditLog).values({
            action: "actuary_rate_quote",
            resource: "actuary_pricing_service",
            resourceId: input.quoteRef ?? null,
            status: result!.decision === "decline" ? "failure" : "success",
            metadata: {
              productLine: input.productLine,
              decision: result!.decision,
              reasonCodes: result!.reasonCodes,
              rateVersion: result!.rateVersion,
              userId: ctx.user!.id,
            },
          });
        }
      } catch {
        // audit failure is logged-and-continued (quote is not a money write)
      }
      return result!;
    }),

  reserveEstimate: actuaryReadProcedure("view_reserves")
    .input(
      z.object({
        line: productLineSchema,
        // ISO date (YYYY-MM-DD); defaults to latest available run.
        asOf: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        method: reserveMethodSchema.optional(),
      })
    )
    .query(async ({ input }) => {
      const db = await requireRealDb();
      const line = await resolveProductLine(db, input.line);
      if (!line) {
        // Unknown registry code is an honest not-found, not zero reserves.
        return {
          found: false as const,
          reason: "unknown_product_line" as const,
          line: input.line,
        };
      }
      const conditions = [eq(actReserveRuns.productLineId, line.id)];
      if (input.method) conditions.push(eq(actReserveRuns.method, input.method));
      const rows = await db
        .select()
        .from(actReserveRuns)
        .where(conditions.length > 1 ? and(...conditions) : conditions[0])
        .orderBy(desc(actReserveRuns.asOf))
        .limit(1);
      const run = rows[0];
      if (!run) {
        return {
          found: false as const,
          reason: "no_reserve_run" as const,
          line: input.line,
          productLineId: line.id,
        };
      }
      return {
        found: true as const,
        runId: run.id,
        line: input.line,
        asOf: run.asOf,
        method: run.method,
        status: run.status,
        ultimateByOrigin: run.ultimateByOrigin,
        // numeric(18,2) arrives as string — Number() it exactly like the
        // W30 savings/pension procedures do.
        ibnr: Number(run.ibnr),
        mackSe: run.mackSe,
        assumptionSetId: run.assumptionSetId,
      };
    }),

  capitalReport: actuaryReadProcedure("view_capital")
    .input(
      z
        .object({
          asOf: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = await requireRealDb();
      const fetchLatest = async (model: "naicom_rbc" | "internal_ec") => {
        const rows = await db
          .select()
          .from(actCapitalRuns)
          .where(eq(actCapitalRuns.model, model))
          .orderBy(desc(actCapitalRuns.asOf))
          .limit(1);
        return rows[0];
      };
      const [rbc, ec] = await Promise.all([
        fetchLatest("naicom_rbc"),
        fetchLatest("internal_ec"),
      ]);
      if (!rbc && !ec) {
        return {
          found: false as const,
          reason: "no_capital_run" as const,
          asOf: input?.asOf ?? null,
        };
      }
      const rbcRequired = rbc?.rbcRequired != null ? Number(rbc.rbcRequired) : null;
      const rbcAvailable =
        rbc?.rbcAvailable != null ? Number(rbc.rbcAvailable) : null;
      return {
        found: true as const,
        asOf: (rbc ?? ec)!.asOf,
        naicomRbc: rbc
          ? {
              required: rbcRequired,
              available: rbcAvailable,
              // ratio null (not 0) when the denominator is absent/zero —
              // an indeterminate solvency ratio is not 0%.
              ratio:
                rbcRequired != null && rbcRequired > 0 && rbcAvailable != null
                  ? rbcAvailable / rbcRequired
                  : null,
              status: rbc.status,
            }
          : null,
        ec: ec
          ? {
              var995: ec.var995 != null ? Number(ec.var995) : null,
              tvar99: ec.tvar99 != null ? Number(ec.tvar99) : null,
              perLine: ec.perLine,
              status: ec.status,
            }
          : null,
      };
    }),

  adequacyMonitor: actuaryReadProcedure("view_adequacy")
    .input(
      z.object({
        line: productLineSchema.optional(),
        // YYYY-MM adequacy period (design §4.f monthly cadence).
        period: z
          .string()
          .regex(/^\d{4}-\d{2}$/)
          .optional(),
      })
    )
    .query(async ({ input }) => {
      const db = await requireRealDb();
      const conditions = [];
      if (input.line) {
        const line = await resolveProductLine(db, input.line);
        if (!line) {
          return {
            alerts: [] as never[],
            pricedLR: null,
            actualLR: null,
            credibility: null,
            line: input.line,
            reason: "unknown_product_line" as const,
          };
        }
        conditions.push(eq(actAdequacyAlerts.productLineId, line.id));
      }
      if (input.period) conditions.push(eq(actAdequacyAlerts.period, input.period));
      const alerts = await db
        .select({
          id: actAdequacyAlerts.id,
          productLineId: actAdequacyAlerts.productLineId,
          lineCode: actProductLines.code,
          period: actAdequacyAlerts.period,
          pricedLossRatio: actAdequacyAlerts.pricedLossRatio,
          actualLossRatio: actAdequacyAlerts.actualLossRatio,
          severity: actAdequacyAlerts.severity,
          acknowledgedBy: actAdequacyAlerts.acknowledgedBy,
          acknowledgedAt: actAdequacyAlerts.acknowledgedAt,
          createdAt: actAdequacyAlerts.createdAt,
        })
        .from(actAdequacyAlerts)
        .leftJoin(
          actProductLines,
          eq(actAdequacyAlerts.productLineId, actProductLines.id)
        )
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(actAdequacyAlerts.createdAt), asc(actAdequacyAlerts.id))
        .limit(200);
      const latest = alerts[0];
      return {
        alerts: alerts.map(a => ({
          ...a,
          pricedLossRatio: Number(a.pricedLossRatio),
          actualLossRatio: Number(a.actualLossRatio),
        })),
        pricedLR: latest ? Number(latest.pricedLossRatio) : null,
        actualLR: latest ? Number(latest.actualLossRatio) : null,
        // Credibility factor is per-line data stored in the assumption-set
        // payload (design Appendix J notes) — not derivable from the alert
        // feed, so honestly null rather than a synthesized 1.0.
        credibility: null,
      };
    }),

  accumulationMap: protectedProcedure
    .input(z.object({ line: productLineSchema }))
    .query(async ({ input }) => {
      const db = await requireRealDb();
      const line = await resolveProductLine(db, input.line);
      if (!line) {
        return {
          line: input.line,
          cells: [] as never[],
          reason: "unknown_product_line" as const,
        };
      }
      const cells = await db
        .select()
        .from(actAccumulationCells)
        .where(eq(actAccumulationCells.productLineId, line.id))
        .orderBy(asc(actAccumulationCells.geoCell))
        .limit(1000);
      return {
        line: input.line,
        cells: cells.map(c => ({
          geoCell: c.geoCell,
          aggregateExposure: Number(c.aggregateExposure),
          policyCount: c.policyCount,
          updatedAt: c.updatedAt,
        })),
      };
    }),

  listReferrals: actuaryReadProcedure("view_referrals")
    .input(
      z
        .object({
          status: z.enum(["open", "accepted", "declined"]).default("open"),
          limit: z.number().min(1).max(200).default(50),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = await requireRealDb();
      const status = input?.status ?? "open";
      const rows = await db
        .select({
          id: actReferrals.id,
          quoteRef: actReferrals.quoteRef,
          productLineId: actReferrals.productLineId,
          lineCode: actProductLines.code,
          reasonCodes: actReferrals.reasonCodes,
          status: actReferrals.status,
          underwriterId: actReferrals.underwriterId,
          decidedAt: actReferrals.decidedAt,
          createdAt: actReferrals.createdAt,
        })
        .from(actReferrals)
        .leftJoin(
          actProductLines,
          eq(actReferrals.productLineId, actProductLines.id)
        )
        .where(eq(actReferrals.status, status))
        .orderBy(asc(actReferrals.createdAt))
        .limit(input?.limit ?? 50);
      return { referrals: rows, status, count: rows.length };
    }),

  decideReferral: actuaryReadProcedure("decide_referral")
    .input(
      z.object({
        id: z.number().int().positive(),
        decision: z.enum(["accepted", "declined"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const adapter = getActuaryAdapter();
      let decision;
      try {
        decision = await adapter.decideReferral(
          input.id,
          input.decision,
          ctx.user!.id
        );
      } catch (e) {
        mapAdapterError(e);
      }
      // Local mirror of the Go-authoritative decision (Appendix D: the Go
      // service writes the audit event). pgSync:false is reported honestly
      // when the PG mirror cannot be updated (DB unavailable) — the Go
      // decision still stands.
      let pgSync = false;
      try {
        const db = await getDb();
        if (db && !(db as { _isNoop?: boolean })._isNoop) {
          await db
            .update(actReferrals)
            .set({
              status: input.decision,
              underwriterId: ctx.user!.id,
              decidedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(actReferrals.id, input.id));
          pgSync = true;
        }
      } catch {
        pgSync = false;
      }
      return { ...decision!, pgSync };
    }),
});
