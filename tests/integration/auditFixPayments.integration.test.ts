/**
 * auditFixPayments.integration.test.ts — audit wave F1 (payments), against
 * the REAL PGlite database (schema pushed from drizzle/schema.ts), the REAL
 * mini-TigerBeetle ledger, and mini-Redis. No mocks on production paths.
 *
 * Covers:
 *   PAY-2  refund pipeline: processRefund actually processes a queued refund
 *          (TB reversal leg + status transition), replay-safe; double-refund
 *          per dispute blocked; ₦2M daily agent cap enforced; documented
 *          ±₦100/24h duplicate detection enforced.
 *   PAY-7  floatManagement: idempotency key (reference) reuse across a
 *          different amount is a loud CONFLICT; same ref+amount replays.
 */
import { describe, it, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../../server/db";
import { agents, refunds } from "../../drizzle/schema";
import { router } from "../../server/_core/trpc";
import { disputeRefundRouter } from "../../server/routers/disputeRefund";
import { floatManagementRouter } from "../../server/routers/floatManagement";
import { paymentReconciliationRouter } from "../../server/routers/paymentReconciliation";
import { bulkPaymentProcessorRouter } from "../../server/routers/bulkPaymentProcessor";
import { sql } from "drizzle-orm";
import {
  adminUser,
  expectCounted as expect,
  expectTrpcError,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";

const FILE = "auditFixPayments";
// Unique numeric namespaces so repeated local runs never collide with other
// files sharing the single PGlite database.
const BASE = Math.floor(Math.random() * 900_000_000) + 100_000_000;
const AGENT_ID = BASE + 1;
const AGENT_CODE = `F1AGT${BASE}`;

const testRouter = router({
  disputeRefund: disputeRefundRouter,
  floatManagement: floatManagementRouter,
  paymentReconciliation: paymentReconciliationRouter,
  bulkPaymentProcessor: bulkPaymentProcessorRouter,
});

function caller(userId?: number) {
  const ctx = {
    user: { ...adminUser, ...(userId != null ? { id: userId } : {}), tenantId: null } as any,
    req: { headers: {} } as any,
    res: { cookie: () => undefined, clearCookie: () => undefined } as any,
    requestId: "f1-test",
  };
  return testRouter.createCaller(ctx);
}

beforeAll(async () => {
  resetAssertionCount();
  const db = (await getDb())!;
  await db.insert(agents).values({
    id: AGENT_ID,
    agentId: AGENT_CODE,
    name: "F1 Float Agent",
    phone: `081${String(BASE).slice(0, 8)}`,
    email: `f1-${BASE}@integration.local`,
    pinHash: "$2b$10$integrationtesthashplaceholder",
    premiumReserve: "100000",
  });
});

describe("PAY-2 refund pipeline (real processing)", () => {
  it("initiates, processes (real TB leg), and replays a refund", async () => {
    const c = caller();
    const init = await c.disputeRefund.initiateRefund({
      disputeId: BASE + 101,
      amount: 4500,
      reason: "F1 audit test refund",
      customerId: BASE + 1001,
      accountNumber: "0123456789",
      agentId: AGENT_ID,
    });
    expect(init.success).toBe(true);
    expect(init.status).toBe("pending");

    const processed = await c.disputeRefund.processRefund({ refundRef: init.refundId! });
    expect(processed.success).toBe(true);
    expect(processed.status).toBe("processed");

    // Replay: already processed → idempotent, no second funds movement.
    const replay = await c.disputeRefund.processRefund({ refundRef: init.refundId! });
    expect(replay.idempotent).toBe(true);

    const db = (await getDb())!;
    const [row] = await db.select().from(refunds).where(eq(refunds.ref, init.refundId!)).limit(1);
    expect(row.status).toBe("processed");
    expect(row.processedAt).toBeTruthy();
  });

  it("blocks a second refund for the same dispute (double-refund)", async () => {
    const c = caller();
    await c.disputeRefund.initiateRefund({
      disputeId: BASE + 102,
      amount: 3000,
      reason: "first refund for dispute",
      customerId: BASE + 1002,
      accountNumber: "0123456789",
      agentId: AGENT_ID,
    });
    // Different amount (outside ±₦100) so ONLY the per-dispute rule fires.
    await expectTrpcError(
      c.disputeRefund.initiateRefund({
        disputeId: BASE + 102,
        amount: 3200,
        reason: "second refund same dispute",
        customerId: BASE + 1002,
        accountNumber: "0123456789",
        agentId: AGENT_ID,
      }),
      "CONFLICT"
    );
  });

  it("enforces the documented ±₦100/24h duplicate detection", async () => {
    const c = caller();
    await c.disputeRefund.initiateRefund({
      disputeId: BASE + 103,
      amount: 8000,
      reason: "original refund under 10k",
      customerId: BASE + 1003,
      accountNumber: "0999999999",
      agentId: AGENT_ID,
    });
    // Different dispute, same customer, amount within ±₦100 → duplicate.
    await expectTrpcError(
      c.disputeRefund.initiateRefund({
        disputeId: BASE + 104,
        amount: 8050,
        reason: "near-duplicate refund amount",
        customerId: BASE + 1003,
        accountNumber: "0999999999",
        agentId: AGENT_ID,
      }),
      "CONFLICT"
    );
  });

  it("enforces the ₦2,000,000 daily agent refund cap", async () => {
    // 2026-09-18 (F5/AB-19): velocity is keyed on the authenticated user, so
    // this scenario also needs a dedicated USER namespace (its 5 calls would
    // otherwise add to earlier tests' per-user velocity budget and trip the
    // velocity guard before reaching the daily cap). Cap semantics unchanged.
    const c = caller(adminUser.id + 500);
    // Dedicated agent namespace so earlier tests' refunds don't count here.
    const capAgent = AGENT_ID + 500;
    // Four refunds of ₦500k from distinct customers/disputes = exactly ₦2M.
    // 2026-09-18 (F5/AB-19): duplicate detection is now keyed on the refund
    // DESTINATION account, so each iteration must use a distinct
    // accountNumber to genuinely reach the daily-cap path.
    for (let i = 0; i < 4; i++) {
      const r = await c.disputeRefund.initiateRefund({
        disputeId: BASE + 200 + i,
        amount: 500_000, // distinct customers: duplicate rule is per-customer
        reason: `cap test refund ${i}`,
        customerId: BASE + 2000 + i,
        accountNumber: `01234567${80 + i}`,
        agentId: capAgent,
      });
      expect(r.success).toBe(true);
    }
    const over = await c.disputeRefund.initiateRefund({
      disputeId: BASE + 299,
      amount: 1000,
      reason: "cap breaching refund",
      customerId: BASE + 2999,
      accountNumber: "0123456799", // distinct destination (AB-19)
      agentId: capAgent,
    });
    expect((over as any).success).toBe(false);
    expect((over as any).error).toBe("daily_agent_cap_exceeded");
  });
});

describe("PAY-7 float top-up idempotency binds ref+amount", () => {
  it("replays same ref+amount; CONFLICT on same ref different amount", async () => {
    const c = caller();
    const ref = `F1-TOP-${BASE}`;
    const first = await c.floatManagement.topUp({
      agentId: AGENT_ID,
      amountNGN: 10_000,
      source: "bank_transfer",
      reference: ref,
    });
    expect(first.idempotent).toBe(false);

    const replay = await c.floatManagement.topUp({
      agentId: AGENT_ID,
      amountNGN: 10_000,
      source: "bank_transfer",
      reference: ref,
    });
    expect(replay.idempotent).toBe(true);

    await expectTrpcError(
      c.floatManagement.topUp({
        agentId: AGENT_ID,
        amountNGN: 20_000,
        source: "bank_transfer",
        reference: ref,
      }),
      "CONFLICT"
    );

    // Balance reflects exactly ONE top-up (100000 seed + 10000).
    const db = (await getDb())!;
    const [a] = await db.select().from(agents).where(eq(agents.id, AGENT_ID)).limit(1);
    expect(Number(a.premiumReserve)).toBe(110_000);
  });
});

describe("PAY-6 reconciliation is real, not theatre", () => {
  it("runReconciliation detects an unconfirmed TB leg; resolve transitions state", async () => {
    const db = (await getDb())!;
    // Seed a settled transaction whose TB leg never confirmed (stale pending).
    const staleRef = `F1-STALE-${BASE}`;
    await db.execute(sql`
      INSERT INTO transactions (ref, "agentId", type, amount, fee, commission, channel, status, metadata, "createdAt")
      VALUES (${staleRef}, ${AGENT_ID}, 'Float Transfer Received', '1234.00', '0', '0', 'Internal', 'success',
              ${JSON.stringify({ tbSyncStatus: "pending" })}, NOW() - INTERVAL '2 hours')
    `);

    const c = caller();
    const run = await c.paymentReconciliation.runReconciliation({ staleMinutes: 30 });
    expect(run.success).toBe(true);
    expect(run.newDiscrepancies).toBeGreaterThanOrEqual(1);

    const open = await c.paymentReconciliation.getDiscrepancies({ status: "open", limit: 100 });
    const mine = (open.items as any[]).find((d) => d.ref === staleRef);
    expect(mine).toBeTruthy();
    expect(mine.kind).toBe("tb_sync_unconfirmed");

    // Second run must not duplicate the open finding.
    const run2 = await c.paymentReconciliation.runReconciliation({ staleMinutes: 30 });
    expect(run2.newDiscrepancies).toBe(0);

    const resolved = await c.paymentReconciliation.resolveDiscrepancy({ id: mine.id, note: "verified and reposted" });
    expect(resolved.success).toBe(true);
    expect(resolved.discrepancy.status).toBe("resolved");

    // Already-resolved → loud CONFLICT, never fake success.
    await expectTrpcError(
      c.paymentReconciliation.resolveDiscrepancy({ id: mine.id, note: "second attempt" }),
      "CONFLICT"
    );
  });

  it("bulkPaymentProcessor fails loud (NOT_IMPLEMENTED) instead of fake success", async () => {
    const c = caller();
    await expectTrpcError(
      c.bulkPaymentProcessor.processBatch({ id: 1 }),
      "NOT_IMPLEMENTED"
    );
    await expectTrpcError(
      c.bulkPaymentProcessor.cancelBatch({ id: 1 }),
      "NOT_IMPLEMENTED"
    );
  });
});

describe("PAY-3 tb_transfer_registry (forced on)", () => {
  it("replays committed refs from the registry and rejects payload reuse", async () => {
    process.env.TB_REGISTRY_FORCE = "1";
    try {
      const { tbCreateTransfer, TBIdempotencyConflictError } = await import("../../server/tbClient");
      const ref = `F1-REG-${BASE}`;
      const req = {
        debitAccountId: `reg-debit-${BASE}`,
        creditAccountId: `reg-credit-${BASE}`,
        amount: 777,
        ledger: 2000,
        code: 300,
        ref,
        txType: "registry_test",
      };
      const first = await tbCreateTransfer({ ...req });
      // Second call is served by the durable registry (no second posting).
      const second = await tbCreateTransfer({ ...req });
      expect(second.id).toBe(first.id);

      const db = (await getDb())!;
      const rows = await db.execute(sql`SELECT status FROM tb_transfer_registry WHERE ref = ${ref}`);
      expect((rows.rows[0] as any).status).toBe("committed");

      await expect(tbCreateTransfer({ ...req, amount: 778 })).rejects.toBeInstanceOf(TBIdempotencyConflictError);
    } finally {
      delete process.env.TB_REGISTRY_FORCE;
    }
  });
});

afterAll(async () => {
  // Remove this file's fixtures so sibling suites (e.g. disputeRefund's
  // global pending-count summary) see the same baseline as before.
  const db = (await getDb())!;
  await db.execute(sql`DELETE FROM payment_discrepancies WHERE ref LIKE 'F1-%'`);
  await db.execute(sql`DELETE FROM tb_transfer_registry WHERE ref LIKE 'F1-%'`);
  await db.execute(sql`DELETE FROM refunds WHERE "disputeId" BETWEEN ${BASE} AND ${BASE + 100000}`);
  await db.execute(sql`DELETE FROM transactions WHERE ref LIKE 'F1-%'`);
  await db.delete(agents).where(eq(agents.id, AGENT_ID));
  console.log(`[${FILE}] assertions: ${getAssertionCount()}`);
});
