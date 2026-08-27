/**
 * apiContract.contract.test.ts — public API contract over REAL HTTP.
 *
 * Boots the REAL express/tRPC server (server/_core/index.ts createApp()) on an
 * ephemeral port with a real Postgres database (PGlite wire server locally,
 * postgres:16 in CI) and asserts the CONTRACT every API consumer depends on:
 *
 *   Envelope shapes (superjson):
 *     - success: HTTP 200, body = { result: { data: { json: <payload> } } }
 *     - error:   HTTP 4xx/5xx, body = { error: { json: { message, code,
 *       data: { code, httpStatus, path } } } } (code = JSON-RPC numeric,
 *       data.code = tRPC string code)
 *
 *   Error taxonomy:
 *     - zod validation failure → 400 BAD_REQUEST (-32600) with the offending
 *       field names in the message and data.path set
 *     - anonymous on protectedProcedure → 401 UNAUTHORIZED (-32001)
 *     - non-admin on admin-only procedure → 403 FORBIDDEN (-32003)
 *     - unknown procedure path → 404 NOT_FOUND (-32004)
 *     - NOT_IMPLEMENTED stubs → 501 with a truthful "not implemented" message
 *       (and auth is still enforced first: anonymous → 401, not 501)
 *
 *   Pagination: limit caps are enforced (bounded), sane limits accepted.
 *
 *   Domain surfaces (SHAPES, not just statuses): health, auth session,
 *   policies, claims, disputes+refunds, agent, transactions.
 *
 * Behavioral flows (refund happy path, supervisor tier, idempotent
 * replay/CONFLICT over HTTP) are owned by tests/e2e/httpApi.e2e.test.ts
 * §6/§7/§7b and are deliberately referenced, not duplicated.
 *
 * Single file by design: the suite shares ONE booted server in a single
 * fork; multiple files would race on boot/shutdown of the shared DB pool
 * and Redis client.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  bootServer,
  shutdownServer,
  apiUrl,
  sessionCookieFor,
  e2eAdmin,
  e2eAgent,
} from "../e2e/helpers/http";
import {
  rawTrpcGet,
  rawTrpcPost,
  expectSuccessEnvelope,
  expectErrorEnvelope,
} from "./helpers/rawHttp";

let adminCookie: string;
let agentCookie: string;

// Dedicated identity for the logout tests (F6-1): auth.logout blacklists the
// PRESENTED token server-side. Two JWTs with identical claims minted within
// the same second are byte-identical, so a disposable cookie for e2eAdmin
// could collide with — and poison — the shared adminCookie. A distinct sub
// makes the logout cookie disjoint by construction.
const e2eLogoutUser = {
  keycloakSub: "e2e-logout-sub-0003",
  name: "E2E Logout",
  email: "e2e-logout@e2e.local",
  role: "admin" as const,
};

describe("CONTRACT — real server, real middleware chain, real DB", () => {
  beforeAll(async () => {
    await bootServer();
    adminCookie = await sessionCookieFor(e2eAdmin);
    agentCookie = await sessionCookieFor(e2eAgent);
  }, 180_000);

  afterAll(async () => {
    await shutdownServer();
  });

  // ════════════════════════════════════════════════════════════════════════
  // 1. superjson envelope shapes
  // ════════════════════════════════════════════════════════════════════════
  describe("envelope shapes", () => {
    it("success query answers 200 with {result:{data:{json}}}", async () => {
      const raw = await rawTrpcGet("system.health", { timestamp: 0 });
      const json = expectSuccessEnvelope(raw);
      expect(json).toEqual({ ok: true });
    });

    it("success mutation answers 200 with the same envelope", async () => {
      // F6-1: auth.logout REVOKES the presented session token server-side
      // (per-token blacklist). Use a disposable freshly-minted cookie so the
      // shared adminCookie is not poisoned for the rest of the suite.
      const disposableCookie = await sessionCookieFor(e2eLogoutUser);
      const raw = await rawTrpcPost("auth.logout", null, disposableCookie);
      const json = expectSuccessEnvelope(raw);
      expect(json).toEqual({ success: true });
    });

    it("null payload (auth.me anonymous) is a valid success envelope", async () => {
      const raw = await rawTrpcGet("auth.me");
      const json = expectSuccessEnvelope(raw);
      expect(json).toBeNull();
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // 2. Validation / auth / stub / routing error taxonomy
  // ════════════════════════════════════════════════════════════════════════
  describe("error taxonomy", () => {
    it("malformed input answers 400 BAD_REQUEST with field detail and path", async () => {
      const raw = await rawTrpcPost(
        "disputeRefund.initiateRefund",
        {
          disputeId: "not-a-number",
          amount: -100, // violates .positive()
          reason: "short", // violates .min(10)
          customerId: 1,
          accountNumber: "0123456789",
        },
        adminCookie
      );
      const err = expectErrorEnvelope(raw, 400, "BAD_REQUEST");
      expect(err.code).toBe(-32600); // JSON-RPC invalid-request / tRPC BAD_REQUEST
      expect(err.data.path).toBe("disputeRefund.initiateRefund");
      // Offending zod fields must be identifiable by the caller.
      expect(err.message).toContain("amount");
      expect(err.message).toContain("reason");
    });

    it("missing required input on a query answers 400 with the field named", async () => {
      const raw = await rawTrpcGet("system.health", {});
      const err = expectErrorEnvelope(raw, 400, "BAD_REQUEST");
      expect(err.message).toContain("timestamp");
      expect(err.data.path).toBe("system.health");
    });

    it("anonymous protectedProcedure call answers 401 UNAUTHORIZED", async () => {
      const raw = await rawTrpcGet("disputeRefund.getSummary");
      const err = expectErrorEnvelope(raw, 401, "UNAUTHORIZED");
      expect(err.code).toBe(-32001);
      expect(err.data.path).toBe("disputeRefund.getSummary");
    });

    it("garbage session cookie is treated as anonymous (401, not 500)", async () => {
      const raw = await rawTrpcGet(
        "disputeRefund.getSummary",
        undefined,
        "kc_session=not-a-real-jwt"
      );
      expectErrorEnvelope(raw, 401, "UNAUTHORIZED");
    });

    it("non-admin on an admin-only procedure answers 403 FORBIDDEN", async () => {
      const raw = await rawTrpcGet("transactions.statsByType", undefined, agentCookie);
      const err = expectErrorEnvelope(raw, 403, "FORBIDDEN");
      expect(err.code).toBe(-32003);
      expect(err.data.path).toBe("transactions.statsByType");
    });

    it("analyticsDashboard.kpiSummary stub answers 501 NOT_IMPLEMENTED", async () => {
      const raw = await rawTrpcGet("analyticsDashboard.kpiSummary", undefined, adminCookie);
      const err = expectErrorEnvelope(raw, 501, "NOT_IMPLEMENTED");
      expect(err.message).toMatch(/not implemented/i);
    });

    it("agentClusterAnalytics.getStats stub answers 501 NOT_IMPLEMENTED", async () => {
      const raw = await rawTrpcGet(
        "agentClusterAnalytics.getStats",
        undefined,
        adminCookie
      );
      const err = expectErrorEnvelope(raw, 501, "NOT_IMPLEMENTED");
      expect(err.message).toMatch(/not implemented/i);
    });

    it("agentClusterAnalytics.optimizeNetwork stub mutation answers 501", async () => {
      const raw = await rawTrpcPost(
        "agentClusterAnalytics.optimizeNetwork",
        {},
        adminCookie
      );
      const err = expectErrorEnvelope(raw, 501, "NOT_IMPLEMENTED");
      expect(err.message).toMatch(/not implemented/i);
    });

    it("stubs are auth-gated first: anonymous call answers 401, not 501", async () => {
      const raw = await rawTrpcGet("analyticsDashboard.kpiSummary");
      expectErrorEnvelope(raw, 401, "UNAUTHORIZED");
    });

    it("unknown procedure path answers 404 NOT_FOUND in the error envelope", async () => {
      const raw = await rawTrpcGet("noSuchRouter.noSuchProcedure", undefined, adminCookie);
      const err = expectErrorEnvelope(raw, 404, "NOT_FOUND");
      expect(err.code).toBe(-32004);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // 3. Pagination: accepted and bounded
  // ════════════════════════════════════════════════════════════════════════
  describe("pagination contract", () => {
    it("disputeRefund.list accepts bounded pagination and echoes it", async () => {
      const raw = await rawTrpcGet(
        "disputeRefund.list",
        { limit: 1, offset: 0, status: "all" },
        adminCookie
      );
      const json = expectSuccessEnvelope(raw);
      expect(json.limit).toBe(1);
      expect(json.offset).toBe(0);
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.data.length).toBeLessThanOrEqual(1);
      expect(typeof json.total).toBe("number");
    });

    it("disputeRefund.list rejects limit above the 100 cap with 400 naming 'limit'", async () => {
      const raw = await rawTrpcGet(
        "disputeRefund.list",
        { limit: 101, offset: 0, status: "all" },
        adminCookie
      );
      const err = expectErrorEnvelope(raw, 400, "BAD_REQUEST");
      expect(err.message).toContain("limit");
    });

    it("agent.list rejects limit above the 200 cap with 400 naming 'limit'", async () => {
      const raw = await rawTrpcGet("agent.list", { page: 1, limit: 201 }, adminCookie);
      const err = expectErrorEnvelope(raw, 400, "BAD_REQUEST");
      expect(err.message).toContain("limit");
    });

    it("transactions.listCursor rejects limit above the 100 cap (validation precedes handler)", async () => {
      const raw = await rawTrpcGet("transactions.listCursor", { limit: 101 }, adminCookie);
      const err = expectErrorEnvelope(raw, 400, "BAD_REQUEST");
      expect(err.message).toContain("limit");
    });

    it("out-of-enum status filter answers 400 naming 'status'", async () => {
      const raw = await rawTrpcGet(
        "disputeRefund.list",
        { limit: 10, offset: 0, status: "bogus" },
        adminCookie
      );
      const err = expectErrorEnvelope(raw, 400, "BAD_REQUEST");
      expect(err.message).toContain("status");
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // 4. Domain surfaces — shapes, not just statuses
  // ════════════════════════════════════════════════════════════════════════
  describe("health surface", () => {
    it("GET /api/health answers the documented liveness shape", async () => {
      const res = await fetch(apiUrl("/api/health"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("ok");
      expect(body.checks).toBeTypeOf("object");
      expect(body.checks.db).toBe("connected");
      expect(typeof body.latencies.db).toBe("number");
      expect(typeof body.timestamp).toBe("string");
      // ISO-8601 timestamp.
      expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    });

    it("system.health tRPC liveness answers {ok:true}", async () => {
      const raw = await rawTrpcGet("system.health", { timestamp: 0 });
      expect(expectSuccessEnvelope(raw)).toEqual({ ok: true });
    });
  });

  describe("auth session surface", () => {
    it("auth.me with a valid kc_session answers the user shape", async () => {
      const raw = await rawTrpcGet("auth.me", undefined, adminCookie);
      const me = expectSuccessEnvelope(raw);
      expect(me).toBeTypeOf("object");
      expect(me.keycloakSub).toBe("e2e-admin-sub-0001");
      expect(me.email).toBe("e2e-admin@e2e.local");
      expect(me.role).toBe("admin");
      expect(typeof me.id).toBe("number");
      // Never leaks credential material.
      expect(me).not.toHaveProperty("password");
      expect(me).not.toHaveProperty("pinHash");
    });

    it("auth.logout mutation answers {success:true}", async () => {
      // F6-1: logout blacklists the session token. Mint a disposable cookie
      // (never the shared adminCookie) and prove the revoked token dies.
      const disposableCookie = await sessionCookieFor(e2eLogoutUser);
      const raw = await rawTrpcPost("auth.logout", null, disposableCookie);
      expect(expectSuccessEnvelope(raw)).toEqual({ success: true });
      // The revoked token no longer resolves a session (auth.me → null).
      const after = await rawTrpcGet("auth.me", undefined, disposableCookie);
      expect(expectSuccessEnvelope(after)).toBeNull();
    });
  });

  describe("policies surface", () => {
    it("insuranceWorkflows.listPolicies answers {policies[], total}", async () => {
      const raw = await rawTrpcGet(
        "insuranceWorkflows.listPolicies",
        { limit: 5, offset: 0 },
        adminCookie
      );
      const json = expectSuccessEnvelope(raw);
      expect(Array.isArray(json.policies)).toBe(true);
      expect(json.policies.length).toBeLessThanOrEqual(5);
      expect(typeof json.total).toBe("number");
    });

    it("insuranceWorkflows.getPolicyById answers null for an unknown id (not 500)", async () => {
      const raw = await rawTrpcGet(
        "insuranceWorkflows.getPolicyById",
        { policyId: 999_999_999 },
        adminCookie
      );
      expect(expectSuccessEnvelope(raw)).toBeNull();
    });

    it("insuranceWorkflows.getPolicyById rejects a non-numeric id with 400", async () => {
      const raw = await rawTrpcGet(
        "insuranceWorkflows.getPolicyById",
        { policyId: "POL-1" },
        adminCookie
      );
      const err = expectErrorEnvelope(raw, 400, "BAD_REQUEST");
      expect(err.message).toContain("policyId");
    });
  });

  describe("claims surface", () => {
    it("insuranceWorkflows.listClaims answers {claims[], total}", async () => {
      const raw = await rawTrpcGet(
        "insuranceWorkflows.listClaims",
        { limit: 5, offset: 0 },
        adminCookie
      );
      const json = expectSuccessEnvelope(raw);
      expect(Array.isArray(json.claims)).toBe(true);
      expect(typeof json.total).toBe("number");
    });

    it("insuranceWorkflows.getClaimById answers null for an unknown id", async () => {
      const raw = await rawTrpcGet(
        "insuranceWorkflows.getClaimById",
        { claimId: 999_999_999 },
        adminCookie
      );
      expect(expectSuccessEnvelope(raw)).toBeNull();
    });

    it("insuranceWorkflows.fileClaim malformed input answers 400 naming the fields", async () => {
      const raw = await rawTrpcPost(
        "insuranceWorkflows.fileClaim",
        {
          policyId: "not-a-number",
          claimType: 42,
          claimedAmount: "a lot",
        },
        adminCookie
      );
      const err = expectErrorEnvelope(raw, 400, "BAD_REQUEST");
      expect(err.data.path).toBe("insuranceWorkflows.fileClaim");
      expect(err.message).toContain("policyId");
      expect(err.message).toContain("claimType");
    });

    it("insuranceWorkflows.fileClaim on an unknown policy answers 404 NOT_FOUND", async () => {
      const raw = await rawTrpcPost(
        "insuranceWorkflows.fileClaim",
        {
          policyId: 999_999_999,
          claimType: "motor",
          incidentDate: "2024-01-15",
          claimedAmount: 1000,
          incidentDescription: "Contract test: policy must not exist",
        },
        adminCookie
      );
      const err = expectErrorEnvelope(raw, 404, "NOT_FOUND");
      expect(err.message).toMatch(/policy not found/i);
    });
  });

  describe("disputes + refunds surface", () => {
    // NOTE: refund initiation happy path, supervisor tier, and the idempotency
    // contract (replay + key-reuse CONFLICT over HTTP) are asserted
    // end-to-end in tests/e2e/httpApi.e2e.test.ts §6/§7/§7b — referenced,
    // not duplicated.
    it("disputeRefund.getSummary answers the aggregate shape", async () => {
      const raw = await rawTrpcGet("disputeRefund.getSummary", undefined, adminCookie);
      const json = expectSuccessEnvelope(raw);
      for (const key of [
        "totalDisputes",
        "pendingRefunds",
        "processedToday",
        "totalRefundedAmount",
        "avgProcessingTime",
      ]) {
        expect(typeof json[key]).toBe("number");
      }
      expect(Number.isNaN(Date.parse(json.lastUpdated))).toBe(false);
    });

    it("disputeRefund.getRefundPolicy answers the published policy tiers", async () => {
      const raw = await rawTrpcGet("disputeRefund.getRefundPolicy", undefined, adminCookie);
      const json = expectSuccessEnvelope(raw);
      expect(Array.isArray(json.tiers)).toBe(true);
      expect(json.tiers.length).toBeGreaterThan(0);
      for (const tier of json.tiers) {
        expect(typeof tier.maxAmount).toBe("string");
        expect(typeof tier.approval).toBe("string");
        expect(typeof tier.slaHours).toBe("number");
        expect(typeof tier.requiresFraudCheck).toBe("boolean");
      }
      expect(typeof json.dailyAgentCap).toBe("number");
      expect(typeof json.maxRefundsPerCustomer30d).toBe("number");
    });

    it("disputeRefund.list rows carry the documented refund-tier enrichment", async () => {
      const raw = await rawTrpcGet(
        "disputeRefund.list",
        { limit: 50, offset: 0, status: "all" },
        adminCookie
      );
      const json = expectSuccessEnvelope(raw);
      expect(Array.isArray(json.data)).toBe(true);
      for (const row of json.data) {
        expect(["auto", "supervisor", "executive"]).toContain(row.refundTier);
        expect(typeof row.slaHours).toBe("number");
        expect(typeof row.requiresFraudCheck).toBe("boolean");
        expect(Number.isNaN(Date.parse(row.slaDeadline))).toBe(false);
      }
    });
  });

  describe("agent surface", () => {
    it("agent.list answers the paginated {agents[], total, page, limit} shape", async () => {
      const raw = await rawTrpcGet("agent.list", { page: 1, limit: 1 }, adminCookie);
      const json = expectSuccessEnvelope(raw);
      expect(Array.isArray(json.agents)).toBe(true);
      expect(json.agents.length).toBeLessThanOrEqual(1);
      expect(typeof json.total).toBe("number");
      expect(json.page).toBe(1);
      expect(json.limit).toBe(1);
    });

    it("agent.me without an agent_session cookie answers null (not an error)", async () => {
      const raw = await rawTrpcGet("agent.me", undefined, adminCookie);
      expect(expectSuccessEnvelope(raw)).toBeNull();
    });

    it("agent.login with bad credentials answers 401 without user enumeration", async () => {
      const raw = await rawTrpcPost(
        "agent.login",
        { agentId: "NO-SUCH-AGENT", pin: "0000" },
        undefined
      );
      const err = expectErrorEnvelope(raw, 401, "UNAUTHORIZED");
      // Same generic message for unknown agent and wrong PIN.
      expect(err.message).toBe("Invalid agent ID or PIN");
    });

    it("agent.login malformed input answers 400 naming agentId/pin", async () => {
      const raw = await rawTrpcPost("agent.login", { agentId: "x", pin: "ab" }, undefined);
      const err = expectErrorEnvelope(raw, 400, "BAD_REQUEST");
      expect(err.message).toContain("agentId");
      expect(err.message).toContain("pin");
    });
  });

  describe("transactions surface", () => {
    it("transactions.statsByType (admin) answers an array of aggregate rows", async () => {
      const raw = await rawTrpcGet("transactions.statsByType", undefined, adminCookie);
      const json = expectSuccessEnvelope(raw);
      expect(Array.isArray(json)).toBe(true);
      for (const row of json) {
        expect(typeof row.type).toBe("string");
        expect(typeof row.count).toBe("number");
        expect(typeof row.volume).toBe("number");
        expect(typeof row.percentage).toBe("number");
      }
    });

    it("transactions.list requires an agent session: staff cookie alone answers 401", async () => {
      const raw = await rawTrpcGet(
        "transactions.list",
        { limit: 10, offset: 0 },
        adminCookie
      );
      const err = expectErrorEnvelope(raw, 401, "UNAUTHORIZED");
      expect(err.message).toMatch(/agent session required/i);
    });

    it("transactions.list anonymous answers 401 UNAUTHORIZED", async () => {
      const raw = await rawTrpcGet("transactions.list", { limit: 10, offset: 0 });
      expectErrorEnvelope(raw, 401, "UNAUTHORIZED");
    });
  });
});
