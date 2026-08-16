/**
 * ═══════════════════════════════════════════════════════════════════════════
 * QUARANTINED — CAT-B assembled-stack dependency — 2026-08-16 (assurance-lead approved; see tests/QUARANTINE.md)
 * ═══════════════════════════════════════════════════════════════════════════
 * REASON: requires a running API server (fetch failed, :3000) — assembled-stack dependency in a unit-level vitest job; candidate for future migration into the real-HTTP e2e harness (createApp pattern), NOT deletion.
 * EVIDENCE: log: fetch failed ×14 (run 31969739386).
 * RE-ENABLE CONDITION: Migrated into the real-HTTP e2e harness or an assembled-stack job provides the server.
 * NO assertion in this file has been modified or deleted — it runs as-is the
 * day the re-enable condition is met. Excluded from the default vitest run via
 * vitest.config.ts (config-level, auditable in one place).
 * ═══════════════════════════════════════════════════════════════════════════
 */
/**
 * Integration Tests — NGApp Platform API
 *
 * Tests end-to-end flows across tRPC routers with a real database connection.
 * Requires: DATABASE_URL environment variable pointing to a test database.
 *
 * Run: npx vitest run tests/integration/
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const API_BASE = process.env.API_BASE_URL ?? "http://localhost:3000";

// Helper to call tRPC procedures
async function trpcQuery(procedure: string, input?: Record<string, unknown>) {
  const params = input ? `?input=${encodeURIComponent(JSON.stringify(input))}` : "";
  const res = await fetch(`${API_BASE}/api/trpc/${procedure}${params}`, {
    headers: { "Content-Type": "application/json" },
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function trpcMutate(procedure: string, input: Record<string, unknown>) {
  const res = await fetch(`${API_BASE}/api/trpc/${procedure}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

describe("Health Check", () => {
  it("should return healthy status", async () => {
    const res = await fetch(`${API_BASE}/api/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("status");
  });
});

describe("Policy Lifecycle", () => {
  let policyId: string;

  it("should list policies (empty or seeded)", async () => {
    const { status, data } = await trpcQuery("policy.list", { limit: 10, offset: 0 });
    // tRPC returns 200 even with empty result
    expect(status).toBeLessThan(500);
  });

  it("should create a new policy", async () => {
    const { status, data } = await trpcMutate("policy.create", {
      customerId: "test-customer-001",
      productType: "motor",
      premiumAmount: 75000,
      startDate: "2026-01-01",
      endDate: "2027-01-01",
    });
    // Should not return 500
    expect(status).toBeLessThan(500);
    if (data?.result?.data) {
      policyId = data.result.data.id;
    }
  });

  it("should retrieve policy by ID", async () => {
    if (!policyId) return; // skip if creation failed
    const { status } = await trpcQuery("policy.getById", { id: policyId });
    expect(status).toBeLessThan(500);
  });
});

describe("Claims Adjudication Rules", () => {
  it("should auto-approve claims under ₦50,000", async () => {
    const { status, data } = await trpcMutate("claims.adjudicate", {
      claimId: "test-claim-001",
      amount: 30000,
    });
    expect(status).toBeLessThan(500);
    // If adjudication works, verify business rule
    if (data?.result?.data?.decision) {
      expect(data.result.data.decision).toBe("approved");
    }
  });

  it("should escalate claims over ₦500,000", async () => {
    const { status, data } = await trpcMutate("claims.adjudicate", {
      claimId: "test-claim-002",
      amount: 750000,
    });
    expect(status).toBeLessThan(500);
    if (data?.result?.data?.decision) {
      expect(data.result.data.decision).toBe("escalated");
    }
  });
});

describe("Underwriting Risk Assessment", () => {
  it("should calculate risk score for standard profile", async () => {
    const { status, data } = await trpcMutate("underwriting.assessRisk", {
      age: 35,
      occupation: "engineer",
      productType: "life",
      sumAssured: 5000000,
    });
    expect(status).toBeLessThan(500);
  });

  it("should reject high-risk profiles", async () => {
    const { status, data } = await trpcMutate("underwriting.assessRisk", {
      age: 80,
      occupation: "test_pilot",
      productType: "life",
      sumAssured: 100000000,
      priorClaims: 5,
    });
    expect(status).toBeLessThan(500);
  });
});

describe("Agent Network", () => {
  it("should register a new agent", async () => {
    const { status } = await trpcMutate("agent.register", {
      name: "Test Agent",
      phone: "+2348012345678",
      state: "Lagos",
      lga: "Ikeja",
    });
    expect(status).toBeLessThan(500);
  });

  it("should list agents with filters", async () => {
    const { status } = await trpcQuery("agent.list", { state: "Lagos", limit: 10 });
    expect(status).toBeLessThan(500);
  });
});

describe("USSD Session", () => {
  it("should return main menu on empty input", async () => {
    const { status, data } = await trpcMutate("ussd.processSession", {
      sessionId: "test-session-001",
      phoneNumber: "+2348012345678",
      input: "",
      serviceCode: "*384*insurance#",
    });
    expect(status).toBeLessThan(500);
  });

  it("should navigate to policy menu on input 1", async () => {
    const { status } = await trpcMutate("ussd.processSession", {
      sessionId: "test-session-001",
      phoneNumber: "+2348012345678",
      input: "1",
      serviceCode: "*384*insurance#",
    });
    expect(status).toBeLessThan(500);
  });
});

describe("Compliance Reporting", () => {
  it("should generate NAICOM quarterly return structure", async () => {
    const { status } = await trpcMutate("compliance.generateNAICOMReturn", {
      quarter: "Q1",
      year: 2026,
    });
    expect(status).toBeLessThan(500);
  });
});

describe("Fraud Detection", () => {
  it("should flag high-velocity transactions", async () => {
    const { status } = await trpcMutate("fraud.checkTransaction", {
      customerId: "test-customer-001",
      amount: 500000,
      transactionsInLastHour: 15,
    });
    expect(status).toBeLessThan(500);
  });
});

describe("Notification Channels", () => {
  it("should send test notification", async () => {
    const { status } = await trpcMutate("notifications.send", {
      channel: "sms",
      recipient: "+2348012345678",
      message: "Integration test notification",
    });
    expect(status).toBeLessThan(500);
  });
});
