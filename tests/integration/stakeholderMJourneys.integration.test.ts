/**
 * stakeholderMJourneys.integration.test.ts — M-wave fixes against the REAL
 * PG (PGlite) schema + mini-Redis + mini-TigerBeetle. No mocks.
 *
 *  W1 (funds) — Temporal claims journey (triggerJ03) previously bypassed the
 *        hardened router SoD: caller-chosen customerId/claimedAmount/
 *        beneficiaryAccount auto-settled real TigerBeetle funds.
 *        - Router: session-derived customerId, server-side coverage check,
 *          beneficiary fields removed from the trigger contract.
 *        - Journey auto-adjudication capped at ₦200,000 and staff-initiated
 *          only; everything else routes to the staff adjudication queue
 *          (status pending_adjudication, migration 0084).
 *        - Activity-level settleClaimPayment enforces the beneficiary of
 *          record and the adjudicated amount (defense in depth).
 *        - assignClaimAdjuster activity requires a staff workflow context.
 *        - cvClaims auto-approve claim-status flip removed (advisory only).
 *  W2 (data) — listPolicies/listClaims: platform-scope (tenantId=0 sentinel)
 *        reads require the admin role; non-admin fails closed.
 *
 * Note: Temporal is not running in this environment, so triggerJ03 success
 * paths are asserted to PASS ALL validation and fail only at workflow start
 * (INTERNAL_SERVER_ERROR from the Temporal client) — never with an
 * authz/validation error code.
 *
 * 2026-09-19. Ids 971xxx / claim numbers M-WAVE-* are unique to this file.
 */
import { eq } from "drizzle-orm";
import { describe, it, beforeAll, afterAll } from "vitest";

import {
  beneficiaries,
  claims,
  customers,
  insuranceProducts,
  policies,
  stakeholderProfiles,
} from "../../drizzle/schema";
import { getDb } from "../../server/db";
import {
  assignClaimAdjuster,
  adjudicateClaim as activityAdjudicateClaim,
  routeClaimToAdjudicationQueue,
  settleClaimPayment as activitySettleClaimPayment,
} from "../../server/journey-activities";
import {
  J03_AUTO_ADJUDICATION_CAP_NGN,
  resolveJ03AdjudicationRoute,
} from "../../server/lib/claimsJourneyPolicy";
import {
  callerFor,
  adminUser,
  type TestUser,
  expectCounted as expect,
  expectTrpcError,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";

const NOW = Date.now();
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

/** Customer-account user (non-staff) whose customers row binds by keycloakSub. */
const customerUser: TestUser = {
  id: 971001,
  email: "m-wave-customer@integration.local",
  name: "M Customer",
  role: "user",
  keycloakSub: "kc-m-wave-customer-971001",
};
/** A second non-staff user with NO customer profile. */
const noProfileUser: TestUser = {
  id: 971002,
  email: "m-wave-noprofile@integration.local",
  name: "M NoProfile",
  role: "user",
  keycloakSub: "kc-m-wave-noprofile-971002",
};
const staffUser: TestUser = {
  id: 971003,
  email: "m-wave-staff@integration.local",
  name: "M Staff",
  role: "supervisor",
  keycloakSub: "kc-m-wave-staff-971003",
};
/** Non-admin platform-scope user (tenantId NULL sentinel). */
const platformUser: TestUser = {
  id: 971004,
  email: "m-wave-platform@integration.local",
  name: "M Platform",
  role: "user",
  tenantId: null,
};
/** Non-admin tenant users for W2 scoping. */
const tenantUserA: TestUser = { id: 971005, email: "m-ta@integration.local", name: "M TA", role: "user", tenantId: 971101 };
const tenantUserB: TestUser = { id: 971006, email: "m-tb@integration.local", name: "M TB", role: "user", tenantId: 971102 };

const CUSTOMER_ID = 971021;
const OTHER_CUSTOMER_ID = 971022;

let productId: number;
let ownPolicyId: number;    // CUSTOMER_ID-owned, active, sum 100k
let otherPolicyId: number;  // OTHER_CUSTOMER_ID-owned, active

async function seedPolicy(over: Partial<typeof policies.$inferInsert> & { policyNumber: string }) {
  const db = (await getDb())!;
  const [p] = await db.insert(policies).values({
    productId,
    customerId: CUSTOMER_ID,
    coverageType: "life",
    status: "active",
    sumInsured: "100000.00",
    annualPremium: "10000.00",
    startDate: new Date(NOW - 100 * DAY),
    endDate: new Date(NOW + 265 * DAY),
    ...over,
  } as typeof policies.$inferInsert).returning();
  return p;
}

async function seedClaim(policyId: number, suffix: string, status: string, approvedAmount?: string) {
  const db = (await getDb())!;
  const [c] = await db.insert(claims).values({
    claimNumber: `M-WAVE-${suffix}`,
    policyId,
    claimantId: CUSTOMER_ID,
    status,
    claimType: "death",
    incidentDate: new Date(NOW - 10 * DAY),
    reportedDate: new Date(),
    claimedAmount: "5000",
    approvedAmount,
    incidentDescription: `M-wave seeded claim ${suffix}`,
  } as typeof claims.$inferInsert).returning();
  return c;
}

beforeAll(async () => {
  resetAssertionCount();
  const db = (await getDb())!;

  // customers rows: the non-staff caller's identity binds via keycloakSub
  // (triggerJ02 convention, reused by the M-wave J03 guard).
  await db.insert(customers).values([
    { id: CUSTOMER_ID, firstName: "M", lastName: "Customer", phone: "+234971000001", keycloakSub: String(customerUser.id) },
    { id: OTHER_CUSTOMER_ID, firstName: "M", lastName: "Other", phone: "+234971000002", keycloakSub: "kc-m-wave-other-971099" },
  ] as (typeof customers.$inferInsert)[]).onConflictDoNothing();

  const [prod] = await db.insert(insuranceProducts).values({
    productCode: "M-WAVE-1",
    name: "M-Wave Test Life",
    coverageType: "life",
    minPremium: "10000.00",
    maxCoverageAmount: "500000.00",
    isActive: true,
  } as typeof insuranceProducts.$inferInsert).returning();
  productId = prod!.id;

  ownPolicyId = (await seedPolicy({ policyNumber: "M-WAVE-OWN-1" })).id;
  otherPolicyId = (await seedPolicy({ policyNumber: "M-WAVE-OTHER-1", customerId: OTHER_CUSTOMER_ID })).id;

  // W2 tenant rows: one policy + one claim per tenant.
  await seedPolicy({ policyNumber: "M-WAVE-TA-1", tenantId: 971101 });
  await seedPolicy({ policyNumber: "M-WAVE-TB-1", tenantId: 971102 });
});

afterAll(() => {
  console.log(`[stakeholderMJourneys] assertions: ${getAssertionCount()}`);
});

describe("W1 triggerJ03: ownership + coverage guard (router level)", () => {
  const baseInput = {
    policyId: 0, // filled per-test
    customerId: CUSTOMER_ID,
    claimType: "death",
    incidentDate: iso(NOW - 9 * DAY),
    claimedAmount: 5000,
    description: "M-wave triggerJ03 probe",
    paymentRef: "M-WAVE-PAY-1",
  };

  it("anonymous callers are rejected", async () => {
    await expectTrpcError(
      callerFor(null).journeyOrchestratorV2.triggerJ03({ ...baseInput, policyId: ownPolicyId }),
      "UNAUTHORIZED"
    );
  });

  it("non-staff caller without a customer profile is rejected (fail-closed)", async () => {
    await expectTrpcError(
      callerFor(noProfileUser).journeyOrchestratorV2.triggerJ03({ ...baseInput, policyId: ownPolicyId }),
      "FORBIDDEN"
    );
  });

  it("non-staff caller cannot file against someone else's customerId", async () => {
    await expectTrpcError(
      callerFor(customerUser).journeyOrchestratorV2.triggerJ03({
        ...baseInput, policyId: otherPolicyId, customerId: OTHER_CUSTOMER_ID,
      }),
      "FORBIDDEN"
    );
  });

  it("non-staff caller cannot claim against a policy they do not own", async () => {
    await expectTrpcError(
      callerFor(customerUser).journeyOrchestratorV2.triggerJ03({
        ...baseInput, policyId: otherPolicyId, customerId: CUSTOMER_ID,
      }),
      "FORBIDDEN"
    );
  });

  it("claimedAmount above the policy coverage is rejected server-side", async () => {
    await expectTrpcError(
      callerFor(customerUser).journeyOrchestratorV2.triggerJ03({
        ...baseInput, policyId: ownPolicyId, claimedAmount: 500_000,
      }),
      "BAD_REQUEST"
    );
  });

  it("a valid non-staff trigger passes ALL validation (fails only at Temporal start)", async () => {
    // Temporal is not running here; reaching the workflow-start failure
    // proves ownership + coverage validation passed. beneficiaryAccount is
    // no longer in the contract — a smuggled value is stripped by zod.
    try {
      await callerFor(customerUser).journeyOrchestratorV2.triggerJ03({
        ...baseInput, policyId: ownPolicyId,
        beneficiaryAccount: "ATTACKER-ACCOUNT-M1",
      } as never);
      throw new Error("expected workflow start to fail without Temporal");
    } catch (err) {
      const code = (err as { code?: string }).code;
      expect(code).toBe("INTERNAL_SERVER_ERROR");
    }
  });

  it("staff may act on behalf of an existing customer; unknown customers are rejected", async () => {
    await expectTrpcError(
      callerFor(staffUser).journeyOrchestratorV2.triggerJ03({
        ...baseInput, policyId: ownPolicyId, customerId: 971999,
      }),
      "NOT_FOUND"
    );
    try {
      await callerFor(staffUser).journeyOrchestratorV2.triggerJ03({ ...baseInput, policyId: ownPolicyId });
      throw new Error("expected workflow start to fail without Temporal");
    } catch (err) {
      expect((err as { code?: string }).code).toBe("INTERNAL_SERVER_ERROR");
    }
  });

  it("the generic trigger cannot start J03 and cannot smuggle staff context", async () => {
    await expectTrpcError(
      callerFor(staffUser).journeyOrchestratorV2.trigger({
        journeyId: "J03",
        input: { policyId: ownPolicyId, customerId: CUSTOMER_ID, claimedAmount: 1000, initiatedByStaff: true, beneficiaryAccount: "X" },
      }),
      "BAD_REQUEST"
    );
  });
});

describe("W1 journey policy: auto-adjudication tier", () => {
  it("routing: customer-initiated or above-cap claims go to the staff queue", () => {
    expect(resolveJ03AdjudicationRoute(5_000, true)).toBe("auto");
    expect(resolveJ03AdjudicationRoute(J03_AUTO_ADJUDICATION_CAP_NGN, true)).toBe("auto");
    expect(resolveJ03AdjudicationRoute(J03_AUTO_ADJUDICATION_CAP_NGN + 1, true)).toBe("staff_queue");
    expect(resolveJ03AdjudicationRoute(1_000, false)).toBe("staff_queue");
    expect(resolveJ03AdjudicationRoute(Number.NaN, true)).toBe("staff_queue");
  });

  it("routeClaimToAdjudicationQueue moves the claim to pending_adjudication", async () => {
    const c = await seedClaim(ownPolicyId, "QUEUE-1", "submitted");
    await routeClaimToAdjudicationQueue({ claimId: c!.id, reason: "above auto tier", triggeredBy: staffUser.id });
    const db = (await getDb())!;
    const [after] = await db.select().from(claims).where(eq(claims.id, c!.id));
    expect(after.status).toBe("pending_adjudication");
  });

  it("staff queue claims are assignable + adjudicable via the hardened router path", async () => {
    const db = (await getDb())!;
    await db.insert(stakeholderProfiles).values({
      userId: 971031, role: "claims_adjuster", maxClaimAuthority: "100000000.00", isActive: true,
    } as typeof stakeholderProfiles.$inferInsert).onConflictDoNothing();
    const c = await seedClaim(ownPolicyId, "QUEUE-2", "pending_adjudication");
    const res = await callerFor(staffUser).insuranceWorkflows.assignClaim({ claimId: c!.id, adjusterId: 971031 });
    expect(res.success).toBe(true);
    // A distinct staff adjudicator decides (filer is null for seeded rows).
    const adj = await callerFor(adminUser).insuranceWorkflows.adjudicateClaim({
      claimId: c!.id, decision: "approved", approvedAmount: 4000,
    });
    expect(adj).toBeTruthy();
    const [after] = await db.select().from(claims).where(eq(claims.id, c!.id));
    expect(after.status).toBe("approved");
  });
});

describe("W1 journey activities: defense in depth", () => {
  it("assignClaimAdjuster refuses non-staff workflow contexts (fail-closed)", async () => {
    const c = await seedClaim(ownPolicyId, "ADJ-ACT-1", "submitted");
    await expect(assignClaimAdjuster({ claimId: c!.id })).rejects.toThrow(/staff-initiated/);
    await expect(assignClaimAdjuster({ claimId: c!.id, staffContext: false })).rejects.toThrow(/staff-initiated/);
    const ok = await assignClaimAdjuster({ claimId: c!.id, staffContext: true });
    expect(ok.adjusterId).toBeGreaterThan(0);
  });

  it("journey adjudicateClaim refuses approvals above the auto tier", async () => {
    const c = await seedClaim(ownPolicyId, "ADJ-ACT-2", "under_review");
    await expect(
      activityAdjudicateClaim({ claimId: c!.id, decision: "approved", approvedAmount: J03_AUTO_ADJUDICATION_CAP_NGN + 1, adjusterId: 1 })
    ).rejects.toThrow(/auto-tier/);
    await expect(
      activityAdjudicateClaim({ claimId: c!.id, decision: "approved", adjusterId: 1 })
    ).rejects.toThrow(/auto-tier/);
  });

  it("settleClaimPayment activity rejects claims with no beneficiary of record", async () => {
    const p = await seedPolicy({ policyNumber: "M-WAVE-NOBENE-1" });
    const c = await seedClaim(p.id, "SET-1", "approved", "5000");
    await expect(
      activitySettleClaimPayment({ claimId: c!.id, approvedAmount: 5000, paymentMethod: "bank_transfer", paymentRef: "M-WAVE-SET-1", beneficiaryAccount: "ATTACKER-ACCOUNT-M2" })
    ).rejects.toThrow(/no beneficiary of record/);
    const db = (await getDb())!;
    const [after] = await db.select().from(claims).where(eq(claims.id, c!.id));
    expect(after.status).toBe("approved"); // no funds moved, no state flip
  });

  it("settleClaimPayment activity rejects a caller-named account that is not the beneficiary of record", async () => {
    const p = await seedPolicy({ policyNumber: "M-WAVE-BENE-1" });
    const db = (await getDb())!;
    await db.insert(beneficiaries).values({
      policyId: p.id, name: "M Beneficiary", relationship: "spouse", percentage: "100", nationalId: "M-NIN-1",
    });
    const c = await seedClaim(p.id, "SET-2", "approved", "5000");
    await expect(
      activitySettleClaimPayment({ claimId: c!.id, approvedAmount: 5000, paymentMethod: "bank_transfer", paymentRef: "M-WAVE-SET-2", beneficiaryAccount: "ATTACKER-ACCOUNT-M3" })
    ).rejects.toThrow(/does not match the recorded beneficiary/);
  });

  it("settleClaimPayment activity pays the beneficiary of record at the adjudicated amount", async () => {
    const p = await seedPolicy({ policyNumber: "M-WAVE-BENE-2" });
    const db = (await getDb())!;
    await db.insert(beneficiaries).values({
      policyId: p.id, name: "M Beneficiary 2", relationship: "spouse", percentage: "100", nationalId: "M-NIN-2",
    });
    const c = await seedClaim(p.id, "SET-3", "approved", "5000");
    // A supplied amount that disagrees with the adjudicated amount is refused.
    await expect(
      activitySettleClaimPayment({ claimId: c!.id, approvedAmount: 9999, paymentMethod: "bank_transfer", paymentRef: "M-WAVE-SET-3X" })
    ).rejects.toThrow(/does not match the adjudicated amount/);
    const res = await activitySettleClaimPayment({
      claimId: c!.id, approvedAmount: 5000, paymentMethod: "bank_transfer", paymentRef: "M-WAVE-SET-3",
    });
    expect(res.settled).toBe(true);
    const [after] = await db.select().from(claims).where(eq(claims.id, c!.id));
    expect(after.status).toBe("paid");
    expect(Number(after.paidAmount)).toBe(5000);
  });
});

describe("W1 cvClaims: auto-approve flip removed", () => {
  it("assessDamage never flips the claim status (advisory only)", async () => {
    const c = await seedClaim(ownPolicyId, "CV-1", "submitted");
    // The CV service is unreachable in this environment → fallback assessment
    // (confidence 0); either way the claim status must remain untouched.
    await callerFor(customerUser).cvClaims.assessDamage({
      claimId: c!.id, imageUrls: ["https://example.local/m-wave-damage.jpg"], claimType: "motor",
    });
    const db = (await getDb())!;
    const [after] = await db.select().from(claims).where(eq(claims.id, c!.id));
    expect(after.status).toBe("submitted");
  });
});

describe("W2 listPolicies/listClaims: platform-scope reads require admin", () => {
  it("non-admin platform-scope (tenantId NULL sentinel) is denied", async () => {
    await expectTrpcError(
      callerFor(platformUser).insuranceWorkflows.listPolicies({ limit: 10, offset: 0 }),
      "FORBIDDEN"
    );
    await expectTrpcError(
      callerFor(platformUser).insuranceWorkflows.listClaims({ limit: 10, offset: 0 }),
      "FORBIDDEN"
    );
  });

  it("non-admin tenant users remain scoped to their own tenant", async () => {
    const resA = await callerFor(tenantUserA).insuranceWorkflows.listPolicies({ limit: 100, offset: 0 });
    expect(resA.policies.length).toBeGreaterThan(0);
    expect(resA.policies.every((p) => p.tenantId === 971101)).toBe(true);
    const resB = await callerFor(tenantUserB).insuranceWorkflows.listPolicies({ limit: 100, offset: 0 });
    expect(resB.policies.every((p) => p.tenantId === 971102)).toBe(true);
  });

  it("admin platform-scope reads still work (staff path)", async () => {
    const res = await callerFor(adminUser).insuranceWorkflows.listPolicies({ limit: 200, offset: 0 });
    expect(res.policies.some((p) => p.tenantId === 971101)).toBe(true);
    expect(res.policies.some((p) => p.tenantId === 971102)).toBe(true);
    const cl = await callerFor(adminUser).insuranceWorkflows.listClaims({ limit: 200, offset: 0 });
    expect(cl.claims.length).toBeGreaterThan(0);
  });
});
