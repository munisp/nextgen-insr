/**
 * premiumTopUpTigerBeetleAuthz.test.ts — 2026-10-02 (W10-B1)
 *
 * Real-behavior PGlite tests for the W10-B1 funds-surface IDOR/gating fixes:
 *   server/routers/premiumTopUp.ts  (getHistory IDOR + topUp ownership gate)
 *   server/routers/tigerBeetle.ts   (ensureAgentAccount / getAgentBalance
 *                                    caller-must-BE-the-agent gate)
 *
 * Harness copied from insurancePolicyQuoteManager.test.ts (real embedded
 * PostgreSQL via pgliteServer.mjs, ephemeral probeFreePort, faithful table
 * projections; agents projection from auth-f3.test.ts; agent_session JWTs
 * signed with the real getJwtSecret()/jose path; revocation fail-open demo
 * flag as in auth-f3).
 *
 * Identity spaces:
 *   - members: users.id 9201/9202 with customers rows keyed by
 *     customers.keycloakSub = String(users.id) (memberPolicies precedent).
 *   - agents: agents.id 101 (agentId 'AGT-101') / 102 ('AGT-102'),
 *     agent_session JWT sub = agents.id.
 *   - POLICY_OWN: customerId = customer 9201, agentId = 101 (owned by member
 *     9201, sold by agent A). POLICY_FOREIGN: customerId = customer 9202,
 *     agentId = 102.
 *
 * Proven contract:
 *   getHistory — owner member OK; foreign member → NOT_FOUND (no data, no
 *     existence leak); admin OK; selling agent (session) OK; non-selling
 *     agent → NOT_FOUND; anonymous → UNAUTHORIZED.
 *   topUp — foreign caller with a valid agent session and premium_collect
 *     role → NOT_FOUND and ZERO durable side effects (no transactions row,
 *     no premiums row); a plain member is already denied FORBIDDEN at the
 *     financialProcedure role layer (defense in depth, still no side effect).
 *   tigerBeetle.getAgentBalance — agent reads OWN balance (PG fallback path,
 *     TB sidecar absent); foreign agentId → FORBIDDEN; admin (no agent
 *     session) OK; plain user without agent session → FORBIDDEN.
 *   tigerBeetle.ensureAgentAccount — foreign agentId → FORBIDDEN; own
 *     agentId passes the gate (fails later, fail-closed, only because the TB
 *     sidecar is absent in tests).
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  makeAuthenticatedCtx,
  makeUnauthenticatedCtx,
} from "../../lib/__tests__/testHelpers";

process.env.PERMIFY_FAIL_OPEN = "true";
// Revocation lists are Redis-backed; absent Redis in tests the fail-open
// demo flag (non-production only) is the auth-f3.test.ts pattern.
process.env.AUTH_REVOCATION_FAIL_OPEN_DEMO = "true";
process.env.JWT_SECRET = "w10b1-authz-test-secret-2026-10-02";

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

// topUp is a financialProcedure: the RBAC middleware keys on the FULL tRPC
// path ("premiumTopUp.topUp", server/_core/permifyMiddleware.ts
// ROUTER_OPERATION_MAP), so topUp callers go through the real appRouter —
// a standalone premiumTopUpRouter caller would be denied for an unmapped
// path before the ownership gate, testing nothing. getHistory/tigerBeetle
// procs are protectedProcedure (path-independent) but use the same callers
// for uniformity.
type TopUpCaller = ReturnType<
  (typeof import("../../routers"))["appRouter"]["createCaller"]
>;
type TbCaller = ReturnType<
  (typeof import("../tigerBeetle"))["tigerBeetleRouter"]["createCaller"]
>;

const AGENT_A = 101; // selling agent of POLICY_OWN
const AGENT_B = 102; // selling agent of POLICY_FOREIGN
const MEMBER_A = 9201; // owns POLICY_OWN (customers.id 9201, keycloakSub '9201')
const MEMBER_B = 9202; // owns POLICY_FOREIGN
const POLICY_OWN = 7001;
const POLICY_FOREIGN = 7002;

let topUpOwnerMember: TopUpCaller; // users.id 9201, no agent session
let topUpForeignMember: TopUpCaller; // users.id 9202
let topUpAgentA: TopUpCaller; // agent session sub=101, user.role 'agent'
let topUpAgentB: TopUpCaller; // agent session sub=102, user.role 'agent'
let topUpAdmin: TopUpCaller;
let topUpAnon: TopUpCaller;

let tbAgentA: TbCaller;
let tbPlainUser: TbCaller; // role user, no agent session
let tbAdmin: TbCaller;

async function signAgentSession(sub: number): Promise<string> {
  const { getJwtSecret } = await import("../../lib/envValidation");
  const secret = new TextEncoder().encode(getJwtSecret());
  return new SignJWT({
    agentId: `AGT-${sub}`,
    name: `Agent ${sub}`,
    tier: "gold",
    role: "agent",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(sub))
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secret);
}

function agentCtx(jwt: string, userId: number, role: string) {
  return makeAuthenticatedCtx({
    user: { id: userId, username: `agent-${userId}`, role } as any,
    req: {
      headers: { cookie: `agent_session=${jwt}` },
      ip: "127.0.0.1",
      protocol: "http",
    } as any,
  });
}

function memberCtx(userId: number, role: string) {
  return makeAuthenticatedCtx({
    user: { id: userId, username: `member-${userId}`, role } as any,
    req: { headers: {}, ip: "127.0.0.1", protocol: "http" } as any,
  });
}

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

  // Full agents projection (auth-f3.test.ts copy) — getAgentFromCookie →
  // getAgentById select()s the whole row and gates on isActive/deletedAt.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agents (
      id serial PRIMARY KEY,
      "agentId" varchar(32) NOT NULL UNIQUE,
      name varchar(128) NOT NULL,
      phone varchar(20) NOT NULL DEFAULT '',
      email varchar(320),
      location varchar(128),
      "terminalModel" varchar(64) DEFAULT 'PAX A920 MAX',
      "terminalSerial" varchar(64),
      tier varchar(32) NOT NULL DEFAULT 'Bronze',
      role varchar(32) NOT NULL DEFAULT 'agent',
      "pinHash" varchar(128) NOT NULL DEFAULT '',
      "failedPinAttempts" integer NOT NULL DEFAULT 0,
      "pinLockedUntil" timestamp,
      "premiumReserve" numeric(15,2) NOT NULL DEFAULT '0.00',
      "floatLimit" numeric(15,2) NOT NULL DEFAULT '1000000.00',
      "commissionBalance" numeric(15,2) NOT NULL DEFAULT '0.00',
      "loyaltyPoints" integer NOT NULL DEFAULT 0,
      streak integer NOT NULL DEFAULT 0,
      rank integer DEFAULT 0,
      "isActive" boolean NOT NULL DEFAULT false,
      "floatLocked" boolean NOT NULL DEFAULT false,
      "terminalEnabled" boolean NOT NULL DEFAULT true,
      "terminalDisabledReason" text,
      "lastLoginAt" timestamp,
      "deletedAt" timestamp,
      "tenantId" integer,
      "creditScore" integer DEFAULT 0,
      "creditLimit" numeric(15,2) DEFAULT '0.00',
      "creditRating" varchar(16) DEFAULT 'N/A',
      "parentAgentId" integer,
      "hierarchyRole" varchar(32) DEFAULT 'agent',
      "hierarchyLevel" integer DEFAULT 3,
      "commissionSplitOverride" numeric(5,2),
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS customers (
      id serial PRIMARY KEY,
      "firstName" varchar(64) NOT NULL DEFAULT '',
      "lastName" varchar(64) NOT NULL DEFAULT '',
      phone varchar(20) NOT NULL DEFAULT '',
      "preferredAgentId" integer,
      "keycloakSub" varchar(128) UNIQUE,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);

  // Full policies projection — topUp/getHistory select() the whole row.
  // Enum-typed columns are varchar here (memberPolicies.test.ts precedent);
  // drizzle SELECTs by column name only.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS policies (
      id serial PRIMARY KEY,
      "policyNumber" varchar(64) NOT NULL UNIQUE,
      "productId" integer NOT NULL,
      "customerId" integer NOT NULL,
      "agentId" integer,
      "brokerId" integer,
      "underwriterId" integer,
      status varchar(20) NOT NULL DEFAULT 'draft',
      "coverageType" varchar(64) NOT NULL,
      "sumInsured" numeric(18,2) NOT NULL,
      "annualPremium" numeric(18,2) NOT NULL,
      "startDate" timestamp,
      "endDate" timestamp,
      "renewalDate" timestamp,
      "cancellationDate" timestamp,
      "cancellationReason" text,
      "policyDocument" text,
      "certificateNumber" varchar(64),
      "naicomRef" varchar(128),
      "termsAndConditions" json,
      metadata json,
      "tenantId" integer,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);

  // Full premiums projection (drizzle/schema.additions.ts:303) — getHistory
  // select()s the whole row.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS premiums (
      id serial PRIMARY KEY,
      "policyId" integer NOT NULL,
      "customerId" integer,
      "agentId" integer,
      "premiumRef" varchar(128) NOT NULL,
      amount numeric(15,2) NOT NULL,
      currency varchar(8) NOT NULL DEFAULT 'NGN',
      "dueDate" timestamp NOT NULL,
      "paidDate" timestamp,
      status varchar(32) NOT NULL DEFAULT 'due',
      "paymentMethod" varchar(64),
      "paymentRef" varchar(128),
      "tbTransferId" varchar(128),
      "gracePeriodDays" integer DEFAULT 30,
      "tenantId" varchar(64),
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);

  // Minimal transactions projection — only raw-SQL side-effect assertions
  // touch it (the ownership gate throws BEFORE the idempotency select for
  // every tested leg).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS transactions (
      id serial PRIMARY KEY,
      ref varchar(32) NOT NULL UNIQUE,
      "agentId" integer,
      amount numeric(15,2)
    )`);

  await db.execute(sql`
    INSERT INTO agents (id, "agentId", name, phone, "isActive", "premiumReserve")
    VALUES
      (${AGENT_A}, 'AGT-101', 'Agent A', '09000000011', true, 1234.56),
      (${AGENT_B}, 'AGT-102', 'Agent B', '09000000012', true, 77.00)`);

  await db.execute(sql`
    INSERT INTO customers (id, "firstName", "lastName", phone, "keycloakSub")
    VALUES
      (${MEMBER_A}, 'Member', 'A', '09000000021', '9201'),
      (${MEMBER_B}, 'Member', 'B', '09000000022', '9202')`);

  await db.execute(sql`
    INSERT INTO policies
      (id, "policyNumber", "productId", "customerId", "agentId", status,
       "coverageType", "sumInsured", "annualPremium")
    VALUES
      (${POLICY_OWN}, 'POL-OWN-7001', 11, ${MEMBER_A}, ${AGENT_A}, 'active', 'life', 500000, 10000),
      (${POLICY_FOREIGN}, 'POL-FOR-7002', 11, ${MEMBER_B}, ${AGENT_B}, 'active', 'life', 600000, 12000)`);

  await db.execute(sql`
    INSERT INTO premiums
      ("policyId", "customerId", "agentId", "premiumRef", amount, "dueDate",
       "paidDate", status, "paymentMethod", "paymentRef")
    VALUES
      (${POLICY_OWN}, ${MEMBER_A}, ${AGENT_A}, 'PMT-OWN-1', 10000, now(), now(), 'paid', 'cash', 'PMT-OWN-1'),
      (${POLICY_FOREIGN}, ${MEMBER_B}, ${AGENT_B}, 'PMT-FOR-1', 12000, now(), now(), 'paid', 'card', 'PMT-FOR-1')`);
}

async function txCount(): Promise<number> {
  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const db = (await getDb())!;
  const r = await db.execute(sql`SELECT COUNT(*)::int AS n FROM transactions`);
  return Number((r as any).rows?.[0]?.n ?? (r as any)[0]?.n);
}

async function premiumCount(): Promise<number> {
  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const db = (await getDb())!;
  const r = await db.execute(sql`SELECT COUNT(*)::int AS n FROM premiums`);
  return Number((r as any).rows?.[0]?.n ?? (r as any)[0]?.n);
}

beforeAll(async () => {
  await startPglite();
  await createTablesAndSeed();
  const { appRouter } = await import("../../routers");
  const { tigerBeetleRouter } = await import("../tigerBeetle");

  topUpOwnerMember = appRouter.createCaller(memberCtx(MEMBER_A, "user"));
  topUpForeignMember = appRouter.createCaller(memberCtx(MEMBER_B, "user"));
  // Agent callers carry a real agent_session JWT; user.role 'agent' (cast in
  // agentCtx) so topUp passes the financialProcedure role layer and the
  // W10-B1 ownership gate is what decides.
  topUpAgentA = appRouter.createCaller(
    agentCtx(await signAgentSession(AGENT_A), 9101, "agent")
  );
  topUpAgentB = appRouter.createCaller(
    agentCtx(await signAgentSession(AGENT_B), 9102, "agent")
  );
  topUpAdmin = appRouter.createCaller(makeAuthenticatedCtx());
  topUpAnon = appRouter.createCaller(makeUnauthenticatedCtx());

  tbAgentA = tigerBeetleRouter.createCaller(
    agentCtx(await signAgentSession(AGENT_A), 9101, "user")
  );
  tbPlainUser = tigerBeetleRouter.createCaller(memberCtx(9999, "user"));
  tbAdmin = tigerBeetleRouter.createCaller(makeAuthenticatedCtx());
}, 60_000);

afterAll(() => {
  pgliteChild?.kill();
});

describe("premiumTopUp.getHistory ownership (2026-10-02, W10-B1)", () => {
  it("rejects anonymous callers with UNAUTHORIZED", async () => {
    await expect(
      topUpAnon.premiumTopUp.getHistory({ policyId: POLICY_OWN, limit: 20, offset: 0 })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("owner member reads their own policy history", async () => {
    const r = await topUpOwnerMember.premiumTopUp.getHistory({
      policyId: POLICY_OWN,
      limit: 20,
      offset: 0,
    });
    expect(r.total).toBe(1);
    expect(r.data).toHaveLength(1);
    expect((r.data[0] as any).premiumRef).toBe("PMT-OWN-1");
  });

  it("foreign member → NOT_FOUND, no data, no existence leak", async () => {
    await expect(
      topUpForeignMember.premiumTopUp.getHistory({ policyId: POLICY_OWN, limit: 20, offset: 0 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Nonexistent policy yields the identical error shape (non-enumerating).
    await expect(
      topUpForeignMember.premiumTopUp.getHistory({ policyId: 999999, limit: 20, offset: 0 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("admin (no agent session) reads any policy history", async () => {
    const r = await topUpAdmin.premiumTopUp.getHistory({
      policyId: POLICY_FOREIGN,
      limit: 20,
      offset: 0,
    });
    expect(r.total).toBe(1);
    expect((r.data[0] as any).premiumRef).toBe("PMT-FOR-1");
  });

  it("selling agent (agent_session sub = policies.agentId) reads history", async () => {
    const r = await topUpAgentA.premiumTopUp.getHistory({
      policyId: POLICY_OWN,
      limit: 20,
      offset: 0,
    });
    expect(r.total).toBe(1);
  });

  it("non-selling agent → NOT_FOUND", async () => {
    await expect(
      topUpAgentB.premiumTopUp.getHistory({ policyId: POLICY_OWN, limit: 20, offset: 0 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("premiumTopUp.topUp ownership gate (2026-10-02, W10-B1)", () => {
  it("foreign agent (valid session, premium_collect role) → NOT_FOUND, ZERO side effects", async () => {
    const txBefore = await txCount();
    const premBefore = await premiumCount();
    await expect(
      topUpAgentB.premiumTopUp.topUp({
        policyId: POLICY_OWN,
        amountNGN: 10000,
        paymentMethod: "cash",
        reference: "W10B1-Foreign-Ref-1",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Fail-closed means NOTHING durable: no transactions row, no premiums
    // row (the gate runs before the TB transfer and both PG inserts).
    expect(await txCount()).toBe(txBefore);
    expect(await premiumCount()).toBe(premBefore);
  });

  it("foreign member is denied (FORBIDDEN at the financial layer), ZERO side effects", async () => {
    const txBefore = await txCount();
    const premBefore = await premiumCount();
    await expect(
      topUpForeignMember.premiumTopUp.topUp({
        policyId: POLICY_OWN,
        amountNGN: 10000,
        paymentMethod: "cash",
        reference: "W10B1-Foreign-Ref-2",
      })
    ).rejects.toThrow();
    expect(await txCount()).toBe(txBefore);
    expect(await premiumCount()).toBe(premBefore);
  });
});

describe("tigerBeetle agent-identity gate (2026-10-02, W10-B1)", () => {
  it("agent reads OWN balance (PG fallback — TB sidecar absent in tests)", async () => {
    const r = await tbAgentA.getAgentBalance({ agentId: "AGT-101" });
    expect(r).toMatchObject({ source: "postgresql", balanceNGN: 1234.56 });
  });

  it("agent CANNOT read a FOREIGN agent balance → FORBIDDEN", async () => {
    await expect(
      tbAgentA.getAgentBalance({ agentId: "AGT-102" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("agent CANNOT provision a FOREIGN agent account → FORBIDDEN", async () => {
    await expect(
      tbAgentA.ensureAgentAccount({ agentId: "AGT-102" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("plain user without an agent session → FORBIDDEN on both procs", async () => {
    await expect(
      tbPlainUser.getAgentBalance({ agentId: "AGT-101" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      tbPlainUser.ensureAgentAccount({ agentId: "AGT-101" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("admin (no agent session) may query any agent balance", async () => {
    const r = await tbAdmin.getAgentBalance({ agentId: "AGT-101" });
    expect(r).toMatchObject({ source: "postgresql", balanceNGN: 1234.56 });
  });

  it("own-agent ensureAgentAccount passes the gate (no FORBIDDEN)", async () => {
    // The gate is the ONLY new check; with the caller BEING AGT-101 the
    // request proceeds to tbEnsureAgentAccount. Whether that succeeds
    // depends on sidecar availability in the test env — the assertion is
    // only that the outcome is NEVER a FORBIDDEN gate rejection.
    try {
      const r = await tbAgentA.ensureAgentAccount({ agentId: "AGT-101" });
      expect(r).toMatchObject({ agentId: "AGT-101" });
    } catch (e: any) {
      expect(e?.code).not.toBe("FORBIDDEN");
    }
  });
});
