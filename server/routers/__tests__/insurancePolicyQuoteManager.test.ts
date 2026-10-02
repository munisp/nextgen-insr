/**
 * insurancePolicyQuoteManager.test.ts — 2026-10-02 (IDOR hardening)
 *
 * Real-behavior PGlite tests for server/routers/insurancePolicyQuoteManager.ts
 * (harness copied from memberQuotes.test.ts — real embedded PostgreSQL,
 * ephemeral probeFreePort, faithful table projections; agents projection
 * copied from auth-f3.test.ts; agent_session JWTs signed with the real
 * getJwtSecret()/jose path, revocation fail-open demo flag as in auth-f3).
 *
 * The pre-fix router was an unbound IDOR surface: removeItem cancelled ANY
 * quoteId with no ownership check; getCart/clearCart/getSummary trusted a
 * caller-supplied customerId; addToCart trusted caller-supplied customerId
 * AND agentId. These tests prove the hardened contract:
 *   - agent A CANNOT remove agent B's quote → NOT_FOUND, row stays pending
 *   - agent A CANNOT remove a quote of a customer assigned to agent B →
 *     NOT_FOUND (no existence leak for foreign rows)
 *   - owner agent CAN remove their own quote (agentId = their agents.id)
 *   - agent CAN remove a quote of a customer ASSIGNED to them
 *     (customers.preferredAgentId — the repo's only agent→customer link)
 *   - admin (no agent session) CAN remove any pending quote (role bypass)
 *   - non-admin WITHOUT an agent session → FORBIDDEN (fail-closed)
 *   - caller-supplied foreign customerId is ignored (getCart/getSummary/
 *     clearCart) or rejected NOT_FOUND (addToCart)
 *   - addToCart pins agentId = session agent (agentId no longer in input)
 *
 * Identity spaces: agent A = agents.id 101 (JWT sub 101), agent B = 102.
 * Customer 5001 assigned to A, 5002 assigned to B (preferredAgentId).
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
process.env.JWT_SECRET = "ipqm-idor-test-secret-2026-10-02";

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

type Caller = ReturnType<
  (typeof import("../insurancePolicyQuoteManager"))["insurancePolicyQuoteManagerRouter"]["createCaller"]
>;
let agentACaller: Caller; // agent_session sub=101
let agentBCaller: Caller; // agent_session sub=102
let adminCaller: Caller; // role admin, no agent session
let plainUserCaller: Caller; // role user, no agent session → FORBIDDEN
let anonCaller: Caller;

const AGENT_A = 101;
const AGENT_B = 102;
const CUST_A = 5001; // preferredAgentId = AGENT_A
const CUST_B = 5002; // preferredAgentId = AGENT_B
const PRODUCT_ID = 11;

let foreignQuoteId = 0; // agent B's quote (agentId 102) — IDOR probe target
let foreignCustQuoteId = 0; // agentId NULL, customerId CUST_B — probe target
let ownQuoteId = 0; // agent A's quote
let assignedQuoteId = 0; // agentId NULL, customerId CUST_A — A's assigned cust
let adminTargetQuoteId = 0; // another agent B quote, for the admin leg

async function signAgentSession(sub: number): Promise<string> {
  const { getJwtSecret } = await import("../../lib/envValidation");
  const secret = new TextEncoder().encode(getJwtSecret());
  return new SignJWT({ agentId: `AGT-${sub}`, name: `Agent ${sub}`, tier: "gold", role: "agent" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(sub))
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secret);
}

function agentCtx(jwt: string, userId: number) {
  return makeAuthenticatedCtx({
    user: { id: userId, username: `agent-${userId}`, role: "user" } as any,
    req: {
      headers: { cookie: `agent_session=${jwt}` },
      ip: "127.0.0.1",
      protocol: "http",
    } as any,
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

  await db.execute(sql`
    CREATE TYPE coverage_type AS ENUM
      ('life', 'health', 'motor', 'property', 'liability', 'marine',
       'aviation', 'agriculture', 'credit', 'travel', 'micro', 'group_life',
       'annuity', 'pension')`);

  // Full agents projection (copied from auth-f3.test.ts) — getAgentFromCookie
  // → getAgentById select()s the whole row and gates on isActive/deletedAt.
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

  // Customers projection + preferredAgentId (the agent→customer assignment
  // link the hardened router checks — schema.ts:1462).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS customers (
      id serial PRIMARY KEY,
      "firstName" varchar(64) NOT NULL,
      "lastName" varchar(64) NOT NULL,
      phone varchar(20) NOT NULL,
      "preferredAgentId" integer,
      "keycloakSub" varchar(128) UNIQUE,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);

  // FULL insurance_products projection (copied from quotePricingA1b.test.ts —
  // addToCart select()s the whole row).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS insurance_products (
      id serial PRIMARY KEY,
      "productCode" varchar(32) NOT NULL UNIQUE,
      name varchar(256) NOT NULL,
      description text,
      "coverageType" coverage_type NOT NULL,
      "minPremium" numeric(18,2),
      "maxCoverageAmount" numeric(18,2),
      "minAge" integer,
      "maxAge" integer,
      "waitingPeriodDays" integer DEFAULT 0,
      "policyTermMonths" integer DEFAULT 12,
      "isActive" boolean NOT NULL DEFAULT true,
      "regulatoryApprovalRef" varchar(128),
      "naicomProductCode" varchar(64),
      "tenantId" integer,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);

  // Minimal claims projection — addToCart counts claims.claimantId =
  // ctx.user.id (A1b rule).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS claims (
      id serial PRIMARY KEY,
      "claimantId" integer NOT NULL
    )`);

  // Filed rating tables (A1 fail-closed pricing) — copied from
  // memberQuotes.test.ts.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS rating_tables (
      id serial PRIMARY KEY,
      "productCode" text,
      "coverageClass" text,
      "effectiveFrom" timestamp NOT NULL,
      "effectiveTo" timestamp,
      status varchar(16) NOT NULL DEFAULT 'draft',
      version integer NOT NULL,
      "filedBy" integer,
      "approvedBy" integer,
      "naicomFilingRef" text,
      "tenantId" integer,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS rating_factors (
      id serial PRIMARY KEY,
      "tableId" integer NOT NULL,
      "factorType" varchar(32) NOT NULL,
      "factorKey" text NOT NULL,
      value numeric(18,6) NOT NULL,
      "minClamp" numeric(18,6),
      "maxClamp" numeric(18,6),
      "sortOrder" integer NOT NULL,
      "tenantId" integer,
      "createdAt" timestamp NOT NULL DEFAULT now()
    )`);

  // Full policy_quotes column set (schema.additions.ts:470).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS policy_quotes (
      id serial PRIMARY KEY,
      "customerId" integer,
      "agentId" integer,
      "productId" integer,
      "productName" text,
      "productType" varchar(64),
      "sumInsured" numeric(18,2),
      "premiumAmount" numeric(18,2),
      "stampDuty" numeric(18,2),
      "totalPayable" numeric(18,2),
      "durationMonths" integer,
      "coverageType" varchar(64),
      status varchar(32) NOT NULL DEFAULT 'pending',
      "validUntil" timestamp,
      metadata jsonb,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);

  await db.execute(sql`
    INSERT INTO agents (id, "agentId", name, phone, "isActive")
    VALUES
      (${AGENT_A}, 'AGT-101', 'Agent A', '09000000011', true),
      (${AGENT_B}, 'AGT-102', 'Agent B', '09000000012', true)`);

  await db.execute(sql`
    INSERT INTO customers (id, "firstName", "lastName", phone, "preferredAgentId", "keycloakSub")
    VALUES
      (${CUST_A}, 'Cust', 'A', '09000000021', ${AGENT_A}, '101'),
      (${CUST_B}, 'Cust', 'B', '09000000022', ${AGENT_B}, '102')`);

  await db.execute(sql`
    INSERT INTO insurance_products (id, "productCode", name, "coverageType")
    VALUES (${PRODUCT_ID}, 'IPQM-LIFE-001', 'Family Life Plan', 'life')`);

  // Filed NAICOM rating table: base rate 0.02/yr, stamp duty 0.5% (same
  // fixture shape as memberQuotes.test.ts → premium 10000 on 500000/12mo).
  await db.execute(sql`
    INSERT INTO rating_tables
      ("productCode", "coverageClass", "effectiveFrom", status, version,
       "naicomFilingRef")
    VALUES ('IPQM-LIFE-001', 'life', '2026-01-01T00:00:00Z', 'active', 1,
            'NAICOM/2026/IPQM-LIFE-001')`);
  await db.execute(sql`
    INSERT INTO rating_factors ("tableId", "factorType", "factorKey", value, "sortOrder")
    SELECT id, 'base', 'rate', '0.02', 0 FROM rating_tables
    WHERE "productCode" = 'IPQM-LIFE-001'`);

  // Seed quotes across the ownership matrix.
  const qr = await db.execute(sql`
    INSERT INTO policy_quotes
      ("customerId", "agentId", "productId", "productName", "sumInsured",
       "premiumAmount", "stampDuty", "totalPayable", "durationMonths", status)
    VALUES
      (${CUST_B}, ${AGENT_B}, ${PRODUCT_ID}, 'Family Life Plan', 900000, 18000, 90, 18090, 12, 'pending'),
      (${CUST_B}, NULL,     ${PRODUCT_ID}, 'Family Life Plan', 800000, 16000, 80, 16080, 12, 'pending'),
      (${CUST_A}, ${AGENT_A}, ${PRODUCT_ID}, 'Family Life Plan', 700000, 14000, 70, 14070, 12, 'pending'),
      (${CUST_A}, NULL,     ${PRODUCT_ID}, 'Family Life Plan', 600000, 12000, 60, 12060, 12, 'pending'),
      (${CUST_B}, ${AGENT_B}, ${PRODUCT_ID}, 'Family Life Plan', 500000, 10000, 50, 10050, 12, 'pending')
    RETURNING id`);
  const ids = ((qr as any).rows ?? (qr as any)).map((r: any) => Number(r.id));
  [foreignQuoteId, foreignCustQuoteId, ownQuoteId, assignedQuoteId, adminTargetQuoteId] = ids;
}

async function quoteStatus(quoteId: number): Promise<string> {
  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const db = (await getDb())!;
  const r = await db.execute(
    sql`SELECT status FROM policy_quotes WHERE id = ${quoteId}`
  );
  const row = (r as any).rows?.[0] ?? (r as any)[0];
  return String(row.status);
}

async function pendingCountFor(customerId: number): Promise<number> {
  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const db = (await getDb())!;
  const r = await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM policy_quotes
        WHERE "customerId" = ${customerId} AND status = 'pending'`
  );
  return Number((r as any).rows?.[0]?.n ?? (r as any)[0]?.n);
}

beforeAll(async () => {
  await startPglite();
  await createTablesAndSeed();
  const { insurancePolicyQuoteManagerRouter } = await import(
    "../insurancePolicyQuoteManager"
  );
  agentACaller = insurancePolicyQuoteManagerRouter.createCaller(
    agentCtx(await signAgentSession(AGENT_A), 9101)
  );
  agentBCaller = insurancePolicyQuoteManagerRouter.createCaller(
    agentCtx(await signAgentSession(AGENT_B), 9102)
  );
  // Admin: valid Keycloak admin user, agent_session cookie invalid/absent →
  // resolveAgentScope fails, role bypass applies (repo pattern).
  adminCaller = insurancePolicyQuoteManagerRouter.createCaller(
    makeAuthenticatedCtx()
  );
  plainUserCaller = insurancePolicyQuoteManagerRouter.createCaller(
    makeAuthenticatedCtx({
      user: { id: 9999, username: "plain", role: "user" } as any,
      req: { headers: {}, ip: "127.0.0.1", protocol: "http" } as any,
    })
  );
  anonCaller = insurancePolicyQuoteManagerRouter.createCaller(
    makeUnauthenticatedCtx()
  );
}, 60_000);

afterAll(() => {
  pgliteChild?.kill();
});

describe("insurancePolicyQuoteManager IDOR hardening (2026-10-02)", () => {
  it("rejects anonymous callers with UNAUTHORIZED", async () => {
    await expect(
      anonCaller.removeItem({ quoteId: foreignQuoteId })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anonCaller.getCart({})).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("fails closed: non-admin without an agent session → FORBIDDEN on every proc", async () => {
    await expect(
      plainUserCaller.removeItem({ quoteId: foreignQuoteId })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(plainUserCaller.getCart({})).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(plainUserCaller.getSummary({})).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(plainUserCaller.clearCart({})).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      plainUserCaller.addToCart({ productId: PRODUCT_ID, sumInsured: 1000 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Fail-closed means NOTHING was cancelled.
    expect(await quoteStatus(foreignQuoteId)).toBe("pending");
  });

  it("agent A CANNOT remove agent B's quote → NOT_FOUND, row intact", async () => {
    await expect(
      agentACaller.removeItem({ quoteId: foreignQuoteId })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await quoteStatus(foreignQuoteId)).toBe("pending");
  });

  it("agent A CANNOT remove a quote of a customer assigned to agent B → NOT_FOUND", async () => {
    // The customerId-smuggle leg: quote.agentId is NULL but the customer is
    // foreign (preferredAgentId = agent B). Still NOT_FOUND — no leak.
    await expect(
      agentACaller.removeItem({ quoteId: foreignCustQuoteId })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await quoteStatus(foreignCustQuoteId)).toBe("pending");
  });

  it("owner agent CAN remove their own quote (agentId = session agent)", async () => {
    const r = await agentACaller.removeItem({ quoteId: ownQuoteId });
    expect(r).toMatchObject({ removed: true, quoteId: ownQuoteId });
    expect(await quoteStatus(ownQuoteId)).toBe("cancelled");
  });

  it("agent CAN remove a quote of a customer ASSIGNED to them (preferredAgentId)", async () => {
    const r = await agentACaller.removeItem({ quoteId: assignedQuoteId });
    expect(r).toMatchObject({ removed: true, quoteId: assignedQuoteId });
    expect(await quoteStatus(assignedQuoteId)).toBe("cancelled");
  });

  it("re-removing a cancelled quote → NOT_FOUND (pending-scoped, non-enumerating)", async () => {
    await expect(
      agentACaller.removeItem({ quoteId: ownQuoteId })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("admin (no agent session) CAN remove any pending quote — role bypass", async () => {
    const r = await adminCaller.removeItem({ quoteId: adminTargetQuoteId });
    expect(r).toMatchObject({ removed: true, quoteId: adminTargetQuoteId });
    expect(await quoteStatus(adminTargetQuoteId)).toBe("cancelled");
  });

  it("getCart ignores a caller-supplied foreign customerId for agents", async () => {
    // Seed one more pending quote per side AFTER the removals above.
    const { getDb } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    const db = (await getDb())!;
    await db.execute(sql`
      INSERT INTO policy_quotes
        ("customerId", "agentId", "productId", "productName", status)
      VALUES
        (${CUST_A}, ${AGENT_A}, ${PRODUCT_ID}, 'Family Life Plan', 'pending'),
        (${CUST_B}, ${AGENT_B}, ${PRODUCT_ID}, 'Family Life Plan', 'pending')`);

    // Agent A asks for customer CUST_B's cart — the foreign id is IGNORED;
    // only A-scoped pending quotes come back.
    const cart = await agentACaller.getCart({ customerId: CUST_B });
    expect(cart.items.length).toBeGreaterThan(0);
    for (const item of cart.items) {
      expect(item.customerId === CUST_A || item.agentId === AGENT_A).toBe(true);
    }
    const bCart = await agentBCaller.getCart({});
    for (const item of bCart.items) {
      expect(item.customerId === CUST_B || item.agentId === AGENT_B).toBe(true);
    }
  });

  it("getSummary is caller-scoped; clearCart cancels ONLY the caller's scope", async () => {
    const summaryA = await agentACaller.getSummary({ customerId: CUST_B });
    const aPending = await pendingCountFor(CUST_A);
    expect(summaryA.count).toBe(aPending);

    const bBefore = await pendingCountFor(CUST_B);
    const cleared = await agentACaller.clearCart({ customerId: CUST_B });
    expect(cleared.cleared).toBe(true);
    // A's pending rows are gone; B's are untouched despite the supplied
    // foreign customerId.
    expect(await pendingCountFor(CUST_A)).toBe(0);
    expect(await pendingCountFor(CUST_B)).toBe(bBefore);
  });

  it("addToCart rejects a caller-supplied FOREIGN customerId with NOT_FOUND", async () => {
    await expect(
      agentACaller.addToCart({
        customerId: CUST_B,
        productId: PRODUCT_ID,
        sumInsured: 500000,
        durationMonths: 12,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("addToCart pins agentId = session agent and verifies the assigned customer", async () => {
    const r = await agentACaller.addToCart({
      customerId: CUST_A,
      productId: PRODUCT_ID,
      sumInsured: 500000,
      durationMonths: 12,
    });
    // Engine-sourced: 0.02 × 500000 = 10000 premium, 50 stamp, 10050 total.
    expect(r.premiumAmount).toBe(10000);
    expect(r.stampDuty).toBe(50);
    expect(r.quote.customerId).toBe(CUST_A);
    expect(r.quote.agentId).toBe(AGENT_A);
    expect(r.quote.status).toBe("pending");
  });
});
