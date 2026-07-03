/**
 * KYB (Know Your Business) Router
 * tRPC procedures bridging POS Shell to the Go KYB Engine, Rust Risk Engine,
 * and Python Analytics services.
 *
 * Integrations: Kafka, Dapr, Temporal, PostgreSQL, Keycloak, Permify, Redis,
 *               Mojaloop, OpenSearch, APISIX, TigerBeetle, Fluvio, Lakehouse
 *
 * Procedures:
 *  kyb.startVerification     — initiate KYB verification for a business
 *  kyb.getVerification       — get verification status by ID
 *  kyb.listVerifications     — list all KYB verifications (admin)
 *  kyb.uploadDocument        — upload a business document for verification
 *  kyb.screenUBOs            — trigger UBO screening (PEP/sanctions)
 *  kyb.assessRisk            — trigger ML-based risk assessment
 *  kyb.approve               — approve a KYB verification
 *  kyb.reject                — reject a KYB verification
 *  kyb.detectFraud           — ML fraud detection via Python analytics
 *  kyb.complianceReport      — generate compliance report
 *  kyb.analyticsDashboard    — get analytics dashboard data
 *  kyb.screenPEP             — direct PEP screening via Rust engine
 *  kyb.screenSanctions       — direct sanctions screening via Rust engine
 *  kyb.screenAML             — AML/CFT screening via Rust engine
 *  kyb.lakehouseETL          — run Lakehouse ETL pipeline
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc.js";
import { getDb, writeAuditLog } from "../db.js";
import { merchantKycDocs } from "../../drizzle/schema.js";
import { eq, desc } from "drizzle-orm";
import { eq, desc } from "drizzle-orm";
import { logger } from './_core/logger';

// ─── Service URLs ────────────────────────────────────────────────────────────

const KYB_ENGINE_URL = process.env.KYB_ENGINE_URL || "http://localhost:8130";
const KYB_RISK_ENGINE_URL =
  process.env.KYB_RISK_ENGINE_URL || "http://localhost:8131";
const KYB_ANALYTICS_URL =
  process.env.KYB_ANALYTICS_URL || "http://localhost:8132";

// ─── HTTP Helper ─────────────────────────────────────────────────────────────

async function serviceCall<T = any>(
  url: string,
  method: "GET" | "POST" = "GET",
  body?: any,
  timeoutMs = 15000
): Promise<T | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const opts: RequestInit = {
      method,
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
    };
    if (body && method === "POST") {
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    clearTimeout(timer);
    if (!res.ok) {
      logger.warn(`[KYB] ${method} ${url} returned ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    logger.warn(`[KYB] ${method} ${url} failed:`, err);
    return null;
  }
}

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const businessTypeSchema = z.enum([
  "corporation",
  "llc",
  "partnership",
  "sole_proprietorship",
  "non_profit",
  "trust",
]);

const addressSchema = z
  .object({
    street: z.string(),
    city: z.string(),
    state: z.string(),
    zip_code: z.string().optional(),
    country: z.string().default("Nigeria"),
  })
  .optional();

const beneficialOwnerSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  date_of_birth: z.string().optional(),
  nationality: z.string().default("Nigeria"),
  ownership_percentage: z.number().min(0).max(100),
  position: z.string().optional(),
  bvn: z.string().length(11).optional(),
  nin: z.string().optional(),
});

// ─── Router ──────────────────────────────────────────────────────────────────

export const kybRouter = router({
  // ── Start KYB Verification ─────────────────────────────────────────────────

  startVerification: protectedProcedure
    .input(
      z.object({
        business_name: z.string().min(2).max(256),
        business_type: businessTypeSchema.default("llc"),
        registration_number: z.string().optional(),
        tax_id: z.string().optional(),
        incorporation_country: z.string().default("Nigeria"),
        incorporation_state: z.string().optional(),
        business_address: addressSchema,
        phone: z.string().optional(),
        email: z.string().email().optional(),
        industry: z.string().optional(),
        annual_revenue: z.number().nonnegative().optional(),
        employee_count: z.number().int().nonnegative().optional(),
        beneficial_owners: z.array(beneficialOwnerSchema).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        // Forward to Go KYB Engine
        const result = await serviceCall(
          `${KYB_ENGINE_URL}/kyb/verify`,
          "POST",
          input,
          30000
        );

        if (!result) {
          throw new TRPCError({
            code: "SERVICE_UNAVAILABLE",
            message: "KYB Engine unavailable — please retry",
          });
        }

        await writeAuditLog({
          agentId: 0,
          agentCode: "system",
          action: "kyb_verification_started",
          resource: "kyb_verification",
          resourceId: result.id || "unknown",
          status: "success",
          metadata: {
            business_name: input.business_name,
            business_type: input.business_type,
          },
        });

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

  // ── Get Verification Status ────────────────────────────────────────────────

  getVerification: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      try {
        const result = await serviceCall(
          `${KYB_ENGINE_URL}/kyb/verifications/${input.id}`
        );
        if (!result) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Verification not found",
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

  // ── List Verifications (Admin) ─────────────────────────────────────────────

  listVerifications: adminProcedure
    .input(
      z.object({
        status: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(50),
      })
    )
    .query(async ({ input }) => {
      try {
        const params = new URLSearchParams();
        if (input.status) params.set("status", input.status);
        params.set("limit", String(input.limit));
        const result = await serviceCall(
          `${KYB_ENGINE_URL}/kyb/verifications?${params}`
        );
        return result || { items: [], total: 0 };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Upload Business Document ───────────────────────────────────────────────

  uploadDocument: protectedProcedure
    .input(
      z.object({
        verification_id: z.string(),
        doc_type: z.enum([
          "cac_certificate",
          "tin_certificate",
          "utility_bill",
          "bank_statement",
          "memart",
          "board_resolution",
          "id_card",
          "passport",
          "bvn_verification",
          "scuml_certificate",
          "cbn_license",
        ]),
        doc_url: z.string().url(),
        doc_number: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await serviceCall(
          `${KYB_ENGINE_URL}/kyb/verifications/${input.verification_id}/documents`,
          "POST",
          {
            doc_type: input.doc_type,
            doc_url: input.doc_url,
            doc_number: input.doc_number,
          }
        );
        if (!result) {
          throw new TRPCError({
            code: "SERVICE_UNAVAILABLE",
            message: "KYB Engine unavailable for document upload",
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

  // ── Screen UBOs (PEP + Sanctions) ──────────────────────────────────────────

  screenUBOs: adminProcedure
    .input(z.object({ verification_id: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const result = await serviceCall(
          `${KYB_ENGINE_URL}/kyb/verifications/${input.verification_id}/screen-ubos`,
          "POST",
          {}
        );
        if (!result) {
          throw new TRPCError({
            code: "SERVICE_UNAVAILABLE",
            message: "KYB Engine unavailable for UBO screening",
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

  // ── Risk Assessment (ML-based via Go→Rust) ─────────────────────────────────

  assessRisk: adminProcedure
    .input(z.object({ verification_id: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const result = await serviceCall(
          `${KYB_ENGINE_URL}/kyb/verifications/${input.verification_id}/assess-risk`,
          "POST",
          {}
        );
        if (!result) {
          throw new TRPCError({
            code: "SERVICE_UNAVAILABLE",
            message: "KYB risk assessment unavailable",
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

  // ── Approve Verification ───────────────────────────────────────────────────

  approve: adminProcedure
    .input(
      z.object({
        verification_id: z.string(),
        actor_id: z.string().default("admin"),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await serviceCall(
          `${KYB_ENGINE_URL}/kyb/verifications/${input.verification_id}/approve`,
          "POST",
          { actor_id: input.actor_id }
        );
        if (!result) {
          throw new TRPCError({
            code: "SERVICE_UNAVAILABLE",
            message: "KYB Engine unavailable for approval",
          });
        }

        await writeAuditLog({
          agentId: 0,
          agentCode: "system",
          action: "kyb_verification_approved",
          resource: "kyb_verification",
          resourceId: input.verification_id,
          status: "success",
        });

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

  // ── Reject Verification ────────────────────────────────────────────────────

  reject: adminProcedure
    .input(
      z.object({
        verification_id: z.string(),
        actor_id: z.string().default("admin"),
        reason: z.string().min(5),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await serviceCall(
          `${KYB_ENGINE_URL}/kyb/verifications/${input.verification_id}/reject`,
          "POST",
          { actor_id: input.actor_id, reason: input.reason }
        );
        if (!result) {
          throw new TRPCError({
            code: "SERVICE_UNAVAILABLE",
            message: "KYB Engine unavailable for rejection",
          });
        }

        await writeAuditLog({
          agentId: 0,
          agentCode: "system",
          action: "kyb_verification_rejected",
          resource: "kyb_verification",
          resourceId: input.verification_id,
          status: "success",
          metadata: { reason: input.reason },
        });

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

  // ── Direct PEP Screening (Rust Engine) ─────────────────────────────────────

  screenPEP: adminProcedure
    .input(
      z.object({
        first_name: z.string().min(1),
        last_name: z.string().min(1),
        nationality: z.string().default("Nigeria"),
        date_of_birth: z.string().optional(),
        bvn: z.string().optional(),
        nin: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await serviceCall(
          `${KYB_RISK_ENGINE_URL}/screen/pep`,
          "POST",
          input
        );
        if (!result) {
          throw new TRPCError({
            code: "SERVICE_UNAVAILABLE",
            message: "KYB Risk Engine unavailable for PEP screening",
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

  // ── Direct Sanctions Screening (Rust Engine) ───────────────────────────────

  screenSanctions: adminProcedure
    .input(
      z.object({
        entity_name: z.string().min(1),
        entity_type: z.enum(["individual", "business"]),
        country: z.string().optional(),
        aliases: z.array(z.string()).optional(),
        registration_number: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await serviceCall(
          `${KYB_RISK_ENGINE_URL}/screen/sanctions`,
          "POST",
          input
        );
        if (!result) {
          throw new TRPCError({
            code: "SERVICE_UNAVAILABLE",
            message: "KYB Risk Engine unavailable for sanctions screening",
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

  // ── AML/CFT Screening (Rust Engine) ────────────────────────────────────────

  screenAML: adminProcedure
    .input(
      z.object({
        entity_name: z.string().min(1),
        entity_type: z.enum(["individual", "business"]),
        country: z.string().default("Nigeria"),
        transaction_volume: z.number().optional(),
        transaction_count: z.number().int().optional(),
        counterparties: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await serviceCall(
          `${KYB_RISK_ENGINE_URL}/screen/aml`,
          "POST",
          input
        );
        if (!result) {
          throw new TRPCError({
            code: "SERVICE_UNAVAILABLE",
            message: "KYB Risk Engine unavailable for AML screening",
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

  // ── ML Fraud Detection (Python Analytics) ──────────────────────────────────

  detectFraud: adminProcedure
    .input(
      z.object({
        verification_id: z.string(),
        business_name: z.string(),
        business_type: z.string(),
        registration_number: z.string().optional(),
        tax_id: z.string().optional(),
        country: z.string().default("Nigeria"),
        industry: z.string().optional(),
        annual_revenue: z.number().optional(),
        employee_count: z.number().int().optional(),
        ubo_count: z.number().int().optional(),
        document_count: z.number().int().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await serviceCall(
          `${KYB_ANALYTICS_URL}/fraud/detect`,
          "POST",
          input,
          30000
        );
        if (!result) {
          throw new TRPCError({
            code: "SERVICE_UNAVAILABLE",
            message: "KYB Analytics unavailable for fraud detection",
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

  // ── Compliance Report (Python Analytics) ───────────────────────────────────

  complianceReport: adminProcedure
    .input(
      z.object({
        report_type: z
          .enum(["monthly", "quarterly", "annual"])
          .default("monthly"),
        start_date: z.string().optional(),
        end_date: z.string().optional(),
        include_details: z.boolean().default(true),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await serviceCall(
          `${KYB_ANALYTICS_URL}/compliance/report`,
          "POST",
          input,
          60000
        );
        if (!result) {
          throw new TRPCError({
            code: "SERVICE_UNAVAILABLE",
            message: "KYB Analytics unavailable for compliance report",
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

  // ── Analytics Dashboard (Python Analytics) ─────────────────────────────────

  analyticsDashboard: adminProcedure.query(async () => {
    const result = await serviceCall(
      `${KYB_ANALYTICS_URL}/analytics/dashboard`
    );
    return (
      result || {
        total_verifications_analyzed: 0,
        fraud_detections: 0,
        anomalies_detected: 0,
        compliance_reports_generated: 0,
        score_distribution: {},
        risk_level_distribution: {},
        avg_fraud_score: 0,
      }
    );
  }),

  // ── Lakehouse ETL (Python Analytics) ───────────────────────────────────────

  lakehouseETL: adminProcedure
    .input(
      z.object({
        data_type: z.enum([
          "kyb_verifications",
          "compliance_reports",
          "anomaly_detections",
        ]),
        batch_size: z.number().int().min(1).max(10000).default(100),
        include_pii: z.boolean().default(false),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await serviceCall(
          `${KYB_ANALYTICS_URL}/etl/lakehouse`,
          "POST",
          input,
          120000
        );
        if (!result) {
          throw new TRPCError({
            code: "SERVICE_UNAVAILABLE",
            message: "KYB Analytics unavailable for Lakehouse ETL",
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

  // ── Service Health Check ───────────────────────────────────────────────────

  healthCheck: adminProcedure.query(async () => {
    const [goHealth, rustHealth, pyHealth] = await Promise.all([
      serviceCall(`${KYB_ENGINE_URL}/health`, "GET", undefined, 5000),
      serviceCall(`${KYB_RISK_ENGINE_URL}/health`, "GET", undefined, 5000),
      serviceCall(`${KYB_ANALYTICS_URL}/health`, "GET", undefined, 5000),
    ]);
    return {
      kyb_engine: goHealth
        ? { status: "healthy", ...goHealth }
        : { status: "unavailable" },
      kyb_risk_engine: rustHealth
        ? { status: "healthy", ...rustHealth }
        : { status: "unavailable" },
      kyb_analytics: pyHealth
        ? { status: "healthy", ...pyHealth }
        : { status: "unavailable" },
    };
  }),
});
