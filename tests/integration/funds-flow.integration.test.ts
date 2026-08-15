/**
 * funds-flow.integration.test.ts — funds-flow integrity evidence (F-01).
 *
 * Executes the REAL money paths against the REAL PGlite database through the
 * REAL tRPC middleware chain and proves:
 *
 *   Idempotency (dispute refunds):
 *     1. Same idempotency key + same payload   -> single durable effect (replay)
 *     2. Same idempotency key + DIFFERENT payload -> explicit CONFLICT rejection
 *     3. N parallel identical refund requests  -> exactly one durable row
 *
 *   Concurrency / no-overdraft (agent float transfers):
 *     4. Happy-path transfer conserves value (debit == credit, balances move)
 *     5. Same reference retried               -> idempotent replay, one effect
 *     6. N parallel transfers, same reference -> exactly one durable effect
 *     7. Parallel debits exceeding balance    -> no overdraft below MIN_FLOAT
 *
 *   Atomicity / rollback:
 *     8. Mid-operation failure (unique violation on the second write) rolls
 *        back the first write — no partial debit survives.
 *
 *   Conservation invariant:
 *     9. Post-operation reconciliation: total float across the seeded
 *        sender+receiver pair is conserved; debit tx sum == credit tx sum.
 */
import { describe, it, beforeAll, afterAll } from "vitest";
import { eq, and, count, sql, inArray, like } from "drizzle-orm";
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { getDb } from "../../server/db";
import { refunds, transactions, agents } from "../../drizzle/schema";
import {
  callerFor,
  adminUser,
  expectCounted as expect,
  expectTrpcError,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";

const FILE = "funds-flow";

// ── Fixtures ──────────────────────────────────────────────────────────────────
const REFUND_CUSTOMER = 920101;
const REFUND_KEY = "ff-refund-key-00001";
const REFUND_KEY_CONFLICT = "ff-refund-key-00002";
const REFUND_KEY_PARALLEL = "ff-refund-key-00003";

const refundInput = {
  disputeId: 5001,
  amount: 2500,
  reason: "Double charge on premium payment",
  customerId: REFUND_CUSTOMER,
  accountNumber: "0123456789",
  agentId: 1,
};

let senderId = 0;
let receiverId = 0;
let senderStart = 0;
let receiverStart = 0;

async function seedAgent(suffix: string, balance: number): Promise<number> {
  const db = (await getDb())!;
  const [a] = await db
    .insert(agents)
    .values({
      agentId: `AGT-FF-${suffix}`,
      name: `Funds Flow ${suffix}`,
      phone: `080${suffix.padStart(8, "0")}`,
      pinHash: "f".repeat(64),
      isActive: true,
      premiumReserve: String(balance),
    })
    .returning();
  return a!.id;
}

// ── PGlite desync containment (harness level) ───────────────────────────────
// Test 8 deliberately triggers a unique-violation INSIDE a transaction. The
// PGlite wire-protocol server (pglite-socket multiplexer) can desync the
// shared single-connection pool after that intentional in-transaction error:
// subsequent queries on the poisoned connection intermittently return rows
// from the WRONG query (observed ~25% flake: balanceOf → undefined row,
// SUM() → "1"). Once the intentional error has fired, all further harness
// reads in this file go through a dedicated fresh pool, bypassing the
// poisoned shared connection entirely.
let harnessPool: Pool | null = null;
let harnessDb: NodePgDatabase | null = null;

/** Call after the intentional in-transaction error (test 8). */
function switchToFreshHarnessConnection(): void {
  if (harnessDb) return;
  harnessPool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    max: 1,
    ssl: false,
  });
  harnessDb = drizzle(harnessPool);
}

/** DB handle for harness reads/writes: shared pool until poisoned, then fresh. */
async function harnessDbHandle(): Promise<NodePgDatabase> {
  if (harnessDb) return harnessDb;
  return (await getDb())! as unknown as NodePgDatabase;
}

async function balanceOf(agentId: number): Promise<number> {
  const db = await harnessDbHandle();
  const [row] = await db.select().from(agents).where(eq(agents.id, agentId));
  return Number(row!.premiumReserve);
}

async function refundCountByKey(key: string): Promise<number> {
  const db = await harnessDbHandle();
  const [row] = await db
    .select({ c: count() })
    .from(refunds)
    .where(eq(refunds.idempotencyKey, key));
  return Number(row?.c ?? 0);
}

async function txRowsByRef(ref: string) {
  const db = await harnessDbHandle();
  return db
    .select()
    .from(transactions)
    .where(inArray(transactions.ref, [ref, `${ref}-RCV`]));
}

describe("funds-flow integrity (integration, real DB)", () => {
  beforeAll(async () => {
    resetAssertionCount();
    senderStart = 100_000;
    receiverStart = 20_000;
    senderId = await seedAgent("SENDER01", senderStart);
    receiverId = await seedAgent("RCVR0001", receiverStart);
  });

  afterAll(async () => {
    // Remove this file's fixtures so sibling suites (e.g. disputeRefund's
    // global pending-count summary) see the same baseline as before.
    // Routed through the harness handle: after test 8 the shared pool may be
    // desynced by PGlite, so cleanup uses the dedicated fresh connection.
    const db = await harnessDbHandle();
    await db.delete(refunds).where(like(refunds.idempotencyKey, "ff-refund-key-%"));
    await db.delete(transactions).where(like(transactions.ref, "FF-TR-%"));
    await db.delete(agents).where(like(agents.agentId, "AGT-FF-%"));
    if (harnessPool) {
      await harnessPool.end();
      harnessPool = null;
      harnessDb = null;
    }
    console.log(`[integration] ${FILE}: ${getAssertionCount()} assertions`);
  });

  // ── 1. Idempotency: same key + same payload → single durable effect ────────
  it("refund replay: same idempotency key + same payload returns same refund, one row", async () => {
    const caller = callerFor(adminUser);
    const r1 = await caller.disputeRefund.initiateRefund({ ...refundInput, idempotencyKey: REFUND_KEY });
    expect(r1.success).toBe(true);
    if (!r1.success) throw new Error("expected success");

    const r2 = await caller.disputeRefund.initiateRefund({ ...refundInput, idempotencyKey: REFUND_KEY });
    expect(r2.success).toBe(true);
    if (!r2.success) throw new Error("expected idempotent replay success");
    expect(r2.refundId).toBe(r1.refundId);
    expect(r2.idempotent).toBe(true);

    expect(await refundCountByKey(REFUND_KEY)).toBe(1);
  });

  // ── 2. Idempotency: same key + DIFFERENT payload → explicit rejection ──────
  it("refund conflict: same key + different payload rejected with CONFLICT, nothing written", async () => {
    const caller = callerFor(adminUser);
    const r1 = await caller.disputeRefund.initiateRefund({ ...refundInput, idempotencyKey: REFUND_KEY_CONFLICT });
    expect(r1.success).toBe(true);

    await expectTrpcError(
      caller.disputeRefund.initiateRefund({
        ...refundInput,
        amount: 9999, // different payload, same key
        idempotencyKey: REFUND_KEY_CONFLICT,
      }),
      "CONFLICT"
    );

    expect(await refundCountByKey(REFUND_KEY_CONFLICT)).toBe(1);
  });

  // ── 3. Concurrency: N parallel identical refunds → exactly one row ─────────
  it("refund race: 8 parallel identical requests produce exactly one durable refund", async () => {
    const caller = callerFor(adminUser);
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        caller.disputeRefund.initiateRefund({ ...refundInput, idempotencyKey: REFUND_KEY_PARALLEL })
      )
    );
    const refundIds = new Set(
      results.map((r) => {
        expect(r.success).toBe(true);
        if (!r.success) throw new Error("expected success under retry race");
        return r.refundId;
      })
    );
    expect(refundIds.size).toBe(1);
    expect(await refundCountByKey(REFUND_KEY_PARALLEL)).toBe(1);
  });

  // ── 4. Happy path: transfer moves value and conserves it ───────────────────
  it("float transfer: ₦5,000 moves from sender to receiver with a debit/credit tx pair", async () => {
    const caller = callerFor(adminUser);
    const res = await caller.agentFloatTransfer.transfer({
      senderAgentId: senderId,
      receiverAgentId: receiverId,
      amountNGN: 5000,
      reference: "FF-TR-0001",
      reason: "Float rebalance between field agents",
    });
    expect(res.idempotent).toBe(false);

    expect(await balanceOf(senderId)).toBe(senderStart - 5000);
    expect(await balanceOf(receiverId)).toBe(receiverStart + 5000);

    const pair = await txRowsByRef("FF-TR-0001");
    expect(pair.length).toBe(2);
    const debit = pair.find((t) => t.ref === "FF-TR-0001")!;
    const credit = pair.find((t) => t.ref === "FF-TR-0001-RCV")!;
    expect(Number(debit.amount)).toBe(5000);
    expect(Number(credit.amount)).toBe(5000);
    expect(debit.agentId).toBe(senderId);
    expect(credit.agentId).toBe(receiverId);
  });

  // ── 5. Idempotency: same reference retried → replay, single effect ─────────
  it("float transfer retry: same reference is idempotent — balances move exactly once", async () => {
    const caller = callerFor(adminUser);
    const before1 = await balanceOf(senderId);
    const before2 = await balanceOf(receiverId);

    const res = await caller.agentFloatTransfer.transfer({
      senderAgentId: senderId,
      receiverAgentId: receiverId,
      amountNGN: 5000,
      reference: "FF-TR-0001", // same reference as test 4
      reason: "Float rebalance between field agents",
    });
    expect(res.idempotent).toBe(true);

    expect(await balanceOf(senderId)).toBe(before1);
    expect(await balanceOf(receiverId)).toBe(before2);
    expect((await txRowsByRef("FF-TR-0001")).length).toBe(2);
  });

  // ── 6. Concurrency: N parallel same-reference transfers → one effect ───────
  it("float transfer race: 5 parallel identical references produce exactly one durable transfer", async () => {
    const caller = callerFor(adminUser);
    const before = await balanceOf(senderId);

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        caller.agentFloatTransfer.transfer({
          senderAgentId: senderId,
          receiverAgentId: receiverId,
          amountNGN: 4000,
          reference: "FF-TR-RACE1",
          reason: "Concurrent duplicate submission test",
        })
      )
    );

    const effects = results.filter((r) => !r.idempotent).length;
    expect(effects).toBe(1);
    expect((await txRowsByRef("FF-TR-RACE1")).length).toBe(2);
    expect(await balanceOf(senderId)).toBe(before - 4000);
  });

  // ── 7. No overdraft: parallel debits exceeding balance ─────────────────────
  it("overdraft guard: 4 parallel ₦10,000 debits against ₦25,000 headroom — at most 2 succeed, floor holds", async () => {
    // Fresh pair: sender has 30,000; MIN_FLOAT floor is 5,000 → headroom 25,000.
    const s2 = await seedAgent("ODRSEND1", 30_000);
    const r2 = await seedAgent("ODRRCV01", 0);
    const caller = callerFor(adminUser);

    const settled = await Promise.allSettled(
      Array.from({ length: 4 }, (_, i) =>
        caller.agentFloatTransfer.transfer({
          senderAgentId: s2,
          receiverAgentId: r2,
          amountNGN: 10_000,
          reference: `FF-TR-ODR-${i}`,
          reason: "Overdraft attempt under concurrency",
        })
      )
    );
    const succeeded = settled.filter((s) => s.status === "fulfilled").length;
    expect(succeeded).toBeLessThanOrEqual(2);

    const senderBal = await balanceOf(s2);
    const receiverBal = await balanceOf(r2);
    expect(senderBal).toBeGreaterThanOrEqual(5000); // MIN_FLOAT floor never breached
    // Conservation: what left the sender is exactly what the receiver gained.
    expect(30_000 - senderBal).toBe(receiverBal);
    expect(30_000 - senderBal).toBe(succeeded * 10_000);
  });

  // ── 8. Atomicity: forced mid-operation failure rolls back the first write ──
  it("atomicity: unique violation on the receiver credit rolls back the sender debit", async () => {
    const db = await harnessDbHandle();
    // Pre-seed a blocker row so the receiver-credit insert (ref `${reference}-RCV`)
    // violates the unique ref constraint mid-operation.
    await db.insert(transactions).values({
      ref: "FF-TR-ATOMIC-RCV",
      agentId: receiverId,
      type: "Transfer",
      amount: "1",
      channel: "App",
      status: "success",
    });

    const sBefore = await balanceOf(senderId);
    const rBefore = await balanceOf(receiverId);
    const caller = callerFor(adminUser);

    let threw = false;
    try {
      await caller.agentFloatTransfer.transfer({
        senderAgentId: senderId,
        receiverAgentId: receiverId,
        amountNGN: 7000,
        reference: "FF-TR-ATOMIC",
        reason: "Forced mid-operation failure probe",
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    // The intentional in-transaction error above can desync the PGlite wire
    // server on the shared single-connection pool. Move all remaining harness
    // reads in this file to a dedicated fresh connection (see helper comment).
    switchToFreshHarnessConnection();

    // First write (sender debit + balance update) must NOT survive.
    expect(await balanceOf(senderId)).toBe(sBefore);
    expect(await balanceOf(receiverId)).toBe(rBefore);
    const leaked = await (await harnessDbHandle())
      .select({ c: count() })
      .from(transactions)
      .where(eq(transactions.ref, "FF-TR-ATOMIC"));
    expect(Number(leaked[0]?.c ?? 0)).toBe(0);
  });

  // ── 9. Conservation invariant: reconciliation query ────────────────────────
  it("reconciliation: pair float conserved and debit sum == credit sum across all seeded transfers", async () => {
    const db = await harnessDbHandle();
    const [totals] = await db
      .select({ total: sql<string>`COALESCE(SUM(CAST("premiumReserve" AS NUMERIC)), 0)` })
      .from(agents)
      .where(inArray(agents.id, [senderId, receiverId]));
    // Every successful transfer between the pair conserved value.
    expect(Number(totals?.total ?? 0)).toBe(senderStart + receiverStart - 7000 * 0); // no value created/destroyed

    const [sums] = await db
      .select({
        debits: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)) FILTER (WHERE type = 'Float Transfer'), 0)`,
        credits: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)) FILTER (WHERE type = 'Float Transfer Received'), 0)`,
      })
      .from(transactions)
      .where(
        and(
          inArray(transactions.agentId, [senderId, receiverId]),
          eq(transactions.status, "success"),
          sql`type IN ('Float Transfer', 'Float Transfer Received')`
        )
      );
    expect(Number(sums?.debits ?? 0)).toBe(Number(sums?.credits ?? 0));
    // Sender balance equals start minus exactly the summed debits it authored.
    const [own] = await db
      .select({
        debits: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.agentId, senderId),
          eq(transactions.type, "Float Transfer"),
          eq(transactions.status, "success")
        )
      );
    expect(await balanceOf(senderId)).toBe(senderStart - Number(own?.debits ?? 0));
  });
});
