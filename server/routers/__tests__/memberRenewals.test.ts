/**
 * memberRenewals.test.ts — R3 batch 5 (2026-10-01, R3-b5)
 *
 * Real-behavior PGlite tests for server/routers/memberRenewals.ts (harness
 * copied from memberIdentity.test.ts — real embedded PostgreSQL, ephemeral
 * probeFreePort, faithful minimal table projections):
 *   - anonymous caller → UNAUTHORIZED
 *   - requestRenewal IDOR closure: foreign policyId (BOTH identity spaces)
 *     → NOT_FOUND, ZERO policy_renewals rows created
 *   - ownership guard accepts the caller's dual-space policies
 *     (users.id AND resolved customers.id)
 *   - source logic preserved: cancelled policy → PRECONDITION_FAILED;
 *     duplicate pending renewal → CONFLICT; fluvio event row written
 *   - myRenewals: real COUNT, caller-scoped (seeded foreign renewal never
 *     appears), honest empty list for a member with no renewals
 *
 * Identity spaces: caller user id 1 → customer 4242; foreign user id 2 →
 * customer 5555. Policies 101/102/105 caller-owned (101 users.id space, 102
 * customers.id space, 105 cancelled), 103/104 foreign.
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

process.env.PERMIFY_FAIL_OPEN = "true";

type Caller = ReturnType<
  (typeof import("../memberRenewals"))["memberRenewalsRouter"]["createCaller"]
>;
let caller: Caller; // session user id 1 → customer 4242
let otherCaller: Caller; // session user id 7 → customer 7777 (no renewals)
let anonCaller: Caller;

const POLICY_OWN_USERS = 101;
const POLICY_OWN_CUST = 102;
const POLICY_FOREIGN_USERS = 103;
const POLICY_FOREIGN_CUST = 104;
const POLICY_CANCELLED = 105;

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
    CREATE TYPE customer_status AS ENUM
      ('pending_kyc', 'active', 'suspended', 'blacklisted')`);
  await db.execute(sql`
    CREATE TYPE policy_status AS ENUM
      ('draft', 'quoted', 'bound', 'active', 'endorsed', 'renewed',
       'cancelled', 'lapsed', 'expired', 'suspended')`);
  await db.execute(sql`
    CREATE TYPE coverage_type AS ENUM
      ('life', 'health', 'motor', 'property', 'liability', 'marine',
       'aviation', 'agriculture', 'credit', 'travel', 'micro', 'group_life',
       'annuity', 'pension')`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS customers (
      id serial PRIMARY KEY,
      "firstName" varchar(64) NOT NULL,
      "lastName" varchar(64) NOT NULL,
      phone varchar(20) NOT NULL,
      status customer_status NOT NULL DEFAULT 'pending_kyc',
      "keycloakSub" varchar(128) UNIQUE,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);

  // Faithful policies projection (guard select + renewal source select).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS policies (
      id serial PRIMARY KEY,
      "policyNumber" varchar(64) NOT NULL UNIQUE,
      "productId" integer NOT NULL,
      "customerId" integer NOT NULL,
      status policy_status NOT NULL DEFAULT 'draft',
      "coverageType" coverage_type NOT NULL,
      "sumInsured" numeric(18,2) NOT NULL,
      "annualPremium" numeric(18,2) NOT NULL,
      "startDate" timestamp,
      "endDate" timestamp,
      "renewalDate" timestamp,
      "certificateNumber" varchar(64),
      "tenantId" integer,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);

  // Full policy_renewals column set (drizzle/schema.ts:5129) — the mutation
  // inserts with .returning() (full row).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS policy_renewals (
      id serial PRIMARY KEY,
      "originalPolicyId" integer NOT NULL,
      "renewedPolicyId" integer,
      "renewalNoticeDate" timestamp,
      "renewalDueDate" timestamp NOT NULL,
      "renewalPremium" numeric(18,2),
      "isAutoRenewal" boolean DEFAULT false,
      status varchar(32) NOT NULL DEFAULT 'pending',
      "notificationSent" boolean DEFAULT false,
      "notificationSentAt" timestamp,
      "completedAt" timestamp,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);

  // Full fluvio_event_log column set (drizzle/schema.ts:5518).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS fluvio_event_log (
      id serial PRIMARY KEY,
      topic varchar(128) NOT NULL,
      partition integer,
      "offset" integer,
      key varchar(256),
      payload json,
      "processedAt" timestamp NOT NULL DEFAULT now(),
      status varchar(32) NOT NULL DEFAULT 'processed',
      "errorMessage" text,
      "createdAt" timestamp NOT NULL DEFAULT now()
    )`);

  await db.execute(sql`
    INSERT INTO customers (id, "firstName", "lastName", phone, status, "keycloakSub")
    VALUES
      (4242, 'Member', 'A', '09000000001', 'active', '1'),
      (5555, 'Foreign', 'F', '09000000002', 'active', '2'),
      (7777, 'Empty', 'E', '09000000003', 'active', '7')
    ON CONFLICT DO NOTHING`);

  await db.execute(sql`
    INSERT INTO policies
      (id, "policyNumber", "productId", "customerId", status, "coverageType",
       "sumInsured", "annualPremium", "endDate")
    VALUES
      (${POLICY_OWN_USERS}, 'POL-OWN-1', 1, 1, 'active', 'life', 100000, 1200.50, '2027-03-01'),
      (${POLICY_OWN_CUST}, 'POL-OWN-2', 1, 4242, 'bound', 'motor', 50000, 800, '2027-06-01'),
      (${POLICY_FOREIGN_USERS}, 'POL-FGN-1', 1, 2, 'active', 'life', 100000, 1000, '2027-01-01'),
      (${POLICY_FOREIGN_CUST}, 'POL-FGN-2', 1, 5555, 'active', 'life', 100000, 1000, '2027-01-01'),
      (${POLICY_CANCELLED}, 'POL-CXL-1', 1, 1, 'cancelled', 'life', 100000, 1000, '2027-01-01')`);

  // A seeded FOREIGN renewal (completed) — must never surface in myRenewals.
  await db.execute(sql`
    INSERT INTO policy_renewals
      ("originalPolicyId", "renewalDueDate", "renewalPremium", status)
    VALUES (${POLICY_FOREIGN_USERS}, '2027-01-01', 1000, 'completed')`);
}

async function renewalCount(policyId: number): Promise<number> {
  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const db = (await getDb())!;
  const r = await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM policy_renewals WHERE "originalPolicyId" = ${policyId}`
  );
  return Number((r as any).rows?.[0]?.n ?? (r as any)[0]?.n);
}

beforeAll(async () => {
  await startPglite();
  await createTablesAndSeed();
  const { memberRenewalsRouter } = await import("../memberRenewals");
  caller = memberRenewalsRouter.createCaller(makeAuthenticatedCtx());
  otherCaller = memberRenewalsRouter.createCaller(
    makeAuthenticatedCtx({ user: { ...makeAuthenticatedCtx().user!, id: 7 } as any })
  );
  anonCaller = memberRenewalsRouter.createCaller(makeUnauthenticatedCtx());
}, 60_000);

afterAll(() => {
  pgliteChild?.kill();
});

describe("memberRenewals router (2026-10-01, R3-b5)", () => {
  it("rejects anonymous callers with UNAUTHORIZED", async () => {
    await expect(anonCaller.myRenewals()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      anonCaller.requestRenewal({ policyId: POLICY_OWN_USERS })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("requestRenewal on a FOREIGN policy → NOT_FOUND, zero rows created (IDOR closed)", async () => {
    const beforeUsers = await renewalCount(POLICY_FOREIGN_USERS);
    const beforeCust = await renewalCount(POLICY_FOREIGN_CUST);
    await expect(
      caller.requestRenewal({ policyId: POLICY_FOREIGN_USERS })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      caller.requestRenewal({ policyId: POLICY_FOREIGN_CUST })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      caller.requestRenewal({ policyId: 999999 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await renewalCount(POLICY_FOREIGN_USERS)).toBe(beforeUsers);
    expect(await renewalCount(POLICY_FOREIGN_CUST)).toBe(beforeCust);
  });

  it("requestRenewal on the caller's OWN policies succeeds in BOTH identity spaces", async () => {
    const r1 = await caller.requestRenewal({
      policyId: POLICY_OWN_USERS,
      isAutoRenewal: true,
    });
    expect(r1.renewal.status).toBe("pending");
    expect(r1.renewal.originalPolicyId).toBe(POLICY_OWN_USERS);
    expect(Number(r1.renewal.renewalPremium)).toBeCloseTo(1200.5);
    expect(r1.renewal.isAutoRenewal).toBe(true);

    const r2 = await caller.requestRenewal({ policyId: POLICY_OWN_CUST });
    expect(r2.renewal.status).toBe("pending");

    // Fluvio event rows really written.
    const { getDb } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    const db = (await getDb())!;
    const ev = await db.execute(
      sql`SELECT COUNT(*)::int AS n FROM fluvio_event_log
          WHERE topic = 'policy-events'
            AND payload->>'eventType' = 'policy.renewal_requested'`
    );
    expect(Number((ev as any).rows?.[0]?.n ?? (ev as any)[0]?.n)).toBe(2);
  });

  it("requestRenewal rejects a cancelled policy and duplicate pending renewals", async () => {
    await expect(
      caller.requestRenewal({ policyId: POLICY_CANCELLED })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    // POLICY_OWN_USERS already has a pending renewal from the prior test.
    await expect(
      caller.requestRenewal({ policyId: POLICY_OWN_USERS })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("myRenewals returns only the caller's renewals with real counts", async () => {
    const result = await caller.myRenewals();
    expect(result.count).toBe(2);
    expect(result.renewals).toHaveLength(2);
    const policyIds = result.renewals.map(r => r.originalPolicyId).sort();
    expect(policyIds).toEqual([POLICY_OWN_USERS, POLICY_OWN_CUST]);
    expect(result.renewals[0].currency).toBe("NGN");
    // The seeded foreign renewal (POL-FGN-1) never appears.
    expect(JSON.stringify(result)).not.toContain("POL-FGN-1");
  });

  it("myRenewals is an honest empty list for a member with no renewals", async () => {
    const result = await otherCaller.myRenewals();
    expect(result).toEqual({ renewals: [], count: 0 });
  });
});
