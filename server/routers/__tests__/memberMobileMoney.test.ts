/**
 * memberMobileMoney.test.ts — R3 batch 3 (2026-10-01, R3-b3)
 *
 * Real-behavior PGlite tests for server/routers/memberMobileMoney.ts:
 *   - anonymous caller → UNAUTHORIZED (protectedProcedure)
 *   - session user with no customer profile → EMPTY result (no caller
 *     phone exists; non-enumerating, never an error)
 *   - phone-scope isolation: rows keyed by the caller's REGISTERED phone
 *     (customers.phone via keycloakSub) — seeded foreign-phone rows are
 *     invisible; smuggled input identity cannot re-scope the query
 *   - myTransaction foreign ref → NOT_FOUND (non-enumerating)
 *   - mySummary math: per-status count/volume, pending rows disclosed
 *   - the router exposes NO mutation (cashIn/cashOut deferred funds wave)
 *
 * Harness: real embedded PostgreSQL (PGlite wire protocol) on an EPHEMERAL
 * probed port (memberReferrals.test.ts probeFreePort pattern — never
 * hardcode ports), minimal table projections carrying exactly the columns
 * the router selects. type/status stored as varchar here (drizzle text
 * comparison is identical; the enum constraint is not the behavior under
 * test).
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

// Unit-test env: no Permify sidecar. Explicit insecure opt-in (same pattern
// as memberPolicies/memberReferrals) so protectedProcedure passes the base
// gate; member authz under test is enforced by the router itself.
process.env.PERMIFY_FAIL_OPEN = "true";

type Caller = ReturnType<
  (typeof import("../memberMobileMoney"))["memberMobileMoneyRouter"]["createCaller"]
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

  // Minimal projections: customers carries the columns the router selects
  // (phone via keycloakSub); transactions carries the projected columns
  // (drizzle/schema.ts:393 ff).
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
      fee numeric(10,2) DEFAULT '0.00',
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

  // Caller-phone mobile-money rows: 2 success (MTN MoMo), 1 pending
  // (Airtel Money, pending_provider disclosed). Plus a caller-phone row
  // WITHOUT a provider key (not mobile-money — must be excluded), and
  // foreign-phone mobile-money rows (must never appear).
  await db.execute(sql`
    INSERT INTO transactions
      (ref, "agentId", type, amount, fee, "customerPhone", status, metadata, "createdAt")
    VALUES
      ('MM001OK', 10, 'Cash In', '5000.00', '0.00', ${CALLER_PHONE}, 'success',
       '{"provider":"MTN MoMo","providerStatus":"settled"}'::json, '2026-09-28T10:00:00Z'),
      ('MM002OK', 10, 'Cash Out', '2000.00', '0.00', ${CALLER_PHONE}, 'success',
       '{"provider":"MTN MoMo","providerStatus":"settled"}'::json, '2026-09-27T10:00:00Z'),
      ('MM003PD', 10, 'Cash In', '1500.00', '0.00', ${CALLER_PHONE}, 'pending',
       '{"provider":"Airtel Money","providerStatus":"pending_provider"}'::json, '2026-09-26T10:00:00Z'),
      ('NOTMM01', 10, 'Bill Payment', '999.00', '0.00', ${CALLER_PHONE}, 'success',
       '{"biller":"IKEDC"}'::json, '2026-09-25T10:00:00Z'),
      ('MMFORGN1', 11, 'Cash In', '7777.00', '0.00', ${FOREIGN_PHONE}, 'success',
       '{"provider":"MTN MoMo","providerStatus":"settled"}'::json, '2026-09-28T11:00:00Z')`);
}

beforeAll(async () => {
  await startPglite();
  await createTablesAndSeed();
  const { memberMobileMoneyRouter } = await import("../memberMobileMoney");
  memberCaller = memberMobileMoneyRouter.createCaller(makeAuthenticatedCtx());
  noProfileCaller = memberMobileMoneyRouter.createCaller(
    makeAuthenticatedCtx({ user: { id: 777 } as any })
  );
  anonCaller = memberMobileMoneyRouter.createCaller(makeUnauthenticatedCtx());
}, 60_000);

afterAll(() => {
  pgliteChild?.kill();
});

describe("memberMobileMoney router (2026-10-01, R3-b3)", () => {
  it("rejects anonymous callers with UNAUTHORIZED", async () => {
    await expect(anonCaller.myTransactions()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      anonCaller.myTransaction({ ref: "MM001OK" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anonCaller.mySummary()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(anonCaller.providers()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("exposes no funds mutations (cashIn/cashOut deferred funds wave)", async () => {
    const { memberMobileMoneyRouter } = await import("../memberMobileMoney");
    const procs = Object.keys(memberMobileMoneyRouter._def.procedures);
    expect(procs.sort()).toEqual([
      "mySummary",
      "myTransaction",
      "myTransactions",
      "providers",
    ]);
  });

  it("myTransactions returns only caller-phone mobile-money rows", async () => {
    const result = await memberCaller.myTransactions();
    expect(result.count).toBe(3);
    expect(result.transactions).toHaveLength(3);
    const refs = result.transactions.map(t => t.ref).sort();
    expect(refs).toEqual(["MM001OK", "MM002OK", "MM003PD"]);
    expect(refs).not.toContain("MMFORGN1");
    expect(refs).not.toContain("NOTMM01"); // no provider key → not mobile money
    // Newest first
    expect(result.transactions[0].ref).toBe("MM001OK");
    // Pending row disclosed verbatim
    const pending = result.transactions.find(t => t.ref === "MM003PD")!;
    expect(pending.status).toBe("pending");
    expect(pending.providerStatus).toBe("pending_provider");
  });

  it("provider input is a FILTER within the caller scope, never a re-scope", async () => {
    const result = await memberCaller.myTransactions({
      provider: "MTN MoMo",
      limit: 20,
      offset: 0,
    });
    expect(result.count).toBe(2);
    const refs = result.transactions.map(t => t.ref).sort();
    expect(refs).toEqual(["MM001OK", "MM002OK"]);
    // Smuggled phone/customer identity in input cannot re-scope (IDOR probe).
    const probed = await memberCaller.myTransactions({
      phone: FOREIGN_PHONE,
      customerPhone: FOREIGN_PHONE,
    } as any);
    expect(probed.count).toBe(3);
    expect(
      probed.transactions.map(t => t.ref).sort()
    ).not.toContain("MMFORGN1");
  });

  it("myTransaction returns the caller's own row", async () => {
    const result = await memberCaller.myTransaction({ ref: "MM001OK" });
    expect(result.transaction.ref).toBe("MM001OK");
    expect(result.transaction.provider).toBe("MTN MoMo");
    expect(Number(result.transaction.amount)).toBe(5000);
  });

  it("myTransaction on a foreign-phone ref → NOT_FOUND (non-enumerating)", async () => {
    await expect(
      memberCaller.myTransaction({ ref: "MMFORGN1" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("mySummary reports per-status counts/volumes honestly", async () => {
    const result = await memberCaller.mySummary({ periodDays: 30 });
    expect(result.totalTransactions).toBe(3);
    const success = result.byStatus.find(s => s.status === "success")!;
    const pending = result.byStatus.find(s => s.status === "pending")!;
    expect(success.count).toBe(2);
    expect(success.volumeNGN).toBe(7000);
    expect(pending.count).toBe(1);
    expect(pending.volumeNGN).toBe(1500);
    // Foreign-phone volume never enters the summary.
    expect(
      result.byStatus.reduce((n, s) => n + s.volumeNGN, 0)
    ).toBe(8500);
  });

  it("no customer profile → empty results, never an error (non-enumerating)", async () => {
    await expect(noProfileCaller.myTransactions()).resolves.toEqual({
      transactions: [],
      count: 0,
    });
    const summary = await noProfileCaller.mySummary();
    expect(summary.totalTransactions).toBe(0);
    expect(summary.byStatus).toEqual([]);
    await expect(
      noProfileCaller.myTransaction({ ref: "MM001OK" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("providers returns the static registry with honest configured flag", async () => {
    const result = await memberCaller.providers();
    expect(result.providers).toHaveLength(4);
    expect(result.providers[0].name).toBe("MTN MoMo");
    expect(result.limits.minAmountNGN).toBe(100);
    expect(typeof result.configured).toBe("boolean");
  });
});
