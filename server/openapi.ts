// @ts-check

/**
 * OpenAPI 3.1 Documentation Generator for NGApp tRPC API
 *
 * Generates OpenAPI spec from tRPC router metadata.
 * Accessible at GET /api/docs (JSON) and GET /api/docs/ui (Swagger UI).
 */
import { type Express } from "express";

const OPENAPI_SPEC = {
  openapi: "3.1.0",
  info: {
    title: "NGApp Insurance Platform API",
    version: "1.0.0",
    description:
      "Comprehensive Nigerian insurance platform API covering 7 domains: Core Insurance, Digital Channels, AI/ML, Compliance, Agent Network, Infrastructure, and Governance.",
    contact: {
      name: "NGApp Platform Team",
      email: "api@ngapp.io",
    },
    license: {
      name: "Proprietary",
    },
  },
  servers: [
    {
      url: "{protocol}://{host}",
      description: "Platform API",
      variables: {
        protocol: { default: "https", enum: ["https", "http"] },
        host: { default: "api.ngapp.io" },
      },
    },
  ],
  tags: [
    { name: "Authentication", description: "Keycloak OIDC authentication flows" },
    { name: "Policies", description: "Policy lifecycle management (create, renew, cancel, claim)" },
    { name: "Claims", description: "Claims submission, adjudication, and settlement" },
    { name: "Underwriting", description: "Risk assessment and premium calculation" },
    { name: "KYC/KYB", description: "Customer and business verification" },
    { name: "Payments", description: "Premium collection, disbursement, and reconciliation" },
    { name: "Agent Network", description: "Agent onboarding, commissions, and hierarchy" },
    { name: "USSD", description: "USSD service for feature phones" },
    { name: "Compliance", description: "NAICOM, NDPR, AML/CFT regulatory reporting" },
    { name: "Analytics", description: "Business intelligence and reporting" },
    { name: "Notifications", description: "SMS, email, push notification channels" },
    { name: "Admin", description: "Platform administration and configuration" },
  ],
  paths: {
    "/api/trpc/policy.list": {
      get: {
        tags: ["Policies"],
        summary: "List policies",
        description: "Returns paginated list of insurance policies with optional filters",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
          { name: "offset", in: "query", schema: { type: "integer", default: 0 } },
          { name: "status", in: "query", schema: { type: "string", enum: ["active", "expired", "cancelled", "pending"] } },
          { name: "productType", in: "query", schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Paginated policy list", content: { "application/json": { schema: { $ref: "#/components/schemas/PolicyListResponse" } } } },
          "401": { description: "Unauthorized" },
        },
        security: [{ bearerAuth: [] }],
      },
    },
    "/api/trpc/policy.getById": {
      get: {
        tags: ["Policies"],
        summary: "Get policy by ID",
        parameters: [{ name: "id", in: "query", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": { description: "Policy details", content: { "application/json": { schema: { $ref: "#/components/schemas/Policy" } } } },
          "404": { description: "Policy not found" },
        },
        security: [{ bearerAuth: [] }],
      },
    },
    "/api/trpc/policy.create": {
      post: {
        tags: ["Policies"],
        summary: "Create new policy",
        requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/CreatePolicyRequest" } } } },
        responses: {
          "200": { description: "Policy created", content: { "application/json": { schema: { $ref: "#/components/schemas/Policy" } } } },
          "400": { description: "Validation error" },
        },
        security: [{ bearerAuth: [] }],
      },
    },
    "/api/trpc/claims.submit": {
      post: {
        tags: ["Claims"],
        summary: "Submit a new claim",
        requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/SubmitClaimRequest" } } } },
        responses: {
          "200": { description: "Claim submitted", content: { "application/json": { schema: { $ref: "#/components/schemas/Claim" } } } },
          "400": { description: "Validation error" },
          "404": { description: "Policy not found" },
        },
        security: [{ bearerAuth: [] }],
      },
    },
    "/api/trpc/claims.adjudicate": {
      post: {
        tags: ["Claims"],
        summary: "Adjudicate a claim",
        description: "Applies business rules: <₦50K auto-approved, >₦500K escalated, suspicious patterns flagged",
        requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/AdjudicateClaimRequest" } } } },
        responses: {
          "200": { description: "Adjudication result", content: { "application/json": { schema: { $ref: "#/components/schemas/AdjudicationResult" } } } },
        },
        security: [{ bearerAuth: [] }],
      },
    },
    "/api/trpc/kyc.verifyNIN": {
      post: {
        tags: ["KYC/KYB"],
        summary: "Verify National Identification Number",
        requestBody: { content: { "application/json": { schema: { type: "object", properties: { nin: { type: "string", pattern: "^\\d{11}$" }, customerId: { type: "string" } }, required: ["nin", "customerId"] } } } },
        responses: {
          "200": { description: "Verification result" },
          "422": { description: "Invalid NIN format" },
        },
        security: [{ bearerAuth: [] }],
      },
    },
    "/api/trpc/payments.processPayment": {
      post: {
        tags: ["Payments"],
        summary: "Process premium payment",
        description: "Processes payment via Mojaloop/TigerBeetle ledger",
        requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/PaymentRequest" } } } },
        responses: {
          "200": { description: "Payment processed" },
          "402": { description: "Insufficient funds" },
        },
        security: [{ bearerAuth: [] }],
      },
    },
    "/api/trpc/agent.register": {
      post: {
        tags: ["Agent Network"],
        summary: "Register a new agent",
        requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/AgentRegistrationRequest" } } } },
        responses: {
          "200": { description: "Agent registered" },
          "409": { description: "Agent already exists" },
        },
        security: [{ bearerAuth: [] }],
      },
    },
    "/api/trpc/ussd.processSession": {
      post: {
        tags: ["USSD"],
        summary: "Process USSD session input",
        requestBody: { content: { "application/json": { schema: { type: "object", properties: { sessionId: { type: "string" }, phoneNumber: { type: "string" }, input: { type: "string" }, serviceCode: { type: "string" } } } } } },
        responses: {
          "200": { description: "USSD response menu" },
        },
      },
    },
    "/api/trpc/compliance.generateNAICOMReturn": {
      post: {
        tags: ["Compliance"],
        summary: "Generate NAICOM quarterly return",
        requestBody: { content: { "application/json": { schema: { type: "object", properties: { quarter: { type: "string", enum: ["Q1", "Q2", "Q3", "Q4"] }, year: { type: "integer" } } } } } },
        responses: {
          "200": { description: "NAICOM return generated" },
        },
        security: [{ bearerAuth: [] }],
      },
    },
    "/api/health": {
      get: {
        tags: ["Admin"],
        summary: "Health check",
        responses: {
          "200": { description: "Service healthy", content: { "application/json": { schema: { type: "object", properties: { status: { type: "string" }, uptime: { type: "number" }, version: { type: "string" } } } } } },
        },
      },
    },
  },
  components: {
    schemas: {
      Policy: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          policyNumber: { type: "string", example: "POL-2026-001" },
          customerId: { type: "string", format: "uuid" },
          productType: { type: "string", enum: ["motor", "health", "life", "property", "travel", "marine", "agriculture"] },
          status: { type: "string", enum: ["draft", "active", "expired", "cancelled", "claimed"] },
          premiumAmount: { type: "number", example: 50000 },
          currency: { type: "string", default: "NGN" },
          startDate: { type: "string", format: "date" },
          endDate: { type: "string", format: "date" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      PolicyListResponse: {
        type: "object",
        properties: {
          items: { type: "array", items: { $ref: "#/components/schemas/Policy" } },
          total: { type: "integer" },
          limit: { type: "integer" },
          offset: { type: "integer" },
        },
      },
      CreatePolicyRequest: {
        type: "object",
        required: ["customerId", "productType", "premiumAmount", "startDate", "endDate"],
        properties: {
          customerId: { type: "string", format: "uuid" },
          productType: { type: "string" },
          premiumAmount: { type: "number", minimum: 1000 },
          startDate: { type: "string", format: "date" },
          endDate: { type: "string", format: "date" },
          beneficiaries: { type: "array", items: { type: "object", properties: { name: { type: "string" }, relationship: { type: "string" }, percentage: { type: "number" } } } },
        },
      },
      Claim: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          policyId: { type: "string", format: "uuid" },
          claimNumber: { type: "string" },
          type: { type: "string", enum: ["death", "accident", "theft", "damage", "health", "crop_loss"] },
          amount: { type: "number" },
          status: { type: "string", enum: ["submitted", "under_review", "approved", "rejected", "paid", "escalated"] },
          submittedAt: { type: "string", format: "date-time" },
          evidence: { type: "array", items: { type: "string", format: "uri" } },
        },
      },
      SubmitClaimRequest: {
        type: "object",
        required: ["policyId", "type", "amount", "description"],
        properties: {
          policyId: { type: "string", format: "uuid" },
          type: { type: "string" },
          amount: { type: "number", minimum: 0 },
          description: { type: "string", maxLength: 2000 },
          evidence: { type: "array", items: { type: "string", format: "uri" } },
          incidentDate: { type: "string", format: "date" },
        },
      },
      AdjudicateClaimRequest: {
        type: "object",
        required: ["claimId"],
        properties: {
          claimId: { type: "string", format: "uuid" },
          decision: { type: "string", enum: ["approve", "reject", "escalate"] },
          reason: { type: "string" },
        },
      },
      AdjudicationResult: {
        type: "object",
        properties: {
          claimId: { type: "string" },
          decision: { type: "string" },
          autoDecision: { type: "boolean" },
          ruleApplied: { type: "string" },
          amount: { type: "number" },
        },
      },
      PaymentRequest: {
        type: "object",
        required: ["policyId", "amount", "method"],
        properties: {
          policyId: { type: "string" },
          amount: { type: "number" },
          currency: { type: "string", default: "NGN" },
          method: { type: "string", enum: ["bank_transfer", "card", "ussd", "mobile_money", "mojaloop"] },
        },
      },
      AgentRegistrationRequest: {
        type: "object",
        required: ["name", "phone", "state", "lga"],
        properties: {
          name: { type: "string" },
          phone: { type: "string", pattern: "^\\+234\\d{10}$" },
          email: { type: "string", format: "email" },
          state: { type: "string" },
          lga: { type: "string" },
          bankAccount: { type: "object", properties: { bankCode: { type: "string" }, accountNumber: { type: "string" } } },
        },
      },
    },
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Keycloak-issued JWT token",
      },
      apiKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "X-API-Key",
        description: "API key for service-to-service communication",
      },
    },
  },
};

export function registerOpenApiDocs(app: Express) {
  // JSON spec endpoint
  app.get("/api/docs", (_req, res) => {
    res.json(OPENAPI_SPEC);
  });

  // Swagger UI (uses CDN)
  app.get("/api/docs/ui", (_req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>NGApp API Documentation</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({ url: '/api/docs', dom_id: '#swagger-ui', deepLinking: true });
  </script>
</body>
</html>`);
  });
}

export { OPENAPI_SPEC };
