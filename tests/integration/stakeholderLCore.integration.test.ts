/**
 * stakeholderLCore.integration.test.ts — L-wave (core) stakeholder-security
 * fixes against the REAL PG (PGlite) schema + mini-Redis + mini-TigerBeetle.
 * No mocks.
 *
 *  L-S-1 assignClaim: staff-only; adjusterId must be an active
 *        claims_adjuster stakeholder with claim authority (fail-closed).
 *  L-S-2/L-P-2 assessRisk: staff / active-underwriter gate, draft|quoted
 *        state guard, atomic transitions.
 *  L-S-3 claims SoD: adjudicator ≠ filer, settler ≠ adjudicator (Keycloak
 *        identities, NULL fails closed); settlement requires a beneficiary of
 *        record (caller-supplied account fallback deleted).
 *  L-P-1 registerBroker: pending (isActive:false), server-defaulted
 *        commission; admin-only approveBroker.
 *  L-P-3 getBrokerPortfolio scoped to the owning broker or staff.
 *  L-P-4 bindPolicy: quoteRef must reference a real unconsumed quote owned by
 *        the customer; premium/sumInsured derived from the quote; brokerId
 *        derived server-side.
 *
 * 2026-09-19. Ids 970xxx / policy numbers L-CORE-* are unique to this file.
 */
import { eq } from "drizzle-orm";
import { describe, it, beforeAll, afterAll } from "vitest";

import {
  beneficiaries,
  claims,
  insuranceProducts,
  policies,
  stakeholderProfiles,
} from "../../drizzle/schema";
import { getDb } from "../../server/db";
import {
  callerFor,
  adminUser,
  regularUser,
  approverUser,
  type TestUser,
  expectCounted as expect,
  expectTrpcError,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";

const NOW = Date.now();
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

// Distinct Keycloak identities — SoD compares keycloakSub, NULL fails closed.
const supervisorUser: TestUser = {
  id: 970002,
  email: "l-core-supervisor@integration.local",
  name: "L Supervisor",
  role: "supervisor",
  keycloakSub: "kc-l-core-supervisor-970002",
};
const underwriterUser: TestUser = {
  id: 970014,
  email: "l-core-uw@integration.local",
  name: "L Underwriter",
  role: "user",
  keycloakSub: "kc-l-core-uw-970014",
};
/** Admin whose user id EQUALS the claimant id (self-dealing case). */
const claimantAdminUser: TestUser = {
  id: 970021,
  email: "l-core-claimant-admin@integration.local",
  name: "L Claimant Admin",
  role: "admin",
  keycloakSub: "kc-l-core-claimant-admin-970021",
};

const ADJUSTER_OK = 970011;
const ADJUSTER_INACTIVE = 970012;
const ADJUSTER_LOW_AUTHORITY = 970013;
const CUSTOMER = 970021;

/** Distinct staff identity from the filer (L-S-3 SoD). */
const adjudicator = () => callerFor(approverUser);

let productId: number;
let activePolicyId: number; // CUSTOMER-owned, active, sum 100k, premium 10k
let brokerId: number;

async function seedPolicy(over: Partial<typeof policies.$inferInsert> & { policyNumber: string }) {
  const db = (await getDb())!;
  const [p] = await db.insert(policies).values({
    productId,
    customerId: CUSTOMER,
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

async function seedClaim(policyId: number, suffix: string, status = "submitted") {
  const db = (await getDb())!;
  const [c] = await db.insert(claims).values({
    claimNumber: `CLM-L-CORE-${suffix}`,
    policyId,
    claimantId: CUSTOMER,
    status,
    claimType: "death",
    incidentDate: new Date(NOW - 10 * DAY),
    reportedDate: new Date(),
    claimedAmount: "5000",
    incidentDescription: `L-wave seeded claim ${suffix}`,
  }).returning();
  return c;
}

beforeAll(async () => {
  resetAssertionCount();
  const db = (await getDb())!;

  const [prod] = await db.insert(insuranceProducts).values({
    productCode: "L-CORE-1",
    name: "L-Core Test Life",
    coverageType: "life",
    minPremium: "10000.00",
    maxCoverageAmount: "500000.00",
    isActive: true,
  } as typeof insuranceProducts.$inferInsert).returning();
  productId = prod!.id;

  const p = await seedPolicy({ policyNumber: "L-CORE-ACTIVE-1" });
  activePolicyId = p.id;

  // L-S-1 adjuster fixtures: valid / inactive / insufficient authority.
  await db.insert(stakeholderProfiles).values([
    { userId: ADJUSTER_OK, role: "claims_adjuster", maxClaimAuthority: "100000000.00", isActive: true },
    { userId: ADJUSTER_INACTIVE, role: "claims_adjuster", maxClaimAuthority: "100000000.00", isActive: false },
    { userId: ADJUSTER_LOW_AUTHORITY, role: "claims_adjuster", maxClaimAuthority: "100.00", isActive: true },
    // L-S-2 underwriter fixture (active underwriter stakeholder, role "user").
    { userId: underwriterUser.id, role: "underwriter", isActive: true },
  ] as (typeof stakeholderProfiles.$inferInsert)[]).onConflictDoNothing();
});

afterAll(() => {
  console.log(`[stakeholderLCore] assertions: ${getAssertionCount()}`);
});

describe("L-S-1 assignClaim: staff gate + valid adjuster", () => {
  it("non-staff caller is rejected", async () => {
    const c = await seedClaim(activePolicyId, "ASG-1");
    await expectTrpcError(
      callerFor(regularUser).insuranceWorkflows.assignClaim({ claimId: c!.id, adjusterId: ADJUSTER_OK }),
      "FORBIDDEN"
    );
  });

  it("unknown / inactive / under-authorised adjusters are rejected (fail-closed)", async () => {
    const admin = callerFor(adminUser);
    const c1 = await seedClaim(activePolicyId, "ASG-2");
    await expectTrpcError(
      admin.insuranceWorkflows.assignClaim({ claimId: c1!.id, adjusterId: 979999 }),
      "FORBIDDEN"
    );
    await expectTrpcError(
      admin.insuranceWorkflows.assignClaim({ claimId: c1!.id, adjusterId: ADJUSTER_INACTIVE }),
      "FORBIDDEN"
    );
    await expectTrpcError(
      admin.insuranceWorkflows.assignClaim({ claimId: c1!.id, adjusterId: ADJUSTER_LOW_AUTHORITY }),
      "FORBIDDEN"
    );
  });

  it("staff assigns to a valid adjuster and the assignment is audited", async () => {
    const c = await seedClaim(activePolicyId, "ASG-3");
    const res = await callerFor(supervisorUser).insuranceWorkflows.assignClaim({
      claimId: c!.id, adjusterId: ADJUSTER_OK,
    });
    expect(res.success).toBe(true);
    const db = (await getDb())!;
    const [after] = await db.select().from(claims).where(eq(claims.id, c!.id));
    expect(after.assignedAdjusterId).toBe(ADJUSTER_OK);
    expect(after.status).toBe("under_review");
  });
});

describe("L-S-2/L-P-2 assessRisk: underwriter gate + state guard", () => {
  it("plain authenticated user cannot make underwriting decisions", async () => {
    const p = await seedPolicy({ policyNumber: "L-CORE-UW-1", status: "draft" });
    await expectTrpcError(
      callerFor(regularUser).insuranceWorkflows.assessRisk({
        policyId: p.id, riskScore: 10, riskCategory: "low", decision: "approved",
      }),
      "FORBIDDEN"
    );
    const db = (await getDb())!;
    const [after] = await db.select().from(policies).where(eq(policies.id, p.id));
    expect(after.status).toBe("draft");
  });

  it("active underwriter stakeholder can bind a draft policy; terminal states are guarded", async () => {
    const p = await seedPolicy({ policyNumber: "L-CORE-UW-2", status: "draft" });
    const res = await callerFor(underwriterUser).insuranceWorkflows.assessRisk({
      policyId: p.id, riskScore: 20, riskCategory: "low", decision: "approved",
    });
    expect(res.assessment).toBeTruthy();
    const db = (await getDb())!;
    const [after] = await db.select().from(policies).where(eq(policies.id, p.id));
    expect(after.status).toBe("bound");
    // A decided policy cannot be re-assessed (state guard).
    await expectTrpcError(
      callerFor(adminUser).insuranceWorkflows.assessRisk({
        policyId: p.id, riskScore: 90, riskCategory: "declined", decision: "declined",
      }),
      "CONFLICT"
    );
  });

  it("staff decline cancels a draft policy", async () => {
    const p = await seedPolicy({ policyNumber: "L-CORE-UW-3", status: "quoted" });
    await callerFor(supervisorUser).insuranceWorkflows.assessRisk({
      policyId: p.id, riskScore: 95, riskCategory: "declined", decision: "declined",
    });
    const db = (await getDb())!;
    const [after] = await db.select().from(policies).where(eq(policies.id, p.id));
    expect(after.status).toBe("cancelled");
  });
});

describe("L-S-3 claims segregation of duties", () => {
  it("the filer cannot adjudicate their own filing; claimant-admin cannot adjudicate", async () => {
    const admin = callerFor(adminUser);
    const { claim } = await admin.insuranceWorkflows.fileClaim({
      policyId: activePolicyId, claimType: "death", incidentDate: iso(NOW - 9 * DAY),
      claimedAmount: 4000, incidentDescription: "L-S-3 self-adjudicate probe",
    });
    // Filer == adjudicator → FORBIDDEN.
    await expectTrpcError(
      admin.insuranceWorkflows.adjudicateClaim({ claimId: claim.id, decision: "approved", approvedAmount: 4000 }),
      "FORBIDDEN"
    );
    // Claimant id == caller id (claimant-admin) → FORBIDDEN even though not the filer.
    await expectTrpcError(
      callerFor(claimantAdminUser).insuranceWorkflows.adjudicateClaim({ claimId: claim.id, decision: "approved", approvedAmount: 4000 }),
      "FORBIDDEN"
    );
    // A distinct staff adjudicator works.
    await adjudicator().insuranceWorkflows.adjudicateClaim({
      claimId: claim.id, decision: "approved", approvedAmount: 4000,
    });
  });

  it("caller without verifiable Keycloak identity is refused (fail-closed)", async () => {
    const c = await seedClaim(activePolicyId, "SOD-2");
    const anonSubAdmin = callerFor({ ...approverUser, id: 970031, keycloakSub: undefined });
    await expectTrpcError(
      anonSubAdmin.insuranceWorkflows.adjudicateClaim({ claimId: c!.id, decision: "approved", approvedAmount: 1000 }),
      "FORBIDDEN"
    );
  });

  it("the adjudicator cannot settle; settlement without beneficiary row fails closed", async () => {
    const db = (await getDb())!;
    const p = await seedPolicy({ policyNumber: "L-CORE-SOD-3" });
    const admin = callerFor(adminUser);
    const { claim } = await admin.insuranceWorkflows.fileClaim({
      policyId: p.id, claimType: "death", incidentDate: iso(NOW - 8 * DAY),
      claimedAmount: 3000, incidentDescription: "L-S-3 self-settle probe",
    });
    await adjudicator().insuranceWorkflows.adjudicateClaim({
      claimId: claim.id, decision: "approved", approvedAmount: 3000,
    });
    // Settler == adjudicator → FORBIDDEN.
    await expectTrpcError(
      adjudicator().insuranceWorkflows.settleClaimPayment({ claimId: claim.id, paymentMethod: "bank_transfer" }),
      "FORBIDDEN"
    );
    // Distinct settler but NO beneficiary of record → PRECONDITION_FAILED
    // (the caller-supplied account fallback is deleted).
    await expectTrpcError(
      admin.insuranceWorkflows.settleClaimPayment({
        claimId: claim.id, paymentMethod: "bank_transfer", beneficiaryAccount: "ATTACKER-ACCOUNT-1",
      }),
      "PRECONDITION_FAILED"
    );
    // With a beneficiary of record, a distinct settler pays the recorded
    // beneficiary — the attacker account is ignored.
    await db.insert(beneficiaries).values({
      policyId: p.id, name: "L Beneficiary", relationship: "spouse", percentage: "100", nationalId: "L-NIN-1",
    });
    const res = await admin.insuranceWorkflows.settleClaimPayment({
      claimId: claim.id, paymentMethod: "bank_transfer", beneficiaryAccount: "ATTACKER-ACCOUNT-2",
    });
    expect((res.payment as { beneficiaryName: string }).beneficiaryName).toBe("L Beneficiary");
    expect((res.payment as { beneficiaryAccount: string }).beneficiaryAccount).toBe("L-NIN-1");
  });

  it("settlement without verifiable adjudication provenance fails closed", async () => {
    // Seeded straight into "approved" with NO adjudication workflow event.
    const db = (await getDb())!;
    const p = await seedPolicy({ policyNumber: "L-CORE-SOD-4" });
    await db.insert(beneficiaries).values({
      policyId: p.id, name: "L Beneficiary 4", relationship: "spouse", percentage: "100",
    });
    const [c] = await db.insert(claims).values({
      claimNumber: "CLM-L-CORE-SOD-4",
      policyId: p.id,
      claimantId: CUSTOMER,
      status: "approved",
      claimType: "death",
      incidentDate: new Date(NOW - 10 * DAY),
      reportedDate: new Date(),
      claimedAmount: "5000",
      approvedAmount: "5000",
      incidentDescription: "no adjudication event provenance",
    }).returning();
    await expectTrpcError(
      callerFor(adminUser).insuranceWorkflows.settleClaimPayment({ claimId: c!.id, paymentMethod: "bank_transfer" }),
      "PRECONDITION_FAILED"
    );
  });
});

describe("L-P-1 broker registration approval gate", () => {
  it("registration is PENDING with server-defaulted commission; non-admin approve rejected; admin approves", async () => {
    const reg = await callerFor(regularUser).insuranceWorkflows.registerBroker({
      companyName: "L-Core Brokers Ltd",
      licenseNumber: "NAICOM-L-CORE-001",
      licenseExpiry: iso(NOW + 365 * DAY),
      naicomRegNumber: "NCR-L-CORE-1",
      contactEmail: "l-core-broker@integration.local",
      contactPhone: "09170000001",
      address: "1 Integration Way, Lagos",
    });
    brokerId = reg.broker.id;
    expect(reg.status).toBe("pending_approval");
    expect(reg.broker.isActive).toBe(false);
    expect(Number(reg.broker.commissionRate)).toBeCloseTo(0.05, 4);

    await expectTrpcError(
      callerFor(regularUser).insuranceWorkflows.approveBroker({ brokerId }),
      "FORBIDDEN"
    );
    // Supervisor is staff but not admin — approval is admin-only.
    await expectTrpcError(
      callerFor(supervisorUser).insuranceWorkflows.approveBroker({ brokerId }),
      "FORBIDDEN"
    );
    const ok = await callerFor(adminUser).insuranceWorkflows.approveBroker({ brokerId, reviewNotes: "license on record" });
    expect(ok.approved).toBe(true);
    expect(ok.broker.isActive).toBe(true);
  });

  it("L-P-3: portfolio reads are scoped to the owning broker or staff", async () => {
    const other: TestUser = {
      id: 970041, email: "l-core-other@integration.local", name: "L Other",
      role: "user", keycloakSub: "kc-l-core-other-970041",
    };
    await expectTrpcError(
      callerFor(other).insuranceWorkflows.getBrokerPortfolio({ brokerId }),
      "FORBIDDEN"
    );
    const own = await callerFor(regularUser).insuranceWorkflows.getBrokerPortfolio({ brokerId });
    expect(own.total).toBeGreaterThanOrEqual(0);
    const staff = await callerFor(adminUser).insuranceWorkflows.getBrokerPortfolio({ brokerId });
    expect(staff.total).toBeGreaterThanOrEqual(0);
  });
});

describe("L-P-4 bindPolicy: real quote required, terms derived", () => {
  it("bogus quoteRef is rejected", async () => {
    await expectTrpcError(
      callerFor(adminUser).insuranceWorkflows.bindPolicy({
        quoteRef: "QT-BOGUS-L-CORE", productId, customerId: CUSTOMER, startDate: iso(NOW),
      }),
      "NOT_FOUND"
    );
  });

  it("ghost premium is impossible; the quote is consumed exactly once", async () => {
    const admin = callerFor(adminUser);
    const q = await admin.insuranceWorkflows.getQuote({
      productId, customerId: CUSTOMER, coverageAmount: 50000, startDate: iso(NOW),
    });
    // Caller asserting a DIFFERENT premium than the quote → rejected.
    await expectTrpcError(
      admin.insuranceWorkflows.bindPolicy({
        quoteRef: q.quoteRef, productId, customerId: CUSTOMER,
        annualPremium: q.annualPremium + 1, startDate: iso(NOW),
      }),
      "BAD_REQUEST"
    );
    // Terms derived from the quote bind successfully...
    const bound = await admin.insuranceWorkflows.bindPolicy({
      quoteRef: q.quoteRef, productId, customerId: CUSTOMER, startDate: iso(NOW),
    });
    // 2026-09-19 (L-wave validation): the policies.annualPremium decimal
    // column returns scale-2 strings ("10000.00"), while the quote's
    // annualPremium is a JS number — String(10000) would be "10000" and fail.
    expect(bound.policy.annualPremium).toBe(q.annualPremium.toFixed(2));
    expect(bound.policy.sumInsured).toBe("50000.00");
    // ...and the quote cannot be consumed twice.
    await expectTrpcError(
      admin.insuranceWorkflows.bindPolicy({
        quoteRef: q.quoteRef, productId, customerId: CUSTOMER, startDate: iso(NOW),
      }),
      "CONFLICT"
    );
  });

  it("cross-customer quote use is rejected (QUOTE_OWNERSHIP)", async () => {
    const admin = callerFor(adminUser);
    const q = await admin.insuranceWorkflows.getQuote({
      productId, customerId: CUSTOMER, coverageAmount: 20000, startDate: iso(NOW),
    });
    await expectTrpcError(
      admin.insuranceWorkflows.bindPolicy({
        quoteRef: q.quoteRef, productId, customerId: 970099, startDate: iso(NOW),
      }),
      "FORBIDDEN"
    );
  });
});

