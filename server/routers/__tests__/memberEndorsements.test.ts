/**
 * memberEndorsements.test.ts — R3 batch 5 (2026-10-01, R3-b5)
 *
 * Real-behavior PGlite tests for server/routers/memberEndorsements.ts
 * (harness copied from memberIdentity.test.ts — real embedded PostgreSQL,
 * ephemeral probeFreePort, faithful minimal table projections):
 *   - anonymous caller → UNAUTHORIZED
 *   - requestEndorsement IDOR closure: foreign policyId (BOTH identity
 *     spaces) → NOT_FOUND, ZERO endorsements rows created
 *   - ownership guard accepts the caller's dual-space policies
 *   - premiumAdjustment is recorded as a REQUEST field on the row (no funds
 *     movement — asserted as a stored value only)
 *   - myEndorsements: real COUNT, caller-scoped join, policyId filter on a
 *     foreign policy yields an honest empty list (non-enumerating)
 *
 * Identity spaces: caller user id 1 → customer 4242; foreign user id 2 →
 * customer 5555. Policies 101/102 caller-owned, 103/104 foreign.
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
  (typeof import("../memberEndorsements"))["memberEndorsementsRouter"]["createCaller"]
>;
let caller: Caller; // session user id 1 → customer 4242
let anonCaller: Caller;

const POLICY_OWN_USERS = 101;
const POLICY_OWN_CUST = 102;
const POLICY_FOREIGN_USERS = 103;
const POLICY_FOREIGN_CUST = 104;

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
    CREATE TYPE endorsement_type AS ENUM
      ('addition', 'deletion', 'modification', 'extension', 'reduction',
       'cancellation', 'reinstatement')`);

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

  // Full endorsements column set (drizzle/schema.ts:5104) — the mutation
  // inserts with .returning() (full row).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS endorsements (
      id serial PRIMARY KEY,
      "endorsementNumber" varchar(64) NOT NULL UNIQUE,
      "policyId" integer NOT NULL,
      type endorsement_type NOT NULL,
      "effectiveDate" timestamp NOT NULL,
      description text NOT NULL,
      "premiumAdjustment" numeric(18,2) DEFAULT '0',
      "sumInsuredAdjustment" numeric(18,2) DEFAULT '0',
      "changesDetail" json,
      "approvedBy" integer,
      "approvedAt" timestamp,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);

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
      (5555, 'Foreign', 'F', '09000000002', 'active', '2')
    ON CONFLICT DO NOTHING`);

  await db.execute(sql`
    INSERT INTO policies
      (id, "policyNumber", "productId", "customerId", status, "coverageType",
       "sumInsured", "annualPremium", "endDate")
    VALUES
      (${POLICY_OWN_USERS}, 'POL-OWN-1', 1, 1, 'active', 'life', 100000, 1000, '2027-01-01'),
      (${POLICY_OWN_CUST}, 'POL-OWN-2', 1, 4242, 'active', 'motor', 50000, 800, '2027-06-01'),
      (${POLICY_FOREIGN_USERS}, 'POL-FGN-1', 1, 2, 'active', 'life', 100000, 1000, '2027-01-01'),
      (${POLICY_FOREIGN_CUST}, 'POL-FGN-2', 1, 5555, 'active', 'life', 100000, 1000, '2027-01-01')`);

  // Seeded FOREIGN endorsement — must never surface in myEndorsements.
  await db.execute(sql`
    INSERT INTO endorsements
      ("endorsementNumber", "policyId", type, "effectiveDate", description)
    VALUES ('END-FOREIGN-1', ${POLICY_FOREIGN_USERS}, 'addition', '2026-11-01', 'Foreign endorsement')`);
}

async function endorsementCount(policyId: number): Promise<number> {
  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const db = (await getDb())!;
  const r = await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM endorsements WHERE "policyId" = ${policyId}`
  );
  return Number((r as any).rows?.[0]?.n ?? (r as any)[0]?.n);
}

beforeAll(async () => {
  await startPglite();
  await createTablesAndSeed();
  const { memberEndorsementsRouter } = await import("../memberEndorsements");
  caller = memberEndorsementsRouter.createCaller(makeAuthenticatedCtx());
  anonCaller = memberEndorsementsRouter.createCaller(makeUnauthenticatedCtx());
}, 60_000);

afterAll(() => {
  pgliteChild?.kill();
});

describe("memberEndorsements router (2026-10-01, R3-b5)", () => {
  it("rejects anonymous callers with UNAUTHORIZED", async () => {
    await expect(anonCaller.myEndorsements()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      anonCaller.requestEndorsement({
        policyId: POLICY_OWN_USERS,
        type: "addition",
        effectiveDate: "2026-11-01",
        description: "x",
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("requestEndorsement on a FOREIGN policy → NOT_FOUND, zero rows created (IDOR closed)", async () => {
    const beforeUsers = await endorsementCount(POLICY_FOREIGN_USERS);
    const beforeCust = await endorsementCount(POLICY_FOREIGN_CUST);
    for (const policyId of [POLICY_FOREIGN_USERS, POLICY_FOREIGN_CUST, 999999]) {
      await expect(
        caller.requestEndorsement({
          policyId,
          type: "addition",
          effectiveDate: "2026-11-01",
          description: "intruder",
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect(await endorsementCount(POLICY_FOREIGN_USERS)).toBe(beforeUsers);
    expect(await endorsementCount(POLICY_FOREIGN_CUST)).toBe(beforeCust);
  });

  it("requestEndorsement on the caller's OWN policies succeeds in BOTH identity spaces", async () => {
    const r1 = await caller.requestEndorsement({
      policyId: POLICY_OWN_USERS,
      type: "extension",
      effectiveDate: "2026-12-01",
      description: "Extend coverage to include spouse",
      premiumAdjustment: 250.75,
      sumInsuredAdjustment: 50000,
    });
    expect(r1.endorsement.policyId).toBe(POLICY_OWN_USERS);
    expect(r1.endorsement.type).toBe("extension");
    expect(r1.endorsementNumber).toContain(`-${POLICY_OWN_USERS}`);
    // premiumAdjustment is a recorded REQUEST field (a stored value only —
    // no funds moved; nothing debited anywhere).
    expect(Number(r1.endorsement.premiumAdjustment)).toBeCloseTo(250.75);
    expect(Number(r1.endorsement.sumInsuredAdjustment)).toBe(50000);
    expect(r1.endorsement.approvedAt).toBeNull();

    const r2 = await caller.requestEndorsement({
      policyId: POLICY_OWN_CUST,
      type: "modification",
      effectiveDate: "2026-12-15",
      description: "Change vehicle usage",
    });
    expect(r2.endorsement.policyId).toBe(POLICY_OWN_CUST);
    expect(Number(r2.endorsement.premiumAdjustment)).toBe(0);

    const { getDb } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    const db = (await getDb())!;
    const ev = await db.execute(
      sql`SELECT COUNT(*)::int AS n FROM fluvio_event_log
          WHERE topic = 'policy-events'
            AND payload->>'eventType' = 'policy.endorsement_requested'`
    );
    expect(Number((ev as any).rows?.[0]?.n ?? (ev as any)[0]?.n)).toBe(2);
  });

  it("myEndorsements returns only the caller's rows with real counts", async () => {
    const result = await caller.myEndorsements();
    expect(result.count).toBe(2);
    expect(result.endorsements).toHaveLength(2);
    const policyIds = result.endorsements.map(e => e.policyId).sort();
    expect(policyIds).toEqual([POLICY_OWN_USERS, POLICY_OWN_CUST]);
    expect(result.endorsements[0].currency).toBe("NGN");
    expect(JSON.stringify(result)).not.toContain("Foreign endorsement");
  });

  it("myEndorsements policyId filter on a FOREIGN policy yields an honest empty list", async () => {
    const result = await caller.myEndorsements({
      policyId: POLICY_FOREIGN_USERS,
    });
    expect(result).toEqual({ endorsements: [], count: 0 });
  });

  it("myEndorsements policyId filter narrows to the caller's own policy", async () => {
    const result = await caller.myEndorsements({ policyId: POLICY_OWN_USERS });
    expect(result.count).toBe(1);
    expect(result.endorsements[0].policyId).toBe(POLICY_OWN_USERS);
    expect(result.endorsements[0].policyNumber).toBe("POL-OWN-1");
  });
});
