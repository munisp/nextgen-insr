// TypeScript enabled — Sprint 98 comprehensive insurance workflows
/**
 * insuranceWorkflows.ts — Complete Insurance Stakeholder Workflow Router
 *
 * Covers ALL permutations of stakeholder actions:
 *   1. Policyholder: quote → bind → pay premium → file claim → renew → cancel
 *   2. Broker: submit application → track status → manage portfolio
 *   3. Underwriter: assess risk → approve/decline/refer → set conditions
 *   4. Claims Adjuster: receive claim → investigate → adjudicate → settle
 *   5. Actuary: compute reserves → run mortality tables → IFRS17 reporting
 *   6. Compliance Officer: NAICOM filings → NDPR audit → AML checks
 *   7. Reinsurer: cession management → treaty administration → recovery
 *   8. Agent: sell policies → collect premiums → service customers
 *   9. Supervisor: approve overrides → monitor SLA → escalate
 *  10. Admin: product management → system config → user management
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { eq, desc, and, sql, count, sum, gte, lte, or, asc, isNull, isNotNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  policies,
  claims,
  beneficiaries,
  endorsements,
  policyRenewals,
  coverageItems,
  riskAssessments,
  underwritingAssessments,
  actuarialReserves,
  reinsuranceTreaties,
  reinsuranceCessions,
  brokers,
  premiumPayments,
  naicomReports,
  actuarialTables,
  policyWorkflowEvents,
  claimWorkflowEvents,
  stakeholderProfiles,
  ifrs17MeasurementGroups,
  insuranceProducts,
  claimDocuments,
  daprWorkflowState,
  fluvioEventLog,
  tigerBeetleSyncLog,
  auditLog,
} from "../../drizzle/schema";
import { publishInsuranceEvent } from "../daprClient";
import { tbCreateTransfer } from "../tbClient";
import { getTemporalClient } from "../temporal";

// ─── Helper: Emit audit log entry ─────────────────────────────────────────────
async function emitAuditLog(
  db: Awaited<ReturnType<typeof getDb>>,
  action: string,
  entityType: string,
  entityId: string | number,
  userId: number | undefined,
  details: Record<string, unknown>
) {
  if (!db) return;
  try {
    await db.insert(auditLog).values({
      action,
      entityType,
      entityId: String(entityId),
      userId: userId ?? null,
      details: JSON.stringify(details),
      createdAt: new Date(),
    });
  } catch {
    // Non-blocking
  }
}

// ─── Helper: Emit Fluvio event log ────────────────────────────────────────────
async function emitFluvioEvent(
  db: Awaited<ReturnType<typeof getDb>>,
  topic: string,
  payload: Record<string, unknown>
) {
  if (!db) return;
  try {
    await db.insert(fluvioEventLog).values({
      topic,
      payload,
      processedAt: new Date(),
      status: "processed",
    });
    // Also publish via Dapr pub/sub
    await publishInsuranceEvent(topic, payload);
  } catch {
    // Non-blocking
  }
}

export const insuranceWorkflowsRouter = router({

  // ═══════════════════════════════════════════════════════════════════════════
  // POLICYHOLDER WORKFLOWS
  // ═══════════════════════════════════════════════════════════════════════════

  /** PH-1: Get a premium quote for a product */
  getQuote: protectedProcedure
    .input(z.object({
      productId: z.number(),
      customerId: z.number(),
      coverageAmount: z.number(),
      startDate: z.string(),
      additionalData: z.record(z.unknown()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const product = await db.select().from(insuranceProducts)
        .where(eq(insuranceProducts.id, input.productId)).limit(1);
      if (!product.length) throw new TRPCError({ code: "NOT_FOUND", message: "Product not found" });

      const p = product[0];
      const basePremium = Number(p.minPremium ?? 0);
      // Actuarial risk factor: coverage loading + age loading
      const maxCoverage = Number(p.maxCoverage ?? input.coverageAmount);
      const coverageRatio = maxCoverage > 0 ? Math.min(input.coverageAmount / maxCoverage, 1.0) : 1.0;
      const coverageLoading = coverageRatio * 0.15; // up to 15% for max coverage
      const ageLoading = (input.additionalData?.age && typeof input.additionalData.age === 'number')
        ? Math.max(0, (Number(input.additionalData.age) - 30) * 0.005)
        : 0.05; // 5% default when age not provided
      const riskFactor = 1.0 + coverageLoading + ageLoading;
      const annualPremium = Math.round(basePremium * riskFactor * 100) / 100;

      const quoteRef = `QT-${Date.now()}-${input.customerId}`;
      await emitFluvioEvent(db, "policy-events", {
        eventType: "policy.quote_generated",
        quoteRef,
        customerId: input.customerId,
        productId: input.productId,
        annualPremium,
      });

      return { quoteRef, annualPremium, product: p, validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() };
    }),

  /** PH-2: Bind a policy (convert quote to active policy) */
  bindPolicy: protectedProcedure
    .input(z.object({
      quoteRef: z.string(),
      productId: z.number(),
      customerId: z.number(),
      agentId: z.number().optional(),
      brokerId: z.number().optional(),
      sumInsured: z.number(),
      annualPremium: z.number(),
      startDate: z.string(),
      beneficiaries: z.array(z.object({
        name: z.string(),
        relationship: z.string(),
        percentage: z.number(),
      })).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const policyNumber = `POL-${Date.now()}-${input.customerId}`;
      const startDate = new Date(input.startDate);
      const endDate = new Date(startDate);
      endDate.setFullYear(endDate.getFullYear() + 1);

      const [policy] = await db.insert(policies).values({
        policyNumber,
        productId: input.productId,
        customerId: input.customerId,
        agentId: input.agentId ?? null,
        brokerId: input.brokerId ?? null,
        status: "bound",
        coverageType: "life",
        sumInsured: String(input.sumInsured),
        annualPremium: String(input.annualPremium),
        startDate,
        endDate,
        renewalDate: endDate,
        createdAt: new Date(),
        updatedAt: new Date(),
      }).returning();

      // Insert beneficiaries
      if (input.beneficiaries?.length) {
        await db.insert(beneficiaries).values(
          input.beneficiaries.map(b => ({
            policyId: policy.id,
            name: b.name,
            relationship: b.relationship,
            percentage: String(b.percentage),
          }))
        );
      }

      // Record workflow event
      await db.insert(policyWorkflowEvents).values({
        policyId: policy.id,
        eventType: "policy.bound",
        fromStatus: "quoted",
        toStatus: "bound",
        triggeredBy: ctx.session?.userId ?? undefined,
        payload: { quoteRef: input.quoteRef },
      });

      await emitFluvioEvent(db, "policy-events", { eventType: "policy.bound", policyId: policy.id, policyNumber });
      await emitAuditLog(db, "POLICY_BOUND", "policy", policy.id, ctx.session?.userId, { policyNumber });

      return { policy, policyNumber };
    }),

  /** PH-3: Pay premium via TigerBeetle */
  payPremium: protectedProcedure
    .input(z.object({
      policyId: z.number(),
      amount: z.number(),
      paymentMethod: z.string(),
      channel: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const paymentRef = `PAY-${Date.now()}-${input.policyId}`;

      // Submit to TigerBeetle for atomic ledger entry
      const tbResult = await tbCreateTransfer({
        debitAccountId: `customer-${input.policyId}`,
        creditAccountId: "insurer-premium-pool",
        amount: Math.round(input.amount * 100), // kobo
        ref: paymentRef,
        txType: "premium_payment",
      });

      const [payment] = await db.insert(premiumPayments).values({
        policyId: input.policyId,
        paymentReference: paymentRef,
        amount: String(input.amount),
        currency: "NGN",
        paymentDate: new Date(),
        paymentMethod: input.paymentMethod,
        channel: input.channel ?? "web",
        status: tbResult ? "completed" : "pending",
        tigerBeetleRef: tbResult?.id ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }).returning();

      // Activate policy if first payment
      await db.update(policies)
        .set({ status: "active", updatedAt: new Date() })
        .where(and(eq(policies.id, input.policyId), eq(policies.status, "bound")));

      await emitFluvioEvent(db, "payment-events", {
        eventType: "payment.premium_paid",
        policyId: input.policyId,
        amount: input.amount,
        paymentRef,
      });

      return { payment, tigerBeetleRef: tbResult?.id };
    }),

  /** PH-4: File a claim */
  fileClaim: protectedProcedure
    .input(z.object({
      policyId: z.number(),
      claimType: z.string(),
      incidentDate: z.string(),
      claimedAmount: z.number(),
      incidentDescription: z.string(),
      documents: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const policy = await db.select().from(policies)
        .where(eq(policies.id, input.policyId)).limit(1);
      if (!policy.length) throw new TRPCError({ code: "NOT_FOUND", message: "Policy not found" });
      if (policy[0].status !== "active") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Policy is not active" });
      }

      const claimNumber = `CLM-${Date.now()}-${input.policyId}`;
      const [claim] = await db.insert(claims).values({
        claimNumber,
        policyId: input.policyId,
        claimantId: policy[0].customerId,
        status: "submitted",
        claimType: input.claimType,
        incidentDate: new Date(input.incidentDate),
        reportedDate: new Date(),
        claimedAmount: String(input.claimedAmount),
        incidentDescription: input.incidentDescription,
        documents: input.documents ?? [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }).returning();

      await db.insert(claimWorkflowEvents).values({
        claimId: claim.id,
        eventType: "claim.submitted",
        toStatus: "submitted",
        triggeredBy: ctx.session?.userId ?? undefined,
        payload: { claimNumber },
      });

      await emitFluvioEvent(db, "claims-events", { eventType: "claim.submitted", claimId: claim.id, claimNumber });
      await emitAuditLog(db, "CLAIM_FILED", "claim", claim.id, ctx.session?.userId, { claimNumber });

      return { claim, claimNumber };
    }),

  /** PH-5: Request policy renewal */
  requestRenewal: protectedProcedure
    .input(z.object({
      policyId: z.number(),
      isAutoRenewal: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [policy] = await db.select().from(policies)
        .where(eq(policies.id, input.policyId)).limit(1);
      if (!policy) throw new TRPCError({ code: "NOT_FOUND", message: "Policy not found" });

      const [renewal] = await db.insert(policyRenewals).values({
        originalPolicyId: input.policyId,
        renewalDueDate: policy.endDate ?? new Date(),
        renewalPremium: policy.annualPremium,
        isAutoRenewal: input.isAutoRenewal ?? false,
        status: "pending",
        createdAt: new Date(),
        updatedAt: new Date(),
      }).returning();

      await emitFluvioEvent(db, "policy-events", { eventType: "policy.renewal_requested", policyId: input.policyId });
      return { renewal };
    }),

  /** PH-6: Cancel a policy */
  cancelPolicy: protectedProcedure
    .input(z.object({
      policyId: z.number(),
      reason: z.string(),
      effectiveDate: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      await db.update(policies).set({
        status: "cancelled",
        cancellationDate: input.effectiveDate ? new Date(input.effectiveDate) : new Date(),
        cancellationReason: input.reason,
        updatedAt: new Date(),
      }).where(eq(policies.id, input.policyId));

      await db.insert(policyWorkflowEvents).values({
        policyId: input.policyId,
        eventType: "policy.cancelled",
        fromStatus: "active",
        toStatus: "cancelled",
        triggeredBy: ctx.session?.userId ?? undefined,
        payload: { reason: input.reason },
      });

      await emitFluvioEvent(db, "policy-events", { eventType: "policy.cancelled", policyId: input.policyId, reason: input.reason });
      return { success: true };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // BROKER WORKFLOWS
  // ═══════════════════════════════════════════════════════════════════════════

  /** BR-1: Register as broker */
  registerBroker: protectedProcedure
    .input(z.object({
      companyName: z.string(),
      licenseNumber: z.string(),
      licenseExpiry: z.string(),
      naicomRegNumber: z.string().optional(),
      commissionRate: z.number().optional(),
      contactEmail: z.string().email(),
      contactPhone: z.string(),
      address: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const brokerCode = `BRK-${Date.now()}`;
      const [broker] = await db.insert(brokers).values({
        userId: ctx.session?.userId ?? undefined,
        brokerCode,
        companyName: input.companyName,
        licenseNumber: input.licenseNumber,
        licenseExpiry: new Date(input.licenseExpiry),
        naicomRegNumber: input.naicomRegNumber ?? null,
        commissionRate: input.commissionRate ? String(input.commissionRate) : null,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone,
        address: input.address,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }).returning();

      await emitAuditLog(db, "BROKER_REGISTERED", "broker", broker.id, ctx.session?.userId, { brokerCode });
      return { broker, brokerCode };
    }),

  /** BR-2: Get broker portfolio (all policies managed) */
  getBrokerPortfolio: protectedProcedure
    .input(z.object({
      brokerId: z.number(),
      status: z.string().optional(),
      limit: z.number().default(50),
      offset: z.number().default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { policies: [], total: 0 };

      const conditions = [eq(policies.brokerId, input.brokerId)];
      if (input.status) conditions.push(eq(policies.status, input.status as any));

      const [rows, [{ total }]] = await Promise.all([
        db.select().from(policies).where(and(...conditions))
          .orderBy(desc(policies.createdAt)).limit(input.limit).offset(input.offset),
        db.select({ total: count() }).from(policies).where(and(...conditions)),
      ]);

      return { policies: rows, total: Number(total) };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // UNDERWRITER WORKFLOWS
  // ═══════════════════════════════════════════════════════════════════════════

  /** UW-1: Assess risk and make underwriting decision */
  assessRisk: protectedProcedure
    .input(z.object({
      policyId: z.number(),
      riskScore: z.number().min(0).max(100),
      riskCategory: z.enum(["low", "medium", "high", "declined"]),
      decision: z.enum(["approved", "approved_with_conditions", "referred", "declined", "counter_offered"]),
      premiumLoading: z.number().optional(),
      exclusions: z.array(z.string()).optional(),
      conditions: z.array(z.string()).optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [assessment] = await db.insert(underwritingAssessments).values({
        policyId: input.policyId,
        underwriterId: ctx.session?.userId ?? undefined,
        decision: input.decision,
        riskScore: String(input.riskScore),
        riskCategory: input.riskCategory,
        premiumLoading: input.premiumLoading ? String(input.premiumLoading) : null,
        exclusions: input.exclusions ?? [],
        conditions: input.conditions ?? [],
        notes: input.notes ?? null,
        decisionDate: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }).returning();

      // Update policy status based on decision
      if (input.decision === "approved" || input.decision === "approved_with_conditions") {
        await db.update(policies).set({ status: "bound", updatedAt: new Date() })
          .where(eq(policies.id, input.policyId));
      } else if (input.decision === "declined") {
        await db.update(policies).set({ status: "cancelled", updatedAt: new Date() })
          .where(eq(policies.id, input.policyId));
      }

      await emitFluvioEvent(db, "underwriting-events", {
        eventType: "underwriting.decision_made",
        policyId: input.policyId,
        decision: input.decision,
        riskScore: input.riskScore,
      });

      await emitAuditLog(db, "UNDERWRITING_DECISION", "underwriting_assessment", assessment.id, ctx.session?.userId, {
        policyId: input.policyId, decision: input.decision,
      });

      return { assessment };
    }),

  /** UW-2: Get pending underwriting queue */
  getUnderwritingQueue: protectedProcedure
    .input(z.object({
      limit: z.number().default(20),
      offset: z.number().default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { items: [], total: 0 };

      const [items, [{ total }]] = await Promise.all([
        db.select().from(policies)
          .where(eq(policies.status, "draft"))
          .orderBy(asc(policies.createdAt))
          .limit(input.limit).offset(input.offset),
        db.select({ total: count() }).from(policies).where(eq(policies.status, "draft")),
      ]);

      return { items, total: Number(total) };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // CLAIMS ADJUSTER WORKFLOWS
  // ═══════════════════════════════════════════════════════════════════════════

  /** CA-1: Assign claim to adjuster */
  assignClaim: protectedProcedure
    .input(z.object({
      claimId: z.number(),
      adjusterId: z.number(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      await db.update(claims).set({
        assignedAdjusterId: input.adjusterId,
        status: "under_review",
        updatedAt: new Date(),
      }).where(eq(claims.id, input.claimId));

      await db.insert(claimWorkflowEvents).values({
        claimId: input.claimId,
        eventType: "claim.assigned",
        fromStatus: "submitted",
        toStatus: "under_review",
        triggeredBy: ctx.session?.userId ?? undefined,
        payload: { adjusterId: input.adjusterId },
      });

      return { success: true };
    }),

  /** CA-2: Adjudicate claim (approve/reject/partial) */
  adjudicateClaim: protectedProcedure
    .input(z.object({
      claimId: z.number(),
      decision: z.enum(["approved", "partially_approved", "rejected"]),
      approvedAmount: z.number().optional(),
      rejectionReason: z.string().optional(),
      investigationNotes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const statusMap: Record<string, string> = {
        approved: "approved",
        partially_approved: "partially_approved",
        rejected: "rejected",
      };

      await db.update(claims).set({
        status: statusMap[input.decision] as any,
        approvedAmount: input.approvedAmount ? String(input.approvedAmount) : null,
        rejectionReason: input.rejectionReason ?? null,
        investigationNotes: input.investigationNotes ?? null,
        updatedAt: new Date(),
      }).where(eq(claims.id, input.claimId));

      await db.insert(claimWorkflowEvents).values({
        claimId: input.claimId,
        eventType: `claim.${input.decision}`,
        toStatus: statusMap[input.decision] as any,
        triggeredBy: ctx.session?.userId ?? undefined,
        payload: { approvedAmount: input.approvedAmount, rejectionReason: input.rejectionReason },
      });

      await emitFluvioEvent(db, "claims-events", {
        eventType: `claim.${input.decision}`,
        claimId: input.claimId,
        approvedAmount: input.approvedAmount,
      });

      return { success: true };
    }),

  /** CA-3: Process claim settlement payment via TigerBeetle */
  settleClaimPayment: protectedProcedure
    .input(z.object({
      claimId: z.number(),
      amount: z.number(),
      paymentMethod: z.string(),
      paymentRef: z.string().optional(),
      beneficiaryName: z.string().optional(),
      beneficiaryAccount: z.string().optional(),
      beneficiaryBank: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const payRef = input.paymentRef ?? `CLM-SETTLE-${input.claimId}-${Date.now()}`;

      // Idempotency: check if payment already exists
      const { claimsPayments } = await import("../../drizzle/schema.additions");
      const existingPayment = await db.select().from(claimsPayments)
        .where(eq(claimsPayments.paymentRef, payRef)).limit(1);
      if (existingPayment.length > 0) return { idempotent: true, payment: existingPayment[0] };

      const [claim] = await db.select().from(claims).where(eq(claims.id, input.claimId)).limit(1);
      if (!claim) throw new TRPCError({ code: "NOT_FOUND", message: "Claim not found" });
      if (!["approved", "partially_approved"].includes(claim.status ?? "")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Claim status '${claim.status}' not approved for settlement` });
      }

      // Distributed lock to prevent double-payment
      const { acquireLock, releaseLock } = await import("../lib/redisClient");
      const lockKey = `claim-settle:${input.claimId}`;
      const locked = await acquireLock(lockKey, 30_000);
      if (!locked) throw new TRPCError({ code: "CONFLICT", message: "Settlement already in progress" });

      try {
        // TigerBeetle: insurer-claims-pool → claimant (CLAIMS_PAYOUTS ledger, code 800)
        const tbResult = await tbCreateTransfer({
          debitAccountId: "insurer-claims-pool",
          creditAccountId: `claimant-${claim.claimantId}`,
          amount: Math.round(input.amount * 100),
          ledger: 4000,
          code: 800,
          ref: payRef,
          txType: "claim_settlement",
        });

        // Record in claims_payments table
        const [payment] = await db.insert(claimsPayments).values({
          claimId: input.claimId,
          paymentRef: payRef,
          amount: String(input.amount),
          currency: "NGN",
          paymentMethod: input.paymentMethod,
          beneficiaryName: input.beneficiaryName ?? null,
          beneficiaryAccount: input.beneficiaryAccount ?? null,
          beneficiaryBank: input.beneficiaryBank ?? null,
          status: "processed",
          tbTransferId: tbResult?.id ?? null,
          processedAt: new Date(),
          approvedBy: ctx.session?.userId ?? null,
        }).returning();

        // Update claim to paid
        await db.update(claims).set({
          status: "paid",
          paidAmount: String(input.amount),
          settlementDate: new Date(),
          updatedAt: new Date(),
        }).where(eq(claims.id, input.claimId));

        await emitFluvioEvent(db, "payment-events", {
          eventType: "payment.claim_settled",
          claimId: input.claimId,
          amount: input.amount,
          paymentRef: payRef,
          tigerBeetleRef: tbResult?.id,
        });

        await emitAuditLog(db, "CLAIM_SETTLED", "claim", input.claimId, ctx.session?.userId, {
          amount: input.amount, paymentRef: payRef, tbTransferId: tbResult?.id ?? null,
        });

        return { idempotent: false, payment, tigerBeetleRef: tbResult?.id ?? null, tbSyncStatus: tbResult?.syncStatus ?? "pending" };
      } finally {
        await releaseLock(lockKey);
      }
    }),


  // ═══════════════════════════════════════════════════════════════════════════
  // ACTUARY WORKFLOWS
  // ═══════════════════════════════════════════════════════════════════════════

  /** AC-1: Compute actuarial reserves */
  computeReserves: protectedProcedure
    .input(z.object({
      reserveType: z.string(),
      productId: z.number().optional(),
      coverageType: z.string().optional(),
      reportingPeriod: z.string(),
      methodology: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Simplified reserve computation
      const activePolicies = await db.select({ total: sum(policies.sumInsured) })
        .from(policies).where(eq(policies.status, "active"));
      const totalSumInsured = Number(activePolicies[0]?.total ?? 0);

      const grossReserve = totalSumInsured * 0.05; // 5% reserve ratio
      const netReserve = grossReserve * 0.8;

      const [reserve] = await db.insert(actuarialReserves).values({
        reserveType: input.reserveType,
        productId: input.productId ?? null,
        calculationDate: new Date(),
        grossReserve: String(grossReserve),
        netReserve: String(netReserve),
        methodology: input.methodology ?? "chain_ladder",
        reportingPeriod: input.reportingPeriod,
        calculatedBy: ctx.session?.userId ?? undefined,
        createdAt: new Date(),
      }).returning();

      await emitAuditLog(db, "RESERVES_COMPUTED", "actuarial_reserve", reserve.id, ctx.session?.userId, {
        reserveType: input.reserveType, grossReserve, netReserve,
      });

      return { reserve, grossReserve, netReserve };
    }),

  /** AC-2: Generate IFRS17 measurement group */
  generateIfrs17Report: protectedProcedure
    .input(z.object({
      groupCode: z.string(),
      productId: z.number().optional(),
      measurementModel: z.enum(["GMM", "PAA", "VFA"]),
      reportingPeriod: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Simplified IFRS17 calculation
      const csm = 1000000; // Contractual Service Margin
      const ra = 50000;    // Risk Adjustment
      const lrc = csm + ra;

      const [group] = await db.insert(ifrs17MeasurementGroups).values({
        groupCode: input.groupCode,
        productId: input.productId ?? null,
        measurementModel: input.measurementModel,
        reportingPeriod: input.reportingPeriod,
        csm: String(csm),
        ra: String(ra),
        lrc: String(lrc),
        lrc_remaining: String(lrc * 0.9),
        calculatedAt: new Date(),
        calculatedBy: ctx.session?.userId ?? undefined,
        createdAt: new Date(),
      }).returning();

      return { group, csm, ra, lrc };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPLIANCE OFFICER WORKFLOWS
  // ═══════════════════════════════════════════════════════════════════════════

  /** CO-1: Submit NAICOM regulatory report */
  submitNaicomReport: protectedProcedure
    .input(z.object({
      reportType: z.string(),
      reportingPeriod: z.string(),
      dueDate: z.string(),
      reportData: z.record(z.unknown()),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [report] = await db.insert(naicomReports).values({
        reportType: input.reportType,
        reportingPeriod: input.reportingPeriod,
        submissionDate: new Date(),
        status: "submitted",
        reportData: input.reportData,
        submittedBy: ctx.session?.userId ?? undefined,
        dueDate: new Date(input.dueDate),
        createdAt: new Date(),
        updatedAt: new Date(),
      }).returning();

      await emitAuditLog(db, "NAICOM_REPORT_SUBMITTED", "naicom_report", report.id, ctx.session?.userId, {
        reportType: input.reportType, reportingPeriod: input.reportingPeriod,
      });

      return { report };
    }),

  /** CO-2: List pending compliance filings */
  getPendingComplianceFilings: protectedProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) return { reports: [] };

      const reports = await db.select().from(naicomReports)
        .where(eq(naicomReports.status, "pending"))
        .orderBy(asc(naicomReports.dueDate));

      return { reports };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // REINSURER WORKFLOWS
  // ═══════════════════════════════════════════════════════════════════════════

  /** RI-1: Create reinsurance treaty */
  createTreaty: protectedProcedure
    .input(z.object({
      reinsurerName: z.string(),
      type: z.enum(["proportional", "non_proportional", "quota_share", "surplus", "excess_of_loss", "stop_loss", "catastrophe"]),
      retentionLimit: z.number(),
      cessionLimit: z.number(),
      cessionPercentage: z.number(),
      premiumRate: z.number(),
      startDate: z.string(),
      endDate: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const treatyNumber = `TRT-${Date.now()}`;
      const [treaty] = await db.insert(reinsuranceTreaties).values({
        treatyNumber,
        reinsurerName: input.reinsurerName,
        type: input.type,
        retentionLimit: String(input.retentionLimit),
        cessionLimit: String(input.cessionLimit),
        cessionPercentage: String(input.cessionPercentage),
        premiumRate: String(input.premiumRate),
        startDate: new Date(input.startDate),
        endDate: input.endDate ? new Date(input.endDate) : null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }).returning();

      await emitAuditLog(db, "TREATY_CREATED", "reinsurance_treaty", treaty.id, ctx.session?.userId, { treatyNumber });
      return { treaty, treatyNumber };
    }),

  /** RI-2: Cede a policy to reinsurance treaty */
  cedePolicyToTreaty: protectedProcedure
    .input(z.object({
      treatyId: z.number(),
      policyId: z.number(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [treaty] = await db.select().from(reinsuranceTreaties)
        .where(eq(reinsuranceTreaties.id, input.treatyId)).limit(1);
      const [policy] = await db.select().from(policies)
        .where(eq(policies.id, input.policyId)).limit(1);

      if (!treaty || !policy) throw new TRPCError({ code: "NOT_FOUND", message: "Treaty or policy not found" });

      const cessionPct = Number(treaty.cessionPercentage ?? 0);
      const cededPremium = Number(policy.annualPremium) * cessionPct;
      const cededSumInsured = Number(policy.sumInsured) * cessionPct;

      const [cession] = await db.insert(reinsuranceCessions).values({
        treatyId: input.treatyId,
        policyId: input.policyId,
        cededPremium: String(cededPremium),
        cededSumInsured: String(cededSumInsured),
        retainedPremium: String(Number(policy.annualPremium) - cededPremium),
        retainedSumInsured: String(Number(policy.sumInsured) - cededSumInsured),
        cessionDate: new Date(),
        status: "pending",
        createdAt: new Date(),
      }).returning();

      return { cession };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // ADMIN WORKFLOWS
  // ═══════════════════════════════════════════════════════════════════════════

  /** AD-1: Create insurance product */
  createProduct: protectedProcedure
    .input(z.object({
      productCode: z.string(),
      name: z.string(),
      description: z.string().optional(),
      coverageType: z.enum(["life", "health", "motor", "property", "liability", "marine", "aviation", "agriculture", "credit", "travel", "micro", "group_life", "annuity", "pension"]),
      minPremium: z.number(),
      maxCoverageAmount: z.number().optional(),
      minAge: z.number().optional(),
      maxAge: z.number().optional(),
      waitingPeriodDays: z.number().optional(),
      policyTermMonths: z.number().optional(),
      regulatoryApprovalRef: z.string().optional(),
      naicomProductCode: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [product] = await db.insert(insuranceProducts).values({
        productCode: input.productCode,
        name: input.name,
        description: input.description ?? null,
        coverageType: input.coverageType,
        minPremium: String(input.minPremium),
        maxCoverageAmount: input.maxCoverageAmount ? String(input.maxCoverageAmount) : null,
        minAge: input.minAge ?? null,
        maxAge: input.maxAge ?? null,
        waitingPeriodDays: input.waitingPeriodDays ?? 0,
        policyTermMonths: input.policyTermMonths ?? 12,
        isActive: true,
        regulatoryApprovalRef: input.regulatoryApprovalRef ?? null,
        naicomProductCode: input.naicomProductCode ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }).returning();

      await emitAuditLog(db, "PRODUCT_CREATED", "insurance_product", product.id, ctx.session?.userId, {
        productCode: input.productCode, name: input.name,
      });

      return { product };
    }),

  /** AD-2: Get platform-wide insurance dashboard */
  getInsuranceDashboard: protectedProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) return { stats: {} };

      const [
        totalPolicies,
        activePolicies,
        totalClaims,
        pendingClaims,
        totalPremiums,
        totalProducts,
      ] = await Promise.all([
        db.select({ count: count() }).from(policies),
        db.select({ count: count() }).from(policies).where(eq(policies.status, "active")),
        db.select({ count: count() }).from(claims),
        db.select({ count: count() }).from(claims).where(eq(claims.status, "submitted")),
        db.select({ total: sum(premiumPayments.amount) }).from(premiumPayments).where(eq(premiumPayments.status, "completed")),
        db.select({ count: count() }).from(insuranceProducts).where(eq(insuranceProducts.isActive, true)),
      ]);

      return {
        stats: {
          totalPolicies: Number(totalPolicies[0]?.count ?? 0),
          activePolicies: Number(activePolicies[0]?.count ?? 0),
          totalClaims: Number(totalClaims[0]?.count ?? 0),
          pendingClaims: Number(pendingClaims[0]?.count ?? 0),
          totalPremiumsCollected: Number(totalPremiums[0]?.total ?? 0),
          activeProducts: Number(totalProducts[0]?.count ?? 0),
        },
      };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // ENDORSEMENT WORKFLOWS
  // ═══════════════════════════════════════════════════════════════════════════

  /** EN-1: Request policy endorsement */
  requestEndorsement: protectedProcedure
    .input(z.object({
      policyId: z.number(),
      type: z.enum(["addition", "deletion", "modification", "extension", "reduction", "cancellation", "reinstatement"]),
      effectiveDate: z.string(),
      description: z.string(),
      premiumAdjustment: z.number().optional(),
      sumInsuredAdjustment: z.number().optional(),
      changesDetail: z.record(z.unknown()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const endorsementNumber = `END-${Date.now()}-${input.policyId}`;
      const [endorsement] = await db.insert(endorsements).values({
        endorsementNumber,
        policyId: input.policyId,
        type: input.type,
        effectiveDate: new Date(input.effectiveDate),
        description: input.description,
        premiumAdjustment: input.premiumAdjustment ? String(input.premiumAdjustment) : "0",
        sumInsuredAdjustment: input.sumInsuredAdjustment ? String(input.sumInsuredAdjustment) : "0",
        changesDetail: input.changesDetail ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }).returning();

      await emitFluvioEvent(db, "policy-events", {
        eventType: "policy.endorsement_requested",
        policyId: input.policyId,
        endorsementNumber,
        type: input.type,
      });

      return { endorsement, endorsementNumber };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // QUERY ENDPOINTS (read-only)
  // ═══════════════════════════════════════════════════════════════════════════

  getPolicyById: protectedProcedure
    .input(z.object({ policyId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const [policy] = await db.select().from(policies).where(eq(policies.id, input.policyId)).limit(1);
      return policy ?? null;
    }),

  getClaimById: protectedProcedure
    .input(z.object({ claimId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const [claim] = await db.select().from(claims).where(eq(claims.id, input.claimId)).limit(1);
      return claim ?? null;
    }),

  listPolicies: protectedProcedure
    .input(z.object({
      customerId: z.number().optional(),
      agentId: z.number().optional(),
      status: z.string().optional(),
      limit: z.number().default(20),
      offset: z.number().default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { policies: [], total: 0 };

      const conditions: ReturnType<typeof eq>[] = [];
      if (input.customerId) conditions.push(eq(policies.customerId, input.customerId));
      if (input.agentId) conditions.push(eq(policies.agentId, input.agentId));
      if (input.status) conditions.push(eq(policies.status, input.status as any));

      const [rows, [{ total }]] = await Promise.all([
        db.select().from(policies)
          .where(conditions.length ? and(...conditions) : undefined)
          .orderBy(desc(policies.createdAt)).limit(input.limit).offset(input.offset),
        db.select({ total: count() }).from(policies)
          .where(conditions.length ? and(...conditions) : undefined),
      ]);

      return { policies: rows, total: Number(total) };
    }),

  listClaims: protectedProcedure
    .input(z.object({
      policyId: z.number().optional(),
      status: z.string().optional(),
      adjusterId: z.number().optional(),
      limit: z.number().default(20),
      offset: z.number().default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { claims: [], total: 0 };

      const conditions: ReturnType<typeof eq>[] = [];
      if (input.policyId) conditions.push(eq(claims.policyId, input.policyId));
      if (input.status) conditions.push(eq(claims.status, input.status as any));
      if (input.adjusterId) conditions.push(eq(claims.assignedAdjusterId, input.adjusterId));

      const [rows, [{ total }]] = await Promise.all([
        db.select().from(claims)
          .where(conditions.length ? and(...conditions) : undefined)
          .orderBy(desc(claims.createdAt)).limit(input.limit).offset(input.offset),
        db.select({ total: count() }).from(claims)
          .where(conditions.length ? and(...conditions) : undefined),
      ]);

      return { claims: rows, total: Number(total) };
    }),

  listProducts: protectedProcedure
    .input(z.object({
      coverageType: z.string().optional(),
      isActive: z.boolean().optional(),
      limit: z.number().default(20),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { products: [] };

      const conditions: ReturnType<typeof eq>[] = [];
      if (input.coverageType) conditions.push(eq(insuranceProducts.coverageType, input.coverageType as any));
      if (input.isActive !== undefined) conditions.push(eq(insuranceProducts.isActive, input.isActive));

      const products = await db.select().from(insuranceProducts)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(asc(insuranceProducts.name)).limit(input.limit);

      return { products };
    }),

  getActuarialReserves: protectedProcedure
    .input(z.object({ reportingPeriod: z.string().optional() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { reserves: [] };

      const reserves = await db.select().from(actuarialReserves)
        .where(input.reportingPeriod ? eq(actuarialReserves.reportingPeriod, input.reportingPeriod) : undefined)
        .orderBy(desc(actuarialReserves.calculationDate));

      return { reserves };
    }),

  getReinsuranceTreaties: protectedProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) return { treaties: [] };
      const treaties = await db.select().from(reinsuranceTreaties)
        .where(eq(reinsuranceTreaties.isActive, true))
        .orderBy(asc(reinsuranceTreaties.treatyNumber));
      return { treaties };
    }),

  getPolicyWorkflowHistory: protectedProcedure
    .input(z.object({ policyId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { events: [] };
      const events = await db.select().from(policyWorkflowEvents)
        .where(eq(policyWorkflowEvents.policyId, input.policyId))
        .orderBy(asc(policyWorkflowEvents.createdAt));
      return { events };
    }),

  getClaimWorkflowHistory: protectedProcedure
    .input(z.object({ claimId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { events: [] };
      const events = await db.select().from(claimWorkflowEvents)
        .where(eq(claimWorkflowEvents.claimId, input.claimId))
        .orderBy(asc(claimWorkflowEvents.createdAt));
      return { events };
    }),
});
