/**
 * tenancy.integration.test.ts — cross-tenant negative integration tests (F-05).
 *
 * Model under test (grounded in the code):
 *   - users.tenantId (drizzle/schema.ts ~L290) assigns a user to a tenant.
 *     NULL tenantId = platform-level account → intentionally UNSCOPED
 *     (tenantId=0 sentinel semantics per server/middleware/tenantIsolation.ts).
 *   - Tenant-owned rows carry a nullable tenantId: policies, claims,
 *     disputes, refunds, agents (all in drizzle/schema.ts).
 *   - server/middleware/tenantIsolation.ts provides assertTenantOwnership();
 *     it was previously dead code and is now applied to the highest-risk
 *     read paths (insuranceWorkflows, disputeRefund, agent routers).
 *
 * What this file proves against a REAL database:
 *   - Tenant A user cannot read/list tenant B policies, claims, disputes,
 *     refunds or agent PII (denied with FORBIDDEN or excluded from lists).
 *   - Tenant A user cannot initiate a refund against a tenant B dispute
 *     (cross-tenant refund abuse via IDOR on disputeId) — nothing is written.
 *   - Same-tenant reads still work (positive control — the filter is not a
 *     blanket deny), and platform-level users remain unscoped (documented
 *     assumption, see THREAT_MODEL.md "Residual risks").
 *
 * Single-tenant-by-design note: multiTenantIsolationRouter (tenant CRUD) is
 * platform-admin surface now mounted on adminProcedure (was plain
 * protectedProcedure — fixed per THREAT_MODEL.md §7.3); its authorization
 * gates are tested in tenantAdminAuthz.integration.test.ts.
 */
import { describe, it, beforeAll, afterAll } from "vitest";
import { eq, count } from "drizzle-orm";
import { getDb } from "../../server/db";
import {
  policies,
  claims,
  disputes,
  refunds,
  agents,
} from "../../drizzle/schema";
import {
  callerFor,
  expectCounted as expect,
  expectTrpcError,
  resetAssertionCount,
  getAssertionCount,
  type TestUser,
} from "./helpers/trpc";

const FILE = "tenancy";

// Synthetic tenant ids far away from any seeded data.
const TENANT_A = 920001;
const TENANT_B = 920002;

const userA: TestUser = {
  id: 920011,
  email: "user-a@tenant-a.integration",
  name: "Tenant A User",
  role: "user",
  tenantId: TENANT_A,
};
const userB: TestUser = {
  id: 920012,
  email: "user-b@tenant-b.integration",
  name: "Tenant B User",
  role: "user",
  tenantId: TENANT_B,
};
const platformUser: TestUser = {
  id: 920013,
  email: "ops@platform.integration",
  name: "Platform Ops",
  role: "admin",
  tenantId: null,
};

// Seeded row ids (filled in beforeAll).
let policyAId: number;
let policyBId: number;
let claimBId: number;
let disputeAId: number;
let disputeBId: number;
let agentAId: number;
let agentBId: number;

async function refundCountForDispute(disputeId: number): Promise<number> {
  const db = (await getDb())!;
  const [row] = await db
    .select({ c: count() })
    .from(refunds)
    .where(eq(refunds.disputeId, disputeId));
  return Number(row?.c ?? 0);
}

describe("cross-tenant isolation (integration, real DB)", () => {
  beforeAll(async () => {
    resetAssertionCount();
    const db = (await getDb())!;

    // ── Policies: one per tenant ─────────────────────────────────────────
    const [pA] = await db
      .insert(policies)
      .values({
        policyNumber: "POL-TEN-A-001",
        productId: 1,
        customerId: 920101,
        coverageType: "motor",
        sumInsured: "5000000",
        annualPremium: "75000",
        tenantId: TENANT_A,
      })
      .returning();
    const [pB] = await db
      .insert(policies)
      .values({
        policyNumber: "POL-TEN-B-001",
        productId: 1,
        customerId: 920201,
        coverageType: "life",
        sumInsured: "10000000",
        annualPremium: "120000",
        tenantId: TENANT_B,
      })
      .returning();
    policyAId = pA!.id;
    policyBId = pB!.id;

    // ── Claims: one for tenant B (plus one for tenant A as control) ──────
    const [cA] = await db
      .insert(claims)
      .values({
        claimNumber: "CLM-TEN-A-001",
        policyId: policyAId,
        claimantId: 920101,
        claimType: "accident",
        incidentDate: new Date(),
        claimedAmount: "250000",
        incidentDescription: "Tenant A control claim",
        tenantId: TENANT_A,
      })
      .returning();
    const [cB] = await db
      .insert(claims)
      .values({
        claimNumber: "CLM-TEN-B-001",
        policyId: policyBId,
        claimantId: 920201,
        claimType: "death",
        incidentDate: new Date(),
        claimedAmount: "9000000",
        incidentDescription: "Tenant B sensitive claim",
        tenantId: TENANT_B,
      })
      .returning();
    claimBId = cB!.id;
    void cA;

    // ── Disputes: one per tenant ─────────────────────────────────────────
    const [dA] = await db
      .insert(disputes)
      .values({
        ref: "DSP-TEN-A-001",
        agentId: 920301,
        amount: "1500",
        description: "Tenant A dispute",
        tenantId: TENANT_A,
      })
      .returning();
    const [dB] = await db
      .insert(disputes)
      .values({
        ref: "DSP-TEN-B-001",
        agentId: 920401,
        amount: "4500",
        description: "Tenant B dispute",
        tenantId: TENANT_B,
      })
      .returning();
    disputeAId = dA!.id;
    disputeBId = dB!.id;

    // ── Agents: one per tenant (agent PII: phone/email) ──────────────────
    const [aA] = await db
      .insert(agents)
      .values({
        agentId: "AGT-TEN-A-001",
        name: "Tenant A Agent",
        phone: "+2348000000001",
        email: "agent-a@tenant-a.integration",
        pinHash: "integration-pin-hash-a",
        tenantId: TENANT_A,
      })
      .returning();
    const [aB] = await db
      .insert(agents)
      .values({
        agentId: "AGT-TEN-B-001",
        name: "Tenant B Agent",
        phone: "+2348000000002",
        email: "agent-b@tenant-b.integration",
        pinHash: "integration-pin-hash-b",
        tenantId: TENANT_B,
      })
      .returning();
    agentAId = aA!.id;
    agentBId = aB!.id;
  });

  afterAll(async () => {
    console.log(`[integration] ${FILE}: ${getAssertionCount()} assertions`);
    // The suite shares one database across files (isolate:false, single
    // fork): remove all seeded rows so aggregate assertions in other files
    // (e.g. disputeRefund.getSummary global counts) are unaffected.
    try {
      const db = (await getDb())!;
      await db.delete(refunds).where(eq(refunds.disputeId, disputeAId));
      await db.delete(refunds).where(eq(refunds.disputeId, disputeBId));
      await db.delete(claims).where(eq(claims.policyId, policyAId));
      await db.delete(claims).where(eq(claims.policyId, policyBId));
      await db.delete(disputes).where(eq(disputes.id, disputeAId));
      await db.delete(disputes).where(eq(disputes.id, disputeBId));
      await db.delete(policies).where(eq(policies.id, policyAId));
      await db.delete(policies).where(eq(policies.id, policyBId));
      await db.delete(agents).where(eq(agents.id, agentAId));
      await db.delete(agents).where(eq(agents.id, agentBId));
    } catch (err) {
      console.warn(`[integration] ${FILE}: cleanup failed: ${String(err)}`);
    }
  });

  // ── Policies ─────────────────────────────────────────────────────────────
  it("listPolicies returns only the caller's tenant rows", async () => {
    const resA = await callerFor(userA).insuranceWorkflows.listPolicies({
      limit: 100,
      offset: 0,
    });
    expect(resA.policies.length).toBeGreaterThan(0);
    expect(resA.policies.every(p => p.tenantId === TENANT_A)).toBe(true);
    expect(resA.policies.some(p => p.id === policyBId)).toBe(false);

    const resB = await callerFor(userB).insuranceWorkflows.listPolicies({
      limit: 100,
      offset: 0,
    });
    expect(resB.policies.every(p => p.tenantId === TENANT_B)).toBe(true);
    expect(resB.policies.some(p => p.id === policyAId)).toBe(false);
  });

  it("getPolicyById denies cross-tenant reads (IDOR) but allows own tenant", async () => {
    // Positive control: tenant A reads its own policy.
    const own = await callerFor(userA).insuranceWorkflows.getPolicyById({
      policyId: policyAId,
    });
    expect(own?.id).toBe(policyAId);

    // Negative: tenant A attempts to read tenant B's policy by id.
    await expectTrpcError(
      callerFor(userA).insuranceWorkflows.getPolicyById({ policyId: policyBId }),
      "FORBIDDEN"
    );
  });

  // ── Claims ───────────────────────────────────────────────────────────────
  it("listClaims returns only the caller's tenant rows", async () => {
    const resA = await callerFor(userA).insuranceWorkflows.listClaims({
      limit: 100,
      offset: 0,
    });
    expect(resA.claims.length).toBeGreaterThan(0);
    expect(resA.claims.every(c => c.tenantId === TENANT_A)).toBe(true);
    expect(resA.claims.some(c => c.id === claimBId)).toBe(false);
  });

  it("getClaimById denies cross-tenant reads (IDOR)", async () => {
    await expectTrpcError(
      callerFor(userA).insuranceWorkflows.getClaimById({ claimId: claimBId }),
      "FORBIDDEN"
    );
  });

  // ── Disputes / refunds ───────────────────────────────────────────────────
  it("disputeRefund.list returns only the caller's tenant disputes", async () => {
    const resA = await callerFor(userA).disputeRefund.list({
      limit: 100,
      offset: 0,
      status: "all",
    });
    expect(resA.data.length).toBeGreaterThan(0);
    expect(resA.data.every((d: any) => d.tenantId === TENANT_A)).toBe(true);
    expect(resA.data.some((d: any) => d.id === disputeBId)).toBe(false);
  });

  it("initiateRefund against another tenant's dispute is denied and writes nothing", async () => {
    const before = await refundCountForDispute(disputeBId);
    await expectTrpcError(
      callerFor(userA).disputeRefund.initiateRefund({
        disputeId: disputeBId,
        amount: 2500,
        reason: "Cross-tenant refund abuse attempt",
        customerId: 920201,
        accountNumber: "0123456789",
      }),
      "FORBIDDEN"
    );
    expect(await refundCountForDispute(disputeBId)).toBe(before);
  });

  it("initiateRefund for own tenant's dispute still works and is tagged with tenantId", async () => {
    const res = await callerFor(userA).disputeRefund.initiateRefund({
      disputeId: disputeAId,
      amount: 2500,
      reason: "Legitimate same-tenant refund request",
      customerId: 920101,
      accountNumber: "0123456789",
    });
    expect(res.success).toBe(true);

    // Look up by the returned ref, not disputeId: other test files insert
    // refunds with colliding numeric disputeIds (the column is not a FK).
    const db = (await getDb())!;
    const rows = await db
      .select()
      .from(refunds)
      .where(eq(refunds.ref, res.refundId));
    expect(rows.length).toBe(1);
    expect(rows[0]!.tenantId).toBe(TENANT_A);
    expect(rows[0]!.status).toBe("pending");
    expect(rows[0]!.disputeId).toBe(disputeAId);
  });

  it("getSummary aggregates are scoped to the caller's tenant", async () => {
    const summaryA = await callerFor(userA).disputeRefund.getSummary();
    const summaryB = await callerFor(userB).disputeRefund.getSummary();
    // Tenant A initiated one pending refund above; tenant B has none.
    expect(summaryA.pendingRefunds).toBe(1);
    expect(summaryB.pendingRefunds).toBe(0);
    expect(summaryA.totalDisputes).toBeGreaterThan(0);
    expect(summaryB.totalDisputes).toBeGreaterThan(0);
  });

  // ── Agent PII ────────────────────────────────────────────────────────────
  it("agent.list returns only the caller's tenant agents (no PII leak)", async () => {
    const resA = await callerFor(userA).agent.list({
      status: "all",
      tier: "all",
      sortBy: "createdAt",
      sortOrder: "desc",
      page: 1,
      limit: 200,
    });
    const ids = resA.agents.map(a => a.id);
    expect(ids).toContain(agentAId);
    expect(ids).not.toContain(agentBId);
    const phones = resA.agents.map(a => a.phone);
    expect(phones).not.toContain("+2348000000002");
  });

  it("agent.getById denies cross-tenant reads (IDOR on agent PII)", async () => {
    const own = await callerFor(userA).agent.getById({ id: agentAId });
    expect(own.id).toBe(agentAId);

    await expectTrpcError(
      callerFor(userA).agent.getById({ id: agentBId }),
      "FORBIDDEN"
    );
  });

  // ── Platform-scope assumption (documented, not a leak) ──────────────────
  it("platform-level users (no tenantId) remain unscoped across tenants", async () => {
    const res = await callerFor(platformUser).insuranceWorkflows.listPolicies({
      limit: 100,
      offset: 0,
    });
    const ids = res.policies.map(p => p.id);
    expect(ids).toContain(policyAId);
    expect(ids).toContain(policyBId);
  });
});
