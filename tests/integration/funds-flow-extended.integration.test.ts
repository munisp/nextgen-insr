/**
 * funds-flow-extended.integration.test.ts — F-02 section 6.3 fault-injection
 * matrix for the commission and premium money paths (extends F-01 coverage
 * beyond refunds/float).
 *
 * COMMISSION PAYOUT (real commissionPayouts router, real middleware chain):
 *   1. happy path: request → approve → process deducts exactly once
 *   2. duplicate process (worker retry) → idempotent replay, one deduction
 *   3. race: 5 parallel process calls → exactly one durable deduction
 *   4. process before approve → rejected, zero balance movement
 *   5. constraint guard at process time → PRECONDITION_FAILED and the status
 *      claim rolls back (crash/constraint-violation atomicity proof)
 *   6. reconciliation: completed payouts sum == balance delta, no orphan rows
 *
 * COMMISSION ACCRUAL/CREDIT (real journey activities):
 *   7. accrual persists a pending commission with exact rate math
 *   8. credit is idempotent on retry and under a 5-way race (one claim)
 *
 * PREMIUM COLLECTION (real premiumTopUp router):
 *   9. happy path: tx + premium ledger row, honest tbSyncStatus "pending"
 *  10. duplicate request (same ref+payload) → replay, one row each
 *  11. same ref + DIFFERENT amount → CONFLICT, counts unchanged
 *  12. race: 6 parallel identical requests → exactly one tx + one premium row
 *  13. constraint-violation rollback (kill-between-writes simulation): the
 *      premium-row unique violation rolls back the reserved transaction row
 *  14. policy status guard: cancelled policy → PRECONDITION_FAILED, no rows
 *  15. reconciliation: tx rows ↔ premium rows 1:1 with equal sums
 */
import { describe, it, beforeAll, afterAll } from "vitest";
import { eq, and, count, sql, inArray, like } from "drizzle-orm";
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { getDb } from "../../server/db";
import { agents, policies, transactions, commissionPayouts } from "../../drizzle/schema";
import { premiums, commissions } from "../../drizzle/schema.additions";
import {
  calculateAgentCommission,
  creditAgentCommission,
} from "../../server/journey-activities";
import {
  callerFor,
  adminUser,
  expectCounted as expect,
  expectTrpcError,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";

const FILE = "funds-flow-extended";

// ── Fixtures ──────────────────────────────────────────────────────────────────
let commAgentPk = 0;          // agents.id for the commission suite
const COMM_AGENT_CODE = "AGT-FFX-COMM01";
const COMM_START = 5_000;

let premAgentPk = 0;
const PREM_AGENT_CODE = "AGT-FFX-PREM01";
let policyActiveId = 0;
let policyCancelledId = 0;
const PREM_CUSTOMER = 930201;

let seedPhoneSeq = 0;
async function seedAgent(code: string, commissionBalance: number): Promise<number> {
  const db = (await getDb())!;
  seedPhoneSeq += 1;
  const [a] = await db.insert(agents).values({
    agentId: code,
    name: `FFX ${code}`,
    phone: `081${String(73000000 + seedPhoneSeq)}`,
    pinHash: "f".repeat(64),
    isActive: true,
    premiumReserve: "0",
    commissionBalance: String(commissionBalance),
  }).returning();
  return a!.id;
}

async function seedPolicy(policyNumber: string, status: "active" | "cancelled", agentPk: number): Promise<number> {
  const db = (await getDb())!;
  const [p] = await db.insert(policies).values({
    policyNumber,
    productId: 1,
    customerId: PREM_CUSTOMER,
    agentId: agentPk,
    status,
    coverageType: "micro",
    sumInsured: "1000000",
    annualPremium: "25000",
  }).returning();
  return p!.id;
}

// ── PGlite desync containment (same pattern as funds-flow) ──────────────────
// Test 13 deliberately triggers a unique-violation INSIDE a transaction; all
// harness reads after that go through a dedicated fresh pool.
let harnessPool: Pool | null = null;
let harnessDb: NodePgDatabase | null = null;

function switchToFreshHarnessConnection(): void {
  if (harnessDb) return;
  harnessPool = new Pool({ connectionString: process.env.POSTGRES_URL, max: 1, ssl: false });
  harnessDb = drizzle(harnessPool);
}

async function harnessDbHandle(): Promise<NodePgDatabase> {
  if (harnessDb) return harnessDb;
  return (await getDb())! as unknown as NodePgDatabase;
}

async function commBalance(agentPk: number): Promise<number> {
  const db = await harnessDbHandle();
  const [row] = await db.select({ b: agents.commissionBalance }).from(agents).where(eq(agents.id, agentPk));
  return Number(row!.b);
}

async function payoutRow(id: number) {
  const db = await harnessDbHandle();
  const [row] = await db.select().from(commissionPayouts).where(eq(commissionPayouts.id, id));
  return row;
}

async function txCountByRef(ref: string): Promise<number> {
  const db = await harnessDbHandle();
  const [row] = await db.select({ c: count() }).from(transactions).where(eq(transactions.ref, ref));
  return Number(row?.c ?? 0);
}

async function premCountByRef(ref: string): Promise<number> {
  const db = await harnessDbHandle();
  const [row] = await db.select({ c: count() }).from(premiums).where(eq(premiums.premiumRef, ref));
  return Number(row?.c ?? 0);
}

describe("funds-flow extended matrix: commission + premium (integration, real DB)", () => {
  beforeAll(async () => {
    resetAssertionCount();
    commAgentPk = await seedAgent(COMM_AGENT_CODE, COMM_START);
    premAgentPk = await seedAgent(PREM_AGENT_CODE, 0);
    policyActiveId = await seedPolicy("POL-FFX-ACTIVE-1", "active", premAgentPk);
    policyCancelledId = await seedPolicy("POL-FFX-CANCEL-1", "cancelled", premAgentPk);
  });

  afterAll(async () => {
    const db = await harnessDbHandle();
    await db.delete(commissionPayouts).where(like(commissionPayouts.agentId, "AGT-FFX-%"));
    await db.delete(commissions).where(inArray(commissions.agentId, [commAgentPk, premAgentPk]));
    await db.delete(premiums).where(like(premiums.premiumRef, "FF-PM-%"));
    await db.delete(transactions).where(like(transactions.ref, "FF-PM-%"));
    await db.delete(policies).where(like(policies.policyNumber, "POL-FFX-%"));
    await db.delete(agents).where(like(agents.agentId, "AGT-FFX-%"));
    if (harnessPool) {
      await harnessPool.end();
      harnessPool = null;
      harnessDb = null;
    }
    console.log(`[integration] ${FILE}: ${getAssertionCount()} assertions`);
  });

  // ── 1. Commission happy path ───────────────────────────────────────────────
  it("commission payout: request → approve → process deducts exactly once", async () => {
    const caller = callerFor(adminUser);
    const payout = await caller.commissionPayouts.request({
      agentId: COMM_AGENT_CODE, amount: 1000, bankCode: "044", accountNumber: "0123456789", accountName: "FFX Agent",
    });
    expect(payout.status).toBe("pending");

    const approved = await caller.commissionPayouts.approve({ id: payout.id });
    expect(approved.status).toBe("approved");

    const processed = await caller.commissionPayouts.process({ id: payout.id });
    expect(processed.status).toBe("completed");
    expect(processed.nubanRef).toBe(`COMM-PAYOUT-${payout.id}`); // deterministic ref
    expect(await commBalance(commAgentPk)).toBe(COMM_START - 1000);
  });

  // ── 2. Commission duplicate process (worker retry) ─────────────────────────
  it("commission payout retry: re-processing a completed payout replays without re-deducting", async () => {
    const db = await harnessDbHandle();
    const [row] = await db.select().from(commissionPayouts)
      .where(and(eq(commissionPayouts.agentId, COMM_AGENT_CODE), eq(commissionPayouts.status, "completed")))
      .limit(1);
    const before = await commBalance(commAgentPk);

    const caller = callerFor(adminUser);
    const replay = await caller.commissionPayouts.process({ id: row!.id });
    expect(replay.status).toBe("completed");
    expect(await commBalance(commAgentPk)).toBe(before); // no second deduction
  });

  // ── 3. Commission process race ─────────────────────────────────────────────
  it("commission payout race: 5 parallel process calls deduct exactly once", async () => {
    const caller = callerFor(adminUser);
    const payout = await caller.commissionPayouts.request({
      agentId: COMM_AGENT_CODE, amount: 500,
    });
    await caller.commissionPayouts.approve({ id: payout.id });
    const before = await commBalance(commAgentPk);

    const settled = await Promise.allSettled(
      Array.from({ length: 5 }, () => caller.commissionPayouts.process({ id: payout.id }))
    );
    const fulfilled = settled.filter((s) => s.status === "fulfilled").length;
    expect(fulfilled).toBe(5); // losers replay the winner, nobody errors
    expect(await commBalance(commAgentPk)).toBe(before - 500);
    const final = await payoutRow(payout.id);
    expect(final!.status).toBe("completed");
  });

  // ── 4. Process before approve ──────────────────────────────────────────────
  it("commission payout order violation: process before approve moves nothing", async () => {
    const caller = callerFor(adminUser);
    const payout = await caller.commissionPayouts.request({ agentId: COMM_AGENT_CODE, amount: 500 });
    const before = await commBalance(commAgentPk);

    await expectTrpcError(caller.commissionPayouts.process({ id: payout.id }), "BAD_REQUEST");
    expect(await commBalance(commAgentPk)).toBe(before);
    expect((await payoutRow(payout.id))!.status).toBe("pending");
  });

  // ── 5. Constraint guard + rollback at process time ─────────────────────────
  it("commission overdraft guard: insufficient balance at process time rolls back the claim", async () => {
    // Agent has 3500 left. Two approved payouts of 3000 + 1000 exceed it.
    const caller = callerFor(adminUser);
    const p1 = await caller.commissionPayouts.request({ agentId: COMM_AGENT_CODE, amount: 3000 });
    const p2 = await caller.commissionPayouts.request({ agentId: COMM_AGENT_CODE, amount: 1000 });
    await caller.commissionPayouts.approve({ id: p1.id });
    await caller.commissionPayouts.approve({ id: p2.id });
    const before = await commBalance(commAgentPk); // 3500

    const done = await caller.commissionPayouts.process({ id: p1.id });
    expect(done.status).toBe("completed");
    expect(await commBalance(commAgentPk)).toBe(before - 3000);

    // Second payout now exceeds the remaining 500: guarded deduction finds
    // zero rows → PRECONDITION_FAILED, and the approved→completed claim must
    // roll back inside the same transaction (no partial durable state).
    await expectTrpcError(caller.commissionPayouts.process({ id: p2.id }), "PRECONDITION_FAILED");
    expect((await payoutRow(p2.id))!.status).toBe("approved"); // claim rolled back
    expect(await commBalance(commAgentPk)).toBe(before - 3000); // balance untouched
  });

  // ── 6. Commission reconciliation ───────────────────────────────────────────
  it("commission reconciliation: completed payout sum == balance delta, refs complete", async () => {
    const db = await harnessDbHandle();
    const rows = await db.select().from(commissionPayouts)
      .where(eq(commissionPayouts.agentId, COMM_AGENT_CODE));
    const completedSum = rows
      .filter((r) => r.status === "completed")
      .reduce((sum, r) => sum + Number(r.amount), 0);
    // 1000 (test 1) + 500 (test 3) + 3000 (test 5) = 4500
    expect(completedSum).toBe(4500);
    expect(await commBalance(commAgentPk)).toBe(COMM_START - completedSum);
    for (const r of rows.filter((r) => r.status === "completed")) {
      expect(r.nubanRef).toBe(`COMM-PAYOUT-${r.id}`);
      expect(r.processedAt).not.toBeNull();
    }
  });

  // ── 7. Commission accrual persists with exact math ─────────────────────────
  it("commission accrual: 10% of ₦10,000 motor premium persists a pending row", async () => {
    const res = await calculateAgentCommission({
      agentId: commAgentPk,
      policyId: 990001,
      premiumAmount: 10_000,
      productType: "motor",
    });
    expect(res.commissionAmount).toBe(1000); // exact integer math, no float drift

    const db = await harnessDbHandle();
    const [row] = await db.select().from(commissions)
      .where(and(eq(commissions.agentId, commAgentPk), eq(commissions.policyId, 990001)));
    expect(row).toBeDefined();
    expect(Number(row!.grossAmount)).toBe(1000);
    expect(row!.status).toBe("pending");
  });

  // ── 8. Commission credit: retry + race ─────────────────────────────────────
  it("commission credit: retry replays and a 5-way race credits exactly once", async () => {
    const before = await commBalance(commAgentPk);
    const input = { agentId: commAgentPk, commissionAmount: 1000, policyId: 990001, commissionRef: "FF-COMM-CR-0001" };

    const r1 = await creditAgentCommission(input);
    expect(r1.newBalance).toBe(before + 1000);

    const r2 = await creditAgentCommission(input); // worker retry
    expect(r2.newBalance).toBe(before + 1000); // unchanged

    // Race on a second accrual
    await calculateAgentCommission({ agentId: commAgentPk, policyId: 990002, premiumAmount: 5000, productType: "health" });
    const settled = await Promise.allSettled(Array.from({ length: 5 }, () =>
      creditAgentCommission({ agentId: commAgentPk, commissionAmount: 400, policyId: 990002, commissionRef: "FF-COMM-CR-0002" })
    ));
    expect(settled.filter((s) => s.status === "fulfilled").length).toBe(5);
    expect(await commBalance(commAgentPk)).toBe(before + 1000 + 400);

    const db = await harnessDbHandle();
    const paid = await db.select().from(commissions)
      .where(and(eq(commissions.agentId, commAgentPk), inArray(commissions.policyId, [990001, 990002])));
    expect(paid.every((c) => c.status === "paid")).toBe(true);
  });

  // ── 9. Premium happy path ──────────────────────────────────────────────────
  it("premium collection: tx + ledger row persist, tbSyncStatus honestly pending", async () => {
    const caller = callerFor(adminUser);
    const res = await caller.premiumTopUp.topUp({
      policyId: policyActiveId, amountNGN: 2500, paymentMethod: "mobile_money", reference: "FF-PM-00001",
    });
    expect(res.idempotent).toBe(false);
    if (res.idempotent) throw new Error("expected fresh effect");
    expect(Number(res.transaction.amount)).toBe(2500);
    expect(res.premium.status).toBe("paid");
    // TB is unreachable in the harness: the row must say "pending", never a
    // fabricated "synced".
    const meta = res.transaction.metadata as { tbSyncStatus?: string; premiumId?: number };
    expect(meta.tbSyncStatus).toBe("pending");
    expect(meta.premiumId).toBe(res.premium.id);
    expect(await txCountByRef("FF-PM-00001")).toBe(1);
    expect(await premCountByRef("FF-PM-00001")).toBe(1);
  });

  // ── 10. Premium duplicate request ──────────────────────────────────────────
  it("premium replay: same reference + same payload returns the original rows", async () => {
    const caller = callerFor(adminUser);
    const res = await caller.premiumTopUp.topUp({
      policyId: policyActiveId, amountNGN: 2500, paymentMethod: "mobile_money", reference: "FF-PM-00001",
    });
    expect(res.idempotent).toBe(true);
    expect(await txCountByRef("FF-PM-00001")).toBe(1);
    expect(await premCountByRef("FF-PM-00001")).toBe(1);
  });

  // ── 11. Premium same ref + different payload → CONFLICT ────────────────────
  it("premium conflict: same reference with a different amount is rejected", async () => {
    const caller = callerFor(adminUser);
    await expectTrpcError(
      caller.premiumTopUp.topUp({
        policyId: policyActiveId, amountNGN: 9999, paymentMethod: "mobile_money", reference: "FF-PM-00001",
      }),
      "CONFLICT"
    );
    expect(await txCountByRef("FF-PM-00001")).toBe(1);
    expect(await premCountByRef("FF-PM-00001")).toBe(1);
  });

  // ── 12. Premium race ───────────────────────────────────────────────────────
  it("premium race: 6 parallel identical requests produce exactly one tx + one premium row", async () => {
    const caller = callerFor(adminUser);
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        caller.premiumTopUp.topUp({
          policyId: policyActiveId, amountNGN: 3000, paymentMethod: "card", reference: "FF-PM-RACE01",
        })
      )
    );
    const effects = results.filter((r) => !r.idempotent).length;
    expect(effects).toBe(1);
    expect(await txCountByRef("FF-PM-RACE01")).toBe(1);
    expect(await premCountByRef("FF-PM-RACE01")).toBe(1);
  });

  // ── 13. Constraint-violation rollback (kill-between-writes simulation) ─────
  it("premium atomicity: unique violation on the premium row rolls back the transaction row", async () => {
    const db = await harnessDbHandle();
    // Pre-seed a blocker premium row so the in-transaction premium insert
    // violates premium_ref_idx AFTER the transaction row was reserved —
    // exactly where a kill -9 or DB error would land mid-flow.
    await db.insert(premiums).values({
      policyId: policyActiveId,
      premiumRef: "FF-PM-ATOMIC",
      amount: "1",
      currency: "NGN",
      dueDate: new Date(),
      status: "paid",
    });

    const caller = callerFor(adminUser);
    let threw = false;
    try {
      await caller.premiumTopUp.topUp({
        policyId: policyActiveId, amountNGN: 7000, paymentMethod: "cash", reference: "FF-PM-ATOMIC",
      });
    } catch { threw = true; }
    expect(threw).toBe(true);

    // Intentional in-transaction error above may desync the shared PGlite
    // connection — switch harness reads to a fresh pool.
    switchToFreshHarnessConnection();

    // The reserved transaction row must NOT survive the rollback.
    expect(await txCountByRef("FF-PM-ATOMIC")).toBe(0);
    // Only the pre-seeded blocker premium row exists.
    expect(await premCountByRef("FF-PM-ATOMIC")).toBe(1);
  });

  // ── 14. Policy status guard ────────────────────────────────────────────────
  it("premium guard: cancelled policy rejects the payment and writes nothing", async () => {
    const caller = callerFor(adminUser);
    await expectTrpcError(
      caller.premiumTopUp.topUp({
        policyId: policyCancelledId, amountNGN: 1000, paymentMethod: "cash", reference: "FF-PM-GUARD1",
      }),
      "PRECONDITION_FAILED"
    );
    expect(await txCountByRef("FF-PM-GUARD1")).toBe(0);
    expect(await premCountByRef("FF-PM-GUARD1")).toBe(0);
  });

  // ── 15. Premium reconciliation ─────────────────────────────────────────────
  it("premium reconciliation: tx ↔ premium rows 1:1 with equal sums", async () => {
    const db = await harnessDbHandle();
    const [txAgg] = await db.select({
      n: count(),
      total: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)`,
    }).from(transactions).where(and(like(transactions.ref, "FF-PM-%"), eq(transactions.status, "success")));
    const [pmAgg] = await db.select({
      n: count(),
      total: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)`,
    }).from(premiums).where(and(like(premiums.premiumRef, "FF-PM-%"), sql`${premiums.premiumRef} != 'FF-PM-ATOMIC'`));

    // Successful collections: FF-PM-00001 (2500) + FF-PM-RACE01 (3000)
    expect(Number(txAgg?.n ?? 0)).toBe(2);
    expect(Number(pmAgg?.n ?? 0)).toBe(2);
    expect(Number(txAgg?.total ?? 0)).toBe(5500);
    expect(Number(pmAgg?.total ?? 0)).toBe(5500);

    // Every successful tx links to an existing premium row (no orphans).
    const txRows = await db.select().from(transactions).where(like(transactions.ref, "FF-PM-%"));
    for (const t of txRows) {
      const meta = (t.metadata ?? {}) as { premiumId?: number };
      expect(meta.premiumId).toBeDefined();
      const [pm] = await db.select({ id: premiums.id }).from(premiums).where(eq(premiums.id, meta.premiumId!));
      expect(pm).toBeDefined();
    }
  });
});
