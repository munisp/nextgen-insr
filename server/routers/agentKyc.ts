// @ts-check
import { TRPCError } from "@trpc/server";
import {
  eq,
  desc,
  and,
  sql,
  count,
} from "drizzle-orm";
import { z } from "zod";

import { kycSessions, kycDocuments, auditLog } from "../../drizzle/schema";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";


// MOCKWARE FIX: The Sprint 78 endpoints previously returned 12 fabricated
// KYC profiles/documents over openProcedure. They now require auth and read
// / persist to the real kyc_sessions and kyc_documents tables. Submitted
// documents are stored as "pending" — no verification is fabricated.

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
  listProfiles: protectedProcedure
    .input(z.object({ status: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { profiles: [], total: 0 };
      const sessions = await db
        .select()
        .from(kycSessions)
        .orderBy(desc(kycSessions.createdAt))
        .limit(100);
      const docs = await db
        .select()
        .from(kycDocuments)
        .orderBy(desc(kycDocuments.createdAt))
        .limit(500);
      const docsByAgent = new Map<number, typeof docs>();
      for (const d of docs) {
        const arr = docsByAgent.get(d.agentId) ?? [];
        arr.push(d);
        docsByAgent.set(d.agentId, arr);
      }
      let profiles = sessions.map(s => ({
        agentId: String(s.agentId ?? ""),
        agentName: null as string | null,
        kycLevel: s.status === "approved" ? 2 : 0,
        overallStatus: s.status,
        riskScore: null as number | null, // no risk scorer attached
        documents: (docsByAgent.get(s.agentId ?? -1) ?? []).map(d => ({
          docId: String(d.id),
          docType: d.docType,
          status: d.status,
        })),
      }));
      if (input?.status)
        profiles = profiles.filter(p => p.overallStatus === input.status);
      return { profiles, total: profiles.length };
    }),

  getProfile: protectedProcedure
    .input(z.object({ agentId: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const agentPk = Number(input.agentId);
      if (!Number.isFinite(agentPk)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid agentId" });
      }
      const [session] = await db
        .select()
        .from(kycSessions)
        .where(eq(kycSessions.agentId, agentPk))
        .orderBy(desc(kycSessions.createdAt))
        .limit(1);
      if (!session) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Agent KYC profile not found" });
      }
      const docs = await db
        .select()
        .from(kycDocuments)
        .where(eq(kycDocuments.agentId, agentPk))
        .limit(50);
      return {
        agentId: input.agentId,
        agentName: null,
        kycLevel: session.status === "approved" ? 2 : 0,
        overallStatus: session.status,
        riskScore: null,
        documents: docs.map(d => ({
          docId: String(d.id),
          docType: d.docType,
          status: d.status,
        })),
      };
    }),

  getDocument: protectedProcedure
    .input(z.object({ docId: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const docPk = Number(input.docId);
      if (!Number.isFinite(docPk)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid docId" });
      }
      const [doc] = await db
        .select()
        .from(kycDocuments)
        .where(eq(kycDocuments.id, docPk))
        .limit(1);
      if (!doc) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
      }
      return {
        docId: String(doc.id),
        docType: doc.docType,
        status: doc.status,
        confidenceScore: null, // no automated verification has run
        agentId: String(doc.agentId),
        docNumber: doc.docNumber,
        fullName: null,
      };
    }),

  submitDocument: protectedProcedure
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
      const db = await getDb();
      if (!db)
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const agentPk = Number(input.agentId);
      if (!Number.isFinite(agentPk)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid agentId" });
      }
      // DD-TSSEC (A7-14): HONEST SEMANTICS — the only automated check that
      // exists is a FORMAT check. There is no NIMC/BVN registry call anywhere
      // in this flow, so:
      //  1. A docNumber that fails the format check for its declared docType
      //     is REJECTED (previously it was inserted anyway, with the failure
      //     buried in audit metadata — any 11-digit string "passed" as a NIN).
      //  2. An accepted document is explicitly labelled format-check-only;
      //     nothing here is or claims to be an identity verification.
      const FORMAT_RULES: Record<string, RegExp> = {
        nin: /^\d{11}$/,
        bvn: /^\d{11}$/,
        passport: /^[A-Z]\d{8}$/,
      };
      const formatRule = FORMAT_RULES[input.docType];
      // null = no format rule exists for this docType (nothing was checked).
      const isFormatValid = formatRule ? formatRule.test(input.docNumber) : null;
      if (formatRule && !isFormatValid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Document number does not match the expected ${input.docType.toUpperCase()} format. Note: submission performs a format check only — no registry verification exists at this step.`,
        });
      }
      const [doc] = await db
        .insert(kycDocuments)
        .values({
          agentId: agentPk,
          docType: input.docType,
          docNumber: input.docNumber,
          status: "pending",
        })
        .returning();
      await db.insert(auditLog).values({
        action: "kyc_document_submitted",
        resource: "kyc_documents",
        resourceId: String(doc.id),
        status: "success",
        metadata: { agentId: agentPk, docType: input.docType, formatValid: isFormatValid },
      }).catch(() => {});
      return {
        docId: String(doc.id),
        agentId: input.agentId,
        docType: input.docType,
        status: "pending" as const,
        // Honest contract: a REGEX FORMAT check ran (or none, for docTypes
        // without a rule). No NIMC/BVN registry verification was performed;
        // the document awaits human review.
        verificationLevel:
          isFormatValid === null ? "unchecked" : "format-check-only",
        confidenceScore: null, // no automated verification has run
        submittedAt: doc.createdAt?.toISOString?.() ?? new Date().toISOString(),
      };
    }),

  getDashboard: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db)
      return {
        totalAgents: 0,
        verificationRate: 0,
        avgRiskScore: null,
        byStatus: {},
        recentSubmissions: [],
      };
    const [totalSessions] = await db
      .select({ value: count() })
      .from(kycSessions);
    const statusCounts = await db
      .select({ status: kycSessions.status, cnt: count() })
      .from(kycSessions)
      .groupBy(kycSessions.status)
      .limit(100);
    const byStatus: Record<string, number> = {};
    statusCounts.forEach(r => {
      byStatus[r.status] = Number(r.cnt);
    });
    const total = Number(totalSessions.value);
    const approved = byStatus["approved"] ?? 0;
    const recentDocs = await db
      .select()
      .from(kycDocuments)
      .orderBy(desc(kycDocuments.createdAt))
      .limit(5);
    return {
      totalAgents: total,
      verificationRate: total > 0 ? Math.round((approved / total) * 100) : 0,
      avgRiskScore: null, // no risk scorer attached
      byStatus,
      recentSubmissions: recentDocs.map(d => ({
        agentId: String(d.agentId),
        docType: d.docType,
        status: d.status,
        submittedAt: d.createdAt?.toISOString?.()?.slice(0, 10) ?? null,
      })),
    };
  }),
  list: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().default(20),
          offset: z.number().default(0),
        })
        .default({ limit: 20, offset: 0 })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { items: [], data: [], total: 0 };
      const rows = await db
        .select()
        .from(kycSessions)
        .orderBy(desc(kycSessions.createdAt))
        .limit(input.limit)
        .offset(input.offset);
      const [totalRow] = await db
        .select({ total: count() })
        .from(kycSessions);
      return { items: rows, data: rows, total: Number(totalRow?.total ?? 0) };
    }),
});
