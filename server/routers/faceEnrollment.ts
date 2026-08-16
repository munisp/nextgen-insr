import { TRPCError } from "@trpc/server";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";

import { faceEnrollments, biometricAuditEvents } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

/**
 * Face Enrollment Router — Manages ArcFace 512-d embedding persistence
 * for biometric verification (KYC, login, payment authentication).
 */
export const faceEnrollmentRouter = router({
  /** Enroll a new face embedding */
  enroll: protectedProcedure
    .input(
      z.object({
        enrollmentType: z.enum(["kyc", "login", "payment"]).default("kyc"),
        embeddingVector: z.array(z.number()).length(512),
        qualityScore: z.number().min(0).max(1).optional(),
        livenessScore: z.number().min(0).max(1).optional(),
        antiSpoofScore: z.number().min(0).max(1).optional(),
        sourceImageHash: z.string().optional(),
        deviceFingerprint: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");

        // Deactivate previous enrollments of the same type
        await db
          .update(faceEnrollments)
          .set({ isActive: false, updatedAt: new Date() })
          .where(
            and(
              eq(faceEnrollments.userId, ctx.user.id),
              eq(faceEnrollments.enrollmentType, input.enrollmentType),
              eq(faceEnrollments.isActive, true)
            )
          );

        // Insert new enrollment
        const [enrollment] = await db
          .insert(faceEnrollments)
          .values({
            userId: ctx.user.id,
            enrollmentType: input.enrollmentType,
            embeddingVector: JSON.stringify(input.embeddingVector),
            embeddingVersion: "arcface_w600k_r50",
            qualityScore: input.qualityScore?.toFixed(4) ?? null,
            livenessScore: input.livenessScore?.toFixed(4) ?? null,
            antiSpoofScore: input.antiSpoofScore?.toFixed(4) ?? null,
            sourceImageHash: input.sourceImageHash ?? null,
            deviceFingerprint: input.deviceFingerprint ?? null,
            ipAddress:
              (ctx.req?.headers?.["x-forwarded-for"] as string)?.split(
                ","
              )[0] ?? null,
            expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          })
          .returning();

        // Audit event
        await db.insert(biometricAuditEvents).values({
          sessionId: `enroll_${enrollment.id}_${Date.now()}`,
          userId: ctx.user.id,
          eventType: "enrollment",
          outcome: "pass",
          confidenceScore: input.qualityScore?.toFixed(4) ?? null,
          livenessMethod: "passive",
          ipAddress:
            (ctx.req?.headers?.["x-forwarded-for"] as string)?.split(",")[0] ??
            null,
        });

        return {
          id: enrollment.id,
          enrollmentType: enrollment.enrollmentType,
          createdAt: enrollment.createdAt,
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

  /** Verify a probe embedding against enrolled templates */
  verify: protectedProcedure
    .input(
      z.object({
        probeEmbedding: z.array(z.number()).length(512),
        enrollmentType: z.enum(["kyc", "login", "payment"]).default("kyc"),
        threshold: z.number().min(0).max(1).default(0.45),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const startTime = Date.now();

        const [enrollment] = await db
          .select()
          .from(faceEnrollments)
          .where(
            and(
              eq(faceEnrollments.userId, ctx.user.id),
              eq(faceEnrollments.enrollmentType, input.enrollmentType),
              eq(faceEnrollments.isActive, true)
            )
          )
          .orderBy(desc(faceEnrollments.createdAt))
          .limit(1);

        if (!enrollment) {
          await db.insert(biometricAuditEvents).values({
            sessionId: `verify_${ctx.user.id}_${Date.now()}`,
            userId: ctx.user.id,
            eventType: "verification",
            outcome: "fail",
            errorDetails: "No active enrollment found",
            processingTimeMs: Date.now() - startTime,
            ipAddress:
              (ctx.req?.headers?.["x-forwarded-for"] as string)?.split(
                ","
              )[0] ?? null,
          });
          return { match: false, score: 0, reason: "no_enrollment" };
        }

        // Cosine similarity
        const enrolled: number[] = JSON.parse(enrollment.embeddingVector);
        const probe = input.probeEmbedding;
        let dotProduct = 0,
          normA = 0,
          normB = 0;
        for (let i = 0; i < 512; i++) {
          dotProduct += enrolled[i] * probe[i];
          normA += enrolled[i] * enrolled[i];
          normB += probe[i] * probe[i];
        }
        const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
        const match = similarity >= input.threshold;
        const processingTimeMs = Date.now() - startTime;

        await db.insert(biometricAuditEvents).values({
          sessionId: `verify_${ctx.user.id}_${Date.now()}`,
          userId: ctx.user.id,
          eventType: "verification",
          outcome: match ? "pass" : "fail",
          matchScore: similarity.toFixed(4),
          processingTimeMs,
          ipAddress:
            (ctx.req?.headers?.["x-forwarded-for"] as string)?.split(",")[0] ??
            null,
        });

        return {
          match,
          score: similarity,
          threshold: input.threshold,
          processingTimeMs,
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

  /** List all enrollments for the current user */
  list: protectedProcedure.query(async ({ ctx }) => {
    try {
      const db = await getDb();
      if (!db) throw new Error("Database connection unavailable");
      return db
        .select({
          id: faceEnrollments.id,
          enrollmentType: faceEnrollments.enrollmentType,
          embeddingVersion: faceEnrollments.embeddingVersion,
          qualityScore: faceEnrollments.qualityScore,
          livenessScore: faceEnrollments.livenessScore,
          isActive: faceEnrollments.isActive,
          createdAt: faceEnrollments.createdAt,
          expiresAt: faceEnrollments.expiresAt,
          revokedAt: faceEnrollments.revokedAt,
        })
        .from(faceEnrollments)
        .where(eq(faceEnrollments.userId, ctx.user.id))
        .orderBy(desc(faceEnrollments.createdAt));
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  }),

  /** Get the user's active enrollment */
  getActive: protectedProcedure
    .input(
      z.object({
        enrollmentType: z.enum(["kyc", "login", "payment"]).default("kyc"),
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("Database connection unavailable");
        const [enrollment] = await db
          .select({
            id: faceEnrollments.id,
            enrollmentType: faceEnrollments.enrollmentType,
            embeddingVersion: faceEnrollments.embeddingVersion,
            qualityScore: faceEnrollments.qualityScore,
            livenessScore: faceEnrollments.livenessScore,
            isActive: faceEnrollments.isActive,
            createdAt: faceEnrollments.createdAt,
            expiresAt: faceEnrollments.expiresAt,
          })
          .from(faceEnrollments)
          .where(
            and(
              eq(faceEnrollments.userId, ctx.user.id),
              eq(faceEnrollments.enrollmentType, input.enrollmentType),
              eq(faceEnrollments.isActive, true)
            )
          )
          .orderBy(desc(faceEnrollments.createdAt))
          .limit(1);
        return enrollment ?? null;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  /** Revoke an enrollment */
  revoke: protectedProcedure
    .input(
      z.object({
        enrollmentId: z.number(),
        reason: z.string().min(1).max(500),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const [updated] = await db
          .update(faceEnrollments)
          .set({
            isActive: false,
            revokedAt: new Date(),
            revokedReason: input.reason,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(faceEnrollments.id, input.enrollmentId),
              eq(faceEnrollments.userId, ctx.user.id)
            )
          )
          .returning();

        if (updated) {
          await db.insert(biometricAuditEvents).values({
            sessionId: `revoke_${input.enrollmentId}_${Date.now()}`,
            userId: ctx.user.id,
            eventType: "enrollment",
            outcome: "pass",
            errorDetails: `Revoked: ${input.reason}`,
            ipAddress:
              (ctx.req?.headers?.["x-forwarded-for"] as string)?.split(
                ","
              )[0] ?? null,
          });
        }
        return { success: !!updated };
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
