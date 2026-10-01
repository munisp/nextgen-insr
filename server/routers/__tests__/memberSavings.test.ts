/**
 * memberSavings.test.ts — R3 batch 2 (2026-10-01, R3-b2)
 *
 * Real-behavior PGlite tests for server/routers/memberSavings.ts. No DB
 * doubles: real PostgreSQL (PGlite wire protocol, spawned
 * tests/integration/setup/pgliteServer.mjs), minimal table projections
 * carrying exactly the columns the router selects/inserts, real SQL
 * execution — the memberClaims/memberReferrals batch-1 pattern.
 *
 * Port: EPHEMERAL free-port probe (memberReferrals.test.ts probeFreePort
 * pattern, 2026-10-01 R3-fix-ci2) — hardcoded ports collided in CI
 * (EADDRINUSE). PG_URL is computed after the probe in startPglite().
 *
 * Covers:
 *   - anonymous caller → UNAUTHORIZED on every proc (protectedProcedure)
 *   - mySummary: settled-only sums (status="success" Cash In − Cash Out);
 *     pending/failed rows and FOREIGN rows seeded in the same table never
 *     leak into the balance
 *   - myTransactions: scoped transactions.agentId = resolved customers.id,
 *     foreign rows invisible, type filter, newest first
 *   - myAccount: own row projection (no PII columns selected), null when no
 *     profile
 *   - openMyAccount: binds the SESSION identity (keycloakSub forced to
 *     String(ctx.user.id), names from ctx.user.name — smuggled input
 *     identity fields are ignored), CONFLICT on second opening, fail-closed
 *     KYC gate (bvn supplied + gateway unreachable → PRECONDITION_FAILED and
 *     NO row is created)
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  makeAuthenticatedCtx,
  makeUnauthenticatedCtx,
} from "../../lib/__tests__/testHelpers";

// 2026-10-01 (R3-b2): ephemeral free port (memberReferrals probeFreePort
// pattern — batch-1 hit EADDRINUSE with hardcoded ports in CI).
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
// as memberPolicies/memberClaims/memberReferrals) so protectedProcedure
// passes the base gate; the member authz under test is enforced by the
// router itself.
process.env.PERMIFY_FAIL_OPEN = "true";
// Force the fail-closed KYC gate onto a guaranteed-unreachable address
// (port 9 = discard, refused) so the bvn test exercises the network-failure
// branch deterministically, regardless of what runs on localhost:8211.
process.env.KYC_ENFORCEMENT_URL = "http://127.0.0.1:9";

type Caller = ReturnType<
  (typeof import("../memberSavings"))["memberSavingsRouter"]["createCaller"]
>;
let memberCaller: Caller; // user id 4242 → customer CUSTOMER_ID
let openerCaller: Caller; // user id 8888, no customer row yet
let anonCaller: Caller;

// 2026-10-01 (R3-b2 verify fix): user.id and customer.id are DELIBERATELY
// distinct id spaces here (7777 vs 4242) so a regression that scopes by the
// wrong space fails loudly instead of passing vacuously.
const MEMBER_USER_ID = 7777;
const CUSTOMER_ID = 4242; // transactions.agentId lives in customers.id space
const FOREIGN_CUSTOMER_ID = 9999; // foreign customer + transactions seeded

const memberCtx = () =>
  makeAuthenticatedCtx({
    user: {
      id: MEMBER_USER_ID,
      username: "member-sav",
      role: "user",
      name: "Savings Member",
      email: "sav@example.io",
    } as never,
  });
const openerCtx = () =>
  makeAuthenticatedCtx({
    user: {
      id: 8888,
      username: "member-open",
      role: "user",
      name: "Session Person",
      email: "open@example.io",
    } as never,
  });

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

  // Minimal tables carrying exactly the columns the router projects (plus
  // NOT-NULL/UNIQUE columns the seed inserts). Real enum types matching
  // drizzle/schema.ts txTypeEnum/txStatusEnum so the column types are
  // faithful.
  await db.execute(sql`
    CREATE TYPE tx_type AS ENUM (
      'Cash In', 'Cash Out', 'Transfer', 'Card Payment', 'QR Payment',
      'NFC Payment', 'Airtime', 'Bill Payment', 'Reversal', 'Nano Loan',
      'Insurance', 'Float Transfer', 'Float Transfer Received'
    )`);
  await db.execute(sql`
    CREATE TYPE tx_status AS ENUM (
      'success', 'pending', 'failed', 'reversed', 'pending_reversal_approval'
    )`);
  // The drizzle insert in openMyAccount references EVERY schema column
  // (defaults included), so the test table must carry the full customers
  // column set from drizzle/schema.ts — not just the projected ones.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS customers (
      id serial PRIMARY KEY,
      "externalId" varchar(128) UNIQUE,
      "firstName" varchar(64) NOT NULL,
      "lastName" varchar(64) NOT NULL,
      email varchar(320),
      phone varchar(20) NOT NULL UNIQUE,
      bvn text,
      nin text,
      bvn_hash varchar(64),
      nin_hash varchar(64),
      "dateOfBirth" text,
      address text,
      status varchar(20) NOT NULL DEFAULT 'pending_kyc',
      "kycLevel" integer NOT NULL DEFAULT 0,
      "walletBalance" numeric(15,2) NOT NULL DEFAULT '0.00',
      "dailyLimit" numeric(15,2) NOT NULL DEFAULT '50000.00',
      "monthlyLimit" numeric(15,2) NOT NULL DEFAULT '300000.00',
      "preferredAgentId" integer,
      "keycloakSub" varchar(128) UNIQUE,
      "passwordHash" varchar(256),
      "refreshToken" text,
      "lastLoginAt" timestamp,
      "deletedAt" timestamp,
      "tenantId" integer,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS transactions (
      id serial PRIMARY KEY,
      ref varchar(32) NOT NULL UNIQUE,
      "agentId" integer NOT NULL,
      type tx_type NOT NULL,
      amount numeric(15,2) NOT NULL,
      currency varchar(8) NOT NULL DEFAULT 'NGN',
      channel varchar(16),
      status tx_status NOT NULL DEFAULT 'pending',
      "failureReason" text,
      "createdAt" timestamp NOT NULL DEFAULT now()
    )`);
  // Full audit_log column set (the router's drizzle insert lists defaults
  // for every schema column).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS audit_log (
      id bigserial PRIMARY KEY,
      "agentId" integer,
      action varchar(128) NOT NULL,
      resource varchar(64),
      "resourceId" varchar(64),
      "ipAddress" varchar(45),
      "userAgent" varchar(256),
      status varchar(20) DEFAULT 'success',
      metadata json,
      "tenantId" integer,
      "prevHash" varchar(64),
      "entryHash" varchar(64),
      "redactedAt" timestamp,
      "createdAt" timestamp NOT NULL DEFAULT now()
    )`);

  // Caller customer (id = CUSTOMER_ID — transactions.agentId lives in
  // customers.id space; keycloakSub = String(user.id)) + a foreign customer.
  await db.execute(sql`
    INSERT INTO customers (id, "firstName", "lastName", phone, status, "keycloakSub")
    VALUES
      (${CUSTOMER_ID}, 'Savings', 'Member', '08030000001', 'active', ${String(MEMBER_USER_ID)}),
      (${FOREIGN_CUSTOMER_ID}, 'Foreign', 'Member', '08030000002', 'active', '9999')`);

  // Transactions: caller-settled Cash In 10_000, caller-settled Cash Out
  // 2_500, caller PENDING Cash In 50_000 (must NOT count toward the
  // settled-only balance), foreign settled Cash In 75_000 (must never leak).
  const mkTx = (
    ref: string,
    agentId: number,
    type: string,
    status: string,
    amount: string
  ) => sql`
    INSERT INTO transactions (ref, "agentId", type, status, amount)
    VALUES (${ref}, ${agentId}, ${type}::tx_type, ${status}::tx_status, ${amount})`;
  await db.execute(mkTx("TX-IN-1", CUSTOMER_ID, "Cash In", "success", "10000.00"));
  await db.execute(mkTx("TX-OUT-1", CUSTOMER_ID, "Cash Out", "success", "2500.00"));
  await db.execute(mkTx("TX-PEND-1", CUSTOMER_ID, "Cash In", "pending", "50000.00"));
  await db.execute(mkTx("TX-FRN-1", FOREIGN_CUSTOMER_ID, "Cash In", "success", "75000.00"));
}

beforeAll(async () => {
  await startPglite();
  await createTablesAndSeed();
  const { memberSavingsRouter } = await import("../memberSavings");
  memberCaller = memberSavingsRouter.createCaller(memberCtx());
  openerCaller = memberSavingsRouter.createCaller(openerCtx());
  anonCaller = memberSavingsRouter.createCaller(makeUnauthenticatedCtx());
}, 60_000);

afterAll(() => {
  pgliteChild?.kill();
});

describe("memberSavings router (R3 batch 2, 2026-10-01)", () => {
  describe("auth gate (fail-closed)", () => {
    it("rejects anonymous callers with UNAUTHORIZED on every proc", async () => {
      await expect(anonCaller.mySummary()).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      await expect(anonCaller.myTransactions(undefined)).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      await expect(anonCaller.myAccount()).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      await expect(
        anonCaller.openMyAccount({ phone: "08030000009" })
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  describe("mySummary", () => {
    it("returns settled-only sums scoped to the caller (foreign + pending rows excluded)", async () => {
      const res = await memberCaller.mySummary();
      // 10_000 settled in − 2_500 settled out; the 50_000 pending Cash In
      // and the 75_000 FOREIGN settled Cash In never enter the balance.
      expect(res.balance).toBe(7500);
      expect(res.totalIn).toBe(10000);
      expect(res.totalOut).toBe(2500);
      expect(res.settledTransactions).toBe(2);
      expect(res.currency).toBe("NGN");
      expect(res.customerId).toBe(CUSTOMER_ID);
    });

    it("answers NOT_FOUND (non-enumerating) when the session has no customer profile", async () => {
      await expect(openerCaller.mySummary()).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("myTransactions", () => {
    it("scopes to the caller's customer id — foreign rows never leak, all statuses shown", async () => {
      const res = await memberCaller.myTransactions({ limit: 50, offset: 0 });
      expect(res.count).toBe(3);
      expect(res.transactions).toHaveLength(3);
      const refs = res.transactions.map(t => t.ref);
      expect(refs).not.toContain("TX-FRN-1");
      // Newest first (highest id first).
      expect(refs[0]).toBe("TX-PEND-1");
      // Pending history rows are disclosed, not hidden.
      const pending = res.transactions.find(t => t.ref === "TX-PEND-1");
      expect(pending?.status).toBe("pending");
    });

    it("applies the type filter", async () => {
      const res = await memberCaller.myTransactions({ type: "Cash Out" });
      expect(res.count).toBe(1);
      expect(res.transactions[0].ref).toBe("TX-OUT-1");
      expect(res.transactions[0].type).toBe("Cash Out");
    });
  });

  describe("myAccount", () => {
    it("returns the caller's own row projection (no PII columns)", async () => {
      const res = await memberCaller.myAccount();
      expect(res.account).not.toBeNull();
      expect(res.account!.id).toBe(CUSTOMER_ID);
      expect(res.account!.firstName).toBe("Savings");
      expect(res.account!.lastName).toBe("Member");
      expect(res.account!.status).toBe("active");
      // The projection must never include PII/secret columns.
      expect(res.account).not.toHaveProperty("bvn");
      expect(res.account).not.toHaveProperty("nin");
      expect(res.account).not.toHaveProperty("bvnHash");
      expect(res.account).not.toHaveProperty("ninHash");
      expect(res.account).not.toHaveProperty("keycloakSub");
    });

    it("returns { account: null } when the session has no customer profile", async () => {
      const res = await openerCaller.myAccount();
      expect(res.account).toBeNull();
    });
  });

  describe("openMyAccount", () => {
    it("binds the SESSION identity — smuggled input identity fields are ignored", async () => {
      const res = await openerCaller.openMyAccount({
        phone: "08030000009",
        // Smuggled identity attempts: the input schema does not accept these
        // and the router never reads them — names/keycloakSub come from the
        // session.
        ...({
          firstName: "Forged",
          lastName: "Identity",
          keycloakSub: "9999",
        } as Record<string, never>),
      });
      expect(res.success).toBe(true);
      expect(res.account.firstName).toBe("Session");
      expect(res.account.lastName).toBe("Person");
      expect(res.account.status).toBe("pending_kyc");

      // Verify the persisted row really carries the session identity.
      const { getDb } = await import("../../db");
      const { sql } = await import("drizzle-orm");
      const db = await getDb();
      const rows = (await db!.execute(sql`
        SELECT "keycloakSub", "firstName", "lastName", status
        FROM customers WHERE phone = '08030000009'`)) as any;
      const row = rows.rows?.[0] ?? rows[0];
      expect(row.keycloakSub).toBe("8888");
      expect(row.firstName).toBe("Session");
      expect(row.status).toBe("pending_kyc");
    });

    it("answers CONFLICT when the session already has an account", async () => {
      await expect(
        openerCaller.openMyAccount({ phone: "08030000010" })
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(
        memberCaller.openMyAccount({ phone: "08030000011" })
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("blocks opening fail-closed when bvn is supplied and the KYC gateway is unreachable", async () => {
      // Fresh caller: a different session user with no customer row.
      const { memberSavingsRouter } = await import("../memberSavings");
      const kycCaller = memberSavingsRouter.createCaller(
        makeAuthenticatedCtx({
          user: {
            id: 9998, // 2026-10-01 (R3-b2 verify fix): distinct from opener 8888 — the KYC-gate caller must have no pre-existing customer row
            username: "member-kyc",
            role: "user",
            name: "Kyc Blocked",
            email: "kyc@example.io",
          } as never,
        })
      );
      await expect(
        kycCaller.openMyAccount({
          phone: "08030000012",
          bvn: "12345678901",
        })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

      // Fail-closed means NO row was created for this session.
      const { getDb } = await import("../../db");
      const { sql } = await import("drizzle-orm");
      const db = await getDb();
      const rows = (await db!.execute(sql`
        SELECT COUNT(*)::int AS n FROM customers WHERE "keycloakSub" = '9998'`)) as any;
      const row = rows.rows?.[0] ?? rows[0];
      expect(row.n).toBe(0); // fail-closed: the KYC-blocked caller (9998) got no row
    });
  });
});
