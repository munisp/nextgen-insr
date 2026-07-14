// @ts-nocheck
import { z } from "zod";
import {
  router,
  publicProcedure as openProcedure,
  protectedProcedure,
} from "../_core/trpc";
import { getDb } from "../db";
import {
  eq,
  desc,
  and,
  sql,
  count,
  sum,
  isNull,
  gte,
  lte,
  or,
  asc,
} from "drizzle-orm";
import { kycSessions, kycDocuments, auditLog } from "@schema";
import { TRPCError } from "@trpc/server";

export const agentKycRouter = router({
  getStats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { totalSessions: 0, pending: 0, approved: 0, rejected: 0 };
    const [total] = await db
      .select({ value: count() })
      .from(kycSessions)
      .limit(100);
    const statusCounts = await db
      .select({ status: kycSessions.status, cnt: count() })
      .from(kycSessions)
      .groupBy(kycSessions.status)
      .limit(100);
    const byStatus: Record<string, number> = {};
    statusCounts.forEach(r => {
      byStatus[r.status] = Number(r.cnt);
    });
    return {
      totalSessions: Number(total.value),
      pending: byStatus["pending"] ?? 0,
      approved: byStatus["approved"] ?? 0,
      rejected: byStatus["rejected"] ?? 0,
    };
  }),
  listSessions: protectedProcedure
    .input(
      z
        .object({
          agentId: z.number().optional(),
          status: z.string().optional(),
          limit: z.number().default(20),
        })
        .optional()
    )
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { sessions: [], total: 0 };
        const conditions: any[] = [];
        if (input?.agentId)
          conditions.push(eq(kycSessions.agentId, input.agentId));
        const where = conditions.length > 0 ? and(...conditions) : undefined;
        const rows = await db
          .select()
          .from(kycSessions)
          .where(where)
          .orderBy(desc(kycSessions.createdAt))
          .limit(input?.limit ?? 20);
        return { sessions: rows, total: rows.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  createSession: protectedProcedure
    .input(
      z.object({ agentId: z.number(), type: z.string().default("standard") })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const [session] = await db
          .insert(kycSessions)
          .values({
            agentId: input.agentId,
            type: input.type,
            status: "pending",
          })
          .returning();
        await db.insert(auditLog).values({
          action: "kyc_session_created",
          resource: "kyc_sessions",
          resourceId: String(session.id),
          status: "success",
          metadata: { agentId: input.agentId },
        });
        return { success: true, session };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  approveSession: protectedProcedure
    .input(
      z.object({ sessionId: z.number(), reviewNotes: z.string().optional() })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const [updated] = await db
          .update(kycSessions)
          .set({ status: "approved", reviewedAt: new Date() })
          .where(eq(kycSessions.id, input.sessionId))
          .returning();
        await db.insert(auditLog).values({
          action: "kyc_approved",
          resource: "kyc_sessions",
          resourceId: String(input.sessionId),
          status: "success",
        });
        return { success: true, session: updated };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Sprint 78 domain-specific procedures ──────────────────────────────────
  listProfiles: openProcedure
    .input(z.object({ status: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const profiles = [
        {
          agentId: "AGT-001",
          agentName: "Adebayo Okonkwo",
          kycLevel: 2,
          overallStatus: "complete",
          riskScore: 15,
          documents: [
            { docId: "DOC-001A", docType: "nin", status: "verified" },
            { docId: "DOC-001B", docType: "bvn", status: "verified" },
          ],
        },
        {
          agentId: "AGT-002",
          agentName: "Fatima Ibrahim",
          kycLevel: 1,
          overallStatus: "pending",
          riskScore: 45,
          documents: [{ docId: "DOC-002A", docType: "nin", status: "pending" }],
        },
        {
          agentId: "AGT-003",
          agentName: "Chidi Nnamdi",
          kycLevel: 2,
          overallStatus: "complete",
          riskScore: 10,
          documents: [
            { docId: "DOC-003A", docType: "nin", status: "verified" },
            { docId: "DOC-003B", docType: "passport", status: "verified" },
          ],
        },
        {
          agentId: "AGT-004",
          agentName: "Amina Yusuf",
          kycLevel: 0,
          overallStatus: "rejected",
          riskScore: 80,
          documents: [
            { docId: "DOC-004A", docType: "nin", status: "rejected" },
          ],
        },
      ];
      let filtered = profiles;
      if (input?.status)
        filtered = filtered.filter(p => p.overallStatus === input.status);
      return { profiles: filtered, total: filtered.length };
    }),

  getProfile: openProcedure
    .input(z.object({ agentId: z.string() }))
    .query(async ({ input }) => {
      const profiles: Record<
        string,
        {
          agentId: string;
          agentName: string;
          kycLevel: number;
          overallStatus: string;
          riskScore: number;
          documents: Array<{ docId: string; docType: string; status: string }>;
        }
      > = {
        "AGT-001": {
          agentId: "AGT-001",
          agentName: "Adebayo Okonkwo",
          kycLevel: 2,
          overallStatus: "complete",
          riskScore: 15,
          documents: [
            { docId: "DOC-001A", docType: "nin", status: "verified" },
            { docId: "DOC-001B", docType: "bvn", status: "verified" },
          ],
        },
        "AGT-002": {
          agentId: "AGT-002",
          agentName: "Fatima Ibrahim",
          kycLevel: 1,
          overallStatus: "pending",
          riskScore: 45,
          documents: [{ docId: "DOC-002A", docType: "nin", status: "pending" }],
        },
      };
      const profile = profiles[input.agentId];
      if (!profile)
        throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found" });
      return profile;
    }),

  getDocument: openProcedure
    .input(z.object({ docId: z.string() }))
    .query(async ({ input }) => {
      const docs: Record<
        string,
        {
          docId: string;
          docType: string;
          status: string;
          confidenceScore: number;
          agentId: string;
          docNumber: string;
          fullName: string;
        }
      > = {
        "DOC-001A": {
          docId: "DOC-001A",
          docType: "nin",
          status: "verified",
          confidenceScore: 95,
          agentId: "AGT-001",
          docNumber: "12345678901",
          fullName: "Adebayo Okonkwo",
        },
        "DOC-001B": {
          docId: "DOC-001B",
          docType: "bvn",
          status: "verified",
          confidenceScore: 98,
          agentId: "AGT-001",
          docNumber: "22345678901",
          fullName: "Adebayo Okonkwo",
        },
      };
      const doc = docs[input.docId];
      if (!doc)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Document not found",
        });
      return doc;
    }),

  submitDocument: openProcedure
    .input(
      z.object({
        agentId: z.string(),
        docType: z.string(),
        docNumber: z.string(),
        fullName: z.string(),
        dateOfBirth: z.string(),
        issueDate: z.string(),
        expiryDate: z.string().nullable(),
        issuingAuthority: z.string(),
        country: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const isValidNin =
        input.docType === "nin" && /^\d{11}$/.test(input.docNumber);
      const isValidBvn =
        input.docType === "bvn" && /^\d{11}$/.test(input.docNumber);
      const isValidPassport =
        input.docType === "passport" && /^[A-Z]\d{8}$/.test(input.docNumber);
      const isValid = isValidNin || isValidBvn || isValidPassport;
      return {
        docId: `DOC-${Date.now()}`,
        agentId: input.agentId,
        docType: input.docType,
        status: isValid ? ("verified" as const) : ("manual_review" as const),
        confidenceScore: isValid ? 95 : 40,
        submittedAt: new Date().toISOString(),
      };
    }),

  getDashboard: openProcedure.query(async () => {
    return {
      totalAgents: 4,
      verificationRate: 50,
      avgRiskScore: 37.5,
      byStatus: { complete: 2, pending: 1, rejected: 1 },
      recentSubmissions: [
        {
          agentId: "AGT-001",
          docType: "nin",
          status: "verified",
          submittedAt: "2024-06-01",
        },
        {
          agentId: "AGT-002",
          docType: "nin",
          status: "pending",
          submittedAt: "2024-06-02",
        },
      ],
    };
  }),
  list: openProcedure
    .input(
      z
        .object({
          limit: z.number().default(20),
          offset: z.number().default(0),
        })
        .default({})
    )
    .query(async () => ({
      items: [],
      data: [],
      total: 0,
    })),
});
