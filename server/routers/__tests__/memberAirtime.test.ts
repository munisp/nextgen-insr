/**
 * memberAirtime.test.ts — R3 batch 3 (2026-10-01, R3-b3)
 *
 * Real-behavior PGlite tests for server/routers/memberAirtime.ts:
 *   - anonymous caller → UNAUTHORIZED (protectedProcedure)
 *   - session user with no customer profile → EMPTY result (no caller
 *     phone; non-enumerating, never an error)
 *   - phone-scope isolation: rows keyed by the caller's REGISTERED phone
 *     (customers.phone via keycloakSub) AND type='Airtime' — seeded
 *     foreign-phone and non-airtime caller rows are invisible; smuggled
 *     input identity cannot re-scope (IDOR probe)
 *   - mySummary math: per-status count/volume, pending disclosed
 *   - the router exposes NO mutation (vend deferred funds wave)
 *
 * Harness: real embedded PostgreSQL (PGlite wire protocol) on an EPHEMERAL
 * probed port (memberReferrals.test.ts probeFreePort pattern — never
 * hardcode ports), minimal table projections carrying exactly the columns
 * the router selects.
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  makeAuthenticatedCtx,
  makeUnauthenticatedCtx,
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

// Unit-test env: no Permify sidecar (same pattern as memberPolicies).
process.env.PERMIFY_FAIL_OPEN = "true";

type Caller = ReturnType<
  (typeof import("../memberAirtime"))["memberAirtimeRouter"]["createCaller"]
>;
let memberCaller: Caller; // session user id 1 → customers.phone '09000000001'
let noProfileCaller: Caller; // session user id 777 → no customers row
let anonCaller: Caller;

const CALLER_PHONE = "09000000001";
const FOREIGN_PHONE = "09000000002";

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

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS customers (
      id serial PRIMARY KEY,
      phone varchar(20) NOT NULL UNIQUE,
      "keycloakSub" varchar(128) UNIQUE
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS transactions (
      id serial PRIMARY KEY,
      ref varchar(32) NOT NULL UNIQUE,
      "agentId" integer NOT NULL,
      type varchar(32) NOT NULL,
      amount numeric(15,2) NOT NULL,
      "customerPhone" varchar(20),
      status varchar(32) NOT NULL DEFAULT 'pending',
      "failureReason" text,
      metadata json,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);

  await db.execute(sql`
    INSERT INTO customers (phone, "keycloakSub")
    VALUES (${CALLER_PHONE}, '1'), (${FOREIGN_PHONE}, '2')
    ON CONFLICT DO NOTHING`);

  // Caller-phone airtime rows: 1 success (MTN), 1 pending (Glo,
  // pending_provider disclosed), 1 failed (failureReason verbatim). Plus a
  // caller-phone NON-airtime row (must be excluded) and a foreign-phone
  // airtime row (must never appear).
  await db.execute(sql`
    INSERT INTO transactions
      (ref, "agentId", type, amount, "customerPhone", status, "failureReason", metadata, "createdAt")
    VALUES
      ('AT001OK', 10, 'Airtime', '1000.00', ${CALLER_PHONE}, 'success', NULL,
       '{"network":"MTN","phoneNumber":"09000000001","providerStatus":"fulfilled"}'::json,
       '2026-09-28T10:00:00Z'),
      ('AT002PD', 10, 'Airtime', '500.00', ${CALLER_PHONE}, 'pending', NULL,
       '{"network":"Glo","phoneNumber":"09000000001","providerStatus":"pending_provider"}'::json,
       '2026-09-27T10:00:00Z'),
      ('AT003FL', 10, 'Airtime', '200.00', ${CALLER_PHONE}, 'failed', 'provider rejected vend',
       '{"network":"Airtel","phoneNumber":"09000000001","providerStatus":"rejected"}'::json,
       '2026-09-26T10:00:00Z'),
      ('NOTAT01', 10, 'Cash In', '999.00', ${CALLER_PHONE}, 'success', NULL,
       '{"provider":"MTN MoMo","providerStatus":"settled"}'::json,
       '2026-09-25T10:00:00Z'),
      ('ATFORGN1', 11, 'Airtime', '5000.00', ${FOREIGN_PHONE}, 'success', NULL,
       '{"network":"MTN","phoneNumber":"09000000002","providerStatus":"fulfilled"}'::json,
       '2026-09-28T11:00:00Z')`);
}

beforeAll(async () => {
  await startPglite();
  await createTablesAndSeed();
  const { memberAirtimeRouter } = await import("../memberAirtime");
  memberCaller = memberAirtimeRouter.createCaller(makeAuthenticatedCtx());
  noProfileCaller = memberAirtimeRouter.createCaller(
    makeAuthenticatedCtx({ user: { id: 777 } as any })
  );
  anonCaller = memberAirtimeRouter.createCaller(makeUnauthenticatedCtx());
}, 60_000);

afterAll(() => {
  pgliteChild?.kill();
});

describe("memberAirtime router (2026-10-01, R3-b3)", () => {
  it("rejects anonymous callers with UNAUTHORIZED", async () => {
    await expect(anonCaller.myHistory()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(anonCaller.mySummary()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("exposes no funds mutation (vend deferred funds wave)", async () => {
    const { memberAirtimeRouter } = await import("../memberAirtime");
    const procs = Object.keys(memberAirtimeRouter._def.procedures);
    expect(procs.sort()).toEqual(["myHistory", "mySummary"]);
  });

  it("myHistory returns only caller-phone Airtime rows, newest first", async () => {
    const result = await memberCaller.myHistory();
    expect(result.total).toBe(3);
    const refs = result.history.map(h => h.ref).sort();
    expect(refs).toEqual(["AT001OK", "AT002PD", "AT003FL"]);
    expect(refs).not.toContain("ATFORGN1");
    expect(refs).not.toContain("NOTAT01"); // type != Airtime
    expect(result.history[0].ref).toBe("AT001OK");
    const pending = result.history.find(h => h.ref === "AT002PD")!;
    expect(pending.network).toBe("Glo");
    expect(pending.providerStatus).toBe("pending_provider");
    const failed = result.history.find(h => h.ref === "AT003FL")!;
    expect(failed.failureReason).toBe("provider rejected vend");
  });

  it("smuggled phone identity in input cannot re-scope the query (IDOR probe)", async () => {
    const probed = await memberCaller.myHistory({
      phone: FOREIGN_PHONE,
      phoneNumber: FOREIGN_PHONE,
    } as any);
    expect(probed.total).toBe(3);
    expect(probed.history.map(h => h.ref)).not.toContain("ATFORGN1");
  });

  it("mySummary reports per-status counts/volumes honestly", async () => {
    const result = await memberCaller.mySummary({ periodDays: 30 });
    expect(result.totalTransactions).toBe(3);
    const success = result.byStatus.find(s => s.status === "success")!;
    const pending = result.byStatus.find(s => s.status === "pending")!;
    const failed = result.byStatus.find(s => s.status === "failed")!;
    expect(success.count).toBe(1);
    expect(success.volumeNGN).toBe(1000);
    expect(pending.count).toBe(1);
    expect(pending.volumeNGN).toBe(500);
    expect(failed.count).toBe(1);
    expect(failed.volumeNGN).toBe(200);
    // Foreign-phone volume never enters the summary.
    expect(result.byStatus.reduce((n, s) => n + s.volumeNGN, 0)).toBe(1700);
  });

  it("no customer profile → empty results, never an error (non-enumerating)", async () => {
    await expect(noProfileCaller.myHistory()).resolves.toEqual({
      history: [],
      total: 0,
    });
    const summary = await noProfileCaller.mySummary();
    expect(summary.totalTransactions).toBe(0);
    expect(summary.byStatus).toEqual([]);
  });
});
