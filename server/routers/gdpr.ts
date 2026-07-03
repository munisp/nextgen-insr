// @ts-check
/**
 * gdpr.ts — NDPR/GDPR Data Portability & Right to Erasure
 *
 * P2-B: Nigeria Data Protection Regulation (NDPR) compliance procedures.
 *
 * Procedures:
 *  - gdpr.exportMyData  — agent requests a JSON export of all their personal data
 *  - gdpr.requestErasure — agent requests deletion of their account and personal data
 *  - gdpr.getErasureStatus — check the status of a pending erasure request
 *
 * Compliance notes:
 *  - Exports include: profile, transactions, audit log, loyalty history, KYC sessions
 *  - Erasure anonymises PII fields (name, phone, email, BVN, NIN) rather than hard-deleting
 *    rows, to preserve financial audit trail required by CBN regulations.
 *  - All export and erasure requests are logged in the audit log.
 *  - Erasure requests are queued (status: 'pending') and processed by a background job.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { getDb, writeAuditLog } from "../db";
import {
  agents,
  transactions,
  auditLog,
  loyaltyHistory,
  kycSessions,
  customers,
  dataRightsRequests,
} from "../../drizzle/schema";
import { router, protectedProcedure } from "../_core/trpc";
import { count } from "drizzle-orm";
import { getAgentFromCookie } from "../middleware/agentAuth";
import { notifyOwner } from "../_core/notification";
import { logger } from '../_core/logger';

export const gdprRouter = router({
  /**
   * Export all personal data for the authenticated agent.
   * Returns a JSON object containing all data categories.
   *
   * NDPR Article 2.1(1)(b): Data subjects have the right to obtain a copy of their data.
   */
  exportMyData: protectedProcedure.query(async ({ ctx }) => {
    try {
      const agent = await getAgentFromCookie(ctx.req);
      if (!agent)
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Agent session required",
        });

      const db = (await getDb())!;
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "DB unavailable",
        });

      // Fetch all data categories
      const [agentProfile] = await db
        .select()
        .from(agents)
        .where(eq(agents.id, agent.id))
        .limit(1);

      const agentTransactions = await db
        .select({
          id: transactions.id,
          ref: transactions.ref,
          type: transactions.type,
          amount: transactions.amount,
          status: transactions.status,
          createdAt: transactions.createdAt,
          customerPhone: transactions.customerPhone,
        })
        .from(transactions)
        .where(eq(transactions.agentId, agent.id))
        .orderBy(desc(transactions.createdAt))
        .limit(1000);

      const auditEntries = await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.agentId, agent.id))
        .orderBy(desc(auditLog.createdAt))
        .limit(500);

      const loyalty = await db
        .select()
        .from(loyaltyHistory)
        .where(eq(loyaltyHistory.agentId, agent.id))
        .orderBy(desc(loyaltyHistory.createdAt))
        .limit(500);

      const kyc = await db
        .select({
          id: kycSessions.id,
          status: kycSessions.status,
          createdAt: kycSessions.createdAt,
        })
        .from(kycSessions)
        .where(eq(kycSessions.agentId, agent.id))
        .orderBy(desc(kycSessions.createdAt))
        .limit(50);

      // Write audit log for the export request
      await writeAuditLog({
        agentId: agent.id,
        agentCode: agent.agentCode,
        action: "GDPR_EXPORT_REQUEST",
        resource: "agent",
        resourceId: String(agent.id),
        status: "success",
        metadata: {
          categories: [
            "profile",
            "transactions",
            "audit_log",
            "loyalty",
            "kyc",
          ],
          transactionCount: agentTransactions.length,
        },
      });

      return {
        exportedAt: new Date().toISOString(),
        dataSubject: {
          id: agentProfile?.id,
          agentCode: agentProfile?.agentCode,
          name: agentProfile?.name,
          phone: agentProfile?.phone,
          email: agentProfile?.email,
          tier: agentProfile?.tier,
          createdAt: agentProfile?.createdAt,
        },
        transactions: agentTransactions.map((t: any) => ({
          ...t,
          amount: Number(t.amount),
        })),
        auditLog: auditEntries,
        loyaltyHistory: loyalty,
        kycSessions: kyc,
        legalBasis: "NDPR 2019 — Article 2.1(1)(b) Right to Data Portability",
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

  /**
   * Request erasure of personal data (right to be forgotten).
   * NDPR Article 2.1(1)(c): Data subjects may request deletion of their data.
   *
   * Note: Financial transaction records are retained for 7 years per CBN AML regulations.
   * PII fields (name, phone, email, BVN, NIN) are anonymised; transaction amounts/refs retained.
   */
  requestErasure: protectedProcedure
    .input(
      z.object({
        reason: z.string().min(10).max(500),
        confirmPhrase: z.literal("DELETE MY DATA"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const agent = await getAgentFromCookie(ctx.req);
        if (!agent)
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Agent session required",
          });

        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });

        // Check for existing pending erasure request
        const existing = await db
          .select({ id: auditLog.id, createdAt: auditLog.createdAt })
          .from(auditLog)
          .where(
            and(
              eq(auditLog.agentId, agent.id),
              eq(auditLog.action, "GDPR_ERASURE_REQUEST")
            )
          )
          .orderBy(desc(auditLog.createdAt))
          .limit(1);

        if (existing.length > 0) {
          const lastRequest = existing[0];
          const daysSince = lastRequest?.createdAt
            ? (Date.now() - new Date(lastRequest.createdAt).getTime()) /
              (1000 * 60 * 60 * 24)
            : 999;
          if (daysSince < 30) {
            throw new TRPCError({
              code: "TOO_MANY_REQUESTS",
              message:
                "An erasure request was already submitted within the last 30 days. Please wait for it to be processed.",
            });
          }
        }

        // Log the erasure request
        await writeAuditLog({
          agentId: agent.id,
          agentCode: agent.agentCode,
          action: "GDPR_ERASURE_REQUEST",
          resource: "agent",
          resourceId: String(agent.id),
          status: "warning" as const, // pending erasure — using warning as closest audit status
          metadata: {
            reason: input.reason,
            requestedAt: new Date().toISOString(),
            note: "PII will be anonymised; financial records retained per CBN AML regulations",
          },
        });

        // Notify the platform owner
        await notifyOwner({
          title: `NDPR Erasure Request: Agent ${agent.agentCode}`,
          content: `Agent ${agent.name} (${agent.agentCode}) has submitted a data erasure request.\n\nReason: ${input.reason}\n\nAction required: Review and process within 30 days per NDPR Article 2.1(1)(c).\n\nNote: Financial transaction records must be retained for 7 years per CBN AML regulations.`,
        }).catch((e: unknown) =>
          logger.error("[GDPR] Erasure notification failed:: " + e)
        );

        return {
          success: true,
          message:
            "Your erasure request has been received and will be processed within 30 days as required by NDPR.",
          requestId: `ERASURE-${agent.agentCode}-${Date.now()}`,
          retentionNote:
            "Financial transaction records will be retained for 7 years as required by CBN AML regulations. All other personal data will be anonymised.",
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

  // ── Data Rights Requests CRUD ────────────────────────────────────────────────────
  submitDataRightsRequest: protectedProcedure
    .input(
      z.object({
        requestType: z.enum(["export", "erasure", "rectification"]),
        requesterEmail: z.string().email(),
        requesterType: z.enum(["user", "agent", "customer"]).default("user"),
        requesterId: z.number().optional(),
        notes: z.string().optional(),
        tenantId: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const [row] = await db
          .insert(dataRightsRequests)
          .values({
            requestType: input.requestType,
            requesterEmail: input.requesterEmail,
            requesterType: input.requesterType,
            requesterId: input.requesterId,
            notes: input.notes,
            tenantId: input.tenantId,
            status: "pending",
          })
          .returning();
        return row;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  listDataRightsRequests: protectedProcedure
    .input(
      z.object({
        status: z.string().optional(),
        requestType: z.string().optional(),
        limit: z.number().default(50),
        offset: z.number().default(0),
      })
    )
    .query(async ({ input, ctx }) => {
      try {
        if (ctx.user.role !== "admin")
          throw new TRPCError({ code: "FORBIDDEN" });
        const db = (await getDb())!;
        if (!db) return { items: [], total: 0 };
        const conditions = [];
        if (input.status)
          conditions.push(eq(dataRightsRequests.status, input.status));
        if (input.requestType)
          conditions.push(
            eq(dataRightsRequests.requestType, input.requestType)
          );
        const where = conditions.length > 0 ? and(...conditions) : undefined;
        const [items, [{ total }]] = await Promise.all([
          db
            .select()
            .from(dataRightsRequests)
            .where(where)
            .orderBy(desc(dataRightsRequests.createdAt))
            .limit(input.limit)
            .offset(input.offset),
          db.select({ total: count() }).from(dataRightsRequests).where(where),
        ]);
        return { items, total };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  processDataRightsRequest: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        status: z.enum(["approved", "rejected", "completed"]),
        exportFileUrl: z.string().url().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        if (ctx.user.role !== "admin")
          throw new TRPCError({ code: "FORBIDDEN" });
        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const [row] = await db
          .update(dataRightsRequests)
          .set({
            status: input.status,
            exportFileUrl: input.exportFileUrl,
            notes: input.notes,
            processedBy: String(ctx.user.id),
            processedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(dataRightsRequests.id, input.id))
          .returning();
        return row;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  /**
   * Check the status of a pending erasure request.
   */
  getErasureStatus: protectedProcedure.query(async ({ ctx }) => {
    try {
      const agent = await getAgentFromCookie(ctx.req);
      if (!agent)
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Agent session required",
        });

      const db = (await getDb())!;
      if (!db) return { hasRequest: false, status: null, requestedAt: null };

      const requests = await db
        .select({
          id: auditLog.id,
          status: auditLog.status,
          createdAt: auditLog.createdAt,
          metadata: auditLog.metadata,
        })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.agentId, agent.id),
            eq(auditLog.action, "GDPR_ERASURE_REQUEST")
          )
        )
        .orderBy(desc(auditLog.createdAt))
        .limit(1);

      if (requests.length === 0) {
        return { hasRequest: false, status: null, requestedAt: null };
      }

      const req = requests[0];
      return {
        hasRequest: true,
        status: req?.status ?? "pending",
        requestedAt: req?.createdAt ?? null,
        dueBy: req?.createdAt
          ? new Date(
              new Date(req.createdAt).getTime() + 30 * 24 * 60 * 60 * 1000
            ).toISOString()
          : null,
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
  list: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().default(20),
          offset: z.number().default(0),
        })
        .default({})
    )
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { items: [], total: 0 };
        return { items: [], total: 0 };
      } catch {
        return { items: [], total: 0 };
      }
    }),
});
