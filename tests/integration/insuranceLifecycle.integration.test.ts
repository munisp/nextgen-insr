/**
 * insuranceLifecycle.integration.test.ts — Wave F2 audit-fix coverage for the
 * insurance lifecycle against the REAL PG (PGlite) schema + REAL mini
 * TigerBeetle ledger + REAL mini Redis lock server. No mocks.
 *
 * Covers: INS-1 (lapse/expiry sweeper), INS-2 (incident window), INS-3
 * (adjudication caps), INS-4 (duplicate-claim dedup), INS-5 (appeal path),
 * INS-7 (assign FROM-state guard), INS-8 (grace hold + arrears offset),
 * INS-9 (reinstatement), INS-10 (premium amount validation + idempotent
 * refs), INS-11 (renewal completion), INS-12 (cancel guards + cooling-off
 * refund), INS-13 (beneficiary CRUD + settlement resolution).
 *
 * All seeds use F2-* policy numbers / 980xxx ids — no other suite file
 * touches these (verified by grep at build time).
 */
import { eq } from "drizzle-orm";
import { describe, it, beforeAll, afterAll } from "vitest";

import {
  beneficiaries,
  claims,
  commissionClawbacks,
  policies,
  policyLifecycleStates,
  policyRenewals,
  premiumPayments,
} from "../../drizzle/schema";
import { getDb } from "../../server/db";
import {
  callerFor,
  adminUser,
  regularUser,
  expectCounted as expect,
  expectTrpcError,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";

const FILE = "insuranceLifecycle";
const CUST = 980001;
const OWNER = 91002; // regularUser.id — policyholder identity for ownership-guarded paths

// 2026-09-18 (F3 fail-closed financial RBAC, AUTH-17): insuranceWorkflows.cancelPolicy
// is now a financialProcedure ("refund"-class op) — the default "user" role is
// DENIED at authz, which would short-circuit BEFORE the ownership/open-claim
// guards this suite exists to exercise. ownerUser therefore carries
// "super_admin" (a role the permify map authorizes for "refund") while keeping
// regularUser.id so the OWNERSHIP semantics are unchanged: isOwner still
// drives the owner leg, and the non-owner call below still fails FORBIDDEN on
// ownership (super_admin is NOT the `role === "admin"` bypass in cancelPolicy).
const ownerUser = { ...regularUser, role: "super_admin" } as const;

const NOW = Date.now();
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

async function seedPolicy(over: Partial<typeof policies.$inferInsert> & { policyNumber: string }) {
  const db = (await getDb())!;
  const [p] = await db.insert(policies).values({
    productId: 1,
    customerId: CUST,
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

beforeAll(() => resetAssertionCount());
afterAll(() => {
  console.log(`[${FILE}] assertions: ${getAssertionCount()}`);
});

describe("INS-1 lapse/expiry sweeper + fileClaim re-check", () => {
  it("sweeps an active policy past endDate+grace to lapsed, then to expired past the reinstatement window", async () => {
    const db = (await getDb())!;
    const p = await seedPolicy({
      policyNumber: "F2-SWEEP-1",
      endDate: new Date(NOW - 40 * DAY), // 40d past end, default 30d grace → lapsed
    });
    const admin = callerFor(adminUser);
    const res = await admin.insuranceWorkflows.sweepPolicyLifecycle();
    expect(res.lapsed + res.expired).toBeGreaterThanOrEqual(1);
    const [after] = await db.select().from(policies).where(eq(policies.id, p.id));
    expect(after.status).toBe("lapsed");
    const [lc] = await db.select().from(policyLifecycleStates)
      .where(eq(policyLifecycleStates.policyId, p.id));
    expect(Number(lc.arrearsAmount)).toBe(10000); // one annual premium owed

    // Push past the 90-day reinstatement window and sweep again → expired.
    await db.update(policyLifecycleStates)
      .set({ lapsedAt: new Date(NOW - 100 * DAY) })
      .where(eq(policyLifecycleStates.policyId, p.id));
    const res2 = await admin.insuranceWorkflows.sweepPolicyLifecycle();
    expect(res2.expired).toBeGreaterThanOrEqual(1);
    const [final] = await db.select().from(policies).where(eq(policies.id, p.id));
    expect(final.status).toBe("expired");
  });

  it("fileClaim fail-closed lapses an active policy past endDate+grace on the spot", async () => {
    const db = (await getDb())!;
    const p = await seedPolicy({
      policyNumber: "F2-SWEEP-2",
      endDate: new Date(NOW - 45 * DAY),
    });
    await expectTrpcError(
      callerFor(adminUser).insuranceWorkflows.fileClaim({
        policyId: p.id,
        claimType: "death",
        incidentDate: iso(NOW - 50 * DAY), // inside the policy period...
        claimedAmount: 5000,
        incidentDescription: "Incident inside period but policy lapsed at filing time",
      }),
      "BAD_REQUEST"
    );
    const [after] = await db.select().from(policies).where(eq(policies.id, p.id));
    expect(after.status).toBe("lapsed");
  });

  it("sweep is admin-gated", async () => {
    await expectTrpcError(callerFor(regularUser).insuranceWorkflows.sweepPolicyLifecycle(), "FORBIDDEN");
  });
});

describe("INS-2 incident window validation", () => {
  it("rejects incident before startDate, after endDate, and in the future", async () => {
    const p = await seedPolicy({ policyNumber: "F2-WIN-1" });
    const caller = callerFor(adminUser);
    await expectTrpcError(caller.insuranceWorkflows.fileClaim({
      policyId: p.id, claimType: "death", incidentDate: iso(NOW - 200 * DAY),
      claimedAmount: 1000, incidentDescription: "pre-inception incident",
    }), "BAD_REQUEST");
    await expectTrpcError(caller.insuranceWorkflows.fileClaim({
      policyId: p.id, claimType: "death", incidentDate: iso(NOW + 300 * DAY),
      claimedAmount: 1000, incidentDescription: "post-expiry incident",
    }), "BAD_REQUEST");
    await expectTrpcError(caller.insuranceWorkflows.fileClaim({
      policyId: p.id, claimType: "death", incidentDate: iso(NOW + DAY),
      claimedAmount: 1000, incidentDescription: "future incident",
    }), "BAD_REQUEST");
  });
});

describe("INS-3 adjudication caps", () => {
  it("rejects approvedAmount > claimedAmount and > sumInsured", async () => {
    const p = await seedPolicy({ policyNumber: "F2-CAP-1", sumInsured: "20000.00" });
    const caller = callerFor(adminUser);
    const { claim } = await caller.insuranceWorkflows.fileClaim({
      policyId: p.id, claimType: "death", incidentDate: iso(NOW - 10 * DAY),
      claimedAmount: 5000, incidentDescription: "cap test claim one",
    });
    await expectTrpcError(caller.insuranceWorkflows.adjudicateClaim({
      claimId: claim.id, decision: "approved", approvedAmount: 5001,
    }), "BAD_REQUEST");
    // 2026-09-18 (F5/AB-7): fileClaim now rejects claimedAmount > sumInsured
    // at filing time (server-side schedule validation), so the over-sum-
    // insured fixture is seeded directly — the F2 adjudication cap on
    // approvedAmount > sumInsured is still the assertion under test.
    const db0 = (await getDb())!;
    const [big] = await db0.insert(claims).values({
      claimNumber: `CLM-CAP-SEED-${Date.now()}`,
      policyId: p.id,
      claimantId: p.customerId,
      status: "submitted",
      claimType: "disability",
      incidentDate: new Date(NOW - 11 * DAY),
      reportedDate: new Date(),
      claimedAmount: "50000",
      incidentDescription: "cap test claim two (seeded)",
    }).returning();
    await expectTrpcError(caller.insuranceWorkflows.adjudicateClaim({
      claimId: big.id, decision: "approved", approvedAmount: 25000,
    }), "BAD_REQUEST");
    // A legal approval still works.
    await caller.insuranceWorkflows.adjudicateClaim({
      claimId: claim.id, decision: "approved", approvedAmount: 4500,
    });
    const db = (await getDb())!;
    const [after] = await db.select().from(claims).where(eq(claims.id, claim.id));
    expect(after.status).toBe("approved");
    expect(Number(after.approvedAmount)).toBe(4500);
  });
});

describe("INS-4 duplicate-claim dedup", () => {
  it("blocks same (policy, incidentDate, claimType) with fuzzy amount, allows other perils", async () => {
    const p = await seedPolicy({ policyNumber: "F2-DUP-1" });
    const caller = callerFor(adminUser);
    const incident = iso(NOW - 20 * DAY);
    await caller.insuranceWorkflows.fileClaim({
      policyId: p.id, claimType: "theft", incidentDate: incident,
      claimedAmount: 3000, incidentDescription: "original theft claim",
    });
    await expectTrpcError(caller.insuranceWorkflows.fileClaim({
      policyId: p.id, claimType: "theft", incidentDate: incident,
      claimedAmount: 3010, incidentDescription: "duplicate via another channel",
    }), "CONFLICT");
    // Different claim type on the same incident is NOT a duplicate.
    await caller.insuranceWorkflows.fileClaim({
      policyId: p.id, claimType: "fire", incidentDate: incident,
      claimedAmount: 3000, incidentDescription: "separate peril, same day",
    });
  });
});

describe("INS-5 appeal path", () => {
  it("rejected → appealed with SLA; non-rejected cannot appeal; appealed is re-adjudicable", async () => {
    const db = (await getDb())!;
    const p = await seedPolicy({ policyNumber: "F2-APL-1", customerId: OWNER });
    const admin = callerFor(adminUser);
    const { claim } = await admin.insuranceWorkflows.fileClaim({
      policyId: p.id, claimType: "death", incidentDate: iso(NOW - 15 * DAY),
      claimedAmount: 8000, incidentDescription: "appeal test claim",
    });
    // Not rejected yet → cannot appeal.
    await expectTrpcError(
      callerFor(regularUser).insuranceWorkflows.appealClaim({ claimId: claim.id, reason: "premature appeal attempt" }),
      "CONFLICT"
    );
    await admin.insuranceWorkflows.adjudicateClaim({
      claimId: claim.id, decision: "rejected", rejectionReason: "insufficient evidence",
    });
    // Claimant (owner) appeals.
    const res = await callerFor(regularUser).insuranceWorkflows.appealClaim({
      claimId: claim.id, reason: "new medical report obtained",
    });
    expect(res.success).toBe(true);
    expect(new Date(res.slaDeadline).getTime()).toBeGreaterThan(NOW);
    const [after] = await db.select().from(claims).where(eq(claims.id, claim.id));
    expect(after.status).toBe("appealed");
    // Appealed is re-adjudicable (re-adjudication queue).
    await admin.insuranceWorkflows.adjudicateClaim({
      claimId: claim.id, decision: "approved", approvedAmount: 8000,
    });
    const [final] = await db.select().from(claims).where(eq(claims.id, claim.id));
    expect(final.status).toBe("approved");
  });
});

describe("INS-7 assignClaim FROM-state guard", () => {
  it("cannot reassign a decided claim back to under_review", async () => {
    const p = await seedPolicy({ policyNumber: "F2-ASG-1" });
    const caller = callerFor(adminUser);
    const { claim } = await caller.insuranceWorkflows.fileClaim({
      policyId: p.id, claimType: "death", incidentDate: iso(NOW - 12 * DAY),
      claimedAmount: 2000, incidentDescription: "assign guard test",
    });
    await caller.insuranceWorkflows.adjudicateClaim({
      claimId: claim.id, decision: "rejected", rejectionReason: "no cover",
    });
    await expectTrpcError(
      caller.insuranceWorkflows.assignClaim({ claimId: claim.id, adjusterId: 42 }),
      "CONFLICT"
    );
  });
});

describe("INS-8 grace hold + arrears offset at settlement", () => {
  it("claim filed in grace settles net of arrears", async () => {
    const db = (await getDb())!;
    // Active policy, endDate 5 days ago, grace 30 → inside grace window.
    const p = await seedPolicy({
      policyNumber: "F2-GRACE-1",
      endDate: new Date(NOW - 5 * DAY),
    });
    await db.insert(policyLifecycleStates).values({
      policyId: p.id, gracePeriodDays: 30, arrearsAmount: "1000.00",
    });
    const caller = callerFor(adminUser);
    const { claim } = await caller.insuranceWorkflows.fileClaim({
      policyId: p.id, claimType: "death", incidentDate: iso(NOW - 6 * DAY),
      claimedAmount: 5000, incidentDescription: "grace window claim",
    });
    const [raw] = await db.select().from(claims).where(eq(claims.id, claim.id));
    expect((raw.metadata as { graceHold?: boolean }).graceHold).toBe(true);
    await caller.insuranceWorkflows.adjudicateClaim({
      claimId: claim.id, decision: "approved", approvedAmount: 4000,
    });
    const res = await caller.insuranceWorkflows.settleClaimPayment({
      claimId: claim.id, paymentMethod: "bank_transfer",
    });
    expect(Number((res.payment as { amount: string }).amount)).toBe(3000); // 4000 - 1000 arrears
    const [lc] = await db.select().from(policyLifecycleStates)
      .where(eq(policyLifecycleStates.policyId, p.id));
    expect(Number(lc.arrearsAmount)).toBe(0); // arrears consumed
  });
});

describe("INS-9 reinstatement", () => {
  it("short payment refuses; full arrears reinstates with waiting-period reset", async () => {
    const db = (await getDb())!;
    const p = await seedPolicy({ policyNumber: "F2-RST-1", status: "lapsed", customerId: OWNER });
    await db.insert(policyLifecycleStates).values({
      policyId: p.id, lapsedAt: new Date(NOW - 10 * DAY), arrearsAmount: "10000.00",
    });
    const owner = callerFor(regularUser);
    await expectTrpcError(owner.insuranceWorkflows.reinstatePolicy({
      policyId: p.id, amount: 500, paymentMethod: "card",
    }), "PRECONDITION_FAILED");
    const res = await owner.insuranceWorkflows.reinstatePolicy({
      policyId: p.id, amount: 10000, paymentMethod: "card",
    });
    expect(res.success).toBe(true);
    const [after] = await db.select().from(policies).where(eq(policies.id, p.id));
    expect(after.status).toBe("active");
    const [lc] = await db.select().from(policyLifecycleStates)
      .where(eq(policyLifecycleStates.policyId, p.id));
    expect(Number(lc.arrearsAmount)).toBe(0);
    expect(lc.waitingPeriodResetAt).not.toBeNull();
  });

  it("lapse beyond the max window cannot be reinstated", async () => {
    const db = (await getDb())!;
    const p = await seedPolicy({ policyNumber: "F2-RST-2", status: "lapsed", customerId: OWNER });
    await db.insert(policyLifecycleStates).values({
      policyId: p.id, lapsedAt: new Date(NOW - 120 * DAY), arrearsAmount: "10000.00",
    });
    await expectTrpcError(callerFor(regularUser).insuranceWorkflows.reinstatePolicy({
      policyId: p.id, amount: 10000, paymentMethod: "card",
    }), "PRECONDITION_FAILED");
  });
});

describe("INS-10 premium amount validation + idempotent refs", () => {
  it("underpayment stays partial without activation; full payment activates; top-up after full is refused", async () => {
    const db = (await getDb())!;
    const p = await seedPolicy({ policyNumber: "F2-PAY-1", status: "bound" });
    const caller = callerFor(adminUser);
    const part = await caller.insuranceWorkflows.payPremium({
      policyId: p.id, amount: 4000, paymentMethod: "card",
    });
    expect(part.partial).toBe(true);
    let [pol] = await db.select().from(policies).where(eq(policies.id, p.id));
    expect(pol.status).toBe("bound"); // no activation on underpayment

    const full = await caller.insuranceWorkflows.payPremium({
      policyId: p.id, amount: 6000, paymentMethod: "card",
    });
    expect(full.partial).toBe(false);
    [pol] = await db.select().from(policies).where(eq(policies.id, p.id));
    expect(pol.status).toBe("active");

    // Premium fully paid: further payment is refused.
    await expectTrpcError(caller.insuranceWorkflows.payPremium({
      policyId: p.id, amount: 100, paymentMethod: "card",
    }), "CONFLICT");
  });

  it("overpayment beyond outstanding premium is refused", async () => {
    const p = await seedPolicy({ policyNumber: "F2-PAY-2", status: "bound" });
    await expectTrpcError(callerFor(adminUser).insuranceWorkflows.payPremium({
      policyId: p.id, amount: 10001, paymentMethod: "card",
    }), "BAD_REQUEST");
  });

  it("retry with the same policy+amount replays the durable payment (no duplicate)", async () => {
    const db = (await getDb())!;
    const p = await seedPolicy({ policyNumber: "F2-PAY-3", status: "bound" });
    const caller = callerFor(adminUser);
    const first = await caller.insuranceWorkflows.payPremium({
      policyId: p.id, amount: 10000, paymentMethod: "card",
    });
    const replay = await caller.insuranceWorkflows.payPremium({
      policyId: p.id, amount: 10000, paymentMethod: "card",
    });
    expect((replay as { idempotent?: boolean }).idempotent).toBe(true);
    const rows = await db.select().from(premiumPayments).where(eq(premiumPayments.policyId, p.id));
    expect(rows.length).toBe(1);
    expect(rows[0]!.id).toBe((first.payment as { id: number }).id);
  });
});

describe("INS-11 renewal completion", () => {
  it("guards cancelled policies and duplicates; payment rolls the term atomically; replay idempotent", async () => {
    const db = (await getDb())!;
    const caller = callerFor(adminUser);
    const cancelled = await seedPolicy({ policyNumber: "F2-REN-0", status: "cancelled" });
    await expectTrpcError(caller.insuranceWorkflows.requestRenewal({ policyId: cancelled.id }), "PRECONDITION_FAILED");

    const oldEnd = new Date(NOW + 30 * DAY);
    const p = await seedPolicy({ policyNumber: "F2-REN-1", endDate: oldEnd, renewalDate: oldEnd });
    const { renewal } = await caller.insuranceWorkflows.requestRenewal({ policyId: p.id });
    await expectTrpcError(caller.insuranceWorkflows.requestRenewal({ policyId: p.id }), "CONFLICT");

    const res = await caller.insuranceWorkflows.payRenewal({
      renewalId: renewal.id, amount: 10000, paymentMethod: "card",
    });
    expect(res.success).toBe(true);
    const [after] = await db.select().from(policies).where(eq(policies.id, p.id));
    expect(after.startDate!.getTime()).toBe(oldEnd.getTime()); // new start = old end
    const expectedEnd = new Date(oldEnd);
    expectedEnd.setFullYear(expectedEnd.getFullYear() + 1);
    expect(after.endDate!.getTime()).toBe(expectedEnd.getTime());
    const [ren] = await db.select().from(policyRenewals).where(eq(policyRenewals.id, renewal.id));
    expect(ren.status).toBe("completed");
    // Replay is idempotent.
    const replay = await caller.insuranceWorkflows.payRenewal({
      renewalId: renewal.id, amount: 10000, paymentMethod: "card",
    });
    expect((replay as { idempotent?: boolean }).idempotent).toBe(true);
  });
});

describe("INS-12 cancel guards + cooling-off refund", () => {
  it("non-owner cannot cancel; open claims hold cancellation", async () => {
    const p = await seedPolicy({ policyNumber: "F2-CXL-1", customerId: OWNER });
    const other = await seedPolicy({ policyNumber: "F2-CXL-2", customerId: CUST });
    await expectTrpcError(
      callerFor(ownerUser).insuranceWorkflows.cancelPolicy({ policyId: other.id, reason: "not mine" }),
      "FORBIDDEN"
    );
    const caller = callerFor(ownerUser);
    await callerFor(adminUser).insuranceWorkflows.fileClaim({
      policyId: p.id, claimType: "death", incidentDate: iso(NOW - 9 * DAY),
      claimedAmount: 1000, incidentDescription: "open claim blocks cancel",
    });
    await expectTrpcError(
      caller.insuranceWorkflows.cancelPolicy({ policyId: p.id, reason: "changed mind" }),
      "PRECONDITION_FAILED"
    );
  });

  it("cooling-off cancellation refunds the premium via the ledger and triggers clawback", async () => {
    const db = (await getDb())!;
    // Bound policy, inception 3 days ago, premium fully paid → within cooling-off.
    const p = await seedPolicy({
      policyNumber: "F2-CXL-3", status: "active", customerId: OWNER,
      agentId: 980050, startDate: new Date(NOW - 3 * DAY), endDate: new Date(NOW + 362 * DAY),
    });
    await callerFor(adminUser).insuranceWorkflows.payPremium({
      policyId: p.id, amount: 10000, paymentMethod: "card",
    });
    const res = await callerFor(ownerUser).insuranceWorkflows.cancelPolicy({
      policyId: p.id, reason: "cooling-off",
    });
    expect(res.coolingOff).toBe(true);
    expect(res.refundAmount).toBe(10000);
    const [after] = await db.select().from(policies).where(eq(policies.id, p.id));
    expect(after.status).toBe("cancelled");
    const clawbacks = await db.select().from(commissionClawbacks)
      .where(eq(commissionClawbacks.agentId, 980050));
    expect(clawbacks.length).toBeGreaterThanOrEqual(1);
    // Double cancel loses the state guard.
    await expectTrpcError(
      callerFor(ownerUser).insuranceWorkflows.cancelPolicy({ policyId: p.id, reason: "again" }),
      "CONFLICT"
    );
  });
});

describe("INS-13 beneficiary lifecycle", () => {
  it("percentage-sum > 100 and guardianless minors are refused", async () => {
    const p = await seedPolicy({ policyNumber: "F2-BEN-1", customerId: OWNER });
    const owner = callerFor(regularUser);
    await owner.insuranceWorkflows.upsertBeneficiary({
      policyId: p.id, name: "Ada", relationship: "spouse", percentage: 60,
    });
    await expectTrpcError(owner.insuranceWorkflows.upsertBeneficiary({
      policyId: p.id, name: "Bola", relationship: "child", percentage: 50,
    }), "BAD_REQUEST");
    await expectTrpcError(owner.insuranceWorkflows.upsertBeneficiary({
      policyId: p.id, name: "Chidi", relationship: "child", percentage: 40, isMinor: true,
    }), "BAD_REQUEST");
    const ok = await owner.insuranceWorkflows.upsertBeneficiary({
      policyId: p.id, name: "Chidi", relationship: "child", percentage: 40,
      isMinor: true, guardianName: "Ada",
    });
    const list = await owner.insuranceWorkflows.listBeneficiaries({ policyId: p.id });
    expect(list.items.length).toBe(2);
    await owner.insuranceWorkflows.removeBeneficiary({
      policyId: p.id, beneficiaryId: (ok.beneficiary as { id: number }).id,
    });
    const list2 = await owner.insuranceWorkflows.listBeneficiaries({ policyId: p.id });
    expect(list2.items.length).toBe(1);
  });

  it("settlement pays the recorded beneficiary, not caller free-text", async () => {
    const p = await seedPolicy({ policyNumber: "F2-BEN-2", customerId: OWNER });
    const owner = callerFor(regularUser);
    await owner.insuranceWorkflows.upsertBeneficiary({
      policyId: p.id, name: "Recorded Beneficiary", relationship: "spouse", percentage: 100,
    });
    const admin = callerFor(adminUser);
    const { claim } = await admin.insuranceWorkflows.fileClaim({
      policyId: p.id, claimType: "death", incidentDate: iso(NOW - 8 * DAY),
      claimedAmount: 7000, incidentDescription: "beneficiary resolution test",
    });
    await admin.insuranceWorkflows.adjudicateClaim({
      claimId: claim.id, decision: "approved", approvedAmount: 7000,
    });
    // Caller-supplied name that contradicts the table is refused.
    await expectTrpcError(admin.insuranceWorkflows.settleClaimPayment({
      claimId: claim.id, paymentMethod: "bank_transfer", beneficiaryName: "Attacker Name",
    }), "BAD_REQUEST");
    const res = await admin.insuranceWorkflows.settleClaimPayment({
      claimId: claim.id, paymentMethod: "bank_transfer",
    });
    expect((res.payment as { beneficiaryName: string }).beneficiaryName).toBe("Recorded Beneficiary");
  });

  it("minor beneficiary without guardian on record blocks settlement", async () => {
    const db = (await getDb())!;
    const p = await seedPolicy({ policyNumber: "F2-BEN-3", customerId: OWNER });
    // Seed directly (API refuses this state) to simulate legacy data.
    await db.insert(beneficiaries).values({
      policyId: p.id, name: "Minor Child", relationship: "child", percentage: "100",
      isMinor: true, guardianName: null,
    });
    const admin = callerFor(adminUser);
    const { claim } = await admin.insuranceWorkflows.fileClaim({
      policyId: p.id, claimType: "death", incidentDate: iso(NOW - 7 * DAY),
      claimedAmount: 6000, incidentDescription: "minor guardian test",
    });
    await admin.insuranceWorkflows.adjudicateClaim({
      claimId: claim.id, decision: "approved", approvedAmount: 6000,
    });
    await expectTrpcError(admin.insuranceWorkflows.settleClaimPayment({
      claimId: claim.id, paymentMethod: "bank_transfer",
    }), "PRECONDITION_FAILED");
  });
});
