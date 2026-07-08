// @ts-check

/**
 * Item 24: API Documentation Generation
 * Provides OpenAPI/Swagger spec for all tRPC endpoints and microservices.
 */
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";

const API_SPEC = {
  openapi: "3.1.0",
  info: {
    title: "InsurePortal Insurance Platform API",
    version: "1.0.0",
    description:
      "Comprehensive API for insurance operations including KYC/KYB, transactions, settlements, and compliance.",
    contact: { name: "InsurePortal Engineering", email: "engineering@insureportal.com" },
    license: { name: "Proprietary" },
  },
  servers: [
    { url: "/api/v1", description: "Production API (versioned)" },
    { url: "/api/trpc", description: "tRPC endpoints" },
  ],
  tags: [
    { name: "Auth", description: "Authentication and authorization" },
    { name: "Agents", description: "Agent management and onboarding" },
    { name: "Merchants", description: "Merchant management" },
    { name: "Transactions", description: "Transaction processing" },
    { name: "KYC", description: "Know Your Customer verification" },
    { name: "KYB", description: "Know Your Business verification" },
    { name: "Settlements", description: "Settlement processing" },
    { name: "Compliance", description: "Regulatory compliance and AML" },
    { name: "Platform", description: "Platform health and monitoring" },
  ],
  paths: {
    "/health": {
      get: {
        tags: ["Platform"],
        summary: "Platform health overview",
        description: "Returns aggregated health status of all microservices",
        responses: {
          "200": {
            description: "Health status",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    overall: {
                      type: "string",
                      enum: ["healthy", "partially_healthy", "degraded"],
                    },
                    timestamp: { type: "string", format: "date-time" },
                    summary: {
                      type: "object",
                      properties: {
                        total: { type: "integer" },
                        healthy: { type: "integer" },
                        degraded: { type: "integer" },
                        unhealthy: { type: "integer" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/kyb/verify": {
      post: {
        tags: ["KYB"],
        summary: "Submit business for KYB verification",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["businessName", "rcNumber", "tin"],
                properties: {
                  businessName: { type: "string" },
                  rcNumber: {
                    type: "string",
                    description: "CAC registration number",
                  },
                  tin: {
                    type: "string",
                    description: "Tax Identification Number",
                  },
                  businessType: {
                    type: "string",
                    enum: [
                      "sole_proprietorship",
                      "partnership",
                      "limited_liability",
                      "plc",
                    ],
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Verification initiated" },
          "401": { description: "Unauthorized" },
          "429": { description: "Rate limit exceeded" },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Keycloak-issued JWT token",
      },
    },
  },
} as const;

export const apiDocsRouter = router({
  getSpec: protectedProcedure.query(() => API_SPEC),
  openapi: protectedProcedure.query(() => API_SPEC),

  endpoints: protectedProcedure.query(() => {
    return {
      trpc: {
        base: "/api/trpc",
        description: "tRPC procedures — use tRPC client for type-safe access",
        categories: [
          {
            name: "auth",
            procedures: ["login", "register", "refreshToken", "logout"],
          },
          {
            name: "agents",
            procedures: ["list", "getById", "create", "update", "onboarding.*"],
          },
          {
            name: "merchants",
            procedures: ["list", "getById", "create", "update"],
          },
          {
            name: "transactions",
            procedures: ["list", "create", "getById", "reverse", "reconcile"],
          },
          {
            name: "kyc",
            procedures: [
              "startSession",
              "submitDocument",
              "verifyBiometric",
              "getStatus",
            ],
          },
          {
            name: "kyb",
            procedures: [
              "initiate",
              "submitDocuments",
              "getRiskScore",
              "getStatus",
            ],
          },
          {
            name: "settlements",
            procedures: ["list", "create", "approve", "process"],
          },
          {
            name: "compliance",
            procedures: ["screenEntity", "getReport", "fileSTR"],
          },
          {
            name: "platformHealth",
            procedures: ["overview", "checkService", "serviceRegistry"],
          },
        ],
      },
      microservices: [
        {
          name: "KYB Engine",
          port: 8130,
          endpoints: ["/verify", "/status/:id", "/health"],
        },
        {
          name: "KYB Risk Engine",
          port: 8131,
          endpoints: ["/screen", "/risk-score", "/health"],
        },
        {
          name: "KYB Analytics",
          port: 8132,
          endpoints: ["/predict", "/report", "/health"],
        },
        {
          name: "DeepFace",
          port: 8133,
          endpoints: ["/verify", "/analyze", "/detect", "/health"],
        },
        {
          name: "Service Auth",
          port: 8140,
          endpoints: ["/token", "/verify", "/health"],
        },
        {
          name: "Circuit Breaker",
          port: 8141,
          endpoints: ["/check", "/status", "/health"],
        },
        {
          name: "Sanctions ETL",
          port: 8142,
          endpoints: ["/screen", "/update", "/health"],
        },
        {
          name: "Webhook Delivery",
          port: 8143,
          endpoints: ["/send", "/status", "/health"],
        },
        {
          name: "ML Model Registry",
          port: 8144,
          endpoints: ["/models", "/predict", "/health"],
        },
        {
          name: "Data Archival",
          port: 8145,
          endpoints: ["/archive", "/restore", "/health"],
        },
        {
          name: "Backup Manager",
          port: 8146,
          endpoints: ["/backup", "/restore", "/health"],
        },
      ],
    };
  }),
});
