// Sprint 96: DeepFace integration — multi-model face recognition & attribute analysis
// Wraps serengil/deepface microservice (port 8133) with tRPC procedures
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  deepfaceVerify,
  deepfaceEnsembleVerify,
  deepfaceAnalyze,
  deepfaceExtractEmbedding,
  deepfaceAntiSpoof,
  deepfaceDetectFaces,
  deepfaceEnroll,
  deepfaceSearch,
} from "../_core/kycClient";
import { protectedProcedure, router } from "../_core/trpc";

const DEEPFACE_MODELS = [
  "VGG-Face",
  "Facenet",
  "Facenet512",
  "OpenFace",
  "DeepFace",
  "DeepID",
  "ArcFace",
  "Dlib",
  "SFace",
  "GhostFaceNet",
] as const;

const DEEPFACE_DETECTORS = [
  "opencv",
  "ssd",
  "dlib",
  "mtcnn",
  "fastmtcnn",
  "retinaface",
  "mediapipe",
  "yolov8",
  "yunet",
  "centerface",
] as const;

const DISTANCE_METRICS = ["cosine", "euclidean", "euclidean_l2"] as const;

const ANALYSIS_ACTIONS = ["age", "gender", "emotion", "race"] as const;

export const deepfaceRouter = router({
  // ── 1:1 Face Verification ────────────────────────────────────────────────
  verify: protectedProcedure
    .input(
      z.object({
        image1Base64: z.string().min(100),
        image2Base64: z.string().min(100),
        modelName: z.enum(DEEPFACE_MODELS).default("ArcFace"),
        detectorBackend: z.enum(DEEPFACE_DETECTORS).default("retinaface"),
        distanceMetric: z.enum(DISTANCE_METRICS).default("cosine"),
        antiSpoofing: z.boolean().default(false),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await deepfaceVerify(
          input.image1Base64,
          input.image2Base64,
          input.modelName,
          input.detectorBackend,
          input.distanceMetric,
          input.antiSpoofing
        );

        if (!result) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DeepFace verification service unavailable",
          });
        }

        return result;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Multi-Model Ensemble Verification ──────────────────────────────────
  ensembleVerify: protectedProcedure
    .input(
      z.object({
        image1Base64: z.string().min(100),
        image2Base64: z.string().min(100),
        models: z
          .array(z.enum(DEEPFACE_MODELS))
          .min(2)
          .max(10)
          .default(["ArcFace", "Facenet512", "VGG-Face"]),
        consensusThreshold: z.number().min(0).max(1).default(0.6),
        antiSpoofing: z.boolean().default(false),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await deepfaceEnsembleVerify(
          input.image1Base64,
          input.image2Base64,
          input.models as string[],
          input.consensusThreshold,
          input.antiSpoofing
        );

        if (!result) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DeepFace ensemble verification service unavailable",
          });
        }

        return result;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Facial Attribute Analysis ──────────────────────────────────────────
  analyze: protectedProcedure
    .input(
      z.object({
        imageBase64: z.string().min(100),
        actions: z
          .array(z.enum(ANALYSIS_ACTIONS))
          .min(1)
          .default(["age", "gender", "emotion", "race"]),
        detectorBackend: z.enum(DEEPFACE_DETECTORS).default("retinaface"),
        antiSpoofing: z.boolean().default(false),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await deepfaceAnalyze(
          input.imageBase64,
          input.actions as string[],
          input.detectorBackend,
          input.antiSpoofing
        );

        if (!result) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DeepFace analysis service unavailable",
          });
        }

        return result;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Face Detection ────────────────────────────────────────────────────
  detectFaces: protectedProcedure
    .input(
      z.object({
        imageBase64: z.string().min(100),
        detectorBackend: z.enum(DEEPFACE_DETECTORS).default("retinaface"),
        antiSpoofing: z.boolean().default(false),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await deepfaceDetectFaces(
          input.imageBase64,
          input.detectorBackend,
          input.antiSpoofing
        );

        if (!result) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DeepFace detection service unavailable",
          });
        }

        return result;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Embedding Extraction ──────────────────────────────────────────────
  extractEmbedding: protectedProcedure
    .input(
      z.object({
        imageBase64: z.string().min(100),
        modelName: z.enum(DEEPFACE_MODELS).default("ArcFace"),
        detectorBackend: z.enum(DEEPFACE_DETECTORS).default("retinaface"),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await deepfaceExtractEmbedding(
          input.imageBase64,
          input.modelName,
          input.detectorBackend
        );

        if (!result) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DeepFace embedding extraction service unavailable",
          });
        }

        return result;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Anti-Spoofing Detection ───────────────────────────────────────────
  antiSpoof: protectedProcedure
    .input(
      z.object({
        imageBase64: z.string().min(100),
        detectorBackend: z.enum(DEEPFACE_DETECTORS).default("retinaface"),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await deepfaceAntiSpoof(
          input.imageBase64,
          input.detectorBackend
        );

        if (!result) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DeepFace anti-spoofing service unavailable",
          });
        }

        return result;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Gallery Enrollment (1:N) ──────────────────────────────────────────
  enrollFace: protectedProcedure
    .input(
      z.object({
        imageBase64: z.string().min(100),
        identity: z.string().min(1).max(255),
        modelName: z.enum(DEEPFACE_MODELS).default("ArcFace"),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await deepfaceEnroll(
          input.imageBase64,
          input.identity,
          input.modelName,
          input.metadata
        );

        if (!result) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DeepFace enrollment service unavailable",
          });
        }

        return result;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Gallery Search (1:N Recognition) ──────────────────────────────────
  searchGallery: protectedProcedure
    .input(
      z.object({
        imageBase64: z.string().min(100),
        modelName: z.enum(DEEPFACE_MODELS).default("ArcFace"),
        topK: z.number().int().min(1).max(100).default(5),
        threshold: z.number().min(0).max(1).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await deepfaceSearch(
          input.imageBase64,
          input.modelName,
          input.topK,
          input.threshold
        );

        if (!result) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DeepFace gallery search service unavailable",
          });
        }

        return result;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Supported Models & Detectors ──────────────────────────────────────
  models: protectedProcedure.query(async () => {
    return {
      models: DEEPFACE_MODELS,
      detectors: DEEPFACE_DETECTORS,
      distanceMetrics: DISTANCE_METRICS,
      analysisActions: ANALYSIS_ACTIONS,
      defaultModel: "ArcFace",
      defaultDetector: "retinaface",
      defaultDistanceMetric: "cosine",
    };
  }),
});
