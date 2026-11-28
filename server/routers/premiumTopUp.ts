/**
 * premiumTopUp.ts — Insurance Premium Top-Up Router
 * Handles premium payment top-ups with TigerBeetle atomicity.
 *
 * 2026-11-28 (insureportal→root merge, W32-C contract): the ip-only
 * server/routers/floatTopUp.ts supervisor-approval workflow was CONSUMED
 * into this router (one premiumTopUp namespace — submit/myRequests/
 * supervisorPendingTopUps/supervisorApproveTopUp below). floatTopUp.ts is
 * deliberately NOT ported as a second router (duplicate-namespace hazard,
 * merge-plan R4).
 */
import { TRPCError } from "@trpc/server";
import { eq, desc, count, sql, and, gte } from "drizzle-orm";
import { z } from "zod";

import { customers, transactions, policies, policyLifecycleStates, auditLog, agents, premiumTopUpRequests, supervisorAgents } from "../../drizzle/schema";
import { getOrInitLifecycle, validateReinstatement } from "../lib/policyLifecycle";
import { premiums } from "../../drizzle/schema.additions";
import { logger } from "../_core/logger";
import { permifyCheck } from "../_core/permify";
import { protectedProcedure, router } from "../_core/trpc";
import { financialProcedure } from "../_core/permifyMiddleware";
import { getDb, writeAuditLog } from "../db";
import { getAgentFromCookie } from "../middleware/agentAuth";
import { fluvioProduce } from "../fluvio";
import { notifyOwner } from "../_core/notification";
import { floatTopupRequestsTotal } from "../metrics";
import { publishEvent, type KafkaTopic } from "../kafkaClient";
import { acquireLock, releaseLock } from "../lib/redisClient";
import { cacheSet } from "../redisClient";
import { tbCreateTransfer, tbEnsureAgentAccount, withTbCompensation } from "../tbClient";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type PolicyRow = typeof policies.$inferSelect;

/**
 * 2026-10-02 (W10-B1): caller→policy ownership gate for the funds surface.
 * Previously getHistory/topUp trusted a caller-supplied policyId — any
 * authenticated caller could read ANY policy's payment history (IDOR) or
 * post a top-up against a foreign policy. The caller is resolved
 * server-side ONLY (never caller-supplied identity):
 *   1. admin/supervisor Keycloak role (repo role pattern,
 *      server/lib/lifecycleWorkflows.ts) → allowed;
 *   2. the policy's owner: policies.customerId matches ctx.user.id directly
 *      OR the caller's resolved customers row (customers.keycloakSub =
 *      String(ctx.user.id) — memberPolicies resolveSessionCustomer /
 *      dual-identity callerPolicyScope precedent, 2026-10-01 R3);
 *   3. the selling agent on record: policies.agentId matches the verified
 *      agent_session identity (getAgentFromCookie — fail-closed, a
 *      suspended/deleted/unverifiable session resolves to null).
 * Everything else → NOT_FOUND (no existence leak for foreign rows).
 * Fail-closed: any lookup failure propagates as an error; access is never
 * granted on uncertainty.
 */
async function assertCallerOwnsPolicy(
  db: Db,
  policy: PolicyRow,
  ctx: { user: { id: number; role?: string | null } | null; req?: unknown }
): Promise<void> {
  const role = ctx.user?.role;
  if (role === "admin" || role === "supervisor") return;

  const userId = ctx.user?.id;
  if (userId != null) {
    if (policy.customerId === userId) return;
    const [customer] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.keycloakSub, String(userId)))
      .limit(1);
    if (customer && policy.customerId === customer.id) return;
  }

  const session = ctx.req
    ? await getAgentFromCookie(ctx.req as never)
    : null;
  if (session && policy.agentId != null && session.id === policy.agentId) {
    return;
  }

  throw new TRPCError({ code: "NOT_FOUND", message: "Policy not found" });
}

// 2026-11-28 (merge, consumed from ip floatTopUp.ts — Phase 48): float
// top-up requests above this amount require supervisor approval before an
// admin can credit the agent's float.
const SUPERVISOR_APPROVAL_THRESHOLD = 50_000;

export const premiumTopUpRouter = router({
  topUp: financialProcedure
    .input(z.object({
      policyId: z.number(),
      amountNGN: z.number().positive(),
      paymentMethod: z.enum(["cash", "bank_transfer", "mobile_money", "card"]),
      reference: z.string().min(5),
      agentId: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // 2026-10-02 (W10-B1): caller→policy ownership gate runs BEFORE the
      // idempotency replay and BEFORE any ledger/payment side effect —
      // previously any caller could top up (or replay-disclose the
      // transaction of) a foreign policy. Fail-closed: the gate throws on
      // lookup failure; nothing below executes for a foreign policyId.
      const [policy] = await db.select().from(policies).where(eq(policies.id, input.policyId)).limit(1);
      if (!policy) throw new TRPCError({ code: "NOT_FOUND", message: "Policy not found" });
      await assertCallerOwnsPolicy(db, policy, ctx);

      // Idempotency: the payment reference binds to exactly one durable
      // effect. Replay must ALSO verify the payload — silently replaying a
      // different amount/policy under a reused reference would mask a client
      // bug or replay attack (F-02).
      const existing = await db.select().from(transactions)
        .where(eq(transactions.ref, input.reference)).limit(1);
      if (existing.length > 0) {
        const prev = existing[0]!;
        const prevMeta = (prev.metadata ?? {}) as { policyId?: number };
        if (Number(prev.amount) !== input.amountNGN || prevMeta.policyId !== input.policyId) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "Payment reference was already used with a different amount or policy. " +
              "Refusing to re-execute; submit with a new reference.",
          });
        }
        return { idempotent: true, transaction: prev };
      }

      if (!["active", "bound", "lapsed"].includes(policy.status ?? "")) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Policy status '${policy.status}' does not allow premium payment` });
      }

      // Sprint 44 wiring (F-12): domain-level authz before any funds move
      // (fail-closed unless the insecure PERMIFY_FAIL_OPEN opt-in is set).
      const allowed = await permifyCheck({
        subjectType: "user", subjectId: ctx.user?.id != null ? String(ctx.user.id) : "system",
        entityType: "premiumTopUp", entityId: String(input.policyId),
        permission: "execute",
      });
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized to post premium payments" });

      // ── I-wave (AB-20): amount & agent identity are server-derived ──────
      // For active/bound policies the amount is compared to the policy's
      // expected premium: underpayment is rejected outright (a partial
      // "premium" must never book full coverage); overpayment follows the
      // repo's cover-the-required-amount convention (validateReinstatement
      // accepts amount >= arrears) and is credited with an explicit audit
      // note. Lapsed policies validate against arrears below.
      if (policy.status === "active" || policy.status === "bound") {
        const expectedPremium = Number(policy.annualPremium);
        // 2026-09-18 (J-wave, PR #210 verifier): underpayment was silently
        // SKIPPED when annualPremium was NULL/0 — an unpriceable policy
        // could book coverage for any amount. Fail CLOSED: if the expected
        // premium cannot be determined, no top-up is accepted for an
        // active/bound policy (lapsed policies validate against recorded
        // arrears below instead).
        if (!(expectedPremium > 0)) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Cannot determine expected premium for policy ${policy.policyNumber ?? input.policyId} (annualPremium missing/zero) — top-up refused; fix the policy premium schedule first`,
          });
        }
        if (input.amountNGN < expectedPremium) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Underpayment: ₦${input.amountNGN} is below the expected premium of ₦${expectedPremium} for policy ${policy.policyNumber ?? input.policyId}`,
          });
        }
      }

      // agentId is NEVER client-derived: the premium belongs to the policy's
      // selling agent on record. A spoofed input.agentId is ignored and
      // audited, not honored.
      const txAgentId = policy.agentId;
      if (txAgentId == null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Policy has no selling agent on record — premium cannot be attributed; fix the policy first",
        });
      }
      const spoofedAgentId =
        input.agentId != null && input.agentId !== policy.agentId
          ? input.agentId
          : null;

      const lockKey = `premium-topup:${input.policyId}:${input.reference}`;
      const locked = await acquireLock(lockKey, 15_000);
      if (!locked) throw new TRPCError({ code: "CONFLICT", message: "Payment in progress" });

      try {
        const tbReq = {
          debitAccountId: `customer-${policy.customerId}`,
          creditAccountId: "insurer-premium-pool",
          amount: Math.round(input.amountNGN * 100),
          ledger: 3000,
          code: 700,
          ref: input.reference,
          txType: "premium_payment",
          // J-wave: policy-derived identity at the LEDGER leg too — a
          // spoofed client agentId must not reach the TB transfer.
          agentId: String(txAgentId),
        };
        const tbResult = await tbCreateTransfer(tbReq);

        // F-02: ALL PostgreSQL effects (transaction row, premium ledger row,
        // lapsed-policy reactivation) commit or roll back as ONE unit. The
        // reference is reserved first with ON CONFLICT DO NOTHING so a
        // concurrent duplicate gets zero rows back and replays the winner —
        // previously the check-then-insert race made the loser's premium
        // insert hit the unique constraint AFTER its premiums-row write,
        // leaving partial durable state and a 500 instead of a replay.
        type TopUpOutcome =
          | { replay: true }
          | { replay: false; tx: typeof transactions.$inferSelect; premium: typeof premiums.$inferSelect };
        // PAY-1 (orphan transfer): the TB leg above is already committed. If
        // the PG transaction fails, post a compensating reversal (ref-REV)
        // and rethrow loudly — value must never exist in the ledger without
        // the corresponding durable PG record.
        const outcome = await withTbCompensation("premiumTopUp.topUp", tbReq, () => db.transaction(async (tx): Promise<TopUpOutcome> => {
          const reserved = await tx.insert(transactions).values({
            ref: input.reference,
            agentId: txAgentId,
            type: "Insurance",
            amount: String(input.amountNGN),
            fee: "0",
            commission: "0",
            channel: ({ cash: "Cash", bank_transfer: "Internal", mobile_money: "App", card: "Card" } as const)[input.paymentMethod],
            status: "success",
            fraudScore: "0.00",
            metadata: { tbSyncStatus: tbResult ? "synced" : "pending", policyId: input.policyId, tbTransferId: tbResult?.id ?? null },
          }).onConflictDoNothing({ target: transactions.ref }).returning();
          if (reserved.length === 0) return { replay: true };

          // Record premium payment (premiums.premiumRef is UNIQUE; inside the
          // same transaction it can never leak without the transaction row).
          const [premiumRecord] = await tx.insert(premiums).values({
            policyId: input.policyId,
            customerId: policy.customerId ?? undefined,
            // J-wave: commission attribution row uses the SAME policy-derived
            // agent identity as the transactions row — never the client.
            agentId: txAgentId,
            premiumRef: input.reference,
            amount: String(input.amountNGN),
            currency: "NGN",
            dueDate: new Date(),
            paidDate: new Date(),
            status: "paid",
            paymentMethod: input.paymentMethod,
            paymentRef: input.reference,
            tbTransferId: tbResult?.id ?? null,
          }).returning();

          // Link premium row into the transaction metadata and return the
          // durable (post-update) row to the caller.
          const [linkedTx] = await tx.update(transactions)
            .set({ metadata: { tbSyncStatus: tbResult ? "synced" : "pending", policyId: input.policyId, premiumId: premiumRecord.id, tbTransferId: tbResult?.id ?? null } })
            .where(eq(transactions.ref, input.reference))
            .returning();

          // INS-9: reactivate a lapsed policy ONLY via the reinstatement
          // rules — payment must cover recorded arrears, the lapse must be
          // inside the max reinstatement window, and the waiting period
          // restarts at reinstatement. Fail-closed: a short payment keeps the
          // premium on the ledger but leaves the policy lapsed (error before
          // commit rolls back this transaction's PG effects; the TB leg keyed
          // on the caller's reference replays idempotently).
          if (policy.status === "lapsed") {
            const lifecycle = await getOrInitLifecycle(tx as never as Awaited<ReturnType<typeof getDb>> & object, input.policyId);
            const reinstateError = validateReinstatement(policy, lifecycle, input.amountNGN);
            if (reinstateError) {
              throw new TRPCError({ code: "PRECONDITION_FAILED", message: reinstateError });
            }
            const now = new Date();
            await tx.update(policies).set({ status: "active", updatedAt: now }).where(eq(policies.id, input.policyId));
            await tx.update(policyLifecycleStates).set({
              arrearsAmount: "0",
              lapsedAt: null,
              reinstatedAt: now,
              waitingPeriodResetAt: now,
              updatedAt: now,
            }).where(eq(policyLifecycleStates.policyId, input.policyId));
          }

          return { replay: false, tx: linkedTx ?? reserved[0]!, premium: premiumRecord };
        }));

        if (outcome.replay) {
          const [winner] = await db.select().from(transactions)
            .where(eq(transactions.ref, input.reference)).limit(1);
          if (winner) return { idempotent: true, transaction: winner };
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Payment conflicted but no winner row found" });
        }

        await db.insert(auditLog).values({
          action: "PREMIUM_TOP_UP",
          resource: "policy",
          resourceId: String(input.policyId),
          status: "success",
          metadata: {
            amountNGN: input.amountNGN,
            reference: input.reference,
            // I-wave (AB-20): server-derived terms on record.
            expectedPremium: policy.annualPremium,
            overpaymentNGN:
              input.amountNGN > Number(policy.annualPremium)
                ? input.amountNGN - Number(policy.annualPremium)
                : 0,
            agentId: txAgentId,
            spoofedAgentIdIgnored: spoofedAgentId,
          },
        }).catch(() => {});

        // Sprint 44 wiring (F-12): event fan-out + status cache. Best-effort
        // AFTER the premium effect is durable (single PG transaction + TB).
        try {
        await publishEvent("pos.premiumtopup" as KafkaTopic, "system", {
          event: "premium.topup.completed", reference: input.reference,
          policyId: input.policyId, amountNGN: input.amountNGN,
          premiumId: outcome.premium.id,
        });
        await fluvioProduce("pos.premiumtopup", {
          value: JSON.stringify({ event: "premium.topup.completed", reference: input.reference, policyId: input.policyId, amountNGN: input.amountNGN }),
        });
        await cacheSet(`tx:status:${input.reference}`, "success", 300);
        } catch (e) {
          logger.warn(`[PremiumTopUp] post-commit eventing degraded (tx is durable): ${e instanceof Error ? e.message : String(e)}`);
        }
        logger.info(`[PremiumTopUp] ₦${input.amountNGN} for policy ${input.policyId} | TB: ${tbResult?.id ?? "pending"}`);
        return { idempotent: false, transaction: outcome.tx, premium: outcome.premium, tbTransferId: tbResult?.id ?? null };
      } finally {
        await releaseLock(lockKey);
      }
    }),

  getHistory: protectedProcedure
    .input(z.object({ policyId: z.number(), limit: z.number().default(20), offset: z.number().default(0) }))
    .query(async ({ input, ctx }) => {
      // 2026-10-02 (W10-B1): was an IDOR — any authenticated caller could
      // read ANY policy's premium payment history. Now fail-closed: DB
      // unavailable → error (never an empty-but-"successful" surface), and
      // the caller must own the policy (or be admin/supervisor, or be the
      // selling agent on record). Foreign/missing policyId → NOT_FOUND, no
      // existence leak, no data returned.
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [policy] = await db.select().from(policies).where(eq(policies.id, input.policyId)).limit(1);
      if (!policy) throw new TRPCError({ code: "NOT_FOUND", message: "Policy not found" });
      await assertCallerOwnsPolicy(db, policy, ctx);
      const results = await db.select().from(premiums)
        .where(eq(premiums.policyId, input.policyId))
        .orderBy(desc(premiums.id)).limit(input.limit).offset(input.offset);
      const [{ total }] = await db.select({ total: count() }).from(premiums).where(eq(premiums.policyId, input.policyId));
      return { data: results, total: Number(total) };
    }),

  getSummary: protectedProcedure
    .input(z.object({ periodDays: z.number().default(30) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { totalPayments: 0, totalVolumeNGN: 0 };
      const since = new Date(Date.now() - input.periodDays * 86400000);
      const [stats] = await db.select({
        total: count(),
        totalAmount: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)`,
        overdue: sql<number>`COUNT(*) FILTER (WHERE status = 'overdue')`,
      }).from(premiums).where(gte(premiums.createdAt, since));
      return {
        periodDays: input.periodDays,
        totalPayments: Number(stats?.total ?? 0),
        totalVolumeNGN: Number(stats?.totalAmount ?? 0),
        overdueCount: Number(stats?.overdue ?? 0),
      };
    }),

  // ── Submit a float top-up request (consumed from ip floatTopUp.ts, Phase 48) ─
  // Agent-facing: creates a pending premiumTopUpRequests row; requests above
  // SUPERVISOR_APPROVAL_THRESHOLD additionally require supervisor approval
  // before admin credit. Pending-request uniqueness per agent is enforced
  // (check-then-throw on the latest request — a duplicate pending request can
  // never move funds by itself; the admin credit leg is separately gated).
  submit: protectedProcedure
    .input(
      z.object({
        amount: z.number().positive().max(10_000_000),
        notes: z.string().max(256).optional(),
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

        const db = await getDb();
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });

        // Check for existing pending request
        const existing = await db
          .select()
          .from(premiumTopUpRequests)
          .where(eq(premiumTopUpRequests.agentId, session.id))
          .orderBy(desc(premiumTopUpRequests.createdAt))
          .limit(1);
        if (existing[0] && existing[0].status === "pending") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "You already have a pending top-up request. Please wait for approval.",
          });
        }

        // Phase 48: determine if supervisor approval is required
        const requiresSupervisor = input.amount > SUPERVISOR_APPROVAL_THRESHOLD;

        const result = await db
          .insert(premiumTopUpRequests)
          .values({
            agentId: session.id,
            requestedAmount: String(input.amount),
            status: "pending",
            notes: input.notes ?? null,
            supervisorApprovalRequired: requiresSupervisor,
          })
          .returning();

        await writeAuditLog({
          agentId: session.id,
          action: "FLOAT_TOPUP_REQUESTED",
          resource: "float_topup",
          resourceId: String(result[0]!.id),
          status: "success",
          metadata: { amount: input.amount, requiresSupervisor },
        });

        // Notify supervisor(s) assigned to this agent if threshold exceeded
        if (requiresSupervisor) {
          try {
            await notifyOwner({
              title: `Large Float Top-Up Requires Supervisor Approval — ₦${input.amount.toLocaleString()}`,
              content: `Agent ${session.agentId} (${session.name}) has requested a float top-up of ₦${input.amount.toLocaleString()} (above ₦${SUPERVISOR_APPROVAL_THRESHOLD.toLocaleString()} threshold). Please review in the Supervisor Dashboard → Pending Float Approvals.`,
            });
          } catch {
            // Non-critical — the durable request row is the source of truth.
          }
        }

        floatTopupRequestsTotal.labels("submitted").inc();

        return {
          success: true,
          requestId: result[0]!.id,
          requiresSupervisorApproval: requiresSupervisor,
          message: requiresSupervisor
            ? `Top-up request submitted. Supervisor approval required for amounts above ₦${SUPERVISOR_APPROVAL_THRESHOLD.toLocaleString()}.`
            : "Top-up request submitted. Awaiting admin approval.",
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

  // ── List agent's own top-up requests (consumed from ip floatTopUp.ts) ────
  myRequests: protectedProcedure.query(async ({ ctx }) => {
    try {
      const session = await getAgentFromCookie(ctx.req);
      if (!session)
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Agent session required",
        });
      const db = await getDb();
      if (!db) throw new Error("Database connection unavailable");
      const rows = await db
        .select()
        .from(premiumTopUpRequests)
        .where(eq(premiumTopUpRequests.agentId, session.id))
        .orderBy(desc(premiumTopUpRequests.createdAt))
        .limit(20);
      return rows.map((r) => ({
        ...r,
        requestedAmount: Number(r.requestedAmount),
      }));
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  }),

  // ── Supervisor: list pending large top-ups for assigned agents ────────────
  // (consumed from ip floatTopUp.ts; supervisorAgents binding preserved —
  // supervisors see ONLY their assigned agents' requests, admins see all.)
  supervisorPendingTopUps: protectedProcedure.query(async ({ ctx }) => {
    try {
      const session = await getAgentFromCookie(ctx.req);
      if (!session)
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Agent session required",
        });
      if (session.role !== "supervisor" && session.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Supervisor or admin privileges required",
        });
      }

      const db = await getDb();
      if (!db) throw new Error("Database connection unavailable");

      // For supervisors: only show top-ups for their assigned agents
      // For admins: show all supervisor-required top-ups
      let agentIds: number[] = [];
      if (session.role === "supervisor") {
        const assignments = await db
          .select({ agentId: supervisorAgents.agentId })
          .from(supervisorAgents)
          .where(eq(supervisorAgents.supervisorUserId, session.id));
        agentIds = assignments.map((a) => a.agentId);
        if (agentIds.length === 0) return [];
      }

      const rows = await db
        .select({
          id: premiumTopUpRequests.id,
          agentId: premiumTopUpRequests.agentId,
          requestedAmount: premiumTopUpRequests.requestedAmount,
          status: premiumTopUpRequests.status,
          supervisorApprovalRequired:
            premiumTopUpRequests.supervisorApprovalRequired,
          supervisorApprovedBy: premiumTopUpRequests.supervisorApprovedBy,
          supervisorApprovedAt: premiumTopUpRequests.supervisorApprovedAt,
          notes: premiumTopUpRequests.notes,
          createdAt: premiumTopUpRequests.createdAt,
          agentUserId: agents.agentId,
          agentName: agents.name,
          agentFloat: agents.premiumReserve,
          agentTier: agents.tier,
        })
        .from(premiumTopUpRequests)
        .leftJoin(agents, eq(premiumTopUpRequests.agentId, agents.id))
        .where(
          and(
            eq(premiumTopUpRequests.supervisorApprovalRequired, true),
            eq(premiumTopUpRequests.status, "pending")
          )
        )
        .orderBy(desc(premiumTopUpRequests.createdAt));

      // Filter by assigned agents for supervisors
      const filtered =
        session.role === "supervisor"
          ? rows.filter(
              (r) => r.agentId !== null && agentIds.includes(r.agentId)
            )
          : rows;

      return filtered.map((r) => ({
        ...r,
        requestedAmount: Number(r.requestedAmount),
        agentFloat: Number(r.agentFloat ?? 0),
      }));
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  }),

  // ── Supervisor: approve a large top-up (consumed from ip floatTopUp.ts) ──
  supervisorApproveTopUp: protectedProcedure
    .input(
      z.object({
        requestId: z.number().int().positive(),
        notes: z.string().optional(),
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
        if (session.role !== "supervisor" && session.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Supervisor or admin privileges required",
          });
        }

        const db = await getDb();
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });

        const rows = await db
          .select()
          .from(premiumTopUpRequests)
          .where(eq(premiumTopUpRequests.id, input.requestId))
          .limit(1);
        const req = rows[0];
        if (!req)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Request not found",
          });
        if (req.status !== "pending") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Request already ${req.status}`,
          });
        }

        // Verify supervisor is assigned to this agent (skip for admin)
        if (session.role === "supervisor") {
          const assignment = await db
            .select()
            .from(supervisorAgents)
            .where(
              and(
                eq(supervisorAgents.supervisorUserId, session.id),
                eq(supervisorAgents.agentId, req.agentId)
              )
            )
            .limit(1);
          if (!assignment[0]) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You are not assigned as supervisor for this agent",
            });
          }
        }

        await db
          .update(premiumTopUpRequests)
          .set({
            // 2026-11-28 (merge fix): ip wrote
            // `supervisorApprovedBy: session.agentId` — the agent CODE — so
            // the audit trail could not be joined back to the agents PK and
            // could collide across tenants. The approver identity is the
            // verified session's numeric agents PK
            // (`supervisorApprovedBy: session.id`), stringified for the
            // varchar(64) column.
            supervisorApprovedBy: String(session.id),
            supervisorApprovedAt: new Date(),
            notes: input.notes
              ? `${req.notes ?? ""}\nSupervisor note: ${input.notes}`.trim()
              : req.notes,
            updatedAt: new Date(),
          })
          .where(eq(premiumTopUpRequests.id, input.requestId));

        await writeAuditLog({
          agentId: session.id,
          action: "FLOAT_TOPUP_SUPERVISOR_APPROVED",
          resource: "float_topup",
          resourceId: String(input.requestId),
          status: "success",
          metadata: {
            amount: Number(req.requestedAmount),
            targetAgentId: req.agentId,
            notes: input.notes,
          },
        });

        return {
          success: true,
          message:
            "Supervisor approval recorded. Admin can now credit the float.",
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
});


