// Sprint 90: Production biometric auth router with real microservice integration
import { TRPCError } from "@trpc/server";
import { eq, desc, and, sql, count } from "drizzle-orm";
import { z } from "zod";

import { kycSessions } from "../../drizzle/schema";
import { logger } from '../_core/logger';
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";


// ── Microservice URLs ───────────────────────────────────────────────────────
const BIOMETRIC_SERVICE_URL =
  process.env.BIOMETRIC_SERVICE_URL || "http://localhost:8046";
const LIVENESS_SERVICE_URL =
  process.env.LIVENESS_SERVICE_URL || "http://localhost:8104";
const FACE_MATCHING_SERVICE_URL =
  process.env.FACE_MATCHING_SERVICE_URL || "http://localhost:8105";
const DEEPFAKE_SERVICE_URL =
  process.env.DEEPFAKE_SERVICE_URL || "http://localhost:8106";

// ── Helper: call microservice ───────────────────────────────────────────────
async function callService(
  url: string,
  body: Record<string, unknown>,
  timeoutMs = 30000
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`Service returned ${resp.status}`);
    return await resp.json();
  } catch (err: any) {
    logger.warn(
      `[biometricAuth] Service call failed: ${url} — ${err.message}`
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const biometricAuthRouter = router({
  // ── Passive Liveness Check ──────────────────────────────────────────────
  passiveLiveness: protectedProcedure
    .input(z.object({ imageBase64: z.string().min(100) }))
    .mutation(async ({ input }) => {
      try {
        const result = await callService(
          `${LIVENESS_SERVICE_URL}/liveness/passive`,
          {
            image_base64: input.imageBase64,
          }
        );

        if (!result) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Liveness service unavailable",
          });
        }

        return {
          isLive: result.is_live ?? false,
          confidence: result.overall_score ?? 0,
          spoofType: result.spoof_type ?? "unknown",
          checks: result.checks ?? {},
          landmarks68: result.landmarks_68 ?? null,
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

  // ── Active Liveness Check ───────────────────────────────────────────────
  activeLiveness: protectedProcedure
    .input(
      z.object({
        framesBase64: z.array(z.string()).min(3).max(30),
        challengeType: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await callService(
          `${LIVENESS_SERVICE_URL}/liveness/active`,
          {
            frames_base64: input.framesBase64,
            challenge_type: input.challengeType,
          }
        );

        if (!result) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Liveness service unavailable",
          });
        }

        return {
          isLive: result.is_live ?? false,
          confidence: result.overall_score ?? 0,
          motionDetected: result.motion_detected ?? false,
          blinkDetected: result.blink_detected ?? false,
          framesAnalyzed: result.frames_analyzed ?? 0,
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

  // ── Face Matching (1:1 Verification) ────────────────────────────────────
  matchFaces: protectedProcedure
    .input(
      z.object({
        image1Base64: z.string().min(100),
        image2Base64: z.string().min(100),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await callService(
          `${FACE_MATCHING_SERVICE_URL}/face/match`,
          {
            image1_base64: input.image1Base64,
            image2_base64: input.image2Base64,
          }
        );

        if (!result) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Face matching service unavailable",
          });
        }

        return {
          match: result.match ?? false,
          similarity: result.similarity ?? 0,
          confidence: result.confidence ?? 0,
          model: result.model ?? "unknown",
          demographics: result.demographics ?? {},
          processingTimeMs: result.processing_time_ms ?? 0,
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

  // ── Face Detection ──────────────────────────────────────────────────────
  detectFaces: protectedProcedure
    .input(z.object({ imageBase64: z.string().min(100) }))
    .mutation(async ({ input }) => {
      try {
        const result = await callService(
          `${FACE_MATCHING_SERVICE_URL}/face/detect`,
          {
            image_base64: input.imageBase64,
          }
        );

        if (!result) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Face detection service unavailable",
          });
        }

        return {
          faces: (result.faces ?? []).map((f: any) => ({
            bbox: f.bbox,
            confidence: f.confidence,
            landmarks5pt: f.landmarks_5pt,
            gender: f.gender,
            age: f.age,
            hasEmbedding: f.has_embedding ?? false,
          })),
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

  // ── Deepfake Detection ──────────────────────────────────────────────────
  detectDeepfake: protectedProcedure
    .input(z.object({ imageBase64: z.string().min(100) }))
    .mutation(async ({ input }) => {
      try {
        const result = await callService(
          `${DEEPFAKE_SERVICE_URL}/deepfake/detect`,
          {
            image_base64: input.imageBase64,
          }
        );

        if (!result) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Deepfake detection service unavailable",
          });
        }

        return {
          isReal: result.is_real ?? true,
          confidence: result.confidence ?? 0,
          deepfakeProbability: result.deepfake_probability ?? 0,
          deepfakeType: result.deepfake_type ?? "unknown",
          analysis: result.analysis ?? {},
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

  // ── Full Biometric Verification ─────────────────────────────────────────
  fullVerification: protectedProcedure
    .input(
      z.object({
        selfieBase64: z.string().min(100),
        documentBase64: z.string().min(100),
        sessionRef: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const userId = ctx.user.id.toString();

        const result = await callService(
          `${BIOMETRIC_SERVICE_URL}/api/v1/biometric/verify`,
          {
            selfie_base64: input.selfieBase64,
            document_base64: input.documentBase64,
            user_id: userId,
          }
        );

        if (!result) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Biometric verification service unavailable",
          });
        }

        // Persist to kycSessions if sessionRef provided
        if (input.sessionRef) {
          const dbInst = await getDb();
          if (!dbInst) throw new Error("DB unavailable");
          try {
            await dbInst
              .update(kycSessions)
              .set({
                livenessScore: String(result.liveness?.confidence ?? 0),
                livenessPassed: result.liveness?.result === "real",
                livenessMethod: result.liveness?.source ?? "biometric_service",
                livenessRaw: result.liveness ?? {},
                matchScore: String(result.face_match?.similarity ?? 0),
                updatedAt: new Date(),
              })
              .where(eq(kycSessions.sessionRef, input.sessionRef));
          } catch (err) {
            logger.warn("[biometricAuth] Failed to persist to kycSessions:: " + err);
          }
        }

        return {
          verificationId: result.verification_id,
          status: result.status,
          overallConfidence: result.overall_confidence,
          faceMatch: result.face_match,
          liveness: result.liveness,
          deepfake: result.deepfake,
          quality: result.quality,
          landmarks: result.landmarks,
          issues: result.issues ?? [],
          processingTimeMs: result.processing_time_ms,
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

  // ── Face Quality Assessment ─────────────────────────────────────────────
  assessQuality: protectedProcedure
    .input(z.object({ imageBase64: z.string().min(100) }))
    .mutation(async ({ input }) => {
      try {
        const result = await callService(
          `${BIOMETRIC_SERVICE_URL}/api/v1/biometric/quality`,
          {
            image_base64: input.imageBase64,
          }
        );

        if (!result) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Quality assessment service unavailable",
          });
        }

        return {
          overallQuality: result.overall_quality ?? 0,
          scores: result.scores ?? {},
          issues: result.issues ?? [],
          icaoCompliant: result.icao_compliant ?? false,
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

  // ── Anti-Spoofing Check ─────────────────────────────────────────────────
  antiSpoof: protectedProcedure
    .input(z.object({ imageBase64: z.string().min(100) }))
    .mutation(async ({ input }) => {
      try {
        const result = await callService(
          `${BIOMETRIC_SERVICE_URL}/api/v1/biometric/anti-spoof`,
          {
            image_base64: input.imageBase64,
          }
        );

        if (!result) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Anti-spoofing service unavailable",
          });
        }

        return {
          antiSpoofScore: result.anti_spoof_score ?? 0,
          isReal: result.is_real ?? false,
          spoofType: result.spoof_type ?? "unknown",
          checks: result.checks ?? {},
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

  // ── List Biometric Records ──────────────────────────────────────────────
  serviceHealth: protectedProcedure.query(async () => {
    const services = [
      { name: "biometric", url: `${BIOMETRIC_SERVICE_URL}/health` },
      { name: "liveness", url: `${LIVENESS_SERVICE_URL}/health` },
      { name: "face_matching", url: `${FACE_MATCHING_SERVICE_URL}/health` },
      { name: "deepfake", url: `${DEEPFAKE_SERVICE_URL}/health` },
    ];

    const results = await Promise.allSettled(
      services.map(async s => {
        try {
          const resp = await fetch(s.url, {
            signal: AbortSignal.timeout(5000),
          });
          if (!resp.ok)
            return {
              name: s.name,
              status: "unhealthy",
              error: `HTTP ${resp.status}`,
            };
          const data = await resp.json();
          return { name: s.name, status: "healthy", data };
        } catch (err: any) {
          return { name: s.name, status: "unavailable", error: err.message };
        }
      })
    );

    return {
      services: results.map((r: any) =>
        r.status === "fulfilled"
          ? r.value
          : { name: "unknown", status: "error" }
      ),
    };
  }),

  // ── Sprint 28 domain procedures ──
  // F-12 (expanded sweep): fixture rows (BIO-001) — no delivered
  // store. Fail loud.
  list: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "list: no biometric-enrollment store is delivered",
    });
  }),
  // F-12 (expanded sweep): fixture rows (successRate 98.5) — no delivered
  // store. Fail loud.
  analytics: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "analytics: no biometric telemetry is delivered",
    });
  }),
});
