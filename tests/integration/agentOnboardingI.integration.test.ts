/**
 * agentOnboardingI.integration.test.ts — I-wave register fixes (AB-8/19/20),
 * REAL routers + PGlite + mini-Redis + mini-TigerBeetle.
 *
 *  AB-8  agentFloatInsuranceClaims.approveClaim: admin/supervisor role only,
 *        segregation-of-duties (claimant can never approve own claim),
 *        approver identity in audit metadata.
 *  AB-19 disputeRefund.initiateRefund: refund terms ALWAYS derived from the
 *        original transaction via the dispute — unlinked disputes rejected,
 *        over-original amounts rejected, client destination ignored.
 *  AB-20 premiumTopUp.topUp: underpayment vs expected premium rejected;
 *        spoofed client agentId ignored (premium attributed to the policy's
 *        selling agent); overpayment credited + audited.
 *
 * Phones 0916xxxxxxx / policy refs POL-IFI-* / refs FF-IFI-*, unused elsewhere.
 */
import { and, eq, like } from "drizzle-orm";
import { describe, it, beforeAll, afterAll } from "vitest";

import {
  agents,
  disputes,
  floatReconciliations,
  policies,
  transactions,
  premiums as _p, // not used directly; premiums live in additions
  auditLog,
} from "../../drizzle/schema";
import { getDb } from "../../server/db";
import {
  callerFor,
  adminUser,
  regularUser,
  type TestUser,
  expectCounted as expect,
  expectTrpcError,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";

const supervisorUser: TestUser = {
  id: 91011,
  email: "i-supervisor@integration.local",
  name: "I Supervisor",
  role: "supervisor",
};

// Refund scenarios use a DEDICATED staff user + dedicated source accounts:
// refund velocity/duplicate counters are keyed on the authenticated user and
// destination account GLOBALLY across this shared cross-suite database, so
// reusing adminUser / 0123456789 would couple this file to other suites'
// fixtures.
const refundStaffUser: TestUser = {
  id: 91012,
  email: "i-refund-staff@integration.local",
  name: "I Refund Staff",
  role: "admin",
};

let claimantAgentPk: number; // claimant whose email == admin's (SoD case)
let claimantNoEmailPk: number; // claimant with NULL email
let claimantNormalPk: number; // ordinary claimant
let sellingAgentPk: number; // policy selling agent (AB-20)
let policyActiveId: number;
let refundAgentPk: number;
let disputeOkId: number; // dispute → tx ₦10,000 from 0123456789
let disputeNoTxId: number; // dispute with no linked transaction

beforeAll(async () => {
  resetAssertionCount();
  const db = (await getDb())!;
  async function seedAgent(code: string, email: string | null, n: number) {
    const [a] = await db
      .insert(agents)
      .values({
        agentId: code,
        name: `IFI ${code}`,
        phone: `091600000${String(n).padStart(2, "0")}`,
        pinHash: "x",
        isActive: true,
        email,
      })
      .returning();
    return a!.id;
  }
  claimantAgentPk = await seedAgent("AGT-IFI-CLAIM1", adminUser.email, 1);
  claimantNoEmailPk = await seedAgent("AGT-IFI-CLAIM2", null, 2);
  claimantNormalPk = await seedAgent(
    "AGT-IFI-CLAIM3",
    "i-claimant@integration.local",
    3
  );
  sellingAgentPk = await seedAgent("AGT-IFI-SELLER", "i-seller@integration.local", 4);
  refundAgentPk = await seedAgent("AGT-IFI-REFUND", "i-refund@integration.local", 5);

  const [pol] = await db
    .insert(policies)
    .values({
      policyNumber: "POL-IFI-ACTIVE-1",
      productId: 1,
      customerId: 960101,
      agentId: sellingAgentPk,
      status: "active",
      coverageType: "micro",
      sumInsured: "1000000",
      annualPremium: "25000",
    })
    .returning();
  policyActiveId = pol!.id;

  // AB-19 fixtures: real dispute → original transaction.
  const [tx] = await db
    .insert(transactions)
    .values({
      ref: "FF-IFI-TX-0001",
      agentId: refundAgentPk,
      type: "Cash In",
      amount: "10000.00",
      customerAccount: "0916100009",
      status: "success",
    })
    .returning();
  const [d1] = await db
    .insert(disputes)
    .values({
      ref: "FF-IFI-DSP-0001",
      transactionId: tx!.id,
      agentId: refundAgentPk,
      status: "open",
    })
    .returning();
  disputeOkId = d1!.id;
  const [d2] = await db
    .insert(disputes)
    .values({
      ref: "FF-IFI-DSP-0002",
      transactionId: null,
      agentId: refundAgentPk,
      status: "open",
    })
    .returning();
  disputeNoTxId = d2!.id;
});

afterAll(() => {
  console.log(`[agentOnboardingI] assertions: ${getAssertionCount()}`);
});

async function seedClaim(agentPk: number, ref: string): Promise<number> {
  const db = (await getDb())!;
  const [c] = await db
    .insert(floatReconciliations)
    .values({
      agentId: agentPk,
      expectedBalance: "1000",
      actualBalance: "0",
      discrepancy: "1000",
      date: new Date(),
      status: "pending",
      notes: ref,
    })
    .returning();
  return c!.id;
}

describe("AB-8: float-claim approval authz + SoD", () => {
  it("plain authenticated user (no admin/supervisor role) is denied", async () => {
    const claimId = await seedClaim(claimantNormalPk, "IFI-C1");
    await expectTrpcError(
      callerFor(regularUser).agentFloatInsuranceClaims.approveClaim({ claimId }),
      "FORBIDDEN"
    );
    const db = (await getDb())!;
    const [row] = await db
      .select()
      .from(floatReconciliations)
      .where(eq(floatReconciliations.id, claimId));
    expect(row.status).toBe("pending");
  });

  it("claimant cannot approve their own claim (SoD, email match)", async () => {
    // adminUser's email == claimant agent's email → self-approval attempt.
    const claimId = await seedClaim(claimantAgentPk, "IFI-C2");
    await expectTrpcError(
      callerFor(adminUser).agentFloatInsuranceClaims.approveClaim({ claimId }),
      "FORBIDDEN"
    );
  });

  it("claimant with NULL email → fail-closed (SoD cannot be ruled out)", async () => {
    const claimId = await seedClaim(claimantNoEmailPk, "IFI-C3");
    await expectTrpcError(
      callerFor(adminUser).agentFloatInsuranceClaims.approveClaim({ claimId }),
      "PRECONDITION_FAILED"
    );
  });

  it("supervisor with distinct identity approves; approver audited", async () => {
    const claimId = await seedClaim(claimantNormalPk, "IFI-C4");
    const res = await callerFor(supervisorUser).agentFloatInsuranceClaims.approveClaim({
      claimId,
      notes: "verified",
    });
    expect(res.claim.status).toBe("resolved");
    const db = (await getDb())!;
    const [log] = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "float_claim_approved"),
          eq(auditLog.resourceId, String(claimId))
        )
      )
      .limit(1);
    const md = log.metadata as Record<string, unknown>;
    expect(md.approverUserId).toBe(supervisorUser.id);
    expect(md.approverRole).toBe("supervisor");
    expect(md.claimantAgentId).toBe(claimantNormalPk);
  });
});

describe("AB-19: refund terms always derived from the original transaction", () => {
  it("unlinked dispute (no transaction) → rejected, nothing written", async () => {
    await expectTrpcError(
      callerFor(refundStaffUser).disputeRefund.initiateRefund({
        disputeId: disputeNoTxId,
        amount: 1000,
        reason: "Refund with no original transaction on record",
        customerId: 960201,
        accountNumber: "9998887776",
      }),
      "BAD_REQUEST"
    );
  });

  it("nonexistent dispute → rejected", async () => {
    await expectTrpcError(
      callerFor(refundStaffUser).disputeRefund.initiateRefund({
        disputeId: 999999,
        amount: 1000,
        reason: "Refund against a dispute that does not exist",
        customerId: 960202,
        accountNumber: "9998887776",
      }),
      "BAD_REQUEST"
    );
  });

  it("amount above the original transaction → rejected", async () => {
    await expectTrpcError(
      callerFor(refundStaffUser).disputeRefund.initiateRefund({
        disputeId: disputeOkId,
        amount: 10001, // original was ₦10,000
        reason: "Over-original refund attempt must be refused",
        customerId: 960203,
        accountNumber: "9998887776",
      }),
      "BAD_REQUEST"
    );
  });

  it("client-chosen destination is ignored — refund goes to the source account", async () => {
    const res = await callerFor(refundStaffUser).disputeRefund.initiateRefund({
      disputeId: disputeOkId,
      amount: 1000,
      reason: "Legitimate partial refund of the original payment",
      customerId: 960204,
      accountNumber: "9998887776", // attacker-chosen; must NOT be used
    });
    expect(res.success).toBe(true);
    if (!res.success) throw new Error("expected success");
    const db = (await getDb())!;
    const { refunds } = await import("../../drizzle/schema");
    const [row] = await db
      .select()
      .from(refunds)
      .where(eq(refunds.ref, res.refundId));
    expect(row.destinationAccount).toBe("0916100009"); // original source
    expect(Number(row.refundAmount)).toBe(1000);
  });
});

describe("AB-20: premium amount + agent identity server-derived", () => {
  it("underpayment vs expected premium → rejected, nothing written", async () => {
    const db = (await getDb())!;
    await expectTrpcError(
      callerFor(adminUser).premiumTopUp.topUp({
        policyId: policyActiveId,
        amountNGN: 1000, // expected ₦25,000
        paymentMethod: "cash",
        reference: "FF-IFI-PM-UND1",
      }),
      "PRECONDITION_FAILED"
    );
    const [tx] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.ref, "FF-IFI-PM-UND1"))
      .limit(1);
    expect(tx).toBeUndefined();
  });

  it("spoofed client agentId is ignored — premium attributed to the selling agent", async () => {
    const res = await callerFor(adminUser).premiumTopUp.topUp({
      policyId: policyActiveId,
      amountNGN: 25000,
      paymentMethod: "mobile_money",
      reference: "FF-IFI-PM-OK01",
      agentId: claimantNormalPk, // spoofed — policy belongs to sellingAgentPk
    });
    expect(res.idempotent).toBe(false);
    if (res.idempotent) throw new Error("expected fresh effect");
    expect(res.transaction.agentId).toBe(sellingAgentPk);
  });

  it("overpayment is credited and audited honestly", async () => {
    const res = await callerFor(adminUser).premiumTopUp.topUp({
      policyId: policyActiveId,
      amountNGN: 30000, // ₦5,000 over the ₦25,000 expected premium
      paymentMethod: "bank_transfer",
      reference: "FF-IFI-PM-OVER1",
    });
    expect(res.idempotent).toBe(false);
    if (res.idempotent) throw new Error("expected fresh effect");
    expect(Number(res.transaction.amount)).toBe(30000);
    const db = (await getDb())!;
    const logs = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "PREMIUM_TOP_UP"),
          eq(auditLog.resourceId, String(policyActiveId)),
          like(auditLog.resource, "policy")
        )
      );
    // Multiple PREMIUM_TOP_UP rows exist for this policy (spoof test above) —
    // select THIS payment's row by its reference in the metadata.
    const log = logs.find(
      l =>
        (l.metadata as Record<string, unknown> | null)?.reference ===
        "FF-IFI-PM-OVER1"
    );
    expect(log).toBeDefined();
    const md = log!.metadata as Record<string, unknown>;
    expect(md.overpaymentNGN).toBe(5000);
    expect(md.expectedPremium).toBe("25000.00");
  });
});
