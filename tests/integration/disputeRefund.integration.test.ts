/**
 * disputeRefund.integration.test.ts — real-DB integration tests for the
 * dispute refund lifecycle (CBN Consumer Protection Framework rules).
 *
 * Proves:
 *   - Auto-tier refund (₦2,500) persists a real refunds row, status "pending",
 *     processedAt null (no rail call is faked as settled)
 *   - getSummary reports honest counts (pendingRefunds=1, processedToday=0)
 *   - Supervisor tier (₦50,000) returns pending_approval and persists "pending"
 *   - Velocity rule: after 5 refunds in 30 days the 6th is refused with
 *     velocity_exceeded and NOTHING is written
 *   - Anonymous callers get UNAUTHORIZED and write nothing
 */
import { describe, it, beforeAll, afterAll } from "vitest";
import { eq, and, count } from "drizzle-orm";
import { getDb } from "../../server/db";
import { agents, disputes, refunds, transactions } from "../../drizzle/schema";
import {
  callerFor,
  adminUser,
  expectCounted as expect,
  expectTrpcError,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";

const FILE = "disputeRefund";
const AUTO_CUSTOMER = 910101;
const SUPERVISOR_CUSTOMER = 910102;
const VELOCITY_CUSTOMER = 910103;
const ANON_CUSTOMER = 910104;

// 2026-09-18 (I-wave/AB-19): initiateRefund now ALWAYS derives refund terms
// server-side from the original transaction linked through the dispute —
// the unlinked trust-the-client fallback was removed (fail-closed). These
// fixtures therefore seed REAL disputes + original transactions; the
// behaviors under test (tiering, persistence, velocity, authz) are
// unchanged.
let disputeAutoId = 0;
let disputeSupervisorId = 0;
let disputeVelocityId = 0;
// 2026-09-18 (I-wave): the integration files share ONE PGlite database, and
// other suites (agentOnboardingI, funds-flow, auditFixPayments) legitimately
// persist refunds. getSummary is GLOBAL for platform users, so the honest
// count assertions below are deltas over this file's own effects, captured
// as a baseline before this file writes anything.
let baselinePendingRefunds = 0;
let baselineProcessedToday = 0;
let baselineTotalRefunded = 0;

async function refundCountFor(customerId: number): Promise<number> {
  const db = (await getDb())!;
  const [row] = await db
    .select({ c: count() })
    .from(refunds)
    .where(eq(refunds.customerId, customerId));
  return Number(row?.c ?? 0);
}

describe("disputeRefund router (integration, real DB)", () => {
  beforeAll(async () => {
    resetAssertionCount();
    const db = (await getDb())!;
    const [agent] = await db
      .insert(agents)
      .values({
        agentId: "AGTI-REFUND-SEED",
        name: "I Refund Seed Agent",
        phone: "09150000001",
        pinHash: "x",
        isActive: true,
        email: "i-refund-seed@integration.local",
      })
      .returning();
    async function seedDispute(
      n: number,
      amount: string,
      sourceAccount: string
    ): Promise<number> {
      const [tx] = await db
        .insert(transactions)
        .values({
          ref: `TX-IT-REFUND-${n}`,
          agentId: agent!.id,
          type: "Cash In",
          amount,
          customerAccount: sourceAccount,
          status: "success",
        })
        .returning();
      const [d] = await db
        .insert(disputes)
        .values({
          ref: `DSP-IT-${n}`,
          transactionId: tx!.id,
          agentId: agent!.id,
          status: "open",
        })
        .returning();
      return d!.id;
    }
    disputeAutoId = await seedDispute(1, "5000.00", "0123456789");
    disputeSupervisorId = await seedDispute(2, "100000.00", "9876543210");
    disputeVelocityId = await seedDispute(200, "10000.00", "0123456789");
    const s0 = await callerFor(adminUser).disputeRefund.getSummary();
    baselinePendingRefunds = s0.pendingRefunds;
    baselineProcessedToday = s0.processedToday;
    baselineTotalRefunded = s0.totalRefundedAmount;
  });

  afterAll(() => {
    console.log(`[integration] ${FILE}: ${getAssertionCount()} assertions`);
  });

  it("auto-tier refund (₦2,500) persists a real pending refunds row", async () => {
    const caller = callerFor(adminUser);
    const res = await caller.disputeRefund.initiateRefund({
      disputeId: disputeAutoId,
      amount: 2500,
      reason: "Customer charged twice for premium",
      customerId: AUTO_CUSTOMER,
      accountNumber: "0123456789",
      agentId: 1,
    });

    expect(res.success).toBe(true);
    if (!res.success) throw new Error("expected success");
    expect(res.approval).toBe("auto");
    expect(res.status).toBe("pending");
    expect(res.message).toContain("No funds have moved yet");

    // Real DB assertion: the row exists, is queued, and was never processed.
    const db = (await getDb())!;
    const rows = await db
      .select()
      .from(refunds)
      .where(eq(refunds.ref, res.refundId));
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe("pending");
    expect(rows[0]!.processedAt).toBeNull();
    expect(rows[0]!.refundAmount).toBe(2500);
    expect(rows[0]!.customerId).toBe(AUTO_CUSTOMER);
  });

  it("getSummary reports honest pending/processed counts", async () => {
    const caller = callerFor(adminUser);
    const summary = await caller.disputeRefund.getSummary();
    // Delta-based (shared cross-suite DB — see baseline note above): this
    // file has persisted exactly one pending refund and processed none.
    expect(summary.pendingRefunds).toBe(baselinePendingRefunds + 1);
    expect(summary.processedToday).toBe(baselineProcessedToday);
    expect(summary.totalRefundedAmount).toBe(baselineTotalRefunded);
  });

  it("supervisor tier (₦50,000) returns pending_approval and persists pending", async () => {
    const caller = callerFor(adminUser);
    const res = await caller.disputeRefund.initiateRefund({
      disputeId: disputeSupervisorId,
      amount: 50000,
      reason: "Policy cancelled within cooling-off period",
      customerId: SUPERVISOR_CUSTOMER,
      accountNumber: "9876543210",
      agentId: 1,
    });

    expect(res.success).toBe(true);
    if (!res.success) throw new Error("expected success");
    expect(res.approval).toBe("supervisor");
    expect(res.status).toBe("pending_approval");
    expect(res.slaDeadline).toBeTruthy();

    const db = (await getDb())!;
    const rows = await db
      .select()
      .from(refunds)
      .where(eq(refunds.ref, res.refundId));
    expect(rows.length).toBe(1);
    // No payout rail is wired: the row stays honestly "pending".
    expect(rows[0]!.status).toBe("pending");
    expect(rows[0]!.processedAt).toBeNull();
  });

  it("velocity check: 6th refund in 30 days returns velocity_exceeded, count stays 5", async () => {
    const db = (await getDb())!;
    // 2026-09-18 (F5/AB-19): velocity is now keyed on the authenticated user
    // (initiatedByUserId) and the refund destination account, not the
    // client-supplied customerId. Seeds therefore carry the new keys; the
    // 6th-refund-denied + count-stays-5 semantics are unchanged.
    for (let i = 0; i < 5; i++) {
      await db.insert(refunds).values({
        ref: `REF-IT-VEL-${i}`,
        disputeId: 100 + i,
        agentId: 1,
        customerId: VELOCITY_CUSTOMER,
        originalAmount: 1000,
        refundAmount: 1000,
        reason: "seeded velocity fixture",
        category: "dispute_refund",
        status: "pending",
        method: "original_method",
        destinationAccount: "0123456789",
        initiatedByUserId: adminUser.id,
      });
    }
    expect(await refundCountFor(VELOCITY_CUSTOMER)).toBe(5);

    const caller = callerFor(adminUser);
    const res = await caller.disputeRefund.initiateRefund({
      disputeId: disputeVelocityId,
      amount: 3000,
      reason: "Sixth refund attempt for same customer",
      customerId: VELOCITY_CUSTOMER,
      accountNumber: "0123456789",
      agentId: 1,
    });

    expect(res.success).toBe(false);
    if (res.success) throw new Error("expected velocity rejection");
    expect(res.error).toBe("velocity_exceeded");

    // Nothing was written by the rejected attempt.
    expect(await refundCountFor(VELOCITY_CUSTOMER)).toBe(5);
  });

  it("anonymous caller gets UNAUTHORIZED and writes nothing", async () => {
    const before = await refundCountFor(ANON_CUSTOMER);
    const caller = callerFor(null);
    await expectTrpcError(
      caller.disputeRefund.initiateRefund({
        disputeId: 300,
        amount: 1000,
        reason: "Anonymous refund attempt blocked",
        customerId: ANON_CUSTOMER,
        accountNumber: "0123456789",
      }),
      "UNAUTHORIZED"
    );
    expect(await refundCountFor(ANON_CUSTOMER)).toBe(before);
  });
});
