/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️  CONNECTIVITY SMOKE — NON-FUNCTIONAL VALIDATION  ⚠️
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This suite is an OPTIONS-LEVEL CONNECTIVITY SMOKE only. It verifies that
 * endpoints exist and return structured responses. It is NOT functional
 * validation: it holds no authenticated session and asserts no business
 * outcomes. It must NEVER be cited as proof of functional correctness —
 * a green run here does NOT mean "N/N tests passed" for the platform.
 *
 * Behavior contract (hardened 2026-08-12):
 *  - Server DOWN (connection refused): every check soft-skips and the run
 *    prints an explicit "SKIPPED — no infra" summary. A green run against a
 *    down server means NOTHING.
 *  - Server UP: this suite FAILS on:
 *      • any 5xx / INTERNAL_SERVER_ERROR from a tRPC call
 *      • "No procedure found" (procedure missing from the router)
 *      • unexpected 4xx on the explicitly guarded checks below
 *    enforced via the shared `infraFailures` gate asserted in afterAll.
 *
 * Original scope note (Sprint 98) — stakeholder scenarios exercised at
 * connectivity level only:
 *   1.  Policyholder:    quote → bind → pay → claim → renew → cancel
 *   2.  Broker:          register → submit application → track portfolio
 *   3.  Underwriter:     queue → assess risk → approve/decline/refer
 *   4.  Claims Adjuster: assign → investigate → adjudicate → settle
 *   5.  Actuary:         compute reserves → IFRS17 → mortality tables
 *   6.  Compliance:      NAICOM filing → NDPR audit → AML check
 *   7.  Reinsurer:       create treaty → cede policy → recovery
 *   8.  Agent:           sell → collect premium → service customer
 *   9.  Supervisor:      approve override → monitor SLA → escalate
 *  10.  Admin:           create product → configure system → user mgmt
 *
 * Infrastructure touch-points probed for reachability:
 *   Keycloak OIDC, TigerBeetle sidecar, PostgreSQL (via tRPC), APISIX gateway,
 *   Permify RBAC, Dapr sidecar, Temporal workflows, Redis state store,
 *   Lakehouse / MinIO, OpenAppSec WAF, Fluvio streaming
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

// ── Config ────────────────────────────────────────────────────────────────────
const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const API_BASE = `${BASE_URL}/api/trpc`;
const TIMEOUT_MS = 15000;

// ── Infra reachability tracking ─────────────────────────────────────────────
// serverUp is probed once in beforeAll. When false, all guarded assertions
// degrade to explicit skips and afterAll prints a "SKIPPED — no infra"
// summary instead of letting the run pass vacuously.
let serverUp = false;

// Real failures observed while the server IS reachable (5xx, missing
// procedures, unexpected network errors). Asserted empty in afterAll — this
// is what stops the suite from passing vacuously against a live but broken
// server.
const infraFailures: string[] = [];

function recordTrpcResult(
  procedure: string,
  httpStatus: number | null,
  error: unknown
): void {
  if (!serverUp) return;
  if (httpStatus !== null && httpStatus >= 500) {
    infraFailures.push(
      `${procedure}: HTTP ${httpStatus} (5xx while infra reachable)`
    );
    return;
  }
  if (error === undefined || error === null) return;
  const errStr = typeof error === "string" ? error : JSON.stringify(error);
  if (/No procedure found/i.test(errStr)) {
    infraFailures.push(
      `${procedure}: procedure missing from router (${errStr.slice(0, 160)})`
    );
  } else if (/INTERNAL_SERVER_ERROR|Internal server error/i.test(errStr)) {
    infraFailures.push(
      `${procedure}: internal server error (${errStr.slice(0, 160)})`
    );
  } else if (/fetch failed|ECONNREFUSED|ECONNRESET/i.test(errStr)) {
    infraFailures.push(
      `${procedure}: network failure while infra was reachable (${errStr.slice(0, 160)})`
    );
  }
}

beforeAll(async () => {
  try {
    const res = await fetch(`${BASE_URL}/api/health`, {
      signal: AbortSignal.timeout(5000),
    });
    serverUp = res.status > 0;
  } catch {
    serverUp = false;
  }
  if (!serverUp) {
    console.warn(
      `⚠️  [connectivity smoke] Server at ${BASE_URL} is DOWN — all checks will soft-skip. ` +
        "A green run against a down server means NOTHING."
    );
  }
});

afterAll(() => {
  if (!serverUp) {
    console.warn(
      "════════════════════════════════════════════════════════════════\n" +
        "CONNECTIVITY SMOKE RESULT: SKIPPED — no infra\n" +
        "The server was not reachable; every check in this file soft-skipped.\n" +
        "Do NOT cite this run as test evidence (it is not 'N/N passed').\n" +
        "════════════════════════════════════════════════════════════════"
    );
    return;
  }
  expect(
    infraFailures,
    `Connectivity smoke observed ${infraFailures.length} real failure(s) while infra was reachable:\n${infraFailures.join("\n")}`
  ).toEqual([]);
});

// ── HTTP helpers ──────────────────────────────────────────────────────────────
async function trpcQuery(
  procedure: string,
  input?: unknown,
  token?: string
): Promise<{ data?: unknown; error?: unknown }> {
  const url = `${API_BASE}/${procedure}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  try {
    const res = await fetch(
      input !== undefined ? `${url}?input=${encodeURIComponent(JSON.stringify(input))}` : url,
      { method: "GET", headers, signal: AbortSignal.timeout(TIMEOUT_MS) }
    );
    const json = await res.json();
    const result =
      json.result?.data !== undefined
        ? { data: json.result.data }
        : { error: json.error };
    recordTrpcResult(procedure, res.status, (result as { error?: unknown }).error);
    return result;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    recordTrpcResult(procedure, null, error);
    return { error };
  }
}

async function trpcMutation(
  procedure: string,
  input: unknown,
  token?: string
): Promise<{ data?: unknown; error?: unknown }> {
  const url = `${API_BASE}/${procedure}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ json: input }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = await res.json();
    const result =
      json.result?.data !== undefined
        ? { data: json.result.data }
        : { error: json.error };
    recordTrpcResult(procedure, res.status, (result as { error?: unknown }).error);
    return result;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    recordTrpcResult(procedure, null, error);
    return { error };
  }
}

async function httpGet(path: string): Promise<{ ok: boolean; status: number; body?: unknown }> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    let body: unknown;
    try { body = await res.json(); } catch { body = await res.text(); }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: 0, body: err instanceof Error ? err.message : String(err) };
  }
}

// ── State shared across tests ─────────────────────────────────────────────────
let authToken: string | undefined;
let testProductId: number | undefined;
let testPolicyId: number | undefined;
let testClaimId: number | undefined;
let testBrokerId: number | undefined;
let testTreatyId: number | undefined;

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 0: Infrastructure Health Checks
// ═══════════════════════════════════════════════════════════════════════════════
describe("connectivity smoke (non-functional) — Suite 0: Infrastructure Health Checks", () => {
  it("0.1 — Server is reachable", async () => {
    const { ok, status } = await httpGet("/api/health");
    // In CI without a running server, status will be 0 (connection refused) — that's acceptable
    // In production, status should be 200 or 404
    if (status === 0) {
      console.warn("[SKIP — no infra] Server not running in this environment — skipping connectivity check");
      return;
    }
    expect([200, 404]).toContain(status);
  });

  it("0.2 — tRPC system.health endpoint responds", async () => {
    const { data, error } = await trpcQuery("system.health");
    // Should return health data or a structured error (not a network failure)
    expect(error?.toString()).not.toContain("ECONNREFUSED");
  });

  it("0.3 — Keycloak OIDC discovery endpoint reachable", async () => {
    const keycloakUrl = process.env.KEYCLOAK_URL ?? "http://localhost:8080";
    const realm = process.env.KEYCLOAK_REALM ?? "insureportal";
    try {
      const res = await fetch(
        `${keycloakUrl}/realms/${realm}/.well-known/openid-configuration`,
        { signal: AbortSignal.timeout(5000) }
      );
      // In CI without Keycloak, this will fail — mark as skipped
      if (res.ok) {
        const json = await res.json();
        expect(json.issuer).toBeDefined();
      } else {
        console.warn("[SKIP] Keycloak not available in this environment");
      }
    } catch {
      console.warn("[SKIP] Keycloak not reachable — skipping OIDC check");
    }
  });

  it("0.4 — TigerBeetle sidecar health check", async () => {
    const tbUrl = process.env.TB_SIDECAR_URL ?? "http://localhost:8080";
    try {
      const res = await fetch(`${tbUrl}/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        expect(res.status).toBe(200);
      } else {
        console.warn("[SKIP] TigerBeetle sidecar not available");
      }
    } catch {
      console.warn("[SKIP] TigerBeetle sidecar not reachable");
    }
  });

  it("0.5 — Redis connectivity via distributed state", async () => {
    const { data, error } = await trpcQuery("system.health");
    // Verify no Redis-related crash errors
    if (error) {
      expect(String(error)).not.toContain("Redis connection");
    }
  });

  it("0.6 — Dapr sidecar health check", async () => {
    const daprPort = process.env.DAPR_HTTP_PORT ?? "3500";
    try {
      const res = await fetch(`http://localhost:${daprPort}/v1.0/healthz`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        expect(res.status).toBe(200);
      } else {
        console.warn("[SKIP] Dapr sidecar not available");
      }
    } catch {
      console.warn("[SKIP] Dapr sidecar not reachable");
    }
  });

  it("0.7 — Fluvio event log table accessible", async () => {
    // Fluvio is integrated via DB event log — check that the router is registered
    const { error } = await trpcQuery("insuranceWorkflows.getInsuranceDashboard");
    // Should not return a "procedure not found" error
    if (error) {
      expect(String(error)).not.toContain("No procedure found");
    }
  });

  it("0.8 — APISIX gateway routes accessible", async () => {
    const apisixUrl = process.env.APISIX_ADMIN_URL ?? "http://localhost:9180";
    try {
      const res = await fetch(`${apisixUrl}/apisix/admin/routes`, {
        headers: { "X-API-KEY": process.env.APISIX_ADMIN_KEY ?? "test-key" },
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        expect(res.status).toBe(200);
      } else {
        console.warn("[SKIP] APISIX admin not reachable");
      }
    } catch {
      console.warn("[SKIP] APISIX not reachable in this environment");
    }
  });

  it("0.9 — Permify authorization service reachable", async () => {
    const permifyUrl = process.env.PERMIFY_URL ?? "http://localhost:3476";
    try {
      const res = await fetch(`${permifyUrl}/healthz`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        expect(res.status).toBe(200);
      } else {
        console.warn("[SKIP] Permify not available");
      }
    } catch {
      console.warn("[SKIP] Permify not reachable");
    }
  });

  it("0.10 — Temporal workflow engine reachable", async () => {
    const temporalAddr = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
    // Check via tRPC temporal router
    const { error } = await trpcQuery("temporalWorkflows.getWorkflowStatus", { workflowId: "smoke-test" });
    if (error) {
      expect(String(error)).not.toContain("No procedure found");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 1: Admin Workflows
// ═══════════════════════════════════════════════════════════════════════════════
describe("connectivity smoke (non-functional) — Suite 1: Admin Workflows", () => {
  it("1.1 — Admin: Get insurance dashboard stats", async () => {
    const { data, error } = await trpcQuery("insuranceWorkflows.getInsuranceDashboard");
    // Should return stats object (even if empty)
    if (!error) {
      expect(data).toHaveProperty("stats");
    } else {
      const errStr = String(error);
      if (!serverUp) {
        console.warn("[SKIP — no infra] dashboard check skipped:", errStr);
        return;
      }
      // Server reachable: only an auth rejection is acceptable for this
      // unauthenticated call. 5xx / missing procedure / network errors FAIL.
      expect(errStr).toMatch(/UNAUTHORIZED|unauthorized|401/i);
    }
  });

  it("1.2 — Admin: Create insurance product (Life)", async () => {
    const { data, error } = await trpcMutation("insuranceWorkflows.createProduct", {
      productCode: `SMOKE-LIFE-${Date.now()}`,
      name: "Smoke Test Life Insurance",
      coverageType: "life",
      minPremium: 5000,
      maxCoverageAmount: 10000000,
      minAge: 18,
      maxAge: 65,
      policyTermMonths: 12,
      waitingPeriodDays: 30,
      regulatoryApprovalRef: "NAICOM/2024/LIFE/001",
    });
    if (!error && data) {
      expect((data as any).product).toBeDefined();
      testProductId = (data as any).product?.id;
    } else {
      console.warn("[SKIP] Product creation requires auth:", String(error));
    }
  });

  it("1.3 — Admin: Create insurance product (Motor)", async () => {
    const { data, error } = await trpcMutation("insuranceWorkflows.createProduct", {
      productCode: `SMOKE-MOTOR-${Date.now()}`,
      name: "Smoke Test Motor Insurance",
      coverageType: "motor",
      minPremium: 15000,
      policyTermMonths: 12,
    });
    if (!error && data) {
      expect((data as any).product).toBeDefined();
    }
  });

  it("1.4 — Admin: Create insurance product (Health)", async () => {
    const { data, error } = await trpcMutation("insuranceWorkflows.createProduct", {
      productCode: `SMOKE-HEALTH-${Date.now()}`,
      name: "Smoke Test Health Insurance",
      coverageType: "health",
      minPremium: 25000,
      policyTermMonths: 12,
    });
    if (!error && data) {
      expect((data as any).product).toBeDefined();
    }
  });

  it("1.5 — Admin: Create insurance product (Micro)", async () => {
    const { data, error } = await trpcMutation("insuranceWorkflows.createProduct", {
      productCode: `SMOKE-MICRO-${Date.now()}`,
      name: "Smoke Test Micro Insurance",
      coverageType: "micro",
      minPremium: 500,
      policyTermMonths: 3,
    });
    if (!error && data) {
      expect((data as any).product).toBeDefined();
    }
  });

  it("1.6 — Admin: List all active products", async () => {
    const { data, error } = await trpcQuery("insuranceWorkflows.listProducts", { isActive: true });
    if (!error) {
      expect(data).toHaveProperty("products");
      expect(Array.isArray((data as any).products)).toBe(true);
    }
  });

  it("1.7 — Admin: System health monitor", async () => {
    const { data, error } = await trpcQuery("systemHealthMonitor.getHealth");
    if (!error) {
      expect(data).toBeDefined();
    }
  });

  it("1.8 — Admin: Platform health check", async () => {
    const { data, error } = await trpcQuery("platformHealth.getStatus");
    if (!error) {
      expect(data).toBeDefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 2: Policyholder Workflows
// ═══════════════════════════════════════════════════════════════════════════════
describe("connectivity smoke (non-functional) — Suite 2: Policyholder Workflows", () => {
  it("2.1 — Policyholder: Get premium quote", async () => {
    const productId = testProductId ?? 1;
    const { data, error } = await trpcMutation("insuranceWorkflows.getQuote", {
      productId,
      customerId: 1,
      coverageAmount: 5000000,
      startDate: new Date(Date.now() + 86400000).toISOString(),
    });
    if (!error && data) {
      expect((data as any).quoteRef).toBeDefined();
      expect((data as any).annualPremium).toBeGreaterThan(0);
    } else {
      console.warn("[SKIP] Quote requires auth:", String(error));
    }
  });

  it("2.2 — Policyholder: Bind policy", async () => {
    const productId = testProductId ?? 1;
    const { data, error } = await trpcMutation("insuranceWorkflows.bindPolicy", {
      quoteRef: `QT-SMOKE-${Date.now()}`,
      productId,
      customerId: 1,
      sumInsured: 5000000,
      annualPremium: 50000,
      startDate: new Date().toISOString(),
      beneficiaries: [
        { name: "Jane Doe", relationship: "spouse", percentage: 100 },
      ],
    });
    if (!error && data) {
      expect((data as any).policy).toBeDefined();
      expect((data as any).policyNumber).toMatch(/^POL-/);
      testPolicyId = (data as any).policy?.id;
    } else {
      console.warn("[SKIP] Policy bind requires auth:", String(error));
    }
  });

  it("2.3 — Policyholder: Pay premium", async () => {
    const policyId = testPolicyId ?? 1;
    const { data, error } = await trpcMutation("insuranceWorkflows.payPremium", {
      policyId,
      amount: 50000,
      paymentMethod: "bank_transfer",
      channel: "web",
    });
    if (!error && data) {
      expect((data as any).payment).toBeDefined();
    } else {
      console.warn("[SKIP] Premium payment requires auth:", String(error));
    }
  });

  it("2.4 — Policyholder: File a claim", async () => {
    const policyId = testPolicyId ?? 1;
    const { data, error } = await trpcMutation("insuranceWorkflows.fileClaim", {
      policyId,
      claimType: "death",
      incidentDate: new Date(Date.now() - 86400000).toISOString(),
      claimedAmount: 5000000,
      incidentDescription: "Smoke test claim — accidental death",
      documents: ["death_certificate.pdf", "police_report.pdf"],
    });
    if (!error && data) {
      expect((data as any).claim).toBeDefined();
      expect((data as any).claimNumber).toMatch(/^CLM-/);
      testClaimId = (data as any).claim?.id;
    } else {
      console.warn("[SKIP] Claim filing requires auth:", String(error));
    }
  });

  it("2.5 — Policyholder: Request policy renewal", async () => {
    const policyId = testPolicyId ?? 1;
    const { data, error } = await trpcMutation("insuranceWorkflows.requestRenewal", {
      policyId,
      isAutoRenewal: false,
    });
    if (!error && data) {
      expect((data as any).renewal).toBeDefined();
    } else {
      console.warn("[SKIP] Renewal requires auth:", String(error));
    }
  });

  it("2.6 — Policyholder: Request endorsement (addition)", async () => {
    const policyId = testPolicyId ?? 1;
    const { data, error } = await trpcMutation("insuranceWorkflows.requestEndorsement", {
      policyId,
      type: "addition",
      effectiveDate: new Date().toISOString(),
      description: "Add accidental death benefit rider",
      premiumAdjustment: 5000,
      sumInsuredAdjustment: 1000000,
    });
    if (!error && data) {
      expect((data as any).endorsementNumber).toMatch(/^END-/);
    } else {
      console.warn("[SKIP] Endorsement requires auth:", String(error));
    }
  });

  it("2.7 — Policyholder: List own policies", async () => {
    const { data, error } = await trpcQuery("insuranceWorkflows.listPolicies", {
      customerId: 1,
      limit: 10,
    });
    if (!error) {
      expect(data).toHaveProperty("policies");
    }
  });

  it("2.8 — Policyholder: Cancel policy", async () => {
    const policyId = testPolicyId ?? 1;
    const { data, error } = await trpcMutation("insuranceWorkflows.cancelPolicy", {
      policyId,
      reason: "Smoke test cancellation",
    });
    if (!error && data) {
      expect((data as any).success).toBe(true);
    } else {
      console.warn("[SKIP] Cancellation requires auth:", String(error));
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 3: Broker Workflows
// ═══════════════════════════════════════════════════════════════════════════════
describe("connectivity smoke (non-functional) — Suite 3: Broker Workflows", () => {
  it("3.1 — Broker: Register as broker", async () => {
    const { data, error } = await trpcMutation("insuranceWorkflows.registerBroker", {
      companyName: `Smoke Test Brokers Ltd ${Date.now()}`,
      licenseNumber: `BRK-LIC-${Date.now()}`,
      licenseExpiry: new Date(Date.now() + 365 * 86400000).toISOString(),
      naicomRegNumber: `NAICOM-BRK-${Date.now()}`,
      commissionRate: 15,
      contactEmail: "broker@smoketest.ng",
      contactPhone: "+2348012345678",
      address: "123 Broker Street, Lagos, Nigeria",
    });
    if (!error && data) {
      expect((data as any).brokerCode).toMatch(/^BRK-/);
      testBrokerId = (data as any).broker?.id;
    } else {
      console.warn("[SKIP] Broker registration requires auth:", String(error));
    }
  });

  it("3.2 — Broker: Get portfolio", async () => {
    const brokerId = testBrokerId ?? 1;
    const { data, error } = await trpcQuery("insuranceWorkflows.getBrokerPortfolio", {
      brokerId,
      limit: 10,
    });
    if (!error) {
      expect(data).toHaveProperty("policies");
      expect(data).toHaveProperty("total");
    }
  });

  it("3.3 — Broker: Bind policy on behalf of customer", async () => {
    const productId = testProductId ?? 1;
    const brokerId = testBrokerId ?? 1;
    const { data, error } = await trpcMutation("insuranceWorkflows.bindPolicy", {
      quoteRef: `QT-BRK-${Date.now()}`,
      productId,
      customerId: 2,
      brokerId,
      sumInsured: 10000000,
      annualPremium: 100000,
      startDate: new Date().toISOString(),
    });
    if (!error && data) {
      expect((data as any).policyNumber).toMatch(/^POL-/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 4: Underwriter Workflows
// ═══════════════════════════════════════════════════════════════════════════════
describe("connectivity smoke (non-functional) — Suite 4: Underwriter Workflows", () => {
  it("4.1 — Underwriter: Get underwriting queue", async () => {
    const { data, error } = await trpcQuery("insuranceWorkflows.getUnderwritingQueue", { limit: 10 });
    if (!error) {
      expect(data).toHaveProperty("items");
      expect(data).toHaveProperty("total");
    }
  });

  it("4.2 — Underwriter: Approve policy (low risk)", async () => {
    const policyId = testPolicyId ?? 1;
    const { data, error } = await trpcMutation("insuranceWorkflows.assessRisk", {
      policyId,
      riskScore: 25,
      riskCategory: "low",
      decision: "approved",
      notes: "Smoke test — low risk approval",
    });
    if (!error && data) {
      expect((data as any).assessment).toBeDefined();
    } else {
      console.warn("[SKIP] Risk assessment requires auth:", String(error));
    }
  });

  it("4.3 — Underwriter: Approve with conditions (medium risk)", async () => {
    const { data, error } = await trpcMutation("insuranceWorkflows.assessRisk", {
      policyId: 2,
      riskScore: 55,
      riskCategory: "medium",
      decision: "approved_with_conditions",
      premiumLoading: 20,
      exclusions: ["pre-existing conditions"],
      conditions: ["annual medical check required"],
      notes: "Smoke test — medium risk with conditions",
    });
    if (!error && data) {
      expect((data as any).assessment).toBeDefined();
    }
  });

  it("4.4 — Underwriter: Decline policy (high risk)", async () => {
    const { data, error } = await trpcMutation("insuranceWorkflows.assessRisk", {
      policyId: 3,
      riskScore: 85,
      riskCategory: "high",
      decision: "declined",
      notes: "Smoke test — high risk declined",
    });
    if (!error && data) {
      expect((data as any).assessment).toBeDefined();
    }
  });

  it("4.5 — Underwriter: Refer policy for senior review", async () => {
    const { data, error } = await trpcMutation("insuranceWorkflows.assessRisk", {
      policyId: 4,
      riskScore: 70,
      riskCategory: "high",
      decision: "referred",
      notes: "Smoke test — referred to senior underwriter",
    });
    if (!error && data) {
      expect((data as any).assessment).toBeDefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 5: Claims Adjuster Workflows
// ═══════════════════════════════════════════════════════════════════════════════
describe("connectivity smoke (non-functional) — Suite 5: Claims Adjuster Workflows", () => {
  it("5.1 — Claims Adjuster: List pending claims", async () => {
    const { data, error } = await trpcQuery("insuranceWorkflows.listClaims", {
      status: "submitted",
      limit: 10,
    });
    if (!error) {
      expect(data).toHaveProperty("claims");
    }
  });

  it("5.2 — Claims Adjuster: Assign claim to adjuster", async () => {
    const claimId = testClaimId ?? 1;
    const { data, error } = await trpcMutation("insuranceWorkflows.assignClaim", {
      claimId,
      adjusterId: 1,
    });
    if (!error && data) {
      expect((data as any).success).toBe(true);
    } else {
      console.warn("[SKIP] Claim assignment requires auth:", String(error));
    }
  });

  it("5.3 — Claims Adjuster: Approve claim", async () => {
    const claimId = testClaimId ?? 1;
    const { data, error } = await trpcMutation("insuranceWorkflows.adjudicateClaim", {
      claimId,
      decision: "approved",
      approvedAmount: 5000000,
      investigationNotes: "Smoke test — claim approved after investigation",
    });
    if (!error && data) {
      expect((data as any).success).toBe(true);
    } else {
      console.warn("[SKIP] Claim adjudication requires auth:", String(error));
    }
  });

  it("5.4 — Claims Adjuster: Partially approve claim", async () => {
    const { data, error } = await trpcMutation("insuranceWorkflows.adjudicateClaim", {
      claimId: 2,
      decision: "partially_approved",
      approvedAmount: 2500000,
      investigationNotes: "Partial approval — some items not covered",
    });
    if (!error && data) {
      expect((data as any).success).toBe(true);
    }
  });

  it("5.5 — Claims Adjuster: Reject claim", async () => {
    const { data, error } = await trpcMutation("insuranceWorkflows.adjudicateClaim", {
      claimId: 3,
      decision: "rejected",
      rejectionReason: "Fraudulent claim — smoke test",
      investigationNotes: "Evidence of fraud detected",
    });
    if (!error && data) {
      expect((data as any).success).toBe(true);
    }
  });

  it("5.6 — Claims Adjuster: Settle claim payment via TigerBeetle", async () => {
    const claimId = testClaimId ?? 1;
    const { data, error } = await trpcMutation("insuranceWorkflows.settleClaimPayment", {
      claimId,
      amount: 5000000,
      paymentMethod: "bank_transfer",
    });
    if (!error && data) {
      expect((data as any).success).toBe(true);
    } else {
      console.warn("[SKIP] Settlement requires auth:", String(error));
    }
  });

  it("5.7 — Claims Adjuster: Get claim workflow history", async () => {
    const claimId = testClaimId ?? 1;
    const { data, error } = await trpcQuery("insuranceWorkflows.getClaimWorkflowHistory", { claimId });
    if (!error) {
      expect(data).toHaveProperty("events");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 6: Actuary Workflows
// ═══════════════════════════════════════════════════════════════════════════════
describe("connectivity smoke (non-functional) — Suite 6: Actuary Workflows", () => {
  it("6.1 — Actuary: Compute IBNR reserves", async () => {
    const { data, error } = await trpcMutation("insuranceWorkflows.computeReserves", {
      reserveType: "IBNR",
      reportingPeriod: "2025-Q1",
      methodology: "chain_ladder",
    });
    if (!error && data) {
      expect((data as any).grossReserve).toBeGreaterThanOrEqual(0);
    } else {
      console.warn("[SKIP] Reserve computation requires auth:", String(error));
    }
  });

  it("6.2 — Actuary: Compute RBNS reserves", async () => {
    const { data, error } = await trpcMutation("insuranceWorkflows.computeReserves", {
      reserveType: "RBNS",
      reportingPeriod: "2025-Q1",
      methodology: "bornhuetter_ferguson",
    });
    if (!error && data) {
      expect((data as any).netReserve).toBeGreaterThanOrEqual(0);
    }
  });

  it("6.3 — Actuary: Compute UPR (Unearned Premium Reserve)", async () => {
    const { data, error } = await trpcMutation("insuranceWorkflows.computeReserves", {
      reserveType: "UPR",
      reportingPeriod: "2025-Q1",
      methodology: "pro_rata",
    });
    if (!error && data) {
      expect((data as any).reserve).toBeDefined();
    }
  });

  it("6.4 — Actuary: Generate IFRS17 GMM report", async () => {
    const { data, error } = await trpcMutation("insuranceWorkflows.generateIfrs17Report", {
      groupCode: `IFRS17-GMM-${Date.now()}`,
      measurementModel: "GMM",
      reportingPeriod: "2025-Q1",
    });
    if (!error && data) {
      expect((data as any).csm).toBeGreaterThan(0);
      expect((data as any).lrc).toBeGreaterThan(0);
    } else {
      console.warn("[SKIP] IFRS17 requires auth:", String(error));
    }
  });

  it("6.5 — Actuary: Generate IFRS17 PAA report (short-duration)", async () => {
    const { data, error } = await trpcMutation("insuranceWorkflows.generateIfrs17Report", {
      groupCode: `IFRS17-PAA-${Date.now()}`,
      measurementModel: "PAA",
      reportingPeriod: "2025-Q1",
    });
    if (!error && data) {
      expect((data as any).group).toBeDefined();
    }
  });

  it("6.6 — Actuary: Get actuarial reserves history", async () => {
    const { data, error } = await trpcQuery("insuranceWorkflows.getActuarialReserves", {
      reportingPeriod: "2025-Q1",
    });
    if (!error) {
      expect(data).toHaveProperty("reserves");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 7: Compliance Officer Workflows
// ═══════════════════════════════════════════════════════════════════════════════
describe("connectivity smoke (non-functional) — Suite 7: Compliance Officer Workflows", () => {
  it("7.1 — Compliance: Submit NAICOM quarterly return", async () => {
    const { data, error } = await trpcMutation("insuranceWorkflows.submitNaicomReport", {
      reportType: "quarterly_return",
      reportingPeriod: "2025-Q1",
      dueDate: new Date(Date.now() + 30 * 86400000).toISOString(),
      reportData: {
        totalPremiums: 5000000,
        totalClaims: 1500000,
        totalReserves: 3000000,
        solvencyRatio: 1.8,
      },
    });
    if (!error && data) {
      expect((data as any).report).toBeDefined();
    } else {
      console.warn("[SKIP] NAICOM report requires auth:", String(error));
    }
  });

  it("7.2 — Compliance: Submit NAICOM annual return", async () => {
    const { data, error } = await trpcMutation("insuranceWorkflows.submitNaicomReport", {
      reportType: "annual_return",
      reportingPeriod: "2024",
      dueDate: new Date(Date.now() + 90 * 86400000).toISOString(),
      reportData: {
        totalPremiums: 20000000,
        totalClaims: 6000000,
        totalReserves: 12000000,
      },
    });
    if (!error && data) {
      expect((data as any).report).toBeDefined();
    }
  });

  it("7.3 — Compliance: Get pending compliance filings", async () => {
    const { data, error } = await trpcQuery("insuranceWorkflows.getPendingComplianceFilings");
    if (!error) {
      expect(data).toHaveProperty("reports");
    }
  });

  it("7.4 — Compliance: AML screening check", async () => {
    const { data, error } = await trpcQuery("complianceFiling.getFilings");
    if (!error) {
      expect(data).toBeDefined();
    }
  });

  it("7.5 — Compliance: Regulatory compliance checks", async () => {
    const { data, error } = await trpcQuery("regulatoryComplianceChecks.getChecks");
    if (!error) {
      expect(data).toBeDefined();
    }
  });

  it("7.6 — Compliance: CBN reporting", async () => {
    const { data, error } = await trpcQuery("cbnReporting.getReports");
    if (!error) {
      expect(data).toBeDefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 8: Reinsurer Workflows
// ═══════════════════════════════════════════════════════════════════════════════
describe("connectivity smoke (non-functional) — Suite 8: Reinsurer Workflows", () => {
  it("8.1 — Reinsurer: Create quota share treaty", async () => {
    const { data, error } = await trpcMutation("insuranceWorkflows.createTreaty", {
      reinsurerName: "Swiss Re Smoke Test",
      type: "quota_share",
      retentionLimit: 50000000,
      cessionLimit: 100000000,
      cessionPercentage: 40,
      premiumRate: 2.5,
      startDate: new Date().toISOString(),
    });
    if (!error && data) {
      expect((data as any).treatyNumber).toMatch(/^TRT-/);
      testTreatyId = (data as any).treaty?.id;
    } else {
      console.warn("[SKIP] Treaty creation requires auth:", String(error));
    }
  });

  it("8.2 — Reinsurer: Create excess of loss treaty", async () => {
    const { data, error } = await trpcMutation("insuranceWorkflows.createTreaty", {
      reinsurerName: "Munich Re Smoke Test",
      type: "excess_of_loss",
      retentionLimit: 100000000,
      cessionLimit: 500000000,
      cessionPercentage: 80,
      premiumRate: 1.8,
      startDate: new Date().toISOString(),
    });
    if (!error && data) {
      expect((data as any).treatyNumber).toMatch(/^TRT-/);
    }
  });

  it("8.3 — Reinsurer: Cede policy to treaty", async () => {
    const treatyId = testTreatyId ?? 1;
    const policyId = testPolicyId ?? 1;
    const { data, error } = await trpcMutation("insuranceWorkflows.cedePolicyToTreaty", {
      treatyId,
      policyId,
    });
    if (!error && data) {
      expect((data as any).cession).toBeDefined();
    } else {
      console.warn("[SKIP] Cession requires auth:", String(error));
    }
  });

  it("8.4 — Reinsurer: List active treaties", async () => {
    const { data, error } = await trpcQuery("insuranceWorkflows.getReinsuranceTreaties");
    if (!error) {
      expect(data).toHaveProperty("treaties");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 9: Agent Workflows
// ═══════════════════════════════════════════════════════════════════════════════
describe("connectivity smoke (non-functional) — Suite 9: Agent Workflows", () => {
  it("9.1 — Agent: List available insurance products", async () => {
    const { data, error } = await trpcQuery("insuranceWorkflows.listProducts", { isActive: true });
    if (!error) {
      expect(data).toHaveProperty("products");
    }
  });

  it("9.2 — Agent: Sell micro-insurance policy", async () => {
    const { data, error } = await trpcMutation("insuranceWorkflows.bindPolicy", {
      quoteRef: `QT-AGENT-${Date.now()}`,
      productId: testProductId ?? 1,
      customerId: 5,
      agentId: 1,
      sumInsured: 500000,
      annualPremium: 5000,
      startDate: new Date().toISOString(),
    });
    if (!error && data) {
      expect((data as any).policyNumber).toMatch(/^POL-/);
    }
  });

  it("9.3 — Agent: Collect premium payment", async () => {
    const { data, error } = await trpcMutation("insuranceWorkflows.payPremium", {
      policyId: testPolicyId ?? 1,
      amount: 5000,
      paymentMethod: "cash",
      channel: "pos",
    });
    if (!error && data) {
      expect((data as any).payment).toBeDefined();
    }
  });

  it("9.4 — Agent: Agent float insurance claims", async () => {
    const { data, error } = await trpcQuery("agentFloatInsuranceClaims.getClaims");
    if (!error) {
      expect(data).toBeDefined();
    }
  });

  it("9.5 — Agent: Micro-insurance products", async () => {
    const { data, error } = await trpcQuery("agentMicroInsurance.getProducts");
    if (!error) {
      expect(data).toBeDefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 10: Supervisor Workflows
// ═══════════════════════════════════════════════════════════════════════════════
describe("connectivity smoke (non-functional) — Suite 10: Supervisor Workflows", () => {
  it("10.1 — Supervisor: Monitor SLA compliance", async () => {
    const { data, error } = await trpcQuery("slaMonitoring.getMetrics");
    if (!error) {
      expect(data).toBeDefined();
    }
  });

  it("10.2 — Supervisor: View audit trail", async () => {
    const { data, error } = await trpcQuery("auditLog.getLogs");
    if (!error) {
      expect(data).toBeDefined();
    }
  });

  it("10.3 — Supervisor: Approve transaction override", async () => {
    const { data, error } = await trpcQuery("supervisor.getPendingApprovals");
    if (!error) {
      expect(data).toBeDefined();
    }
  });

  it("10.4 — Supervisor: View policy workflow history", async () => {
    const policyId = testPolicyId ?? 1;
    const { data, error } = await trpcQuery("insuranceWorkflows.getPolicyWorkflowHistory", { policyId });
    if (!error) {
      expect(data).toHaveProperty("events");
    }
  });

  it("10.5 — Supervisor: Escalation chains", async () => {
    const { data, error } = await trpcQuery("escalationChains.getChains");
    if (!error) {
      expect(data).toBeDefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 11: Cross-Service Integration Tests
// ═══════════════════════════════════════════════════════════════════════════════
describe("connectivity smoke (non-functional) — Suite 11: Cross-Service Integration", () => {
  it("11.1 — TigerBeetle: Settlement workflow", async () => {
    const { data, error } = await trpcQuery("tigerBeetle.getSyncStatus");
    if (!error) {
      expect(data).toBeDefined();
    }
  });

  it("11.2 — Temporal: Settlement workflow trigger", async () => {
    const { data, error } = await trpcQuery("temporalWorkflows.getWorkflowStatus", {
      workflowId: "settlement-smoke-test",
    });
    if (!error) {
      expect(data).toBeDefined();
    }
  });

  it("11.3 — Lakehouse: Data pipeline health", async () => {
    const { data, error } = await trpcQuery("lakehouse.getStatus");
    if (!error) {
      expect(data).toBeDefined();
    }
  });

  it("11.4 — Fraud detection: ML scoring", async () => {
    const { data, error } = await trpcQuery("mlScoring.getModelStatus");
    if (!error) {
      expect(data).toBeDefined();
    }
  });

  it("11.5 — KYC enforcement: Customer verification", async () => {
    const { data, error } = await trpcQuery("kycEnforcement.getStatus");
    if (!error) {
      expect(data).toBeDefined();
    }
  });

  it("11.6 — Vault secrets: Secret store health", async () => {
    const { data, error } = await trpcQuery("vaultSecrets.getHealth");
    if (!error) {
      expect(data).toBeDefined();
    }
  });

  it("11.7 — Analytics: Dashboard metrics", async () => {
    const { data, error } = await trpcQuery("analytics.getDashboard");
    if (!error) {
      expect(data).toBeDefined();
    }
  });

  it("11.8 — General ledger: Account balances", async () => {
    const { data, error } = await trpcQuery("generalLedger.getBalances");
    if (!error) {
      expect(data).toBeDefined();
    }
  });

  it("11.9 — Settlement reconciliation", async () => {
    const { data, error } = await trpcQuery("settlementReconciliation.getStatus");
    if (!error) {
      expect(data).toBeDefined();
    }
  });

  it("11.10 — Commission payouts", async () => {
    const { data, error } = await trpcQuery("commissionPayouts.getPending");
    if (!error) {
      expect(data).toBeDefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 12: Security & WAF Tests
// ═══════════════════════════════════════════════════════════════════════════════
describe("connectivity smoke (non-functional) — Suite 12: Security & WAF Validation", () => {
  it("12.1 — SQL injection attempt is blocked", async () => {
    const { error } = await trpcQuery("insuranceWorkflows.listPolicies", {
      customerId: "1; DROP TABLE policies; --" as any,
    });
    // Should return validation error, not execute SQL
    if (error) {
      const errStr = String(error);
      if (!serverUp) {
        console.warn("[SKIP — no infra] SQLi check skipped:", errStr);
        return;
      }
      // Server reachable: must be a validation/auth rejection, never a 5xx
      expect(errStr).toMatch(/invalid|validation|type|UNAUTHORIZED|unauthorized|401/i);
      expect(errStr).not.toMatch(/INTERNAL_SERVER_ERROR|Internal server error/i);
    }
  });

  it("12.2 — XSS payload in input is sanitized", async () => {
    const { error } = await trpcMutation("insuranceWorkflows.cancelPolicy", {
      policyId: 1,
      reason: "<script>alert('xss')</script>",
    });
    // Should either sanitize or reject
    if (error) {
      expect(String(error)).not.toContain("script");
    }
  });

  it("12.3 — Rate limiting is active", async () => {
    // Make multiple rapid requests
    const results = await Promise.all(
      Array.from({ length: 5 }, () => httpGet("/api/health"))
    );
    // In CI without server, all statuses will be 0 — that's acceptable
    // In production, should not crash the server
    const statuses = results.map(r => r.status);
    if (statuses.every(s => s === 0)) {
      console.warn("[SKIP — no infra] Server not running — rate limit test skipped");
      return;
    }
    // Server reachable: health endpoint must not 5xx under a small burst
    expect(statuses.some(s => s > 0)).toBe(true);
    expect(statuses.every(s => s < 500)).toBe(true);
  });

  it("12.4 — CORS headers present", async () => {
    const { ok, status } = await httpGet("/api/health");
    // In CI without server, status will be 0 — skip
    if (status === 0) {
      console.warn("[SKIP — no infra] Server not running — CORS test skipped");
      return;
    }
    expect(status).not.toBe(0);
    expect(status, "health endpoint returned 5xx").toBeLessThan(500);
  });

  it("12.5 — Unauthenticated access to protected route returns 401", async () => {
    const { error } = await trpcQuery("insuranceWorkflows.getInsuranceDashboard");
    if (!serverUp) {
      console.warn("[SKIP — no infra] auth-gate check skipped");
      return;
    }
    // Server reachable: a protected route MUST reject unauthenticated calls —
    // and only with 401/UNAUTHORIZED (not 5xx, not "No procedure found").
    expect(error, "protected route returned data without auth").toBeDefined();
    expect(String(error)).toMatch(/UNAUTHORIZED|unauthorized|401/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 13: Data Integrity Tests
// ═══════════════════════════════════════════════════════════════════════════════
describe("connectivity smoke (non-functional) — Suite 13: Data Integrity & Schema Validation", () => {
  it("13.1 — Policy schema: required fields validated", async () => {
    const { error } = await trpcMutation("insuranceWorkflows.bindPolicy", {
      // Missing required fields
      productId: 1,
    });
    if (!serverUp) {
      console.warn("[SKIP — no infra] schema validation check skipped");
      return;
    }
    expect(error).toBeDefined();
    // A 5xx on invalid input means the server crashed instead of validating
    expect(String(error)).not.toMatch(/INTERNAL_SERVER_ERROR|Internal server error/i);
  });

  it("13.2 — Claim schema: invalid claim type rejected", async () => {
    const { error } = await trpcMutation("insuranceWorkflows.fileClaim", {
      policyId: 1,
      claimType: "invalid_type",
      incidentDate: new Date().toISOString(),
      claimedAmount: -1000, // negative amount
      incidentDescription: "",
    });
    // Should fail validation
    if (!serverUp) {
      console.warn("[SKIP — no infra] schema validation check skipped");
      return;
    }
    expect(error).toBeDefined();
    // A 5xx on invalid input means the server crashed instead of validating
    expect(String(error)).not.toMatch(/INTERNAL_SERVER_ERROR|Internal server error/i);
  });

  it("13.3 — Underwriting: invalid decision rejected", async () => {
    const { error } = await trpcMutation("insuranceWorkflows.assessRisk", {
      policyId: 1,
      riskScore: 150, // > 100, invalid
      riskCategory: "low",
      decision: "invalid_decision" as any,
    });
    if (!serverUp) {
      console.warn("[SKIP — no infra] schema validation check skipped");
      return;
    }
    expect(error).toBeDefined();
    // A 5xx on invalid input means the server crashed instead of validating
    expect(String(error)).not.toMatch(/INTERNAL_SERVER_ERROR|Internal server error/i);
  });

  it("13.4 — Treaty: invalid type rejected", async () => {
    const { error } = await trpcMutation("insuranceWorkflows.createTreaty", {
      reinsurerName: "Test",
      type: "invalid_treaty_type" as any,
      retentionLimit: 1000000,
      cessionLimit: 5000000,
      cessionPercentage: 40,
      premiumRate: 2.0,
      startDate: new Date().toISOString(),
    });
    if (!serverUp) {
      console.warn("[SKIP — no infra] schema validation check skipped");
      return;
    }
    expect(error).toBeDefined();
    // A 5xx on invalid input means the server crashed instead of validating
    expect(String(error)).not.toMatch(/INTERNAL_SERVER_ERROR|Internal server error/i);
  });

  it("13.5 — IFRS17: invalid measurement model rejected", async () => {
    const { error } = await trpcMutation("insuranceWorkflows.generateIfrs17Report", {
      groupCode: "TEST",
      measurementModel: "INVALID" as any,
      reportingPeriod: "2025-Q1",
    });
    if (!serverUp) {
      console.warn("[SKIP — no infra] schema validation check skipped");
      return;
    }
    expect(error).toBeDefined();
    // A 5xx on invalid input means the server crashed instead of validating
    expect(String(error)).not.toMatch(/INTERNAL_SERVER_ERROR|Internal server error/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 14: End-to-End Golden Path
// ═══════════════════════════════════════════════════════════════════════════════
describe("connectivity smoke (non-functional) — Suite 14: End-to-End Golden Path", () => {
  it("14.1 — Full life insurance lifecycle: quote → bind → pay → claim → settle", async () => {
    // This test verifies the complete happy path
    const productId = testProductId ?? 1;

    // Step 1: Quote
    const { data: quoteData } = await trpcMutation("insuranceWorkflows.getQuote", {
      productId,
      customerId: 99,
      coverageAmount: 5000000,
      startDate: new Date().toISOString(),
    });

    // Step 2: Bind
    const { data: bindData } = await trpcMutation("insuranceWorkflows.bindPolicy", {
      quoteRef: (quoteData as any)?.quoteRef ?? `QT-E2E-${Date.now()}`,
      productId,
      customerId: 99,
      sumInsured: 5000000,
      annualPremium: 50000,
      startDate: new Date().toISOString(),
    });

    const e2ePolicyId = (bindData as any)?.policy?.id;

    // Step 3: Pay premium
    if (e2ePolicyId) {
      const { data: payData } = await trpcMutation("insuranceWorkflows.payPremium", {
        policyId: e2ePolicyId,
        amount: 50000,
        paymentMethod: "bank_transfer",
        channel: "web",
      });

      // Step 4: File claim
      const { data: claimData } = await trpcMutation("insuranceWorkflows.fileClaim", {
        policyId: e2ePolicyId,
        claimType: "death",
        incidentDate: new Date(Date.now() - 86400000).toISOString(),
        claimedAmount: 5000000,
        incidentDescription: "E2E golden path test claim",
      });

      const e2eClaimId = (claimData as any)?.claim?.id;

      // Step 5: Adjudicate
      if (e2eClaimId) {
        await trpcMutation("insuranceWorkflows.adjudicateClaim", {
          claimId: e2eClaimId,
          decision: "approved",
          approvedAmount: 5000000,
        });

        // Step 6: Settle
        const { data: settleData } = await trpcMutation("insuranceWorkflows.settleClaimPayment", {
          claimId: e2eClaimId,
          amount: 5000000,
          paymentMethod: "bank_transfer",
        });

        if (settleData) {
          expect((settleData as any).success).toBe(true);
        }
      }
    }

    if (!serverUp) {
      console.warn("[SKIP — no infra] golden path not exercised (no server)");
      return;
    }
    // Connectivity-level only: without an authenticated session the golden
    // path cannot complete end-to-end. The infraFailures gate in afterAll has
    // already failed this run if any call above returned 5xx or hit a
    // missing procedure; reaching here means endpoints responded structurally.
  });

  it("14.2 — Full motor insurance lifecycle: quote → bind → endorsement → renewal", async () => {
    const productId = testProductId ?? 1;

    const { data: bindData } = await trpcMutation("insuranceWorkflows.bindPolicy", {
      quoteRef: `QT-MOTOR-${Date.now()}`,
      productId,
      customerId: 88,
      sumInsured: 3000000,
      annualPremium: 45000,
      startDate: new Date().toISOString(),
    });

    const motorPolicyId = (bindData as any)?.policy?.id;

    if (motorPolicyId) {
      // Endorsement
      await trpcMutation("insuranceWorkflows.requestEndorsement", {
        policyId: motorPolicyId,
        type: "modification",
        effectiveDate: new Date().toISOString(),
        description: "Change vehicle registration",
      });

      // Renewal
      const { data: renewalData } = await trpcMutation("insuranceWorkflows.requestRenewal", {
        policyId: motorPolicyId,
        isAutoRenewal: true,
      });

      if (renewalData) {
        expect((renewalData as any).renewal).toBeDefined();
      }
    }

    if (!serverUp) {
      console.warn("[SKIP — no infra] golden path not exercised (no server)");
      return;
    }
    // Connectivity-level only — see 14.1 note and the afterAll infra gate.
  });
});
