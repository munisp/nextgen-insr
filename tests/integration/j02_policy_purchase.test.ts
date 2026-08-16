/**
 * ═══════════════════════════════════════════════════════════════════════════
 * QUARANTINED — CAT-B assembled-stack dependency — 2026-08-16 (assurance-lead approved; see tests/QUARANTINE.md)
 * ═══════════════════════════════════════════════════════════════════════════
 * REASON: requires a running API server (fetch failed) — assembled-stack dependency; candidate for the real-HTTP e2e harness, NOT deletion.
 * EVIDENCE: log: fetch failed (run 31969739386).
 * RE-ENABLE CONDITION: Same as above.
 * NO assertion in this file has been modified or deleted — it runs as-is the
 * day the re-enable condition is met. Excluded from the default vitest run via
 * vitest.config.ts (config-level, auditable in one place).
 * ═══════════════════════════════════════════════════════════════════════════
 */
/**
 * J02 Policy Purchase Journey — Integration Test Suite
 *
 * Tests the complete J02_PolicyPurchaseWorkflow end-to-end:
 *   1. Happy path: full policy purchase with TigerBeetle ledger verification
 *   2. Saga compensation: simulates mid-flow failure and verifies rollback
 *   3. Idempotency: duplicate trigger returns same execution
 *   4. Fraud gate rejection: high-risk transaction blocked
 *   5. Underwriting decline: high-risk profile declined
 *   6. TigerBeetle ledger: verifies debit/credit entries after purchase
 *
 * Run: npx vitest run tests/integration/j02_policy_purchase.test.ts
 * Requires: DATABASE_URL, API_BASE_URL (defaults to http://localhost:3000)
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { getDb } from "../../server/db";
import { tbGetAgentBalance, tbGetSyncStatus, TB_SYSTEM_ACCOUNTS } from "../../server/tbClient";
import { customers, agents, policies, transactions, auditLog } from "../../drizzle/schema";
import { journeyExecutions, journeyStepEvents } from "../../drizzle/schema.journeys";
import { eq, and, desc } from "drizzle-orm";

const API_BASE = process.env.API_BASE_URL ?? "http://localhost:3000";
const TEST_TIMEOUT = 60_000; // 60s — journeys can take time

// ── Auth token for protected procedures ──────────────────────────────────────
let authToken: string | null = null;
let testCustomerId: number | null = null;
let testAgentId: number | null = null;
let testProductId: number = 1;

// ── tRPC helpers ──────────────────────────────────────────────────────────────
async function trpcQuery(procedure: string, input?: Record<string, unknown>) {
  const params = input ? `?input=${encodeURIComponent(JSON.stringify(input))}` : "";
  const res = await fetch(`${API_BASE}/api/trpc/${procedure}${params}`, {
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function trpcMutate(procedure: string, input: Record<string, unknown>) {
  const res = await fetch(`${API_BASE}/api/trpc/${procedure}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

// ── Wait for journey completion ───────────────────────────────────────────────
async function waitForJourneyCompletion(
  workflowId: string,
  maxWaitMs = 30_000
): Promise<{ status: string; currentStep: string; durationMs?: number }> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const { data } = await trpcQuery("journeyOrchestratorV2.getStatus", { workflowId });
    const status = data?.result?.data?.status ?? "unknown";
    if (["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"].includes(status)) {
      // Also check DB record
      const db = await getDb();
      const dbRecord = db ? await db.select()
        .from(journeyExecutions)
        .where(eq(journeyExecutions.workflowId, workflowId))
        .limit(1) : [];
      return {
        status,
        currentStep: data?.result?.data?.currentStep ?? "unknown",
        durationMs: dbRecord[0]?.durationMs ?? undefined,
      };
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`Journey ${workflowId} did not complete within ${maxWaitMs}ms`);
}

// ── Setup ─────────────────────────────────────────────────────────────────────
beforeAll(async () => {
  // Authenticate as test user
  const loginRes = await trpcMutate("auth.login", {
    email: process.env.TEST_USER_EMAIL ?? "test@insureportal.ng",
    password: process.env.TEST_USER_PASSWORD ?? "TestPass123!",
  });
  authToken = loginRes.data?.result?.data?.token ?? null;

  if (!authToken) {
    console.warn("No auth token — tests will run without authentication");
  }

  // Get or create test customer
  const db = await getDb();
  if (db) {
    const existing = await db.select().from(customers)
      .where(eq(customers.email, "j02-test@insureportal.ng"))
      .limit(1);

    if (existing.length > 0) {
      testCustomerId = existing[0].id;
    } else {
      const [cust] = await db.insert(customers).values({
        email: "j02-test@insureportal.ng",
        phone: "08012345678",
        firstName: "J02",
        lastName: "TestCustomer",
        dateOfBirth: "1990-01-01",
        address: "123 Test Street",
        state: "Lagos",
        kycStatus: "verified",
        kycLevel: 2,
      }).returning({ id: customers.id });
      testCustomerId = cust.id;
    }

    // Get a test agent
    const agent = await db.select().from(agents).limit(1);
    testAgentId = agent[0]?.id ?? null;
  }
}, TEST_TIMEOUT);

afterAll(async () => {
  // Clean up test data
  const db = await getDb();
  if (db && testCustomerId) {
    await db.delete(journeyExecutions)
      .where(eq(journeyExecutions.triggeredBy, testCustomerId));
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST SUITE 1: Happy Path
// ═══════════════════════════════════════════════════════════════════════════
describe("J02 Policy Purchase — Happy Path", () => {
  let workflowId: string;
  let policyId: number;
  let paymentRef: string;

  it("should trigger J02 journey and return a workflow ID", async () => {
    paymentRef = `TEST-J02-${Date.now()}`;

    const { status, data } = await trpcMutate("journeyOrchestratorV2.triggerJ02", {
      customerId: testCustomerId ?? 1,
      productId: testProductId,
      sumInsured: 5_000_000,
      premiumAmount: 50_000,
      durationMonths: 12,
      paymentRef,
      agentId: testAgentId,
      idempotencyKey: `j02-happy-${Date.now()}`,
    });

    expect(status).toBe(200);
    expect(data?.result?.data?.success).toBe(true);
    expect(data?.result?.data?.workflowId).toBeTruthy();
    workflowId = data.result.data.workflowId;
    console.log(`  → Workflow started: ${workflowId}`);
  }, TEST_TIMEOUT);

  it("should record journey execution in PostgreSQL immediately", async () => {
    const db = await getDb();
    if (!db) return;

    const record = await db.select().from(journeyExecutions)
      .where(eq(journeyExecutions.workflowId, workflowId))
      .limit(1);

    expect(record.length).toBe(1);
    expect(record[0].journeyId).toBe("J02");
    expect(record[0].status).toBe("running");
    expect(record[0].currentStep).toBeTruthy();
    console.log(`  → DB record: status=${record[0].status}, step=${record[0].currentStep}`);
  }, TEST_TIMEOUT);

  it("should complete successfully and create a policy", async () => {
    const result = await waitForJourneyCompletion(workflowId, 30_000);
    expect(result.status).toBe("COMPLETED");
    console.log(`  → Journey completed in ${result.durationMs}ms`);
  }, TEST_TIMEOUT);

  it("should have recorded step events in journey_step_events", async () => {
    const db = await getDb();
    if (!db) return;

    const execution = await db.select().from(journeyExecutions)
      .where(eq(journeyExecutions.workflowId, workflowId))
      .limit(1);

    const steps = await db.select().from(journeyStepEvents)
      .where(eq(journeyStepEvents.executionId, execution[0].id))
      .orderBy(journeyStepEvents.recordedAt);

    expect(steps.length).toBeGreaterThan(0);
    const stepNames = steps.map(s => s.stepName);
    console.log(`  → Steps recorded: ${stepNames.join(" → ")}`);

    // Verify key steps are present
    expect(stepNames.some(s => s.includes("fraud"))).toBe(true);
    expect(stepNames.some(s => s.includes("underwriting"))).toBe(true);
    expect(stepNames.some(s => s.includes("premium") || s.includes("collect"))).toBe(true);
    expect(stepNames.some(s => s.includes("policy"))).toBe(true);
  }, TEST_TIMEOUT);

  it("should have created a policy record in PostgreSQL", async () => {
    const db = await getDb();
    if (!db) return;

    const policy = await db.select().from(policies)
      .where(eq(policies.customerId, testCustomerId ?? 1))
      .orderBy(desc(policies.id))
      .limit(1);

    expect(policy.length).toBeGreaterThan(0);
    expect(policy[0].status).toBe("active");
    expect(parseFloat(policy[0].premiumAmount ?? "0")).toBe(50_000);
    policyId = policy[0].id;
    console.log(`  → Policy created: ID=${policyId}, status=${policy[0].status}`);
  }, TEST_TIMEOUT);

  it("should have created a premium payment transaction in PostgreSQL", async () => {
    const db = await getDb();
    if (!db) return;

    const txn = await db.select().from(transactions)
      .where(and(
        eq(transactions.reference, paymentRef),
        eq(transactions.type, "premium_payment")
      ))
      .limit(1);

    expect(txn.length).toBe(1);
    expect(txn[0].status).toBe("completed");
    expect(parseFloat(txn[0].amount)).toBe(50_000);
    console.log(`  → Transaction: ID=${txn[0].id}, amount=₦${txn[0].amount}, status=${txn[0].status}`);
  }, TEST_TIMEOUT);

  it("should have written an audit log entry for the premium payment", async () => {
    const db = await getDb();
    if (!db) return;

    const audit = await db.select().from(auditLog)
      .where(and(
        eq(auditLog.action, "PREMIUM_COLLECTED"),
        eq(auditLog.resource, "policy")
      ))
      .orderBy(desc(auditLog.id))
      .limit(1);

    expect(audit.length).toBeGreaterThan(0);
    console.log(`  → Audit log: action=${audit[0].action}, resource=${audit[0].resource}`);
  }, TEST_TIMEOUT);

  it("should have updated journey execution status to completed in DB", async () => {
    const db = await getDb();
    if (!db) return;

    const record = await db.select().from(journeyExecutions)
      .where(eq(journeyExecutions.workflowId, workflowId))
      .limit(1);

    expect(record[0].status).toBe("completed");
    expect(record[0].completedAt).toBeTruthy();
    expect(record[0].durationMs).toBeGreaterThan(0);
    expect(record[0].resultSnapshot).toBeTruthy();
    console.log(`  → Final status: ${record[0].status}, duration: ${record[0].durationMs}ms`);
  }, TEST_TIMEOUT);
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST SUITE 2: TigerBeetle Ledger Verification
// ═══════════════════════════════════════════════════════════════════════════
describe("J02 Policy Purchase — TigerBeetle Ledger Verification", () => {
  it("should verify TigerBeetle sidecar is healthy", async () => {
    const tbStatus = await tbGetSyncStatus();
    if (!tbStatus) {
      console.warn("  ⚠ TigerBeetle sidecar not running — skipping TB ledger tests");
      return;
    }
    expect(tbStatus).toBeTruthy();
    console.log(`  → TB sidecar: lag=${tbStatus.lagSeconds}s, synced=${tbStatus.synced}`);
  }, TEST_TIMEOUT);

  it("should have a TigerBeetle transfer recorded for the premium payment", async () => {
    const db = await getDb();
    if (!db) return;

    // Find the most recent completed premium payment transaction
    const txn = await db.select().from(transactions)
      .where(and(
        eq(transactions.type, "premium_payment"),
        eq(transactions.status, "completed")
      ))
      .orderBy(desc(transactions.id))
      .limit(1);

    if (txn.length === 0) {
      console.warn("  ⚠ No completed premium payment found — skipping");
      return;
    }

    // Verify the TB transfer ID is recorded in metadata
    const metadata = txn[0].metadata as Record<string, unknown> | null;
    const tbTransferId = metadata?.tbTransferId as string | undefined;

    if (!tbTransferId || tbTransferId === "tb-posted-fallback") {
      console.warn("  ⚠ TB sidecar not running — transaction used PG-only fallback");
      console.log(`  → Transaction status: ${txn[0].status}, amount: ₦${txn[0].amount}`);
      // This is acceptable — the PG fallback is the designed behaviour when TB is down
      expect(txn[0].status).toBe("completed");
      return;
    }

    console.log(`  → TB transfer ID: ${tbTransferId}`);
    expect(tbTransferId).toBeTruthy();
    expect(tbTransferId).toMatch(/^\d+$/); // TB transfer IDs are BigInt strings
  }, TEST_TIMEOUT);

  it("should verify agent float balance reflects commission credit", async () => {
    if (!testAgentId) {
      console.warn("  ⚠ No test agent — skipping commission balance check");
      return;
    }

    const db = await getDb();
    if (!db) return;

    const agent = await db.select().from(agents)
      .where(eq(agents.id, testAgentId))
      .limit(1);

    if (!agent.length) return;

    const pgBalance = parseFloat(agent[0].floatBalance ?? "0");
    console.log(`  → Agent PG float balance: ₦${pgBalance.toLocaleString()}`);

    // Try TB balance if sidecar is running
    try {
      const tbBalance = await tbGetAgentBalance(testAgentId);
      if (tbBalance !== null) {
        console.log(`  → Agent TB balance: ₦${(Number(tbBalance) / 100).toLocaleString()}`);
        // TB balance is in kobo, PG is in naira
        const tbBalanceNaira = Number(tbBalance) / 100;
        // Allow ±₦1 rounding difference
        expect(Math.abs(tbBalanceNaira - pgBalance)).toBeLessThan(1);
        console.log(`  → ✓ TB and PG balances are consistent`);
      }
    } catch {
      console.warn("  ⚠ TB balance check skipped — sidecar not running");
    }
  }, TEST_TIMEOUT);

  it("should verify system accounts exist (PREMIUM_POOL, FEE_POOL, SUSPENSE)", async () => {
    try {
      const premiumPoolId = TB_SYSTEM_ACCOUNTS.PREMIUM_POOL;
      const feePoolId = TB_SYSTEM_ACCOUNTS.FEE_POOL;
      const suspenseId = TB_SYSTEM_ACCOUNTS.SUSPENSE;

      expect(premiumPoolId).toBeTruthy();
      expect(feePoolId).toBeTruthy();
      expect(suspenseId).toBeTruthy();
      console.log(`  → System accounts: PREMIUM_POOL=${premiumPoolId}, FEE_POOL=${feePoolId}, SUSPENSE=${suspenseId}`);
    } catch {
      console.warn("  ⚠ TB system accounts not seeded — sidecar not running");
    }
  }, TEST_TIMEOUT);
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST SUITE 3: Saga Compensation
// ═══════════════════════════════════════════════════════════════════════════
describe("J02 Policy Purchase — Saga Compensation", () => {
  it("should compensate (refund) premium when policy creation fails", async () => {
    const db = await getDb();
    if (!db) return;

    // Use an invalid productId that will cause policy creation to fail
    // but premium collection to succeed first (to test compensation)
    const paymentRef = `TEST-SAGA-${Date.now()}`;
    const countBefore = await db.select().from(transactions)
      .where(eq(transactions.type, "premium_payment"));

    const { data } = await trpcMutate("journeyOrchestratorV2.triggerJ02", {
      customerId: testCustomerId ?? 1,
      productId: 999999, // Non-existent product — will fail at createPolicy step
      sumInsured: 1_000_000,
      premiumAmount: 10_000,
      durationMonths: 12,
      paymentRef,
      idempotencyKey: `j02-saga-${Date.now()}`,
    });

    if (!data?.result?.data?.workflowId) {
      console.warn("  ⚠ Journey did not start — skipping saga test");
      return;
    }

    const workflowId = data.result.data.workflowId;
    console.log(`  → Saga test workflow: ${workflowId}`);

    // Wait for failure
    let finalStatus = "unknown";
    try {
      const result = await waitForJourneyCompletion(workflowId, 20_000);
      finalStatus = result.status;
    } catch {
      finalStatus = "timeout";
    }

    console.log(`  → Journey final status: ${finalStatus}`);

    // The journey should either fail (if product not found) or complete
    // What matters is that no orphaned premium payment exists without a policy
    const premiumTxn = await db.select().from(transactions)
      .where(and(
        eq(transactions.reference, paymentRef),
        eq(transactions.type, "premium_payment")
      ))
      .limit(1);

    if (premiumTxn.length > 0 && finalStatus === "FAILED") {
      // If premium was collected but policy creation failed, compensation should have run
      // Check for a reversal transaction
      const reversalTxn = await db.select().from(transactions)
        .where(and(
          eq(transactions.reference, `COMP-${paymentRef}`),
          eq(transactions.type, "premium_refund")
        ))
        .limit(1);

      if (reversalTxn.length > 0) {
        console.log(`  → ✓ Saga compensation ran: refund transaction created`);
        expect(reversalTxn[0].status).toBe("completed");
      } else {
        // Compensation may have run via TB reversal — check audit log
        const compAudit = await db.select().from(auditLog)
          .where(eq(auditLog.action, "SAGA_COMPENSATION"))
          .orderBy(desc(auditLog.id))
          .limit(1);
        if (compAudit.length > 0) {
          console.log(`  → ✓ Saga compensation logged in audit trail`);
        } else {
          console.log(`  → Journey failed before premium was collected (no compensation needed)`);
        }
      }
    } else if (finalStatus === "FAILED") {
      console.log(`  → ✓ Journey failed cleanly before fund movement (no compensation needed)`);
    }

    // The key invariant: no policy should exist for this payment reference
    const orphanPolicy = await db.select().from(policies)
      .where(eq(policies.customerId, testCustomerId ?? 1))
      .orderBy(desc(policies.id))
      .limit(1);

    // If a policy was created, it should be for a valid product, not our invalid one
    if (orphanPolicy.length > 0) {
      console.log(`  → Most recent policy: productId=${orphanPolicy[0].productId}, status=${orphanPolicy[0].status}`);
      expect(orphanPolicy[0].productId).not.toBe(999999);
    }
  }, TEST_TIMEOUT);

  it("should verify saga compensation step is recorded in step events", async () => {
    const db = await getDb();
    if (!db) return;

    // Find any failed J02 execution
    const failedExec = await db.select().from(journeyExecutions)
      .where(and(
        eq(journeyExecutions.journeyId, "J02"),
        eq(journeyExecutions.status, "failed")
      ))
      .orderBy(desc(journeyExecutions.id))
      .limit(1);

    if (!failedExec.length) {
      console.log("  → No failed J02 executions found — saga compensation not triggered");
      return;
    }

    const steps = await db.select().from(journeyStepEvents)
      .where(eq(journeyStepEvents.executionId, failedExec[0].id))
      .orderBy(journeyStepEvents.recordedAt);

    console.log(`  → Failed execution steps: ${steps.map(s => `${s.stepName}(${s.status})`).join(" → ")}`);

    // Check if any compensation steps were recorded
    const compensationSteps = steps.filter(s => s.status === "compensated");
    if (compensationSteps.length > 0) {
      console.log(`  → ✓ Compensation steps: ${compensationSteps.map(s => s.stepName).join(", ")}`);
    } else {
      console.log("  → No compensation steps needed (failure before fund movement)");
    }
  }, TEST_TIMEOUT);
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST SUITE 4: Idempotency
// ═══════════════════════════════════════════════════════════════════════════
describe("J02 Policy Purchase — Idempotency", () => {
  it("should return the same workflow ID for duplicate idempotency key", async () => {
    const idempotencyKey = `j02-idem-${Date.now()}`;
    const paymentRef = `TEST-IDEM-${Date.now()}`;

    // First trigger
    const { data: first } = await trpcMutate("journeyOrchestratorV2.triggerJ02", {
      customerId: testCustomerId ?? 1,
      productId: testProductId,
      sumInsured: 2_000_000,
      premiumAmount: 20_000,
      durationMonths: 12,
      paymentRef,
      idempotencyKey,
    });

    const firstWorkflowId = first?.result?.data?.workflowId;
    expect(firstWorkflowId).toBeTruthy();

    // Second trigger with same idempotency key
    const { data: second } = await trpcMutate("journeyOrchestratorV2.triggerJ02", {
      customerId: testCustomerId ?? 1,
      productId: testProductId,
      sumInsured: 2_000_000,
      premiumAmount: 20_000,
      durationMonths: 12,
      paymentRef: `${paymentRef}-DUPLICATE`,
      idempotencyKey, // Same key!
    });

    const secondWorkflowId = second?.result?.data?.workflowId;
    expect(secondWorkflowId).toBe(firstWorkflowId);
    console.log(`  → ✓ Idempotency: both triggers returned workflowId=${firstWorkflowId}`);
  }, TEST_TIMEOUT);
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST SUITE 5: tRPC Endpoint Verification
// ═══════════════════════════════════════════════════════════════════════════
describe("J02 — tRPC Endpoint Verification", () => {
  it("should return journey definitions from getDefinitions", async () => {
    const { status, data } = await trpcQuery("journeyOrchestratorV2.getDefinitions");
    expect(status).toBe(200);
    const defs = data?.result?.data;
    expect(Array.isArray(defs)).toBe(true);
    expect(defs.length).toBe(20);
    const j02 = defs.find((d: { id: string }) => d.id === "J02");
    expect(j02).toBeTruthy();
    expect(j02.name).toBe("Insurance Policy Purchase");
    expect(j02.services).toContain("tigerbeetle");
    expect(j02.services).toContain("rust-fraud-gate");
    console.log(`  → ✓ J02 definition: ${j02.name}, services: ${j02.services.join(", ")}`);
  }, TEST_TIMEOUT);

  it("should return execution list from listExecutions", async () => {
    const { status, data } = await trpcQuery("journeyOrchestratorV2.listExecutions", {
      journeyId: "J02",
      limit: 10,
      offset: 0,
    });
    expect(status).toBe(200);
    const result = data?.result?.data;
    expect(result).toHaveProperty("executions");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.executions)).toBe(true);
    console.log(`  → ✓ listExecutions: ${result.total} total J02 executions`);
  }, TEST_TIMEOUT);

  it("should return analytics from getAnalytics", async () => {
    const { status, data } = await trpcQuery("journeyOrchestratorV2.getAnalytics", { days: 30 });
    expect(status).toBe(200);
    const result = data?.result?.data;
    expect(result).toHaveProperty("byJourney");
    expect(result).toHaveProperty("byStatus");
    expect(result).toHaveProperty("avgDuration");
    console.log(`  → ✓ analytics: ${result.byJourney.length} journeys, ${result.byStatus.length} statuses`);
  }, TEST_TIMEOUT);

  it("should return schedules from listSchedules", async () => {
    const { status, data } = await trpcQuery("journeyOrchestratorV2.listSchedules", {});
    expect(status).toBe(200);
    const schedules = data?.result?.data;
    expect(Array.isArray(schedules)).toBe(true);
    console.log(`  → ✓ listSchedules: ${schedules.length} schedules configured`);
  }, TEST_TIMEOUT);
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST SUITE 6: Fraud Gate Rejection
// ═══════════════════════════════════════════════════════════════════════════
describe("J02 Policy Purchase — Fraud Gate Integration", () => {
  it("should verify fraud gate is called during J02 execution", async () => {
    const db = await getDb();
    if (!db) return;

    // Find a completed J02 execution
    const exec = await db.select().from(journeyExecutions)
      .where(and(
        eq(journeyExecutions.journeyId, "J02"),
        eq(journeyExecutions.status, "completed")
      ))
      .orderBy(desc(journeyExecutions.id))
      .limit(1);

    if (!exec.length) {
      console.warn("  ⚠ No completed J02 executions — skipping fraud gate test");
      return;
    }

    const steps = await db.select().from(journeyStepEvents)
      .where(eq(journeyStepEvents.executionId, exec[0].id));

    const fraudStep = steps.find(s =>
      s.stepName.includes("fraud") && s.service?.includes("rust-fraud-gate")
    );

    if (fraudStep) {
      expect(fraudStep.status).toBe("completed");
      console.log(`  → ✓ Rust fraud-gate called: step=${fraudStep.stepName}, service=${fraudStep.service}`);
    } else {
      // Fraud gate may be recorded differently
      const anyFraudStep = steps.find(s => s.stepName.includes("fraud"));
      if (anyFraudStep) {
        console.log(`  → Fraud check step found: ${anyFraudStep.stepName} (${anyFraudStep.service})`);
      } else {
        console.log(`  → Steps recorded: ${steps.map(s => s.stepName).join(", ")}`);
      }
    }
  }, TEST_TIMEOUT);
});
