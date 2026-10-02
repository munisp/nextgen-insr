/**
 * fundsIdempotencyW10B2.test.ts — 2026-10-02 (W10-B2)
 *
 * Real-behavior PGlite tests for the two funds-surface replay fixes:
 *
 *   merchantPayoutSettlement.initiatePayout (server/routers/merchantPayoutSettlement.ts)
 *     - duplicate call with the SAME idempotency key → exactly ONE payout
 *       row and the SAME response payload (replay, no double-pay)
 *     - a DIFFERENT key → a second, independent payout row
 *     - key reuse with a DIFFERENT amount → CONFLICT (F-02 payload binding)
 *     - idempotency store DOWN → payout REFUSED (fail-closed; vi.spyOn on
 *       the journey-activities checkIdempotency export, 2026-10-02 W10-B2)
 *     - NO key at all → BAD_REQUEST (funds mutations are idempotency-mandatory)
 *
 *   parametricEngine.attestReading (server/routers/parametricEngine.ts)
 *     - first-time reading attests OK
 *     - duplicate reading (same triggerId + metric + observedAt) → CONFLICT,
 *       no second reading row, and NO payout/event side effect (real DB counts)
 *     - dedup store DOWN → attestation REFUSED (fail-closed)
 *
 * Harness pattern copied from memberQuotes.test.ts (2026-10-01, R3-b5): real
 * embedded PostgreSQL via PGlite, ephemeral probeFreePort, faithful minimal
 * table projections — including the REAL idempotency_records store
 * (drizzle/schema.ts:913) that both fixes ride on.
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  makeAuthenticatedCtx,
} from "../../lib/__tests__/testHelpers";

let PG_PORT = 0;
let PG_URL = "";

async function probeFreePort(): Promise<number> {
  const net = await import("node:net");
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => (port > 0 ? resolve(port) : reject(new Error("no port"))));
    });
  });
}
let pgliteChild: ChildProcess | null = null;

process.env.PERMIFY_FAIL_OPEN = "true";

// 2026-10-02 (W10-B2): financialProcedure keys its operation map on the FULL
// procedure path ("merchantPayoutSettlement.initiatePayout"), so the caller
// must be built from a root router that nests the real router name — a
// standalone createCaller would see path "initiatePayout" and be DENIED
// (fail-closed, AUTH-17), which is not the behavior under test.
type PayoutCaller = ReturnType<
  (typeof import("../merchantPayoutSettlement"))["merchantPayoutSettlementRouter"]["createCaller"]
>;
type ParametricCaller = ReturnType<
  (typeof import("../parametricEngine"))["parametricEngineRouter"]["createCaller"]
>;
let payoutCaller: PayoutCaller; // admin staff user id 1
let paramCaller: ParametricCaller;

const MERCHANT_ID = 910001;
const TRIGGER_ID = 920001;
const OBSERVED_AT = "2026-10-02T00:00:00.000Z";

async function startPglite(): Promise<void> {
  PG_PORT = await probeFreePort();
  PG_URL = `postgresql://postgres:postgres@127.0.0.1:${PG_PORT}/postgres`;
  const script = path.resolve(
    __dirname,
    "../../../tests/integration/setup/pgliteServer.mjs"
  );
  pgliteChild = spawn(process.execPath, [script], {
    env: { ...process.env, PGLITE_PORT: String(PG_PORT) },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise<void>((resolve, reject) => {
    const to = setTimeout(() => reject(new Error("PGlite start timeout")), 30_000);
    pgliteChild!.stdout!.on("data", d => {
      if (String(d).includes("PGLITE_READY")) {
        clearTimeout(to);
        resolve();
      }
    });
    pgliteChild!.on("exit", c => reject(new Error(`pglite exited ${c}`)));
  });
  process.env.POSTGRES_URL = PG_URL;
}

async function createTablesAndSeed() {
  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) throw new Error("PGlite DB not reachable");

  // Faithful idempotency_records projection (drizzle/schema.ts:913) — the
  // REAL F-02 store both fixes use. The unique key index is load-bearing.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS idempotency_records (
      id serial PRIMARY KEY,
      key varchar(192) NOT NULL,
      journey varchar(32) NOT NULL,
      "payloadHash" varchar(64),
      status varchar(16) NOT NULL DEFAULT 'in_progress',
      result jsonb,
      error text,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now(),
      "expiresAt" timestamp NOT NULL
    )`);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idempotency_records_key_idx
      ON idempotency_records (key)`);

  // Minimal merchants projection (columns initiatePayout reads).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS merchants (
      id serial PRIMARY KEY,
      "merchantCode" varchar(32) NOT NULL UNIQUE,
      "businessName" varchar(128) NOT NULL,
      "ownerName" varchar(128) NOT NULL,
      phone varchar(20) NOT NULL,
      category varchar(32) NOT NULL DEFAULT 'retail',
      status varchar(24) NOT NULL DEFAULT 'pending',
      "settlementAccountNumber" varchar(20),
      "settlementBankCode" varchar(10),
      "settlementBankName" varchar(64),
      "walletBalance" numeric(15,2) NOT NULL DEFAULT '0.00',
      "totalVolume" numeric(20,2) NOT NULL DEFAULT '0.00',
      "totalTransactions" integer NOT NULL DEFAULT 0,
      "preferredAgentId" integer,
      "keycloakSub" varchar(128),
      "passwordHash" varchar(256),
      email varchar(320),
      address text,
      "rcNumber" varchar(32),
      "tinNumber" varchar(32),
      "tenantId" integer,
      "deletedAt" timestamp,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);

  // Minimal merchant_settlement_change_requests projection (hold check).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS merchant_settlement_change_requests (
      id serial PRIMARY KEY,
      "merchantId" integer NOT NULL,
      status varchar(16) NOT NULL DEFAULT 'pending',
      "holdUntil" timestamp
    )`);

  // Faithful merchant_payouts projection (drizzle/schema.ts:3395) — the
  // insert uses .returning() (full row).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS merchant_payouts (
      id serial PRIMARY KEY,
      merchant_id integer NOT NULL,
      amount numeric(15,2) NOT NULL,
      currency text NOT NULL DEFAULT 'NGN',
      bank_code text NOT NULL,
      account_number text NOT NULL,
      account_name text NOT NULL,
      reference text NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      initiated_by integer,
      processed_at timestamp,
      failure_reason text,
      period_start timestamp NOT NULL,
      period_end timestamp NOT NULL,
      tx_count integer DEFAULT 0,
      created_at timestamp DEFAULT now()
    )`);

  // Parametric projections (attestReading insert + side-effect assertions).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS parametric_trigger_definitions (
      id serial PRIMARY KEY,
      name varchar(128) NOT NULL UNIQUE,
      metric varchar(64) NOT NULL,
      operator varchar(8) NOT NULL,
      threshold numeric(18,4) NOT NULL,
      window_seconds integer NOT NULL,
      datasource_config jsonb NOT NULL,
      status varchar(16) NOT NULL DEFAULT 'draft',
      created_by integer,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS parametric_manual_readings (
      id serial PRIMARY KEY,
      trigger_id integer NOT NULL,
      metric varchar(64) NOT NULL,
      value numeric(18,4) NOT NULL,
      observed_at timestamp NOT NULL,
      attested_by integer NOT NULL,
      confirmed_by integer,
      note text,
      created_at timestamp NOT NULL DEFAULT now(),
      confirmed_at timestamp
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS parametric_events (
      id serial PRIMARY KEY,
      event_key varchar(256) NOT NULL UNIQUE,
      trigger_id integer NOT NULL,
      status varchar(24) NOT NULL,
      created_at timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS parametric_payout_settlements (
      id serial PRIMARY KEY,
      event_id integer NOT NULL,
      claim_id integer NOT NULL,
      amount numeric(18,2) NOT NULL,
      status varchar(24) NOT NULL,
      created_at timestamp NOT NULL DEFAULT now()
    )`);

  // Active merchant with a verified settlement account and ample balance.
  await db.execute(sql`
    INSERT INTO merchants
      (id, "merchantCode", "businessName", "ownerName", phone, status,
       "settlementAccountNumber", "settlementBankCode", "settlementBankName",
       "walletBalance")
    VALUES
      (${MERCHANT_ID}, 'MCH-W10B2', 'W10B2 Stores', 'Owner One',
       '09000000009', 'active', '0123456789', '044', 'Access Bank',
       10000000)`);

  await db.execute(sql`
    INSERT INTO parametric_trigger_definitions
      (id, name, metric, operator, threshold, window_seconds,
       datasource_config, status)
    VALUES
      (${TRIGGER_ID}, 'W10B2-RAIN', 'rainfall_mm', 'gt', '50', 86400,
       '{"type":"manual"}'::jsonb, 'active')`);
}

async function payoutCount(): Promise<number> {
  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const db = (await getDb())!;
  const r = await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM merchant_payouts WHERE merchant_id = ${MERCHANT_ID}`
  );
  return Number((r as any).rows?.[0]?.n ?? (r as any)[0]?.n);
}

async function readingCount(): Promise<number> {
  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const db = (await getDb())!;
  const r = await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM parametric_manual_readings WHERE trigger_id = ${TRIGGER_ID}`
  );
  return Number((r as any).rows?.[0]?.n ?? (r as any)[0]?.n);
}

async function parametricSideEffectCounts(): Promise<{ events: number; payouts: number }> {
  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const db = (await getDb())!;
  const e = await db.execute(sql`SELECT COUNT(*)::int AS n FROM parametric_events`);
  const p = await db.execute(sql`SELECT COUNT(*)::int AS n FROM parametric_payout_settlements`);
  return {
    events: Number((e as any).rows?.[0]?.n ?? (e as any)[0]?.n),
    payouts: Number((p as any).rows?.[0]?.n ?? (p as any)[0]?.n),
  };
}

beforeAll(async () => {
  await startPglite();
  await createTablesAndSeed();
  const { merchantPayoutSettlementRouter } = await import("../merchantPayoutSettlement");
  const { parametricEngineRouter } = await import("../parametricEngine");
  const { router: trpcRouter } = await import("../../_core/trpc");
  payoutCaller = trpcRouter({ merchantPayoutSettlement: merchantPayoutSettlementRouter })
    .createCaller(makeAuthenticatedCtx())
    .merchantPayoutSettlement;
  paramCaller = parametricEngineRouter.createCaller(makeAuthenticatedCtx());
}, 60_000);

afterAll(() => {
  pgliteChild?.kill();
});

describe("merchantPayoutSettlement.initiatePayout idempotency (2026-10-02, W10-B2)", () => {
  it("refuses a funds mutation with NO idempotency key (BAD_REQUEST, fail-closed)", async () => {
    await expect(
      payoutCaller.initiatePayout({ merchantId: MERCHANT_ID, amount: 5000 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await payoutCount()).toBe(0);
  });

  it("duplicate key replays the ORIGINAL payout — exactly one row, same response", async () => {
    const first = await payoutCaller.initiatePayout({
      merchantId: MERCHANT_ID,
      amount: 25000,
      settlementCycle: "T1",
      idempotencyKey: "w10b2-payout-key-1",
    });
    expect(first.payout.reference).toContain("PO-MCH-W10B2-");
    expect(await payoutCount()).toBe(1);

    const replay = await payoutCaller.initiatePayout({
      merchantId: MERCHANT_ID,
      amount: 25000,
      settlementCycle: "T1",
      idempotencyKey: "w10b2-payout-key-1",
    });
    expect(replay.idempotent).toBe(true);
    expect(replay.payout.id).toBe(first.payout.id);
    expect(replay.payout.reference).toBe(first.payout.reference);
    // The funds invariant: still exactly ONE payout row.
    expect(await payoutCount()).toBe(1);
  });

  it("a DIFFERENT idempotency key executes a second, independent payout", async () => {
    const second = await payoutCaller.initiatePayout({
      merchantId: MERCHANT_ID,
      amount: 25000,
      settlementCycle: "T1",
      idempotencyKey: "w10b2-payout-key-2",
    });
    expect(second.idempotent).toBeUndefined();
    expect(await payoutCount()).toBe(2);
  });

  it("key reuse with a DIFFERENT amount is CONFLICT — no new payout row", async () => {
    await expect(
      payoutCaller.initiatePayout({
        merchantId: MERCHANT_ID,
        amount: 99999,
        settlementCycle: "T1",
        idempotencyKey: "w10b2-payout-key-1",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await payoutCount()).toBe(2);
  });

  it("idempotency store DOWN → payout REFUSED (fail-closed, no row written)", async () => {
    // 2026-10-02 (W10-B2): simulate an idempotency-store outage by rejecting
    // the store reservation call. The router must REFUSE the payout — a
    // funds path never proceeds without idempotency protection.
    const ja = await import("../../journey-activities");
    const spy = vi
      .spyOn(ja, "checkIdempotency")
      .mockRejectedValueOnce(new Error("idempotency store unavailable"));
    try {
      await expect(
        payoutCaller.initiatePayout({
          merchantId: MERCHANT_ID,
          amount: 7000,
          idempotencyKey: "w10b2-payout-key-3",
        })
      ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    } finally {
      spy.mockRestore();
    }
    expect(await payoutCount()).toBe(2);
  });
});

describe("parametricEngine.attestReading replay dedup (2026-10-02, W10-B2)", () => {
  it("first-time reading attests OK", async () => {
    const res = await paramCaller.attestReading({
      triggerId: TRIGGER_ID,
      metric: "rainfall_mm",
      value: 72.5,
      observedAt: OBSERVED_AT,
    });
    expect(res.status).toBe("attested");
    expect(res.readingId).toBeGreaterThan(0);
    expect(await readingCount()).toBe(1);
  });

  it("duplicate reading (same trigger + metric + observedAt) → CONFLICT, no payout/claim side effect", async () => {
    await expect(
      paramCaller.attestReading({
        triggerId: TRIGGER_ID,
        metric: "rainfall_mm",
        value: 72.5,
        observedAt: OBSERVED_AT,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    // Real DB state: exactly one reading, and NO parametric event / payout
    // settlement / claim-feeding side effect was written by the replay.
    expect(await readingCount()).toBe(1);
    expect(await parametricSideEffectCounts()).toEqual({ events: 0, payouts: 0 });
  });

  it("the same metric at a DIFFERENT observation timestamp is a distinct reading", async () => {
    const res = await paramCaller.attestReading({
      triggerId: TRIGGER_ID,
      metric: "rainfall_mm",
      value: 80.1,
      observedAt: "2026-10-02T01:00:00.000Z",
    });
    expect(res.status).toBe("attested");
    expect(await readingCount()).toBe(2);
  });

  it("dedup store DOWN → attestation REFUSED (fail-closed, no row written)", async () => {
    // 2026-10-02 (W10-B2): same outage simulation as the payout test —
    // without the dedup store the attestation must not proceed.
    const ja = await import("../../journey-activities");
    const spy = vi
      .spyOn(ja, "checkIdempotency")
      .mockRejectedValueOnce(new Error("idempotency store unavailable"));
    try {
      await expect(
        paramCaller.attestReading({
          triggerId: TRIGGER_ID,
          metric: "rainfall_mm",
          value: 55.0,
          observedAt: "2026-10-02T02:00:00.000Z",
        })
      ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    } finally {
      spy.mockRestore();
    }
    expect(await readingCount()).toBe(2);
  });

  it("non-admin callers cannot attest (role gate verified)", async () => {
    const { parametricEngineRouter } = await import("../parametricEngine");
    const nonAdmin = parametricEngineRouter.createCaller(
      makeAuthenticatedCtx({ user: { id: 2, role: "agent" } as any })
    );
    await expect(
      nonAdmin.attestReading({
        triggerId: TRIGGER_ID,
        metric: "rainfall_mm",
        value: 10,
        observedAt: "2026-10-02T03:00:00.000Z",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await readingCount()).toBe(2);
  });
});
