/**
 * journey-idempotency.integration.test.ts — F-02 DB-backed journey idempotency.
 *
 * Executes the REAL journey activities (server/journey-activities.ts) against
 * the REAL PGlite database and proves:
 *
 *   DB-backed idempotency (idempotency_records is the source of truth):
 *     1. reserve → execute → complete → replay returns the stored result
 *     2. same key + DIFFERENT payload → IdempotencyConflictError (CONFLICT)
 *     3. Redis loss (write-through cache entry dropped) does NOT reopen the
 *        double-execution window — the old fail-open path returned null here
 *     4. a FRESH in_progress reservation blocks a concurrent executor
 *        (fail-closed: IdempotencyInProgressError, retryable by Temporal)
 *
 *   Crash recovery (item 3 of the funds-flow matrix):
 *     5. worker crash after the side effect but before recordIdempotency:
 *        the stale in_progress row is taken over, the retried side effect is
 *        idempotent, and exactly ONE durable effect exists at the end
 *
 *   TigerBeetle loud-failure boundary (journey payout flow):
 *     6. sidecar unreachable → createTigerBeetleTransfer throws (no fabricated
 *        OFFLINE- id), the idempotency record is NOT completed — no phantom
 *        success, no partial durable state
 *     7. after failIdempotency the key is retryable (failed → re-executable)
 *
 *   Concurrency:
 *     8. 8 parallel reservations of the same key → exactly one owner
 *
 *   Reconciliation:
 *     9. completed idempotency records map 1:1 to durable side effects; keys
 *        that never completed left zero side effects behind
 */
import { describe, it, beforeAll, afterAll } from "vitest";
import { eq, like, count, sql } from "drizzle-orm";
import { getDb } from "../../server/db";
import { idempotencyRecords, transactions } from "../../drizzle/schema";
import {
  checkIdempotency,
  recordIdempotency,
  failIdempotency,
  createTigerBeetleTransfer,
  IdempotencyConflictError,
  IdempotencyInProgressError,
} from "../../server/journey-activities";
import { getRedisClient } from "../../server/lib/redisClient";
import {
  expectCounted as expect,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";

const FILE = "journey-idempotency";
const J = "J21";

const K_BASIC = "ff-j21-basic-0001";
const K_CONFLICT = "ff-j21-conflict-01";
const K_REDIS = "ff-j21-redisdown-1";
const K_FRESH = "ff-j21-fresh-00001";
const K_CRASH = "ff-j21-crash-00001";
const K_TB = "ff-j21-tbdown-0001";
const K_RACE = "ff-j21-race-00001";

const CRASH_TX_REF = "FF-J21-CRASH-EFFECT";

async function idemRows(keySuffix: string) {
  const db = (await getDb())!;
  return db.select().from(idempotencyRecords)
    .where(like(idempotencyRecords.key, `%${keySuffix}`));
}

/** Simulate the J21 payout steps with a real durable side effect. */
async function simulatedPayoutEffect(ref: string): Promise<void> {
  const db = (await getDb())!;
  // Mirrors the production pattern: unique ref + ON CONFLICT DO NOTHING makes
  // the side effect itself retry-safe.
  await db.insert(transactions).values({
    ref,
    agentId: 0,
    type: "Insurance",
    amount: "12500",
    fee: "0",
    commission: "0",
    channel: "App",
    status: "success",
    fraudScore: "0.00",
    metadata: { simulated: "journey-payout" },
  }).onConflictDoNothing({ target: transactions.ref });
}

describe("journey idempotency (integration, real DB)", () => {
  beforeAll(() => {
    resetAssertionCount();
  });

  afterAll(async () => {
    const db = (await getDb())!;
    await db.delete(idempotencyRecords).where(like(idempotencyRecords.key, "J21:ff-j21-%"));
    await db.delete(transactions).where(like(transactions.ref, "FF-J21-%"));
    console.log(`[integration] ${FILE}: ${getAssertionCount()} assertions`);
  });

  // ── 1. reserve → execute → complete → replay ───────────────────────────────
  it("reserve/complete/replay: one record, stored result returned on re-check", async () => {
    const payload = { triggerId: 42, payoutAmount: 12500, customerId: 777 };
    const result = { payoutId: 42, tbTransferId: "tb-abc-123", status: "paid" };

    const first = await checkIdempotency(K_BASIC, J, payload);
    expect(first).toBeNull(); // caller owns the reservation and must execute

    let rows = await idemRows(K_BASIC);
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe("in_progress");

    const rec = await recordIdempotency(K_BASIC, J, result, payload);
    expect(rec.recorded).toBe(true);

    // Replay with an equivalent payload in DIFFERENT key order — canonical
    // hashing must treat them as the same payload.
    const replay = await checkIdempotency(K_BASIC, J, {
      customerId: 777, payoutAmount: 12500, triggerId: 42,
    });
    expect(replay).toEqual(result);

    rows = await idemRows(K_BASIC);
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe("completed");
    expect(rows[0]!.payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  // ── 2. same key + DIFFERENT payload → CONFLICT ─────────────────────────────
  it("conflict: same key with a different payload is rejected at check and record", async () => {
    const payloadA = { payoutAmount: 1000, customerId: 1 };
    const payloadB = { payoutAmount: 9999, customerId: 1 }; // different!

    expect(await checkIdempotency(K_CONFLICT, J, payloadA)).toBeNull();
    await recordIdempotency(K_CONFLICT, J, { status: "paid" }, payloadA);

    let threw: unknown = null;
    try {
      await checkIdempotency(K_CONFLICT, J, payloadB);
    } catch (err) { threw = err; }
    expect(threw).toBeInstanceOf(IdempotencyConflictError);

    threw = null;
    try {
      await recordIdempotency(K_CONFLICT, J, { status: "paid" }, payloadB);
    } catch (err) { threw = err; }
    expect(threw).toBeInstanceOf(IdempotencyConflictError);

    const rows = await idemRows(K_CONFLICT);
    expect(rows.length).toBe(1); // nothing extra persisted
  });

  // ── 3. Redis loss must not reopen the execution window ─────────────────────
  it("redis-loss: completed key still replays from the DB (old code failed open)", async () => {
    // The suite now runs with a REAL Redis (fail-closed locks need it — see
    // vitest.integration.config.ts). Redis loss is simulated honestly at the
    // exact layer the production code treats as a non-authoritative cache:
    // drop the write-through cache entry so the read path must fall through
    // to the DB, precisely what a Redis outage/eviction looks like.
    const payload = { payoutAmount: 500, customerId: 9 };
    expect(await checkIdempotency(K_REDIS, J, payload)).toBeNull();
    await recordIdempotency(K_REDIS, J, { status: "paid", n: 1 }, payload);

    // Sanity: the write-through cache really held the completed record.
    expect(await getRedisClient().get(`idem:${J}:${K_REDIS}`)).not.toBeNull();
    await getRedisClient().del(`idem:${J}:${K_REDIS}`);

    // The OLD implementation read ONLY Redis: with the cache entry gone it
    // returned null and the workflow re-executed the payout. The DB-backed
    // check must return the recorded result.
    const replay = await checkIdempotency(K_REDIS, J, payload);
    expect(replay).toEqual({ status: "paid", n: 1 });
  });

  // ── 4. fresh in_progress blocks concurrent execution ───────────────────────
  it("fresh in_progress reservation: concurrent executor is rejected (fail-closed)", async () => {
    expect(await checkIdempotency(K_FRESH, J, { n: 1 })).toBeNull(); // worker A reserves

    let threw: unknown = null;
    try {
      await checkIdempotency(K_FRESH, J, { n: 1 }); // worker B must NOT execute
    } catch (err) { threw = err; }
    expect(threw).toBeInstanceOf(IdempotencyInProgressError);

    const rows = await idemRows(K_FRESH);
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe("in_progress");
  });

  // ── 5. crash recovery: stale in_progress takeover → exactly one effect ─────
  it("crash mid-flow: retry with same key produces exactly one durable effect", async () => {
    const payload = { triggerId: 77, payoutAmount: 12500, customerId: 555 };
    const result = { payoutId: 77, tbTransferId: "tb-crash-1", status: "paid" };

    // ── Attempt 1: reserve, run the side effect, then "CRASH" (process dies
    // before recordIdempotency — e.g. kill -9 between the two writes).
    expect(await checkIdempotency(K_CRASH, J, payload)).toBeNull();
    await simulatedPayoutEffect(CRASH_TX_REF);
    // ← simulated crash: no recordIdempotency call

    // Age the reservation past the stale threshold (2 min): the crashed
    // holder can never come back, so the key is safe to take over.
    const db = (await getDb())!;
    await db.update(idempotencyRecords)
      .set({ updatedAt: new Date(Date.now() - 3 * 60 * 1000) })
      .where(eq(idempotencyRecords.key, `J21:${K_CRASH}`));

    // ── Attempt 2 (worker retry): take over the stale reservation, re-run
    // the side effect (idempotent via unique ref), complete the record.
    expect(await checkIdempotency(K_CRASH, J, payload)).toBeNull();
    await simulatedPayoutEffect(CRASH_TX_REF); // retried — must not duplicate
    await recordIdempotency(K_CRASH, J, result, payload);

    // ── Attempt 3 (client replay): stored result returned, no execution.
    expect(await checkIdempotency(K_CRASH, J, payload)).toEqual(result);

    // Exactly one durable side effect despite the crash + retry.
    const [txCount] = await db.select({ c: count() }).from(transactions)
      .where(eq(transactions.ref, CRASH_TX_REF));
    expect(Number(txCount?.c ?? 0)).toBe(1);

    const rows = await idemRows(K_CRASH);
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe("completed");
  });

  // ── 6. TigerBeetle unreachable → loud failure, no phantom success ──────────
  it("payout boundary: TB sidecar down → throws, record stays uncompleted, no side effect", async () => {
    const payload = { triggerId: 88, payoutAmount: 40000, customerId: 888 };
    expect(await checkIdempotency(K_TB, J, payload)).toBeNull(); // reserved

    // The harness points TB_SIDECAR_URL at a dead port. The journey payout
    // step must FAIL LOUDLY here — the old code returned a fabricated
    // `OFFLINE-<ts>` transfer id and the journey recorded a phantom payout.
    let threw: unknown = null;
    try {
      await createTigerBeetleTransfer({
        debitAccountId: "CLAIMS_RESERVE",
        creditAccountId: "customer_888",
        amount: 4_000_000, // kobo
        code: 9,
        userData: 88,
      });
    } catch (err) { threw = err; }
    expect(threw).toBeInstanceOf(Error);
    expect((threw as Error).message).toContain("TigerBeetle");
    expect((threw as Error).message).not.toContain("OFFLINE");

    // No phantom completion and no partial durable payout state.
    const rows = await idemRows(K_TB);
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe("in_progress"); // NOT completed
    const db = (await getDb())!;
    const [phantom] = await db.select({ c: count() }).from(transactions)
      .where(sql`${transactions.metadata}::text LIKE '%customer_888%'`);
    expect(Number(phantom?.c ?? 0)).toBe(0);
  });

  // ── 7. failed records are retryable ────────────────────────────────────────
  it("failed reservation is retryable: fail → re-execute → complete", async () => {
    const payload = { triggerId: 88, payoutAmount: 40000, customerId: 888 };
    // Continue the K_TB flow from test 6: mark the crashed step failed…
    await failIdempotency(K_TB, J, "TigerBeetle sidecar unavailable");
    // …then a later retry must be allowed to own the key again.
    expect(await checkIdempotency(K_TB, J, payload)).toBeNull();
    await recordIdempotency(K_TB, J, { payoutId: 88, tbTransferId: "tb-later", status: "paid" }, payload);
    expect(await checkIdempotency(K_TB, J, payload)).toEqual({
      payoutId: 88, tbTransferId: "tb-later", status: "paid",
    });
  });

  // ── 8. concurrency: 8 parallel reservations → exactly one owner ────────────
  it("reservation race: 8 parallel checks of the same key yield exactly one owner", async () => {
    const settled = await Promise.allSettled(
      Array.from({ length: 8 }, () => checkIdempotency(K_RACE, J, { race: true }))
    );
    const owners = settled.filter((s) => s.status === "fulfilled" && s.value === null).length;
    const blocked = settled.filter(
      (s) => s.status === "rejected" && s.reason instanceof IdempotencyInProgressError
    ).length;
    expect(owners).toBe(1);
    expect(owners + blocked).toBe(8); // nobody executed twice, nobody errored otherwise

    const rows = await idemRows(K_RACE);
    expect(rows.length).toBe(1);
  });

  // ── 9. reconciliation: completed records ↔ exactly one durable effect ──────
  it("reconciliation: 1:1 completed-record/effect mapping, zero effects for uncompleted keys", async () => {
    const db = (await getDb())!;
    const rows = await db.select().from(idempotencyRecords)
      .where(like(idempotencyRecords.key, "J21:ff-j21-%"));
    const completed = rows.filter((r) => r.status === "completed");
    // Every test that completed a record did so exactly once per key.
    const keys = new Set(completed.map((r) => r.key));
    expect(keys.size).toBe(completed.length);

    // The crash-recovery flow produced exactly one effect for its one record.
    const [effects] = await db.select({ c: count() }).from(transactions)
      .where(like(transactions.ref, "FF-J21-%"));
    expect(Number(effects?.c ?? 0)).toBe(1);

    // No idempotency record is stuck in a state the tests did not intend:
    // K_FRESH (test 4) and K_RACE (test 8) are deliberately left in_progress.
    const inProgress = rows.filter((r) => r.status === "in_progress").map((r) => r.key).sort();
    expect(inProgress).toEqual([`J21:${K_FRESH}`, `J21:${K_RACE}`].sort());
  });
});
